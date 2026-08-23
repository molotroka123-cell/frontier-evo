// render/relief3d.js — 3D-РЕЛЬЕФ (стадия 1 ТЗ «ФРОНТИР 3D»): земля как плиты.
//
// ═══════════════════════════ ЗАЧЕМ ═══════════════════════════
// Плоская заливка terrain.draw кладёт местность одним блитом чанка: высота
// существует только как цвет, объёма нет совсем — гряда гор отличается от луга
// оттенком серого. Здесь каждый тайл становится ПЛИТОЙ: верхняя грань по
// проекции плюс боковые стенки до нулевого уровня, затемнённые на 12 % (южная
// грань) и 22 % (восточная при базовом азимуте) — псевдоосвещение с
// фиксированного направления света, того же канона «сверху-слева», что у
// terrain.buildHeight и спрайтов. Вода лежит чуть ниже нулевой отметки и несёт
// блик-полоску — берег читается уступом ещё до всякой анимации воды.
//
// ═══════════════════ КОНТРАКТ С ПРОЕКТОРОМ ═══════════════════
// Проекция берётся из render/projection3d.js агента 17:
//   projectPoint(x, y, h, cam, tilePx) → {sx, sy} ОТНОСИТЕЛЬНО точки цели
//   камеры (экран добавляет центр вьюпорта сам);
//   sortKey(tx, ty, cam)               — ключ глубины, меньше = дальше.
// Импорт МЯГКИЙ (динамический, в try/catch): агент 17 писал файл параллельно,
// и на время его отсутствия работает локальный fallback с ТОЙ ЖЕ формой
// контракта (вид без вращения карты, yaw = 0). Когда файл на месте — он
// подхватывается сам, переключать импорт вручную не нужно; блок ПОДКЛЮЧЕНИЯ
// внизу описывает только правки renderer.js.
//
// ═══════════════════ ДВА МАСШТАБА ВЫСОТ ═══════════════════
// У этого слоя своя шкала высот heightAt(): 0..3 «плит» (вода 0, равнина 0..1,
// холм ~2, гора ~3). У projection3d.tileHeightAt другая — TILE_HEIGHT из
// palette.js (−0.55..1.35) под якоря зданий. Смешивать нельзя: здания обязаны
// стоять на своей отметке, плиты — показывать тир клетки. projectPoint высоте
// всё равно: он умножает её на cos(pitch)·k, единицы выбирает вызывающий.
//
// ═══════════════════════ ГРАНИЦЫ ═══════════════════════
// Модуль только читает world.tiles / world.elev и не пишет ничего ни в мир,
// ни в симуляцию. WALKABLE ему не нужен: проходимость — дело ядра, рельефу
// важна лишь отметка высоты.
//
// СЛУЧАЙНОСТЬ. Ни Math.random, ни общий генератор симуляции: рендер идёт у
// разных игроков с разной частотой, и каждый вызов общего генератора сдвинул
// бы состояние партии и поплыли бы сейвы. Все «случайные» решения выводятся
// из hash(world.seed, x, y) — та же схема, что в weather.js/water.js/renderer.js.
import { TILE } from '../core/data.js';
import { TERRAIN, shade } from './palette.js';

// ─── мягкий импорт проектора ─────────────────────────────────────────────
// Верхний await допустим: приложение живёт на нативных ES-модулях. Если файла
// ещё нет (параллельная сдача агента 17) — молча работаем на fallback.
let _p3d = null;
try { _p3d = await import('./projection3d.js'); } catch { _p3d = null; }

// ─── геометрия вида ──────────────────────────────────────────────────────
const WATER_DROP = 0.14;      // вода ниже нулевого уровня — берег выходит уступом
const BASE_TILE_PX = 32;      // пикселей тайла при zoom=1 — как TILE_PX у проектора
const DEFAULT_PITCH = Math.PI / 4;   // тот же наклон по умолчанию, что makeCam()
const MIN_WALL_PX = 10;       // ниже этого экранного размера стенка субпиксельна

// ─── качество (см. render/quality.js) ────────────────────────────────────
// Потолок плит на кадр по пресетам. Сверху него — упрощение без стенок:
// верхняя грань стоит одну заливку, и худший кадр остаётся конечным. На eco
// слой молчит ЦЕЛИКОМ: пресет живёт одним блитом чанка, тысяча path-заливок
// его убивает — тот же критерий, по которому quality.js отключает richRelief.
const CAPS = { eco: 700, medium: 1600, high: 3200, ultra: 5200 };
const FIELDS_KEEP = 4;        // сколько полей высот держим в кэше (по числу миров)

// Детерминированный хеш от сида мира и координат. Смеситель тот же, что в
// palette.hash2 и renderer.hashSeed, плюс слагаемое сида: два мира с одной
// расстановкой тайлов не должны получить одинаковую фактуру высот.
function hashSeed(seed, x, y, salt) {
  let h = (x * 374761393 + y * 668265263 + (seed | 0) * 1442695041 + salt * 2246822519) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Когерентный (гладкий) шум 0..1: решётка хешей с интерполяцией по сглаженному
// весу, две октавы. Гладкость обязательна: поклеточный независимый шум дал бы
// шахматку высот на равнине, а крупные пятна первой октавы как раз рисуют
// природные увалы и ложбины.
function vnoise(seed, x, y) {
  const oct = (f, salt) => {
    const fx = x * f, fy = y * f;
    const xi = Math.floor(fx), yi = Math.floor(fy);
    let sx = fx - xi, sy = fy - yi;
    sx = sx * sx * (3 - 2 * sx); sy = sy * sy * (3 - 2 * sy);
    const a = hashSeed(seed, xi, yi, salt), b = hashSeed(seed, xi + 1, yi, salt);
    const c = hashSeed(seed, xi, yi + 1, salt), d = hashSeed(seed, xi + 1, yi + 1, salt);
    const top = a + (b - a) * sx, bot = c + (d - c) * sx;
    return top + (bot - top) * sy;
  };
  return oct(0.09, 7) * 0.64 + oct(0.31, 13) * 0.36;
}

// ===========================================================================
// ПОЛЕ ВЫСОТ: 0 — вода, 0..1 — равнина, ~2 — холм, ~3 — гора.
//
// Источник два, и оба нужны. Тип клетки задаёт ТИР: игра балансируется по
// нему (шахте нужна гора, каменоломне холм — см. needTile в data.js), поэтому
// высота не смеет перепрыгнуть тир. Шум от сида размывает ступени внутри тира:
// без него гряда — плато с отвесным краем, то самое, на что жалуется шапка
// relief.js. Если мир собран worldgen2 и несёт настоящую карту elev, она
// подтягивает переходы к природной форме, но тир по-прежнему главнее.
// ===========================================================================
export function buildHeightField(world) {
  const w = world.w | 0, h = world.h | 0, N = w * h;
  const t = world.tiles;
  const elev = (world.elev && world.elev.length === N) ? world.elev : null;

  // Размах elev для нормировки — один проход, поле строится раз на мир.
  let eMin = Infinity, eMax = -Infinity;
  if (elev) {
    for (let i = 0; i < N; i++) {
      const e = elev[i];
      if (e < eMin) eMin = e;
      if (e > eMax) eMax = e;
    }
  }
  const span = elev && eMax - eMin > 1e-6 ? eMax - eMin : 0;
  const seed = world.seed | 0;

  const H = new Float32Array(N);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, tt = t[i];
      if (tt === TILE.DEEP || tt === TILE.WATER) continue;   // вода ровно 0 — уровень моря
      const n = vnoise(seed, x, y);
      let v;
      if (tt === TILE.MOUNTAIN) {
        v = 3 - (1 - n) * 0.25;                 // 2.75..3: гребень дышит, вершины разные
      } else if (tt === TILE.HILL) {
        v = 1.72 + n * 0.56;                    // 1.72..2.28
      } else {
        // Равнина занимает ВСЮ полку 0..1: песчаная кромка низкая (берег),
        // лес повыше травы, шум разводит пятна — иначе плоская равнина
        // читается заливкой, а не землёй.
        const base = tt === TILE.SAND ? 0.16 : tt === TILE.FOREST ? 0.50 : 0.34;
        v = base + (n - 0.5) * (tt === TILE.SAND ? 0.26 : 0.66);
        if (v < 0.05) v = 0.05; else if (v > 1) v = 1;
      }
      if (span > 0) {
        // elev смягчает переходы между тирами, но вес тира больше: тип клетки
        // — игровой контракт, elev — картинка.
        const e = (elev[i] - eMin) / span * 3;
        v = v * 0.62 + e * 0.38;
        if (v < 0.03) v = 0.03;
      }
      H[i] = v;
    }
  }
  return { w, h, H };
}

// Кэш полей по миру. Не больше четырёх: миры плодятся при каждой загрузке
// сейва, и вечный реестр копил бы мёртвые массивы 96×96 за каждую партию.
const _fields = new Map();

function fieldOf(world) {
  let f = _fields.get(world);
  if (!f) {
    f = buildHeightField(world);
    _fields.set(world, f);
    while (_fields.size > FIELDS_KEEP) _fields.delete(_fields.keys().next().value);
  }
  return f;
}

// Высота клетки 0..3. Дробные координаты округляются вниз — как tileAt().
// За краем мира 0: там океан, ровно как tileAt() в core/world.js отдаёт
// TILE.DEEP за границей.
export function heightAt(world, x, y) {
  const f = fieldOf(world);
  const xi = Math.floor(x), yi = Math.floor(y);
  if (xi < 0 || yi < 0 || xi >= f.w || yi >= f.h) return 0;
  return f.H[yi * f.w + xi];
}

// ===========================================================================
// ПРОЕКТОР: живой projection3d.js либо локальный fallback ТОГО ЖЕ контракта.
//
// ПОЧЕМУ FALLBACK ТАКОЙ. Контракт агент 17 зафиксировал жёстко: координаты
// относительно цели камеры, камера {yaw, pitch, zoom, targetX, targetY},
// пикселей на клетку = tilePx·zoom. Fallback повторяет формулы при yaw = 0:
// на старте карта не вращается, а когда настоящий файл появится, ветка
// просто перестанет использоваться — менять вызовы не нужно ни в одном месте.
// Анимацию камеры (camStep) рельефу брать неоткуда и не надо: слой рисует по
// мгновенному состоянию камеры, плавный ход живёт в renderer/projection3d.
// ===========================================================================
const _fallbackProject = (x, y, h, cam, tilePx = BASE_TILE_PX) => {
  const k = tilePx * cam.zoom;
  const sp = Math.sin(DEFAULT_PITCH), cp = Math.cos(DEFAULT_PITCH);
  return {
    sx: (x - cam.targetX) * k,
    sy: (y - cam.targetY) * k * sp - (h || 0) * k * cp,
  };
};
const _fallbackUnproject = (sx, sy, h, cam, tilePx = BASE_TILE_PX) => {
  const k = tilePx * cam.zoom;
  const sp = Math.sin(DEFAULT_PITCH), cp = Math.cos(DEFAULT_PITCH);
  return {
    x: cam.targetX + sx / k,
    y: cam.targetY + (sy / k + (h || 0) * cp) / sp,
  };
};
const _fallbackSortKey = (tx, ty, cam) => ty - cam.targetY;   // yaw=0: глубина — это строки

const projectOf = (x, y, h, cam, tilePx) =>
  (_p3d && _p3d.projectPoint ? _p3d.projectPoint : _fallbackProject)(x, y, h, cam, tilePx);
const unprojectOf = (sx, sy, h, cam, tilePx) =>
  (_p3d && _p3d.unprojectPoint ? _p3d.unprojectPoint : _fallbackUnproject)(sx, sy, h, cam, tilePx);

// Глубина плиты: меньше — дальше от зрителя. Тот же контракт, что у
// projection3d.sortKey (ключ согласован с экранным sy, поэтому порядок по
// ключу всегда совпадает с порядком перекрытия).
export function sortKey(tx, ty, cam) {
  return (_p3d && _p3d.sortKey ? _p3d.sortKey : _fallbackSortKey)(tx, ty, cam);
}

// Камера контракта projection3d. Старую плоскую {x, y, zoom} конвертируем:
// стадия 1 живёт параллельно со старым рендером, и renderer ещё не обязан
// держать makeCam — но и дублировать его сюда не хочется (он зажимает пределы
// своим законом), поэтому конвертация минимальная и локальная.
function camOf(cam) {
  if (cam && typeof cam.targetX === 'number') return cam;
  const c = cam || {};
  return {
    yaw: 0,
    pitch: DEFAULT_PITCH,
    zoom: c.zoom > 0 ? c.zoom : 1,
    targetX: c.targetX != null ? c.targetX : (c.x || 0),
    targetY: c.targetY != null ? c.targetY : (c.y || 0),
  };
}

// ===========================================================================
// ОДНА ПЛИТА. Верхняя грань — четырёхугольник проекций углов клетки на высоте
// hh, стенки — от верхних рёбер до нулевого уровня: общая нижняя кромка у
// соседей означает стык без щелей, а берег честно нависает над зерном воды
// (его верх на −WATER_DROP). Затенение граней фиксированное — юг −12 %,
// восток −22 %: две готовые тональности вместо расчёта нормалей в кадре.
// Возвращает число залитых граней — для тестов и отладочных счётчиков.
// ===========================================================================
export function drawTile3d(ctx, world, x, y, cam, palette = TERRAIN[0], opts = {}) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const f = fieldOf(world);
  if (xi < 0 || yi < 0 || xi >= f.w || yi >= f.h) return 0;
  const i = yi * f.w + xi;
  const tt = world.tiles[i];
  const hh = f.H[i];
  const wet = tt === TILE.DEEP || tt === TILE.WATER;

  // Палитра может быть сезонной или урезанной: чужой тайл — не повод падать.
  const p = (palette && palette[tt]) || { base: '#808080', lo: '#606060', hi: '#a0a0a0' };
  // Пестрота верхней грани — от сида, как «непластиковая» заливка в
  // terrain.buildLow: кадр в кадр одинакова, панорама её не перетасовывает.
  const topCol = shade(p.base, wet ? 0.06 : 0.04 + hashSeed(world.seed, xi, yi, 3) * 0.08);

  const cam3d = camOf(cam);
  const tilePx = opts.tilePx > 0 ? opts.tilePx : BASE_TILE_PX;
  const cx = opts.cx || 0, cy = opts.cy || 0;   // экранное положение цели камеры
  const P = (wx, wy, wh) => {
    const q = projectOf(wx, wy, wh, cam3d, tilePx);
    return { x: cx + q.sx, y: cy + q.sy };
  };

  const zTop = wet ? -WATER_DROP : hh;
  const A = P(xi, yi, zTop);
  const B = P(xi + 1, yi, zTop);
  const C = P(xi + 1, yi + 1, zTop);
  const D = P(xi, yi + 1, zTop);

  let faces = 0;

  if (!wet && hh >= 0.03 && opts.walls !== false) {
    const As = P(xi, yi + 1, 0);
    const Bs = P(xi + 1, yi, 0);
    const Cs = P(xi + 1, yi + 1, 0);
    ctx.fillStyle = shade(p.base, -0.12);          // южная грань: ловит канонический свет
    ctx.beginPath();
    ctx.moveTo(D.x, D.y); ctx.lineTo(C.x, C.y);
    ctx.lineTo(Cs.x, Cs.y); ctx.lineTo(As.x, As.y);
    ctx.closePath(); ctx.fill(); faces++;
    ctx.fillStyle = shade(p.base, -0.22);          // восточная: теневая сторона плиты
    ctx.beginPath();
    ctx.moveTo(B.x, B.y); ctx.lineTo(C.x, C.y);
    ctx.lineTo(Cs.x, Cs.y); ctx.lineTo(Bs.x, Bs.y);
    ctx.closePath(); ctx.fill(); faces++;
  }

  ctx.fillStyle = topCol;
  ctx.beginPath();
  ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y);
  ctx.lineTo(C.x, C.y); ctx.lineTo(D.x, D.y);
  ctx.closePath(); ctx.fill(); faces++;

  if (wet) {
    // Блик-полоска поперёк зеркала. Положение — из хеша клетки: без разлёта
    // полоски складывались бы в регулярную решётку «жалюзи».
    const k = tilePx * cam3d.zoom;
    const j = (hashSeed(world.seed, xi, yi, 11) - 0.5) * 0.30;
    const uL = 0.38 + j, uR = 0.62 + j;
    const Lx = A.x + (D.x - A.x) * uL, Ly = A.y + (D.y - A.y) * uL;
    const Rx = B.x + (C.x - B.x) * uR, Ry = B.y + (C.y - B.y) * uR;
    ctx.strokeStyle = 'rgba(210,236,255,0.20)';
    ctx.lineWidth = Math.max(1, k * 0.09);
    ctx.beginPath();
    ctx.moveTo(Lx + (B.x - A.x) * 0.16, Ly + (B.y - A.y) * 0.16);
    ctx.lineTo(Rx - (B.x - A.x) * 0.16, Ry - (B.y - A.y) * 0.16);
    ctx.stroke();
  }
  return faces;
}

// ===========================================================================
// ПАКЕТНЫЙ КАДР.
// collectTiles — чистая часть (отсечение + сортировка глубины), её проверяют
// тесты; drawRelief3d — тонкий проход по готовому списку.
// Отсечение точное, по экранному AABB плиты: стенки уходят вниз до нулевого
// уровня, поэтому плита с вершиной ЗА нижним краем экрана всё ещё видна
// стенкой — и обязана остаться в списке.
// ===========================================================================
export function collectTiles(world, viewRect, cam, opts = {}) {
  const f = fieldOf(world);
  const cam3d = camOf(cam);
  const tilePx = opts.tilePx > 0 ? opts.tilePx : BASE_TILE_PX;
  const cx = viewRect.cx || 0, cy = viewRect.cy || 0;

  // Окно поиска: разворачиваем углы экрана обратно в мир (высота 0 — стены
  // только добавляют вниз, вверх ничего не торчит) и берём рамку с запасом.
  // Лишних кандидатов не боится точечная проверка AABB ниже.
  const cs = [
    unprojectOf(-cx, -cy, 0, cam3d, tilePx),
    unprojectOf(viewRect.cw - cx, -cy, 0, cam3d, tilePx),
    unprojectOf(-cx, viewRect.ch - cy, 0, cam3d, tilePx),
    unprojectOf(viewRect.cw - cx, viewRect.ch - cy, 0, cam3d, tilePx),
  ];
  let wx0 = Infinity, wx1 = -Infinity, wy0 = Infinity, wy1 = -Infinity;
  for (const q of cs) {
    if (q.x < wx0) wx0 = q.x; if (q.x > wx1) wx1 = q.x;
    if (q.y < wy0) wy0 = q.y; if (q.y > wy1) wy1 = q.y;
  }
  const PAD = 2;
  const x0 = Math.max(0, Math.floor(wx0) - PAD), x1 = Math.min(f.w - 1, Math.ceil(wx1) + PAD);
  const y0 = Math.max(0, Math.floor(wy0) - PAD), y1 = Math.min(f.h - 1, Math.ceil(wy1) + PAD);

  const out = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * f.w + x;
      const tt = world.tiles[i];
      const wet = tt === TILE.DEEP || tt === TILE.WATER;
      const hh = f.H[i];
      const zTop = wet ? -WATER_DROP : hh;
      const a = projectOf(x, y, zTop, cam3d, tilePx);
      const b = projectOf(x + 1, y, zTop, cam3d, tilePx);
      const c = projectOf(x + 1, y + 1, zTop, cam3d, tilePx);
      const d = projectOf(x, y + 1, zTop, cam3d, tilePx);
      const minX = Math.min(a.sx, b.sx, c.sx, d.sx) + cx;
      const maxX = Math.max(a.sx, b.sx, c.sx, d.sx) + cx;
      const minY = Math.min(a.sy, b.sy, c.sy, d.sy) + cy;
      // Низ AABB: нулевая отметка лежит ниже верхней грани ровно на
      // hh·cos(pitch)·k (у воды — ещё на каплю ниже её зеркала).
      const cp = Math.abs(Math.cos(cam3d.pitch));
      const drop = (wet ? WATER_DROP : hh) * cp * tilePx * cam3d.zoom;
      const maxY = Math.max(a.sy, b.sy, c.sy, d.sy) + cy + drop;
      if (maxX <= 0 || minX >= viewRect.cw || maxY <= 0 || minY >= viewRect.ch) continue;
      out.push({ key: sortKey(x + 1, y + 1, cam3d), x, y });
    }
  }
  out.sort((p, q) => p.key - q.key || p.x - q.x || p.y - q.y);
  return out;
}

// Гейт качества — единственное место, где слой решает «рисовать ли вообще»
// и какой потолок плит действует. Пресеты читаются утиной типизацией: у всех
// пресетов quality.js есть id, добавлять поле туда ради одного слоя не нужно.
export function relief3dGate(quality) {
  const id = (quality && quality.id) || 'high';
  const cap = CAPS[id] != null ? CAPS[id] : CAPS.high;
  return { on: id !== 'eco', cap };
}

// Отрисовка рельефа за кадр. cam — камера контракта projection3d (или старая
// плоская {x, y, zoom} — см. camOf). viewRect — {cx, cy, cw, ch}: cx/cy — где
// на экране стоит цель камеры (renderer передаёт cw/2, ch/2 — центр вьюпорта).
// Возвращает число плит в кадре.
export function drawRelief3d(ctx, world, cam, viewRect, opts = {}) {
  if (!ctx || !world || !world.tiles) return 0;
  const gate = relief3dGate(opts.quality);
  if (!gate.on) return 0;

  const cam3d = camOf(cam);
  const tilePx = opts.tilePx > 0 ? opts.tilePx : BASE_TILE_PX;
  const items = collectTiles(world, viewRect, cam3d, { tilePx });

  const palette = opts.palette || TERRAIN[0];
  const cap = typeof opts.cap === 'number' ? opts.cap : gate.cap;
  // Стенки гасятся дважды: потолком (худший кадр должен оставаться конечным)
  // и малым экранным размером — субпиксельная стенка стоит столько же, сколько
  // пользы не приносит никакой.
  const k = tilePx * cam3d.zoom;
  const walls = k >= MIN_WALL_PX && opts.walls !== false;

  let drawn = 0;
  for (let n = 0; n < items.length; n++) {
    drawTile3d(ctx, world, items[n].x, items[n].y, cam3d, palette, {
      walls: walls && n < cap,
      tilePx,
      cx: viewRect.cx || 0,
      cy: viewRect.cy || 0,
    });
    drawn++;
  }
  return drawn;
}

// ═══════════════════════════════════════════════════════════════════════════
// ПОДКЛЮЧЕНИЕ (правку в app/src/render/renderer.js делает ведущий)
//
// ФЛАГ. sim.view3d — режим «объёмной земли», по умолчанию ВЫКЛ (нет поля —
// выключено). До замеров FPS включать нельзя: тысяча path-заливок против
// одного блита чанка — это не улучшение, а риск. Предложение: чекбокс
// «Объёмная земля» в настройках графики + горячая клавиша V; значение хранить
// в localStorage ('frontier_view3d', '1'/'0') и НЕ сериализовать в сейв — это
// настройка вида, а не состояние партии. main.js при старте:
//   sim.view3d = localStorage.getItem('frontier_view3d') === '1';
//
// 1) ИМПОРТ. Якорь — единственная строка в файле:
//      import { ReliefLayer } from './relief.js';
//    Вставить сразу после неё:
//      import { drawRelief3d, relief3dGate } from './relief3d.js';
//    И в существующую строку `import { lightAt, hash2 } from './palette.js';`
//    добавить TERRAIN:
//      import { lightAt, hash2, TERRAIN } from './palette.js';
//
// 2) КАДР. Якорь (начало Renderer.draw, две строки с точным текстом):
//      // --- местность (чанками, рельефное освещение, береговая линия) ---
//      this.terrain.draw(ctx, sim, ox, oy, z, cw, ch);
//    Заменить на:
//      // --- местность: 3D-плиты по флагу sim.view3d, иначе плоские чанки ---
//      if (sim.view3d && relief3dGate(this.quality).on) {
//        drawRelief3d(ctx, sim.world, this.cam,
//          { cx: cw / 2, cy: ch / 2, cw, ch },
//          { palette: TERRAIN[sim.seasonIdx] || TERRAIN[0], quality: this.quality });
//      } else {
//        this.terrain.draw(ctx, sim, ox, oy, z, cw, ch);
//      }
//    Старую this.cam можно отдавать как есть: relief3d сам приводит её к
//    камере контракта projection3d (yaw 0, pitch 45°, target = cam.x/y).
//    Когда ведущий заведёт this.view3d из блока ПОДКЛЮЧЕНИЯ projection3d.js,
//    достаточно передавать её вместо this.cam — больше никаких правок.
//
// 3) СЛОИ ПОВЕРХ. Здания/жители продолжают рисоваться в ox + wx*z: пока
//    pitch близок к вертикали, кадры почти совпадают; полный переезд слоёв на
//    projectPoint — стадия 2 (см. ПОДКЛЮЧЕНИЕ в projection3d.js). До того
//    момента флаг sim.view3d остаётся экспериментальным — потому он и ВЫКЛ.
// ═══════════════════════════════════════════════════════════════════════════
