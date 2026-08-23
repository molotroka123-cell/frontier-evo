// render/projection3d.js — чистая математика псевдо-3D камеры (стадия 1 ТЗ «ФРОНТИР 3D»).
//
// Зачем отдельный модуль: renderer.js считает экран линейно (sx = ox + wx*z,
// sy = oy + wy*z) — вид строго сверху. Цивовский наклон требует повернуть карту
// по yaw, сплющить вертикаль по pitch и поднять рельеф по высоте, при этом
// обратная задача (клик → тайл) обязана оставаться точной, иначе сломаются
// выделение и стройка. Математика выделена в файл без canvas/DOM/rng: её можно
// тестировать в node, кэшировать и переиспользовать любому слою.
//
// СОГЛАШЕНИЯ (не менять задним числом — на них встанут terrain/select/minimap):
//  • Экранные координаты — пиксели ОТНОСИТЕЛЬНО точки, куда проецируется цель
//    камеры. Рендер добавляет центр вьюпорта: absSx = cw/2 + p.sx.
//    Это прямой наследник старых ox,oy (ox = cw/2 − cam.x*z даёт тот же кадр
//    при yaw=0 и pitch=90°, так что переезд слоёв постепенный).
//  • yaw, pitch — радианы. По умолчанию yaw кратен 90° («вращение карты» как
//    в Цивилизации); общие углы математика держит, но сортировка глубины
//    гарантированно корректна именно на кратных 90°.
//  • pitch сжимает вертикаль карты по sin(pitch), а высота h поднимает точку
//    вверх экрана на h·cos(pitch)·zoom·TILE — при pitch→90° обе сходятся к
//    прежнему виду сверху, что и даёт совместимость со старым рендером.
//  • Всё детерминировано: ни Math.random, ни rng симуляции — только аргументы.
import { TILE } from '../core/data.js';
import { TILE_HEIGHT } from './palette.js';

// Базовый размер тайла — то же число, что TILE_PX в renderer.js: модуль не
// импортирует рендер (тот тянет canvas-слои), поэтому значение продублировано.
// Рассинхрон двух констант сделал бы клики неточными — проверяется тестом круга.
export const TILE_PX = 32;

// Пределы камеры по ТЗ. Радианы: 35°..60° наклона — ниже 35° карта «ложится»
// и здания перекрывают пол-экрана, выше 60° пропадает объём ради высот.
export const PITCH_MIN = 35 * Math.PI / 180;
export const PITCH_MAX = 60 * Math.PI / 180;
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2.5;

// Постоянная времени плавного хода камеры, сек. Подобрана так, что за 1 сек
// (60 кадров) остаточная ошибка < 0.01 тайла даже при перелёте через полкарты,
// а движение всё ещё заметно инерционным, а не мгновенным прыжком.
const CAM_TAU = 0.09;

// Безопасное чтение числа: NaN/undefined от сейва или ввода не должны ронять
// кадр и давать NaN-геометрию — подставляем осмысленный запасной вариант.
function num(v, dflt) {
  const n = +v;
  return Number.isFinite(n) ? n : dflt;
}

// Нормализация угла в диапазон [-π, π). Нужна, чтобы накопленный yaw после
// сотни вращений не уезжал в тысячи радианов и shortest-path интерполяция
// в camStep всегда крутила камеру короткой дугой.
export function wrapAngle(a) {
  let x = (num(a, 0) + Math.PI) % (2 * Math.PI);
  if (x < 0) x += 2 * Math.PI;
  return x - Math.PI;
}

// Камера по умолчанию: цель — центр мира 96×96 (как стартовый cam рендера),
// вид «сверху чуть наклонён». Возвращает ЗАЖАТУЮ камеру: невалидный ввод из
// UI/сейва не может вывести камеру за пределы ТЗ.
export function makeCam(over = {}) {
  return clampCam({
    yaw: over.yaw != null ? over.yaw : 0,
    pitch: over.pitch != null ? over.pitch : 45 * Math.PI / 180,
    zoom: over.zoom != null ? over.zoom : 1,
    targetX: over.targetX != null ? over.targetX : 48,
    targetY: over.targetY != null ? over.targetY : 48,
  });
}

// Зажим пределов. Возвращает НОВЫЙ объект — функции-чистые, мутация входа
// рассинхронила бы кэши слоёв, удерживающих ссылку на камеру.
export function clampCam(cam) {
  return {
    yaw: wrapAngle(num(cam.yaw, 0)),
    pitch: Math.min(PITCH_MAX, Math.max(PITCH_MIN, num(cam.pitch, 45 * Math.PI / 180))),
    zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, num(cam.zoom, 1))),
    targetX: num(cam.targetX, 0),
    targetY: num(cam.targetY, 0),
  };
}

// Прямая проекция мировой точки (x, y — непрерывные координаты как у жителей,
// h — высота рельефа в тех же единицах, что world.elev/TILE_HEIGHT).
// Порядок преобразований по ТЗ: сдвиг к цели → поворот yaw → сжатие pitch →
// масштаб zoom → подъём высоты. scale отдаётся наружу, чтобы старые слои
// считали свой размер спрайта как TILE_PX * scale, не зная геометрии камеры.
export function projectPoint(x, y, h, cam, tilePx = TILE_PX) {
  const dx = x - cam.targetX;
  const dy = y - cam.targetY;
  const c = Math.cos(cam.yaw), s = Math.sin(cam.yaw);
  const rx = dx * c - dy * s;          // карта вращается вокруг цели
  const ry = dx * s + dy * c;
  const sp = Math.sin(cam.pitch), cp = Math.cos(cam.pitch);
  const k = tilePx * cam.zoom;
  return {
    sx: rx * k,
    sy: ry * sp * k - num(h, 0) * cp * k, // высота поднимает точку вверх экрана
    scale: cam.zoom,
  };
}

// Проекция тайла — тонкая обёртка БЕЗ сдвига на полтайла: старый рендер ставит
// здания в ox + b.x*z (якорь в углу клетки), и совместимость якорей важнее
// «геометрической честности» центра. Для центра тайла передавайте tx+0.5.
export function projectTile(tx, ty, h, cam, tilePx = TILE_PX) {
  return projectPoint(tx, ty, h, cam, tilePx);
}

// Обратное ядро при ИЗВЕСТНОЙ высоте — аналитически, без итераций.
// Именно оно обеспечивает точный круг проекция↔клик: погрешность здесь только
// машинная (~1e-12), что снимает вопрос «недоезда» указателя на полтайла.
export function unprojectPoint(sx, sy, h, cam, tilePx = TILE_PX) {
  const k = tilePx * cam.zoom;
  const sp = Math.sin(cam.pitch), cp = Math.cos(cam.pitch);
  const rx = sx / k;
  const ry = (sy / k + num(h, 0) * cp) / sp; // высоту снимаем ДО раскрытия наклона
  const c = Math.cos(cam.yaw), s = Math.sin(cam.yaw);
  return {
    x: cam.targetX + rx * c + ry * s,
    y: cam.targetY - rx * s + ry * c,
  };
}

// Клик → тайл, когда высота под курсором заранее неизвестна. Решаем
// неподвижной точкой: начинаем с h=0, читаем рельеф в предположенной точке,
// пересчитываем. Рельеф меняется медленно относительно обзора, но на крутых
// склонах число нужных итераций растёт, поэтому цикл АДАПТИВНЫЙ: крутимся,
// пока очередная поправка не перестанет двигать точку (tol в тайлах), с
// потолком итераций против вечного цикла на «пиле» из обрывов. Схема
// фиксирована входом — тот же клик даёт бит-в-бит тот же результат.
export function screenToTile(sx, sy, cam, opts = {}) {
  const heightAt = opts.heightAt || null;
  const tol = num(opts.tol, 1e-6);
  const maxIters = Math.max(1, num(opts.iters, 12));
  let h = 0;
  let p = unprojectPoint(sx, sy, h, cam, opts.tilePx);
  for (let i = 0; i < maxIters && heightAt; i++) {
    h = num(heightAt(p.x, p.y), 0);
    const next = unprojectPoint(sx, sy, h, cam, opts.tilePx);
    const moved = Math.max(Math.abs(next.x - p.x), Math.abs(next.y - p.y));
    p = next;
    if (moved <= tol) break;
  }
  return { x: p.x, y: p.y, h };
}

// Ключ глубины для painter's algorithm: сортировка ПО ВОЗРАСТАНИЮ ключа =
// дальние рисуются раньше. Глубиной служит повёрнутая координата ry — та же,
// что гонит точку вниз экрана, поэтому порядок по ключу всегда согласован с
// порядком по sy (проверяется тестом монотонности на всех 4 yaw). На диагоналях,
// перпендикулярных взгляду, ключи совпадают: для земли порядок равнозначен,
// для стабильности компаратору стоит добавить вторичный признак (sx или индекс).
export function sortKey(tx, ty, cam) {
  const dx = tx - cam.targetX;
  const dy = ty - cam.targetY;
  return dx * Math.sin(cam.yaw) + dy * Math.cos(cam.yaw);
}

// Плавный ход камеры: экспоненциальное затухание к цели, k = 1 − exp(−dt/τ).
// Чистая функция — возвращает НОВУЮ камеру, входы не мутирует: состояние
// анимации остаётся созванным снаружи, и один и тот же вход даёт бит-в-бит
// одинаковый выход (детерминизм без rng). yaw интерполируется короткой дугой,
// иначе поворот на 270° крутит камеру три четверти лишнего круга.
export function camStep(cam, target, dt, opts = {}) {
  const tau = num(opts.tau, CAM_TAU);
  const t = Math.max(0, num(dt, 0));
  const k = t > 0 ? 1 - Math.exp(-t / tau) : 0;
  const dYaw = wrapAngle(num(target.yaw, 0) - cam.yaw);
  return clampCam({
    yaw: cam.yaw + dYaw * k,
    pitch: cam.pitch + (num(target.pitch, cam.pitch) - cam.pitch) * k,
    zoom: cam.zoom + (num(target.zoom, cam.zoom) - cam.zoom) * k,
    targetX: cam.targetX + (num(target.targetX, cam.targetX) - cam.targetX) * k,
    targetY: cam.targetY + (num(target.targetY, cam.targetY) - cam.targetY) * k,
  });
}

// Высота точки мира. Приоритет — baked world.elev из worldgen2 (непрерывные
// значения с шумом, горы читаются мягко); миру gen1 elev не достался, поэтому
// запасной путь — табличная высота по типу тайла (те же числа, что
// palette.TILE_HEIGHT: два разных масштаба высот заставили бы здания «всплывать»
// над своим холмом). Вне карты — уровень глубокой воды, как у tileAt.
export function tileHeightAt(world, x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const outside = !world || xi < 0 || yi < 0 ||
    xi >= (world.w | 0) || yi >= (world.h | 0);
  if (outside) return TILE_HEIGHT[TILE.DEEP];
  if (world.elev) return world.elev[yi * world.w + xi];
  return TILE_HEIGHT[world.tiles[yi * world.w + xi]] || 0;
}

// ---------------------------------------------------------------------------
// ПОДКЛЮЧЕНИЕ (app/src/render/renderer.js — применит ведущий; существующий код
// не ломается: view3d живёт ПАРАЛЛЕЛЬНО старой this.cam до переезда слоёв).
//
// Шаг 1. Импорт. Якорь (Grep=1):
//   import { settlementView } from '../core/systems/settlement_view.js';
// Вставить ПОСЛЕ:
//   import { makeCam, projectPoint, screenToTile, sortKey, camStep, tileHeightAt } from './projection3d.js';
//
// Шаг 2. Состояние. Якорь (Grep=1):
//   this.cam = { x: 48, y: 48, zoom: 1 };
// Вставить ПОСЛЕ (минимапа/coach/main читают this.cam.x/y — их трогать нельзя):
//   this.view3d = makeCam({ targetX: 48, targetY: 48 });
//
// Шаг 3. Клики. Якорь (Grep=1):
//   screenToWorld(sx, sy) {
// Заменить метод целиком на:
//   screenToWorld(sx, sy) {
//     if (!this.world3d) {
//       return {
//         x: this.cam.x + (sx - this.canvas.width / this.dpr / 2) / (TILE_PX * this.cam.zoom),
//         y: this.cam.y + (sy - this.canvas.height / this.dpr / 2) / (TILE_PX * this.cam.zoom),
//       };
//     }
//     const cw2 = this.canvas.width / this.dpr / 2, ch2 = this.canvas.height / this.dpr / 2;
//     const p = screenToTile(sx - cw2, sy - ch2, this.view3d, {
//       heightAt: (x, y) => tileHeightAt(this.world3d, x, y),
//     });
//     return { x: p.x, y: p.y };
//   }
// (поле this.world3d присваивает main.js вместе с sim.world; пока оно пусто —
// работает старый путь, риск отката нулевой.)
//
// Шаг 4 (стадия 2, отдельно). В draw(): экранные координаты объектов —
//   const p = projectPoint(b.x, b.y, tileHeightAt(sim.world, b.x, b.y), this.view3d);
//   const sx = cw / 2 + p.sx, sy = ch / 2 + p.sy;
// сортировка глубины вместо items.sort((p, q) => p.y - q.y):
//   items.sort((a, b) => sortKey(a.wx, a.wy, this.view3d) - sortKey(b.wx, b.wy, this.view3d));
// ход камеры раз в кадр (dtReal уже есть в draw):
//   this.view3d = camStep(this.view3d, this.camTarget3d, dtReal);
