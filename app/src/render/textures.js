// render/textures.js — фотопаттерны земли и материалов (art/tex/*.jpg).
// ЗАЧЕМ. Процедурная заливка terrain.js даёт ровный цвет; фотографическая
// фактура поверх неё (альфа ≤ 0.35) добавляет материал, не ломая читаемость
// карты и не трогая симуляцию. Данные роль→dataURI льёт сборка в
// window.__FRONTIER_TEX__ (tools/build.mjs, по образцу __FRONTIER_ART__):
// frontier.html обязан работать по file:// без соседних файлов.
//
// ДЕТЕРМЕНИЗМ. Сдвиги паттерна выводятся только из hash(seed, роль) — ни
// Math.random, ни sim.rng: кадр при одной и той же камере воспроизводим,
// а общий генератор симуляции остаётся нетронутым.
//
// БЕЗОПАСНОСТЬ. Нет данных, нет роли, нет Image — всё возвращает false и не
// бросает: отсутствие art/tex не должно отличаться для игры от «текстур нет».

// Роли в порядке важности для земли; постройки — для будущих слоёв.
export const TEX_ROLES = [
  'grass', 'water', 'forest_floor', 'dirt', 'sand', 'snow', 'hill_rock',
  'wood_wall', 'thatch_roof', 'tile_roof', 'stone_wall', 'cloth',
];

// Потолок альфы — договор с рендером: фактура не должна превращаться в
// новую картинку поверх карты, это подложка, а не спрайт.
export const TEX_MAX_ALPHA = 0.35;

let atlas = null;          // роль → { img, ok } (img может быть заглушкой в Node)
let autoTried = false;     // ленивый автоподхват window.__FRONTIER_TEX__ — один раз

// Смешатель в духе palette.hash2: целочисленный, без накопления состояния.
function texHash(seed, salt, n) {
  let h = (seed | 0) * 374761393 + salt * 668265263 + n * 2246822519;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Соль роли из её имени: паттерн травы и паттерн воды не должны сдвигаться
// одинаково при одном seed, иначе сетка фактур выстраивается в узор.
function roleSalt(role) {
  let s = 0;
  for (let i = 0; i < role.length; i++) s = (s * 131 + role.charCodeAt(i)) | 0;
  return s | 0;
}

// Заглушка вместо Image для сред без DOM (тесты в Node): модуль должен
// импортироваться и честно отвечать false, а не падать на первом обращении.
function makeImageStub() {
  return { src: '', complete: false, naturalWidth: 0, naturalHeight: 0, onload: null, onerror: null };
}

// buildAtlas(TEX_DATA) — регистрирует роли из карта роль→dataURI.
// Возвращает число принятых ролей. Повторный вызов пересобирает атлас.
export function buildAtlas(data) {
  if (!data || typeof data !== 'object') return 0;
  atlas = {};
  let n = 0;
  for (const role of Object.keys(data)) {
    if (typeof data[role] !== 'string' || !data[role]) continue;
    const img = (typeof Image !== 'undefined') ? new Image() : makeImageStub();
    const rec = { img, ok: false };
    atlas[role] = rec;
    img.onload = () => { rec.ok = true; };
    img.onerror = () => { rec.ok = false; };
    img.src = data[role];
    n++;
  }
  return n;
}

// Ленивый автоподхват данных сборки. Явный buildAtlas(...) имеет приоритет:
// если атлас уже есть, инжект ничего не перетирает.
function ensureAtlas() {
  if (atlas || autoTried) return;
  autoTried = true;
  try {
    const injected = (typeof window !== 'undefined') ? window.__FRONTIER_TEX__ : null;
    if (injected) buildAtlas(injected);
  } catch { /* нет window или доступ запрещён — играем без паттернов */ }
}

// texReady(role) — true, когда картинка роли реально декодирована.
export function texReady(role) {
  ensureAtlas();
  const rec = atlas && atlas[role];
  return !!(rec && rec.ok && rec.img.naturalWidth > 0);
}

// Кэш паттернов на контекст: CanvasPattern привязан к документу контекста,
// а перезапуск createPattern на каждый fillRect — лишняя работа в кадре.
const patternCache = new WeakMap();

// texPattern(ctx, role, x, y, w, h, alpha, opts) — заливает прямоугольник
// паттерном роли. opts: { seed, ax, ay } — seed мира для детерминированного
// сдвига и якорь в экранных пикселях (ox/oy рендера), чтобы фактура не
// «плавала» под камерой. Возвращает false, если роли нет — вызывающий код
// просто остаётся с процедурной заливкой.
export function texPattern(ctx, role, x, y, w, h, alpha = 0.3, opts = {}) {
  if (!ctx || w <= 0 || h <= 0) return false;
  if (!texReady(role)) return false;
  const rec = atlas[role];

  let cache = patternCache.get(ctx);
  if (!cache) { cache = new Map(); patternCache.set(ctx, cache); }
  let pat = cache.get(role);
  if (!pat) {
    try { pat = ctx.createPattern(rec.img, 'repeat'); } catch { return false; }
    if (!pat) return false;
    cache.set(role, pat);
  }

  const tw = rec.img.naturalWidth || 384;
  const th = rec.img.naturalHeight || 384;
  const seed = (opts.seed | 0);
  const salt = roleSalt(role);
  // Сдвиг фазы паттерна: из сида и роли, детерминированно. Якорь ax/ay
  // привязывает сетку фактуры к миру (рендер передаёт ox/oy), иначе при
  // панораме текстура «езжает» вместе с экраном — заметный артефакт.
  const jx = texHash(seed, salt, 1) * tw;
  const jy = texHash(seed, salt, 2) * th;
  const ax = (opts.ax || 0) + jx;
  const ay = (opts.ay || 0) + jy;

  const a = Math.min(TEX_MAX_ALPHA, Math.max(0, +alpha || 0));
  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(-ax, -ay);
  ctx.fillStyle = pat;
  ctx.fillRect(x + ax, y + ay, w, h);
  ctx.restore();
  return true;
}
