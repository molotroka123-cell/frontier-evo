// Тесты 3D-рельефа (app/src/render/relief3d.js), стадия 1 ТЗ «ФРОНТИР 3D».
// Запуск: node app/tests/test-relief3d.mjs
//
// Канваса в node нет, поэтому контекст — заглушка со счётчиками вызовов:
// модуль проверяется как ЧИСТАЯ логика (высоты, сортировка глубины,
// отсечение, потолок, цвета), а не как пиксели. Пиксели проверит глаз ведущего.
// Проекция в ожиданиях берётся ИЗ НАСТОЯЩЕГО render/projection3d.js — так
// тест проверяет согласованность слоя с контрактом проектора, а не сам себя.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TILE } from '../src/core/data.js';
import { TERRAIN } from '../src/render/palette.js';

const P3D = await import('../src/render/projection3d.js');
const {
  heightAt, buildHeightField, drawTile3d, drawRelief3d,
  collectTiles, sortKey, relief3dGate,
} = await import('../src/render/relief3d.js');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('OK', name); } catch (e) { fail++; console.log('FAIL', name, '—', e.message); } };
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };

// ------------------------------------------------------------- заготовки
// Мир из одной породы — чтобы счётчики заливок сходились с арифметикой.
const mkWorld = (w, h, seed, tile) => ({
  w, h, seed,
  tiles: new Uint8Array(w * h).fill(tile),
  startX: w >> 1, startY: h >> 1,
});
// Мешанина всех типов: строка каждого типа на своём ряду.
const mkMixed = (seed = 4242) => {
  const w = 12, h = 7;
  const kinds = [TILE.DEEP, TILE.WATER, TILE.SAND, TILE.GRASS, TILE.FOREST, TILE.HILL, TILE.MOUNTAIN];
  const tiles = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) tiles[y * w + x] = kinds[y % kinds.length];
  return { w, h, seed, tiles, startX: 6, startY: 3 };
};

// Камера контракта projection3d: без вращения, наклон по умолчанию,
// пикселей на клетку задаём через zoom (= px/32).
const mkCam = (pxPerTile) => ({
  yaw: 0, pitch: Math.PI / 4,
  zoom: pxPerTile / 32,
  targetX: 0, targetY: 0,
});
const VR = (cw, ch) => ({ cx: 0, cy: 0, cw, ch });

// Заглушка контекста: считает заливки/обводки и запоминает цвета.
const stubCtx = () => {
  const st = { fill: 0, stroke: 0, paths: 0, styles: [] };
  const noop = () => {};
  return {
    st,
    fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1,
    save: noop, restore: noop,
    beginPath() { this.st.paths++; },
    moveTo: noop, lineTo: noop, closePath: noop,
    fill() { this.st.fill++; this.st.styles.push(String(this.fillStyle)); },
    stroke() { this.st.stroke++; this.st.styles.push(String(this.strokeStyle)); },
  };
};

// Видимый набор плит по ЗАДАННОМУ контракту отсечения (экранный AABB плиты,
// низ — нулевой уровень стенки или зеркало воды). Ожидания считаются здесь
// независимо, настоящим проектором — так проверяется поведение слоя, а не то,
// что функция вызвала сама себя.
function visibleSet(world, vr, cam, tilePx = 32) {
  const cp = Math.abs(Math.cos(cam.pitch));
  const k = tilePx * cam.zoom;
  const out = [];
  for (let y = 0; y < world.h; y++) {
    for (let x = 0; x < world.w; x++) {
      const tt = world.tiles[y * world.w + x];
      const wet = tt === TILE.DEEP || tt === TILE.WATER;
      const hh = heightAt(world, x, y);
      const zTop = wet ? -0.14 : hh;
      const pts = [
        P3D.projectPoint(x, y, zTop, cam, tilePx),
        P3D.projectPoint(x + 1, y, zTop, cam, tilePx),
        P3D.projectPoint(x + 1, y + 1, zTop, cam, tilePx),
        P3D.projectPoint(x, y + 1, zTop, cam, tilePx),
      ];
      const minX = Math.min(...pts.map(q => q.sx)) + vr.cx;
      const maxX = Math.max(...pts.map(q => q.sx)) + vr.cx;
      const minY = Math.min(...pts.map(q => q.sy)) + vr.cy;
      const maxY = Math.max(...pts.map(q => q.sy)) + vr.cy + (wet ? 0.14 : hh) * cp * k;
      if (maxX <= 0 || minX >= vr.cw || maxY <= 0 || minY >= vr.ch) continue;
      out.push([x, y]);
    }
  }
  return out;
}

// ------------------------------------------------------- высоты: базис
t('heightAt: детерминирован и в диапазоне 0..3', () => {
  const w = mkMixed();
  for (let y = 0; y < w.h; y++) {
    for (let x = 0; x < w.w; x++) {
      const a = heightAt(w, x, y);
      const b = heightAt(w, x, y);
      ok(a === b, `нестабилен в (${x},${y}): ${a} vs ${b}`);
      ok(a >= 0 && a <= 3, `вне диапазона в (${x},${y}): ${a}`);
    }
  }
});

t('heightAt: вода ровно 0, тиры на своих полках', () => {
  const w = mkMixed();   // строки: 0 DEEP, 1 WATER, 2 SAND, 3 GRASS, 4 FOREST, 5 HILL, 6 MOUNTAIN
  for (let x = 0; x < w.w; x++) {
    ok(heightAt(w, x, 0) === 0 && heightAt(w, x, 1) === 0, 'вода не нулевая');
    ok(heightAt(w, x, 5) >= 1.72 && heightAt(w, x, 5) <= 2.28, 'холм вне полки 2');
    ok(heightAt(w, x, 6) >= 2.75 && heightAt(w, x, 6) <= 3, 'гора вне полки 3');
    ok(heightAt(w, x, 3) > 0 && heightAt(w, x, 3) <= 1, 'трава вне полки 0..1');
    ok(heightAt(w, x, 4) > 0 && heightAt(w, x, 4) <= 1, 'лес вне полки 0..1');
  }
});

t('heightAt: песок ниже травы, шум разводит клетки одного типа', () => {
  let noiseWorks = false;
  for (let x = 1; x < 11; x++) {
    const sand = heightAt(mkMixed(), x, 2);
    const grass = heightAt(mkMixed(), x, 3);
    ok(sand <= 1 && sand >= 0.05, 'песок вылетел из полки');
    if (heightAt(mkMixed(), x - 1, 3) !== grass) noiseWorks = true;
  }
  ok(noiseWorks, 'шум не работает — все клетки равнины одного тона');
});

t('heightAt: чистая функция buildHeightField — два одинаковых мира дают одно поле', () => {
  const a = buildHeightField({ ...mkMixed(), seed: 777 });
  const b = buildHeightField({ ...mkMixed(), seed: 777 });
  ok(a.H.length === b.H.length, 'размер поля поплыл');
  for (let i = 0; i < a.H.length; i++) ok(a.H[i] === b.H[i], `поле разошлось в ${i}`);
});

t('heightAt: сид меняет фактуру, но не тиры', () => {
  const a = mkMixed(1000), b = mkMixed(2000);
  let diff = 0;
  for (let i = 0; i < a.tiles.length; i++) {
    if (a.tiles[i] !== b.tiles[i]) continue;
    const ha = heightAt(a, i % a.w, (i / a.w) | 0);
    const hb = heightAt(b, i % a.w, (i / a.w) | 0);
    if (ha !== hb) diff++;
    const tt = b.tiles[i];
    if (tt === TILE.MOUNTAIN) ok(hb <= 3 && hb >= 2.7, 'чужой сид выбил гору из тира');
    if (tt === TILE.WATER || tt === TILE.DEEP) ok(hb === 0, 'чужой сид сдвинул воду');
  }
  ok(diff > 0, 'сид ни на что не влияет — два мира неотличимы');
});

t('heightAt: дробные координаты округляются вниз, край мира — вода', () => {
  const w = mkMixed();
  ok(heightAt(w, 5.9, 3.9) === heightAt(w, 5, 3), 'дробь не легла на клетку');
  ok(heightAt(w, -1, 2) === 0 && heightAt(w, 2, -1) === 0, 'за краем не 0');
  ok(heightAt(w, 999, 999) === 0, 'далеко за краем не 0');
});

// --------------------------------------------------------- сортировка
t('сортировка: ключи собранного списка неубывают, ряды идут от дальних к ближним', () => {
  const w = mkMixed();
  const cam = mkCam(18);
  const items = collectTiles(w, VR(240, 160), cam);
  ok(items.length > 10, `список пустоват: ${items.length}`);
  for (let i = 1; i < items.length; i++) {
    ok(items[i - 1].key <= items[i].key, `ключи перепутаны на ${i}`);
    ok(items[i - 1].y <= items[i].y, `дальний ряд (${items[i - 1].x},${items[i - 1].y}) после ближнего (${items[i].x},${items[i].y})`);
  }
});

t('сортировка: перекрывающиеся плиты — дальняя раньше ближней', () => {
  const cam = mkCam(18);
  ok(sortKey(5, 4, cam) < sortKey(5, 5, cam), 'плита (5,4) должна рисоваться раньше (5,5)');
  const w = mkMixed();
  const it = collectTiles(w, VR(300, 300), cam);
  const at = (x, y) => it.findIndex(p => p.x === x && p.y === y);
  const back = at(5, 4), front = at(5, 5);
  ok(back >= 0 && front >= 0, 'нет обеих плит в кадре');
  ok(back < front, 'ближняя плита нарисовалась раньше дальней — дыра в земле');
});

// ------------------------------------------------------------ отсечение
t('отсечение: рисуется ровно видимое — считаем заливки заглушкой', () => {
  const w = mkWorld(40, 40, 4242, TILE.GRASS);
  const cam = mkCam(20);
  const vis = visibleSet(w, VR(120, 120), cam);
  ok(vis.length > 0 && vis.length < w.w * w.h, 'видимый набор выродился');
  const ctx = stubCtx();
  const drawn = drawRelief3d(ctx, w, cam, VR(120, 120), { quality: { id: 'high' } });
  ok(drawn === vis.length, `нарисовано ${drawn}, по контракту ${vis.length}`);
  // Трава всегда выше пола стенок: каждая плита = верх + 2 стенки.
  ok(ctx.st.fill === vis.length * 3, `заливок ${ctx.st.fill}, ждали ${vis.length * 3}`);
  ok(ctx.st.stroke === 0, 'трава вдруг заблистала как вода');
});

t('отсечение: кадр над водой даёт только верхние грани и блики', () => {
  const w = mkWorld(24, 24, 999, TILE.DEEP);
  const cam = mkCam(20);
  const vis = visibleSet(w, VR(110, 110), cam);
  const ctx = stubCtx();
  drawRelief3d(ctx, w, cam, VR(110, 110), { quality: { id: 'high' } });
  ok(ctx.st.fill === vis.length, `верхов ${ctx.st.fill}, ждали ${vis.length}`);
  ok(ctx.st.stroke === vis.length, `бликов ${ctx.st.stroke}, ждали ${vis.length}`);
});

t('отсечение: прямоугольник мимо мира не рождает ни одного вызова', () => {
  const w = mkMixed();
  const ctx = stubCtx();
  const drawn = drawRelief3d(ctx, w, mkCam(20), { cx: 5000, cy: 5000, cw: 100, ch: 100 }, { quality: { id: 'high' } });
  ok(drawn === 0 && ctx.st.fill === 0 && ctx.st.stroke === 0, 'мимо кадра что-то нарисовано');
});

t('гейт качества: eco молчит целиком, прочие пресеты живы', () => {
  const w = mkMixed();
  const ctx = stubCtx();
  ok(relief3dGate({ id: 'eco' }).on === false, 'eco должен молчать');
  ok(relief3dGate({ id: 'medium' }).on === true, 'medium убит зря');
  ok(relief3dGate(undefined).on === true, 'без пресета слой умер — по умолчанию высоко');
  drawRelief3d(ctx, w, mkCam(18), VR(240, 160), { quality: { id: 'eco' } });
  ok(ctx.st.fill === 0, 'eco всё-таки рисует');
});

// ------------------------------------------------------------- потолок
t('потолок: сверх лимита верхние грани остаются, стенки исчезают', () => {
  const w = mkWorld(64, 64, 555, TILE.GRASS);
  const cam = mkCam(16);
  const total = visibleSet(w, VR(480, 480), cam).length;
  ok(total > 800, `мало плит в окне: ${total}`);
  const ctx = stubCtx();
  const drawn = drawRelief3d(ctx, w, cam, VR(480, 480), { quality: { id: 'high' }, cap: 100 });
  ok(drawn === total, `нарисовано ${drawn}, видно ${total}`);
  ok(ctx.st.fill === 100 * 3 + (total - 100), `арифметика потолка не сошлась: ${ctx.st.fill}`);
});

t('потолок: щедрый лимит ничего не упрощает', () => {
  const w = mkWorld(20, 20, 555, TILE.GRASS);
  const cam = mkCam(20);
  const total = visibleSet(w, VR(400, 400), cam).length;
  const ctx = stubCtx();
  drawRelief3d(ctx, w, cam, VR(400, 400), { quality: { id: 'high' }, cap: 100000 });
  ok(ctx.st.fill === total * 3, `стенки пропали без причины: ${ctx.st.fill} против ${total * 3}`);
});

t('малый зум: стенки субпиксельны — рисуются только верхние грани', () => {
  const w = mkWorld(24, 24, 555, TILE.GRASS);
  const cam = mkCam(8);   // 8 px на клетку < MIN_WALL_PX
  const ctx = stubCtx();
  const total = visibleSet(w, VR(160, 160), cam).length;
  drawRelief3d(ctx, w, cam, VR(160, 160), { quality: { id: 'high' } });
  ok(total > 0, 'кадр оказался пустым');
  ok(ctx.st.fill === total, `заливок ${ctx.st.fill}, ждали ${total} верхних граней`);
});

// -------------------------------------------------------------- палитра
t('палитра: ни одного NaN/Infinity в цветах всех сезонов и типов', () => {
  const w = mkMixed();
  const cam = mkCam(24);
  for (let s = 0; s < TERRAIN.length; s++) {
    const ctx = stubCtx();
    for (let y = 0; y < w.h; y++) {
      for (let x = 0; x < w.w; x++) {
        drawTile3d(ctx, w, x, y, cam, TERRAIN[s]);
        const A = P3D.projectPoint(x, y, 1, cam, 32);
        ok(Number.isFinite(A.sx) && Number.isFinite(A.sy), 'проектор выдал NaN');
      }
    }
    ok(ctx.st.styles.length > 0, `сезон ${s}: ни одного цвета`);
    for (const col of ctx.st.styles) {
      ok(!/NaN|Infinity/.test(col), `сезон ${s}: мусорный цвет «${col}»`);
      const nums = col.match(/-?\d+(\.\d+)?/g);
      ok(nums && nums.length >= 3, `цвет без компонент: «${col}»`);
      for (const nRaw of nums) {
        const n = Number(nRaw);
        ok(Number.isFinite(n), `не-число в цвете «${col}»`);
      }
    }
  }
});

t('drawTile3d: вне мира молчит, стены отключаются флагом', () => {
  const w = mkMixed();
  const cam = mkCam(24);
  const off = stubCtx();
  ok(drawTile3d(off, w, -5, 5, cam) === 0, 'вне мира вернулся не 0');
  ok(off.st.fill === 0, 'вне мира что-то залито');
  const flat = stubCtx();
  drawTile3d(flat, w, 3, 3, cam, TERRAIN[0], { walls: false });   // (3,3) — трава
  ok(flat.st.fill === 1, `упрощение дало ${flat.st.fill} заливки вместо 1`);
});

// ---------------------------------------------------------- гигиена файла
t('гигиена: ни Math.random, ни генератора симуляции в файле нет', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/render/relief3d.js'), 'utf8');
  const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  ok(!/Math\.random/.test(code), 'Math.random в рендере запрещён');
  ok(!/\brng\b/.test(code), 'обращение к генератору симуляции из рендера запрещено');
  ok(/ПОДКЛЮЧЕНИЕ/.test(src), 'в файле нет блока подключения');
});

console.log(`\nИтого: ${pass} прошло, ${fail} упало`);
process.exit(fail ? 1 : 0);
