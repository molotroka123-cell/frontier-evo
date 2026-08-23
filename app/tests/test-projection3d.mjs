// Тесты чистой математики псевдо-3D камеры (app/src/render/projection3d.js).
// Запуск: node app/tests/test-projection3d.mjs
//
// Модуль не знает ни canvas, ни DOM — проверяется только геометрия: круг
// проекция↔клик, порядок отрисовки по глубине на всех поворотах карты,
// пределы камеры, сходимость плавного хода и линейность зума.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TILE } from '../src/core/data.js';

const {
  TILE_PX, PITCH_MIN, PITCH_MAX, ZOOM_MIN, ZOOM_MAX,
  wrapAngle, makeCam, clampCam,
  projectPoint, projectTile, unprojectPoint, screenToTile,
  sortKey, camStep, tileHeightAt,
} = await import('../src/render/projection3d.js');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('OK', name); } catch (e) { fail++; console.log('FAIL', name, '—', e.message); } };
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const near = (a, b, eps, msg) => ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b} (допуск ${eps})`);

const DEG = Math.PI / 180;
// Сетка камер: все 4 «цивовских» поворота × крайние и средний наклон ×
// крайние и базовый зум. Круг точности обязан держаться на ЛЮБОЙ из них —
// именно на границах диапазонов копится вычислительная погрешность.
const YAWS = [0, 90 * DEG, 180 * DEG, -90 * DEG];
const camGrid = [];
for (const yaw of YAWS)
  for (const pitch of [PITCH_MIN, 45 * DEG, PITCH_MAX])
    for (const zoom of [ZOOM_MIN, 1, ZOOM_MAX])
      camGrid.push(makeCam({ yaw, pitch, zoom, targetX: 48.3, targetY: 47.7 }));

// Детерминированный разброс тайлов вместо Math.random: арифметика по индексу
// даёт один и тот же набор точек при каждом запуске.
const scatter = (i, m) => ((i * 73 + i * i * 19) % (2 * m)) - m;

// --------------------------------------------------- круг проекция↔клик
t('круг project↔unproject: сетка точек, h=0, погрешность < 0.5px на всех камерах', () => {
  for (const cam of camGrid) {
    for (let gx = -5; gx <= 5; gx++) for (let gy = -5; gy <= 5; gy++) {
      const x = 48 + gx * 4 + 0.25, y = 47 + gy * 4 - 0.75;
      const p = projectPoint(x, y, 0, cam);
      const back = unprojectPoint(p.sx, p.sy, 0, cam);
      // Переводим расхождение мировых координат в пиксели экрана: допуск ТЗ — в px
      const errPx = Math.hypot(back.x - x, back.y - y) * TILE_PX * cam.zoom;
      if (!(errPx < 0.5)) throw new Error(`yaw=${cam.yaw.toFixed(2)} point=(${x},${y}) ошибка ${errPx}px`);
    }
  }
});

t('круг через screenToTile без heightAt совпадает с аналитическим ядром', () => {
  const cam = makeCam({ yaw: 90 * DEG, pitch: 40 * DEG, zoom: 1.7 });
  const p = projectPoint(51.5, 43.25, 0, cam);
  const hit = screenToTile(p.sx, p.sy, cam);
  near(hit.x, 51.5, 1e-9, 'X клика');
  near(hit.y, 43.25, 1e-9, 'Y клика');
});

t('высота поднимает точку ровно на h·cos(pitch)·zoom·TILE вверх экрана', () => {
  const cam = makeCam({ pitch: 50 * DEG, zoom: 1.3 });
  const flat = projectPoint(50, 50, 0, cam);
  const lift = projectPoint(50, 50, 0.62, cam);
  near(flat.sy - lift.sy, 0.62 * Math.cos(cam.pitch) * cam.zoom * TILE_PX, 1e-9, 'подъём');
  near(lift.sx, flat.sx, 1e-12, 'высота не должна сдвигать X');
});

t('screenToTile: поправка по высоте сходится — самосогласованность склона', () => {
  // Наклонная терраса: высота известна в любой точке, но НЕ в точке клика —
  // ровно та ситуация, в которой слой рельефа будет звать функцию.
  const heightAt = (x, y) => 0.05 * x + 0.03 * y;
  const cam = makeCam({ yaw: 270 * DEG, pitch: PITCH_MIN, zoom: 0.6 });
  const wx = 60, wy = 36;
  const p = projectPoint(wx, wy, heightAt(wx, wy), cam);
  const hit = screenToTile(p.sx, p.sy, cam, { heightAt });
  const errPx = Math.hypot(hit.x - wx, hit.y - wy) * TILE_PX * cam.zoom;
  ok(errPx < 0.01, `остаток итераций ${errPx}px`);
  // Высота берётся в найденной точке: её сдвиг на tol по склону 0.05 даёт
  // ту же погрешность в h, поэтому допуск наследует tol итераций, а не машинный ноль.
  near(hit.h, heightAt(wx, wy), 1e-6, 'высота под курсором');
});

// ------------------------------------------------------------- глубина
t('depth-key монотонен по экранному sy на всех 4 yaw (дальние раньше)', () => {
  for (const yaw of YAWS) {
    const cam = makeCam({ yaw, pitch: 45 * DEG, zoom: 1 });
    const pts = [];
    for (let i = 0; i < 200; i++) pts.push({ x: 48 + scatter(i * 2 + 1, 30), y: 48 + scatter(i * 2 + 2, 30) });
    let prevSy = -Infinity;
    for (const q of [...pts].sort((a, b) => sortKey(a.x, a.y, cam) - sortKey(b.x, b.y, cam))) {
      const p = projectPoint(q.x, q.y, 0, cam);
      // Строгая проверка: возрастание ключа не должно давать уменьшение sy.
      // Допуск 1e-9 закрывает машинный шум на равных ключах (диагонали).
      ok(p.sy >= prevSy - 1e-9, `yaw=${yaw / DEG}°: сортировка по ключу ломает экранный порядок`);
      prevSy = p.sy;
    }
  }
});

t('depth-key согласован с экранным порядком пары точек при любом yaw', () => {
  // «Дальний/ближний» зависят от поворота карты: при yaw=180° север уезжает
  // вниз экрана. Инвариант один — кто ниже на экране, у того ключ больше.
  for (const yaw of YAWS) {
    const cam = makeCam({ yaw, targetX: 48, targetY: 48 });
    for (const [ax, ay] of [[48, 38], [38, 48]]) {
      const A = projectPoint(ax, ay, 0, cam);
      const B = projectPoint(58, 58, 0, cam);
      ok((B.sy > A.sy) === (sortKey(58, 58, cam) > sortKey(ax, ay, cam)),
        `yaw=${yaw / DEG}°: ключ глубины разошёлся с экранным порядком (${ax},${ay})`);
      if (B.sy !== A.sy) ok(Math.sign(B.sy - A.sy) === Math.sign(sortKey(58, 58, cam) - sortKey(ax, ay, cam)), 'знак');
    }
  }
});

t('projectTile якорится в угол тайла, как старый ox+x*z (без сдвига на полтайла)', () => {
  const cam = makeCam({});
  const a = projectTile(10, 10, 0, cam);
  const b = projectPoint(10, 10, 0, cam);
  near(a.sx, b.sx, 0, 'projectTile разошёлся с projectPoint');
  near(a.sy, b.sy, 0, 'projectTile разошёлся с projectPoint');
});

// ------------------------------------------------------------ пределы
t('пределы камеры зажимаются: pitch 35..60°, zoom 0.5..2.5, yaw в [-π,π)', () => {
  const c = clampCam({ yaw: 720 * DEG + 30 * DEG, pitch: -5, zoom: 100, targetX: 7, targetY: -3 });
  near(c.pitch, PITCH_MIN, 0, 'нижний предел pitch');
  near(c.zoom, ZOOM_MAX, 0, 'верхний предел zoom');
  ok(c.yaw >= -Math.PI && c.yaw < Math.PI, 'yaw не нормализован');
  near(c.yaw, 30 * DEG, 1e-12, 'накрутка оборотов yaw не сбита');

  const hi = clampCam({ pitch: 89 * DEG, zoom: 0.01 });
  near(hi.pitch, PITCH_MAX, 0, 'верхний предел pitch');
  near(hi.zoom, ZOOM_MIN, 0, 'нижний предел zoom');
});

t('мусорный ввод камеры не даёт NaN и не роняет кадр', () => {
  const c = clampCam({ yaw: NaN, pitch: undefined, zoom: 'сломано', targetX: null, targetY: Infinity });
  ok([c.yaw, c.pitch, c.zoom, c.targetX].every(Number.isFinite), `NaN прошёл в камеру: ${JSON.stringify(c)}`);
  near(c.pitch, 45 * DEG, 0, 'запасной pitch не дефолтный');
});

t('clampCam/makeCam/camStep не мутируют вход', () => {
  const src = { yaw: 5, pitch: 1, zoom: 9, targetX: 1, targetY: 2 };
  const copy = { ...src };
  clampCam(src);
  const cam = makeCam({ pitch: 40 * DEG });
  camStep(cam, { yaw: 3, pitch: 1, zoom: 2, targetX: 9, targetY: 9 }, 0.5);
  ok(JSON.stringify(src) === JSON.stringify(copy), 'clampCam переписал вход');
  ok(cam.pitch === 40 * DEG && cam.zoom === 1, 'makeCam вернул зажатый, но чужой объект');
});

// ------------------------------------------------------- ход камеры
t('camStep сходится за 60 шагов с остатком < 0.01', () => {
  let cam = makeCam({ yaw: 0, pitch: 35 * DEG, zoom: 0.5, targetX: 20, targetY: 20 });
  const target = { yaw: 90 * DEG, pitch: 60 * DEG, zoom: 2.5, targetX: 78, targetY: 71 };
  for (let i = 0; i < 60; i++) cam = camStep(cam, target, 1 / 60);
  const worst = Math.max(
    Math.abs(wrapAngle(cam.yaw - target.yaw)),
    Math.abs(cam.pitch - target.pitch),
    Math.abs(cam.zoom - target.zoom),
    Math.abs(cam.targetX - target.targetX),
    Math.abs(cam.targetY - target.targetY),
  );
  ok(worst < 0.01, `остаток ${worst}`);
});

t('camStep детерминирован: два прогона бит-в-бит одинаковы', () => {
  const target = { yaw: -90 * DEG, pitch: 55 * DEG, zoom: 1.9, targetX: 61, targetY: 33 };
  const run = () => {
    let cam = makeCam({ targetX: 11, targetY: 80 });
    const trace = [];
    for (let i = 0; i < 30; i++) { cam = camStep(cam, target, 1 / 60 + (i % 3) * 0.001); trace.push(cam.targetX, cam.yaw); }
    return JSON.stringify(trace);
  };
  ok(run() === run(), 'одинаковые входы дали разные траектории');
});

t('camStep: dt<=0 стоит на месте, короткая дуга выбрана верно', () => {
  const cam = makeCam({ yaw: 170 * DEG, targetX: 5, targetY: 5 });
  const still = camStep(cam, { yaw: cam.yaw, pitch: cam.pitch, zoom: cam.zoom, targetX: 5, targetY: 5 }, 0);
  near(still.targetX, 5, 0, 'нулевой dt сдвинул камеру');
  const turned = camStep(cam, { yaw: -170 * DEG, pitch: cam.pitch, zoom: cam.zoom, targetX: 5, targetY: 5 }, 0.09);
  // Нормализованный yaw может перескочить через ±π (170°→-177°), поэтому шаг
  // сравниваем как угол: он обязан быть короткой дугой +20°·k, а не -340°.
  const stepAng = wrapAngle(turned.yaw - cam.yaw);
  near(stepAng, wrapAngle(wrapAngle(-170 * DEG - 170 * DEG)) * (1 - Math.exp(-1)), 1e-9, 'величина шага поворота');
  ok(stepAng > 0 && Math.abs(stepAng) < 20 * DEG + 1e-9, 'поворот пошёл не короткой дугой');
});

// --------------------------------------------------------------- зум
t('zoom меняет масштаб линейно: дистанции и scale растут пропорционально', () => {
  const base = makeCam({ zoom: 1, pitch: 45 * DEG, yaw: 45 * DEG * 2 });
  const a = projectPoint(40, 52, 0, base), b = projectPoint(57, 41, 0, base);
  const d1 = Math.hypot(b.sx - a.sx, b.sy - a.sy);
  for (const z of [ZOOM_MIN, 1.4, ZOOM_MAX]) {
    const cam = { ...base, zoom: z };
    const a2 = projectPoint(40, 52, 0, cam), b2 = projectPoint(57, 41, 0, cam);
    const dz = Math.hypot(b2.sx - a2.sx, b2.sy - a2.sy);
    near(dz / d1, z, 1e-9, `дистанция при zoom=${z}`);
    near(projectPoint(50, 50, 0, cam).scale, z, 0, 'поле scale');
  }
});

// ------------------------------------------------------------- высоты
t('tileHeightAt: мир gen1 без elev берёт таблицу типов, мир с elev — массив', () => {
  const g1 = { w: 4, h: 4, tiles: new Uint8Array(16).fill(TILE.GRASS) };
  near(tileHeightAt(g1, 2, 2), 0.10, 0, 'высота травы gen1');
  const withElev = { w: 4, h: 4, tiles: g1.tiles, elev: new Float32Array(16).fill(0.77) };
  near(tileHeightAt(withElev, 2, 2), 0.77, 1e-6, 'elev проигнорирован'); // Float32 хранит грубее double
  near(tileHeightAt(g1, -1, 2), tileHeightAt(g1, 2, -1), 0, 'край карты дал разную высоту');
  near(tileHeightAt(null, 0, 0), tileHeightAt(g1, -1, -1), 0, 'нет мира — нет запасного уровня');
});

t('tileHeightAt согласован с палитрой: гора выше холма выше травы', () => {
  const tiles = [TILE.GRASS, TILE.HILL, TILE.MOUNTAIN];
  const w = { w: 3, h: 1, tiles: Uint8Array.from(tiles) };
  const hG = tileHeightAt(w, 0, 0), hH = tileHeightAt(w, 1, 0), hM = tileHeightAt(w, 2, 0);
  ok(hG < hH && hH < hM, `шкала высот сломана: ${hG} ${hH} ${hM}`);
  ok(hM > 0 && hG >= -0.55, 'высоты вышли за разумный диапазон');
});

// --------------------------------------------------------- гигиена файла
t('гигиена: ни Math.random, ни rng, есть блок ПОДКЛЮЧЕНИЕ', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/render/projection3d.js'), 'utf8');
  const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  ok(!/Math\.random/.test(code), 'Math.random в модуле запрещён');
  ok(!/\brng\b/.test(code), 'обращение к rng симуляции из модуля запрещено');
  ok(/ПОДКЛЮЧЕНИЕ/.test(src), 'в файле нет блока подключения');
});

console.log(`\nИтого: ${pass} прошло, ${fail} упало`);
process.exit(fail ? 1 : 0);
