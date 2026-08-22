// render/faction_town.js — поселения фракций: от шатра кочевья до каменного города.
//
// ЗАЧЕМ. Прежняя отрисовка (renderer.drawFactionSettlement) клала на карту
// 3–5 плоских квадратов цвета фракции. На фоне слоёной местности и печёных
// спрайтов зданий это читалось как недокрашенный placeholder: по поселению —
// главному ориентиру стратегии — невозможно было понять, вырос ли город,
// стоит ли он стенами, горит ли после набега. Здесь весь силуэт собирается
// из ПРОИЗВОДНОГО состояния settlement_view (ступень роста, стены, война,
// свежий ущерб) и рисуется сценами: шатёр с костром, хижины вокруг площади,
// плотный посад с колодцем, каменные дома под черепицей, город с башнями
// и знамёнами. Симуляцию этот файл не трогает: вид приходит готовым из
// core/systems/settlement_view.js (тот сам кэшируется и не мутирует sim).
//
// ЧТО ДЕЛАЕТ.
//   1. Расстановка построек детерминирована: разброс берётся только из
//      hash2(координаты поселения, соль) — тот же мир выглядит одинаково
//      у всех игроков и во всех кадрах. Ни Math.random, ни sim.rng: вызов
//      общего потока сдвинул бы симуляцию и поплыли бы сейвы.
//   2. Глубина: элементы сцены складываются в очередь и сортируются по Y —
//      дальние дома рисуются раньше ближних, без клипов и пересечений.
//   3. Знамя фракции печётся ОДИН раз на комбинацию (цвет, вариант выреза,
//      война) в offscreen-канвас и дальше только блитится; кэш ограничен
//      12 записями, лишние вытесняются по возрасту.
//   4. Ночью (opts.L.tint[3] > 0.2) на фасадах загораются тёплые окна,
//      их яркость пропорциональна L.glow; у повреждённых поселений идёт
//      дым над руинами.
//
// ГАБАРИТ: силуэт не шире 3.2z и не выше 2.6z над якорной клеткой — слой
// гарантированно не залезает на подписи и панели соседей по кадру.
//
// ЦЕНА КАДРА: пара десятков fill/ellipse на поселение, знамя — один
// drawImage; ни одного createRadialGradient, getImageData и ctx.filter.
import { hash2 } from './palette.js';
import { settlementView } from '../core/systems/settlement_view.js';

// Материалы двух «эпох» застройки. Дерево — ранние ступени, камень и черепица —
// поздние; держим их локально, чтобы палитра посёлка не разъезжалась с палитрой
// процедурных спрайтов при смене эпохи мира.
const WOOD_WALL = ['#9c7a48', '#8a6a3e'];
const WOOD_ROOF = ['#6b4f35', '#5d442c'];
const STONE_WALL = ['#b1aa9a', '#a29a89'];
const TILE_ROOF = ['#a0522d', '#8a4326'];
const WALL_STROKE = '#6f6a60';   // каменная стена города
const DARK = '#3a2f22';          // двери и проёмы
const RUIN_WALL = '#33302c';     // обугленный дом

// Контактная тень: тот же тон, что и у слоя теней жителей, чтобы земля
// под всеми объектами темнела одинаково.
const SHADOW_STYLE = 'rgba(0,0,0,0.25)';
// Тёплый цвет ночного окна — из семейства ERA_PALETTE.glow; альбу вшиваем
// в строку стиля, чтобы кадр не зависел от глобального состояния контекста.
const WIN_RGB = '255,182,88';
const SMOKE_RGB = '96,92,90';
const TAU = Math.PI * 2;

// Сколько окон горит на посёлке по ступеням: столица видна ночью издалека,
// шатру вместо окон хватает собственного костра.
const WIN_N = [0, 2, 3, 3, 4];

// Вид-заглушка: если производный слой ещё не готов, посёлок остаётся виден,
// а рендер не падает на полпути кадра.
const FALLBACK_VIEW = { tier: 1, walls: 0, atWar: false, damaged: false, pop: 0, banner: 1 };

// ---------------------------------------------------------------------------
// Выпечка знамени. Ключ — «цвет|вариант|война»: полотнище меняется только
// когда сменилась фракция, примета места или состояние войны, поэтому за
// долгую партию печётся считанное число раз.
// ---------------------------------------------------------------------------
const BANNER_CACHE = new Map();
const BANNER_CACHE_MAX = 12;

// Для тестов дисциплины кэша: наружу торчит только размер.
export function bannerCacheSize() { return BANNER_CACHE.size; }

function bakeBanner(color, variant, war) {
  const key = `${color}|${variant}|${war ? 1 : 0}`;
  const hit = BANNER_CACHE.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = 40; cv.height = 96;
  const c = cv.getContext('2d');
  // Шест с золотым навершием: тёмное дерево читается на любой местности.
  c.fillStyle = '#4a3620';
  c.fillRect(6, 6, 3, 86);
  c.fillStyle = '#c9a227';
  c.beginPath(); c.arc(7.5, 5, 2.6, 0, TAU); c.fill();
  // Полотнище: три варианта нижней кромки — примета конкретного места.
  const x0 = 9, x1 = 43, y0 = 9, y1 = 37;
  c.beginPath();
  c.moveTo(x0, y0); c.lineTo(x1, y0);
  if (variant === 0) {
    // треугольный вырез внутрь полотнища
    c.lineTo(x1, y1); c.lineTo((x0 + x1) / 2, y1 - 9); c.lineTo(x0, y1);
  } else if (variant === 1) {
    // прямой прямоугольник
    c.lineTo(x1, y1); c.lineTo(x0, y1);
  } else {
    // ласточкин хвост: два хвоста расходятся наружу
    c.lineTo(x1, y0 + 7); c.lineTo((x0 + x1) / 2 + 2, (y0 + y1) / 2); c.lineTo(x1, y1); c.lineTo(x0, y1);
  }
  c.closePath();
  c.fillStyle = color;
  c.fill();
  if (war) {
    // Красная кайма — войну видно до того, как различишь герб.
    c.strokeStyle = '#c0392b'; c.lineWidth = 2.5; c.stroke();
  }
  // Эмблема-круг: без неё полотнище сливается с территорией того же цвета.
  c.fillStyle = 'rgba(255,255,255,0.5)';
  c.beginPath(); c.arc(x0 + 9, y0 + 9, 3.6, 0, TAU); c.fill();
  // Вытесняем самую старую запись, когда кэш распухает: фракций на экране
  // меньше дюжины, а перерисовка полотна каждый кадр дороже одного блита.
  if (BANNER_CACHE.size >= BANNER_CACHE_MAX) {
    BANNER_CACHE.delete(BANNER_CACHE.keys().next().value);
  }
  BANNER_CACHE.set(key, cv);
  return cv;
}

// Векторная копия знамени для среды без document (headless): редкий путь,
// поэтому без кэша — главное не упасть и сохранить ту же геометрию кромки.
function drawBannerLive(ctx, x, footY, w, h, color, variant, war) {
  const pw = Math.max(1.5, w * 0.08);
  ctx.fillStyle = '#4a3620';
  ctx.fillRect(x - w / 2, footY - h, pw, h);
  const x0 = x - w / 2 + w * 0.1, cw = w * 0.9, x1 = x0 + cw;
  const y0 = footY - h, ch = h * 0.34, y1 = y0 + ch;
  ctx.beginPath();
  ctx.moveTo(x0, y0); ctx.lineTo(x1, y0);
  if (variant === 0) {
    ctx.lineTo(x1, y1); ctx.lineTo(x0 + cw / 2, y1 - ch * 0.34); ctx.lineTo(x0, y1);
  } else if (variant === 1) {
    ctx.lineTo(x1, y1); ctx.lineTo(x0, y1);
  } else {
    ctx.lineTo(x1, y0 + ch * 0.26); ctx.lineTo(x0 + cw / 2 + cw * 0.06, y0 + ch * 0.5);
    ctx.lineTo(x1, y1); ctx.lineTo(x0, y1);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  if (war) { ctx.strokeStyle = '#c0392b'; ctx.lineWidth = Math.max(1, h * 0.03); ctx.stroke(); }
}

// ---------------------------------------------------------------------------
// Примитивы сцен. Всё — fill/stroke без градиентов: градиент в кадре на
// программном растеризаторе стоит дороже всего остального слоя вместе.
// ---------------------------------------------------------------------------

// Контактная эллипс-тень под строением: садит силуэт на землю.
function contactShadow(ctx, cx, cy, rx, ry) {
  ctx.fillStyle = SHADOW_STYLE;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
  ctx.fill();
}

// Дом с двускатной крышей: корпус, труба (по флагу), крыша одним треугольником,
// дверь. Окно приходит снаружи — ночные точки распределяет вызывающая сцена.
function house(ctx, hx, footY, w, hb, rh, wall, roof, stone, night, winA, r1, r2) {
  contactShadow(ctx, hx, footY + 1, w * 0.62, Math.max(1.5, w * 0.2));
  ctx.fillStyle = wall;
  ctx.fillRect(hx - w / 2, footY - hb, w, hb);
  if (stone) {
    // Труба у каменных домов: глиняные топят по-чёрному, дым ей не нужен.
    ctx.fillStyle = '#6f6a60';
    ctx.fillRect(hx + w * 0.16, footY - hb - rh * 0.85, Math.max(1.5, w * 0.11), rh * 0.85 + hb * 0.25);
  }
  ctx.beginPath();
  ctx.moveTo(hx - w * 0.62, footY - hb);
  ctx.lineTo(hx, footY - hb - rh);
  ctx.lineTo(hx + w * 0.62, footY - hb);
  ctx.closePath();
  ctx.fillStyle = roof;
  ctx.fill();
  if (stone) {
    // Ряды черепицы: две короткие линии по скату дешевле узора из плиток.
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hx - w * 0.34, footY - hb - rh * 0.42);
    ctx.lineTo(hx + w * 0.34, footY - hb - rh * 0.42);
    ctx.moveTo(hx - w * 0.2, footY - hb - rh * 0.74);
    ctx.lineTo(hx + w * 0.2, footY - hb - rh * 0.74);
    ctx.stroke();
  }
  ctx.fillStyle = DARK;
  ctx.fillRect(hx - w * 0.08, footY - hb * 0.55, Math.max(1, w * 0.16), hb * 0.55);
  if (night > 0) {
    // Позиция окна из хеша: город мерцает неровно, но кадр в кадр одинаково.
    const wx = hx + (r1 - 0.5) * w * 0.5;
    const wy = footY - hb * (0.4 + r2 * 0.35);
    const ww = Math.max(1.5, w * 0.14);
    ctx.fillStyle = `rgba(${WIN_RGB},${winA})`;
    ctx.fillRect(wx - ww / 2, wy - ww * 0.8, ww, ww * 1.6);
  }
}

// Башня: каменное тело, коническая кровля, бойница. Ставится по углам города.
function tower(ctx, tx, footY, w, hb, night, winA, r1) {
  contactShadow(ctx, tx, footY + 1, w * 0.8, Math.max(1.5, w * 0.3));
  ctx.fillStyle = '#9a948a';
  ctx.fillRect(tx - w / 2, footY - hb, w, hb);
  ctx.beginPath();
  ctx.moveTo(tx - w * 0.75, footY - hb);
  ctx.lineTo(tx, footY - hb - hb * 0.42);
  ctx.lineTo(tx + w * 0.75, footY - hb);
  ctx.closePath();
  ctx.fillStyle = '#6d4a3a';
  ctx.fill();
  if (night > 0) {
    const ww = Math.max(1.5, w * 0.3);
    ctx.fillStyle = `rgba(${WIN_RGB},${winA})`;
    ctx.fillRect(tx + (r1 - 0.5) * w * 0.3 - ww / 2, footY - hb * 0.72, ww, ww * 1.7);
  }
}

// Обугленный дом после набега: тёмный короб, рваная линия обрушенной кровли,
// головешки. Рисуется на месте одной из построек.
function ruin(ctx, hx, footY, w, hb, time, rnd) {
  contactShadow(ctx, hx, footY + 1, w * 0.66, Math.max(1.5, w * 0.22));
  ctx.fillStyle = RUIN_WALL;
  ctx.fillRect(hx - w / 2, footY - hb * 0.7, w, hb * 0.7);
  // Обрушенная крыша: ломаная вместо треугольника — силуэт сразу «битый».
  ctx.strokeStyle = '#211e1b';
  ctx.lineWidth = Math.max(1.5, w * 0.09);
  ctx.beginPath();
  ctx.moveTo(hx - w * 0.6, footY - hb * 0.7);
  ctx.lineTo(hx - w * 0.25, footY - hb * 1.05);
  ctx.lineTo(hx + w * 0.05, footY - hb * 0.55);
  ctx.lineTo(hx + w * 0.4, footY - hb * 0.9);
  ctx.lineTo(hx + w * 0.6, footY - hb * 0.7);
  ctx.stroke();
  ctx.fillStyle = '#26231f';
  ctx.fillRect(hx + w * 0.1, footY - hb * 0.35, Math.max(1.5, w * 0.14), hb * 0.35);
  // Столб дыма: три клуба, поднимающиеся по детерминированной фазе от хеша
  // и времени кадра; время приходит снаружи, поэтому повтор кадра честный.
  const topY = footY - hb * 0.95;
  for (let i = 0; i < 3; i++) {
    const ph = ((time * 0.35) + i * 0.37 + rnd(40 + i)) % 1;
    const py = topY - ph * 1.1 * hb * 1.6;
    const pr = (0.09 + ph * 0.17) * hb * 1.4;
    const sway = Math.sin(ph * 5 + rnd(44 + i) * TAU) * hb * 0.22;
    ctx.fillStyle = `rgba(${SMOKE_RGB},${((1 - ph) * 0.42).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(hx + w * 0.2 + sway, py, pr, 0, TAU);
    ctx.fill();
  }
}

// Колодец посадского посада: сруб, тёмный зев, стойки и маленькая кровля.
function well(ctx, wx, footY, z) {
  contactShadow(ctx, wx, footY + 1, z * 0.22, z * 0.08);
  ctx.fillStyle = '#8d8578';
  ctx.beginPath(); ctx.arc(wx, footY - z * 0.1, z * 0.17, 0, TAU); ctx.fill();
  ctx.fillStyle = '#22201c';
  ctx.beginPath(); ctx.arc(wx, footY - z * 0.12, z * 0.09, 0, TAU); ctx.fill();
  ctx.fillStyle = '#5d442c';
  ctx.fillRect(wx - z * 0.16, footY - z * 0.5, Math.max(1, z * 0.045), z * 0.42);
  ctx.fillRect(wx + z * 0.115, footY - z * 0.5, Math.max(1, z * 0.045), z * 0.42);
  ctx.beginPath();
  ctx.moveTo(wx - z * 0.26, footY - z * 0.48);
  ctx.lineTo(wx, footY - z * 0.68);
  ctx.lineTo(wx + z * 0.26, footY - z * 0.48);
  ctx.closePath();
  ctx.fillStyle = WOOD_ROOF[1];
  ctx.fill();
}

// Костёр шатрового лагеря: камни, колоды, двойное пламя. Пламя дышит от
// времени кадра — фаза своя у каждого костра, синхронного мигания нет.
function campfire(ctx, fx, footY, z, time, phase) {
  contactShadow(ctx, fx, footY + 1, z * 0.24, z * 0.09);
  ctx.fillStyle = '#7d776c';
  for (let i = 0; i < 3; i++) {
    const a = phase * TAU + (i / 3) * TAU;
    ctx.beginPath();
    ctx.arc(fx + Math.cos(a) * z * 0.17, footY - z * 0.04 + Math.sin(a) * z * 0.06, Math.max(1, z * 0.05), 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = '#5d4326';
  ctx.fillRect(fx - z * 0.13, footY - z * 0.1, z * 0.26, Math.max(1, z * 0.05));
  ctx.fillStyle = '#4a351e';
  ctx.fillRect(fx - z * 0.09, footY - z * 0.15, z * 0.18, Math.max(1, z * 0.05));
  const fl = 1 + 0.12 * Math.sin(time * 6.3 + phase * TAU);
  ctx.fillStyle = '#ff9a3c';
  ctx.beginPath(); ctx.arc(fx, footY - z * 0.2, z * 0.15 * fl, 0, TAU); ctx.fill();
  ctx.fillStyle = '#ffd08a';
  ctx.beginPath(); ctx.arc(fx, footY - z * 0.18, z * 0.08 * fl, 0, TAU); ctx.fill();
}

// Сцена — список слотов построек в клеточных долях: dx от оси посёлка,
// dy — сдвиг подошвы (глубина), w — ширина. Размеры и джиттер добирают хешем.
const SCENES = {
  1: [
    { dx: -1.0, dy: -0.26, w: 0.6 }, { dx: -0.24, dy: -0.44, w: 0.7 },
    { dx: 0.7, dy: -0.22, w: 0.58 }, { dx: 0.14, dy: 0.14, w: 0.52, opt: 1 },
  ],
  2: [
    { dx: -1.2, dy: -0.18, w: 0.62 }, { dx: -0.58, dy: -0.46, w: 0.86, barn: 1 },
    { dx: 0.02, dy: -0.3, w: 0.55 }, { dx: 0.6, dy: -0.52, w: 0.66 },
    { dx: 1.16, dy: -0.12, w: 0.58 }, { dx: -0.12, dy: 0.12, w: 0.6 },
  ],
  3: [
    { dx: -1.22, dy: -0.3, w: 0.64 }, { dx: -0.55, dy: -0.52, w: 0.72 },
    { dx: 0.1, dy: -0.34, w: 0.6 }, { dx: 0.72, dy: -0.5, w: 0.68 },
    { dx: 1.2, dy: -0.1, w: 0.56 }, { dx: -0.1, dy: 0.12, w: 0.62 },
  ],
};
// Город: башни по углам (kind:'t') плюс семь домов — плотность столицы.
SCENES[4] = [
  { dx: -1.3, dy: -0.55, kind: 't' }, { dx: -0.72, dy: -0.4, w: 0.58 },
  { dx: -0.05, dy: -0.52, w: 0.66 }, { dx: 0.62, dy: -0.36, w: 0.6 },
  { dx: 1.3, dy: -0.5, kind: 't' }, { dx: -1.05, dy: 0.02, w: 0.54 },
  { dx: -0.28, dy: 0.16, w: 0.62 }, { dx: 0.45, dy: -0.02, w: 0.58 },
  { dx: 1.05, dy: 0.1, w: 0.52 },
];

// ---------------------------------------------------------------------------
// Главная точка входа. Контракт совпадает со старой drawFactionSettlement:
// sx, sy — левый-верхний угол якорного тайла поселения на экране.
// ---------------------------------------------------------------------------
export function drawFactionTown(ctx, sx, sy, z, f, s, sim, opts = {}) {
  if (!(z > 0) || !f || !s) return;
  let view = FALLBACK_VIEW;
  try { view = settlementView(sim, f, s) || FALLBACK_VIEW; } catch { /* вид обязателен, но кадр дороже исключения */ }
  const tier = Math.max(0, Math.min(4, view.tier | 0));
  const walls = Math.max(0, Math.min(2, view.walls | 0));
  const damaged = !!view.damaged;
  const bannerV = view.banner | 0;
  const atWar = !!view.atWar;

  const L = opts.L || null;
  // Ночь наступает, когда синий тон дня набирает альфу; яркость окон — от glow.
  const night = L && L.tint && L.tint[3] > 0.2
    ? (typeof L.glow === 'number' ? Math.max(0, Math.min(1, L.glow)) : 1)
    : 0;
  const winA = night > 0 ? (0.3 + 0.65 * night).toFixed(3) : '0';
  const time = typeof opts.time === 'number' ? opts.time : 0;

  const ax = sx + z * 0.5;      // ось поселения — центр якорной клетки
  const gy = sy + z;            // подошва — низ якорной клетки

  // Выпечка знамени недоступна без document (headless-среды) — но и там
  // посёлок должен опознаваться: печатаем векторное знамя напрямую.
  const canBake = typeof document !== 'undefined' && !!document.createElement;
  const bannerImg = () => (canBake ? bakeBanner(f.def.color, bannerV, atWar) : null);

  // Дальняя отрисовка: когда клетка мельче семи пикселей, полная сцена не
  // окупает ни одного вызова — посёлок это цветная точка с флажком.
  if (z < 7) {
    contactShadow(ctx, ax, gy - z * 0.08, z * 0.7, z * 0.22);
    ctx.fillStyle = f.def.color;
    ctx.fillRect(ax - z * 0.35, gy - z * 0.8, z * 0.7, z * 0.8);
    const far = bannerImg();
    if (far) ctx.drawImage(far, Math.round(ax - z * 0.06), Math.round(gy - z * 2.0), Math.round(z * 0.5), Math.round(z * 1.2));
    else drawBannerLive(ctx, ax, gy, z * 0.45, z * 1.1, f.def.color, bannerV, atWar);
    return;
  }

  const bx = s.x | 0, by = s.y | 0;
  // Детерминированный разброс: та же пара координат, что кормит banner в
  // settlement_view, поэтому «приметы места» везде согласованы.
  const rnd = (k) => hash2(bx * 16 + k * 131 + 7, by * 8 + k * 61 + 3);

  // --- дальний план: земля посёлка, пока ничего не перекрыто ---------------
  if (tier === 0) {
    // пепелище кочевья: вытоптанный круг
    ctx.fillStyle = 'rgba(110,95,72,0.25)';
    ctx.beginPath(); ctx.ellipse(ax, gy - z * 0.05, z * 0.85, z * 0.3, 0, 0, TAU); ctx.fill();
  } else if (tier < 4) {
    // утоптанная площадь деревни/посада
    ctx.fillStyle = 'rgba(122,102,72,0.18)';
    ctx.beginPath(); ctx.ellipse(ax, gy - z * 0.12, z * 1.3, z * 0.44, 0, 0, TAU); ctx.fill();
  } else {
    // вымощенная площадь города
    ctx.fillStyle = 'rgba(196,186,166,0.3)';
    ctx.fillRect(ax - z * 0.55, gy - z * 0.28, z * 1.1, z * 0.5);
  }

  // --- очередь глубины: {y, fn}, сортировка по Y, дальние раньше -----------
  const q = [];

  if (tier === 0) {
    // Шатёр: два треугольника — склон к нам и боковой скат, плюс костёр.
    const main = '#a5854f', side = '#8a6d3e';
    q.push({
      y: gy - z * 0.05, fn: () => {
        contactShadow(ctx, ax - 0.12 * z, gy + 1, z * 0.8, z * 0.24);
        ctx.fillStyle = main;
        ctx.beginPath();
        ctx.moveTo(ax - 0.72 * z, gy);
        ctx.lineTo(ax - 0.1 * z, gy - 1.05 * z);
        ctx.lineTo(ax + 0.45 * z, gy);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = side;
        ctx.beginPath();
        ctx.moveTo(ax + 0.28 * z, gy);
        ctx.lineTo(ax + 0.62 * z, gy - 0.72 * z);
        ctx.lineTo(ax + 0.98 * z, gy);
        ctx.closePath(); ctx.fill();
        // вход: тёмный проём делает шатёр обжитым
        ctx.fillStyle = DARK;
        ctx.fillRect(ax - 0.18 * z, gy - 0.34 * z, z * 0.2, z * 0.34);
      },
    });
    q.push({ y: gy + z * 0.05, fn: () => campfire(ctx, ax + z * 0.85, gy, z, time, rnd(9)) });
    if (damaged) {
      // Лагерь разгромлен: головёшки и дым рядом с шатром.
      q.push({
        y: gy + z * 0.1, fn: () => ruin(ctx, ax - z * 1.0, gy, z * 0.5, z * 0.4, time, rnd),
      });
    }
  } else {
    // --- застройка по слотам сцены -----------------------------------------
    const slots = SCENES[tier];
    // Слоты с пометкой opt стоят не в каждой деревне: решает хеш места, так
    // что посёлки на карте получаются разными, но каждый кадр — одинаковым.
    const live = slots.filter((sl) => !sl.opt || rnd(77) >= 0.35);
    const nB = live.length;
    // Окна раскладываем по домам циклично: 2–4 точки на посёлок целиком,
    // как договаривались — ночь должна подсвечивать жизнь, а не прожектором
    // заливать каждый фасад.
    const winN = WIN_N[tier];
    const winCounts = new Array(nB).fill(0);
    for (let i = 0; i < winN; i++) winCounts[i % nB]++;
    // Повреждение бьёт по одному конкретному дому — второму слоту сцены.
    const ruinIdx = damaged ? 1 % nB : -1;

    for (let i = 0; i < nB; i++) {
      const sl = live[i];
      const r0 = rnd(i * 4 + 1), r1 = rnd(i * 4 + 2), r2 = rnd(i * 4 + 3);
      const hx = ax + (sl.dx + (r0 - 0.5) * 0.14) * z;
      const footY = gy + sl.dy * z;
      const w = sl.w * z;
      const hb = (sl.barn ? 0.3 : 0.34 + r1 * 0.1) * z;
      const rh = w * 0.52;
      const stone = tier >= 3;
      const wall = stone ? STONE_WALL[i % 2] : WOOD_WALL[(i + ((r0 * 2) | 0)) % 2];
      const roof = stone ? TILE_ROOF[i % 2] : WOOD_ROOF[(i + 1) % 2];
      const wc = winCounts[i];
      const isRuin = i === ruinIdx;
      q.push({
        y: footY, fn: () => {
          if (isRuin) ruin(ctx, hx, footY, w, hb + rh * 0.5, time, rnd);
          else if (sl.kind === 't') tower(ctx, hx, footY, w * 0.55, hb + rh * 0.9, night, winA, r1);
          else house(ctx, hx, footY, w, hb, rh, wall, roof, stone, wc > 0 ? night : 0, winA, r1, r2);
        },
      });
    }

    if (tier === 2) q.push({ y: gy + z * 0.12, fn: () => well(ctx, ax + z * 0.15, gy, z) });

    // Частокол: колья по эллиптическому периметру, каждый в своей глубине.
    if (walls === 1) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const px = ax + Math.cos(a) * z * 1.5;
        const py = gy - z * 0.28 + Math.sin(a) * z * 0.5;
        const hh = z * (0.34 + rnd(60 + i) * 0.14);
        q.push({
          y: py, fn: () => {
            ctx.fillStyle = i % 2 ? '#7a5a33' : '#6b4d2a';
            ctx.fillRect(px - z * 0.035, py - hh, z * 0.07, hh);
          },
        });
      }
    }

    // Каменная стена: замкнутый контур вокруг города. Рисуется до домов,
    // чтобы застройка читалась внутри кольца, а ворота — после, поверх площади.
    if (walls === 2) {
      q.push({
        y: gy - z * 1.4, fn: () => {
          ctx.strokeStyle = WALL_STROKE;
          ctx.lineWidth = Math.max(1.5, z * 0.1);
          ctx.beginPath();
          ctx.moveTo(ax - z * 1.5, gy + z * 0.05);
          ctx.lineTo(ax - z * 1.5, gy - z * 0.95);
          ctx.lineTo(ax - z * 0.6, gy - z * 1.25);
          ctx.lineTo(ax + z * 0.7, gy - z * 1.2);
          ctx.lineTo(ax + z * 1.5, gy - z * 0.9);
          ctx.lineTo(ax + z * 1.5, gy + z * 0.05);
          ctx.closePath();
          ctx.stroke();
        },
      });
      q.push({
        y: gy + z * 0.3, fn: () => {
          // ворота: проём с аркой на южной стороне
          ctx.fillStyle = '#4a3a28';
          ctx.fillRect(ax - z * 0.14, gy - z * 0.26, z * 0.28, z * 0.28);
          ctx.fillStyle = '#5d4a32';
          ctx.fillRect(ax - z * 0.17, gy - z * 0.34, z * 0.34, z * 0.1);
        },
      });
    }
  }

  // --- знамя фракции: шест с полотнищем, у города — пара ------------------
  // Полотнище держим в пределах +1.4z от оси: вместе со стеной (±1.55z)
  // это даёт максимальный размах 3.1z — внутри обещанных 3.2z.
  const img = bannerImg();
  q.push({
    y: gy - z * 0.02, fn: () => {
      if (img) ctx.drawImage(img, Math.round(ax + z * 0.62), Math.round(gy - z * 1.86), Math.round(z * 0.78), Math.round(z * 1.86));
      else drawBannerLive(ctx, ax + z * 0.92, gy, z * 0.6, z * 1.5, f.def.color, bannerV, atWar);
    },
  });
  if (tier === 4) {
    q.push({
      y: gy - z * 0.01, fn: () => {
        if (img) ctx.drawImage(img, Math.round(ax - z * 1.32), Math.round(gy - z * 1.31), Math.round(z * 0.55), Math.round(z * 1.31));
      },
    });
  }

  // Сортировка стабильна, порядок слотов фиксирован — кадр воспроизводим.
  q.sort((a, b) => a.y - b.y);
  for (const it of q) it.fn();
}
