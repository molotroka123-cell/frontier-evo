// test-water-fx.mjs — проверки слоя воды water_fx.js:
// детерминизм фаз от сида, диапазоны фаз, потолки кадра и гейты
// (eco / зима / дальний зум / пустые данные). Чистый node, без DOM.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { TILE } = await import('../src/core/data.js');
const { QUALITY } = await import('../src/render/quality.js');
const {
  WATER_LIMITS, SPECLE_CYCLE_MIN, SPECLE_CYCLE_MAX, FOAM_PERIOD, FLOW_CYCLE,
  FOAM_W_MIN, FOAM_W_MAX,
  hash4, speclePhase, foamEdge, riverAxis, riverDash, WaterFx,
} = await import('../src/render/water_fx.js');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('OK', name); } catch (e) { fail++; console.log('FAIL', name, '—', e.message); } };
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const near = (a, b, eps, msg) => ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

// --------------------------------------------------------------- заготовки
// Подложка: море слева (x<80), река одной клеткой шириной вправо (y=60),
// остальное суша. Даёт и длинную кромку для пены, и узкое русло для течения.
function coastWorld(w = 160, h = 120, seed = 4242) {
  const tiles = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      tiles[y * w + x] = (x < 80 || (y === 60 && x >= 80)) ? TILE.WATER : TILE.GRASS;
    }
  }
  return { w, h, seed, tiles };
}
const seaWorld = (w = 160, h = 120, seed = 4242) => ({
  w, h, seed, tiles: new Uint8Array(w * h).fill(TILE.WATER),
});
const mockSim = (world, over = {}) => ({ world, seasonIdx: 0, ...over });

function fakeCtx() {
  return {
    fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1,
    n: { arc: 0, fill: 0, fillRect: 0, stroke: 0 },
    save() {}, restore() {}, beginPath() {},
    moveTo() {}, lineTo() {},
    arc() { this.n.arc++; },
    fill() { this.n.fill++; },
    fillRect() { this.n.fillRect++; },
    stroke() { this.n.stroke++; },
  };
}

// ------------------------------------------------------------- гигиена кода
t('гигиена: Math.random и rng ядра не используются, блок подключения на месте', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/render/water_fx.js'), 'utf8');
  const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  ok(!/Math\.random/.test(code), 'Math.random запрещён в рендере');
  ok(!/\brng\b/.test(code), 'рендер не зовёт sim.rng — только хэш от сида');
  ok(/ПОДКЛЮЧЕНИЕ/.test(src), 'блок ПОДКЛЮЧЕНИЕ обязан быть в хвосте модуля');
});

// ------------------------------------------------------------- детерминизм
t('детерминизм: те же входы дают те же фазы, у разных сидов россыпь разная', () => {
  const a = speclePhase(4242, 31, 47, 12.34);
  const b = speclePhase(4242, 31, 47, 12.34);
  ok(a.u === b.u && a.v === b.v && a.a === b.a, 'speclePhase недетерминирован');
  const f1 = foamEdge(4242, 8, 9, 3.21), f2 = foamEdge(4242, 8, 9, 3.21);
  ok(f1.w === f2.w && f1.k === f2.k, 'foamEdge недетерминирован');
  const d1 = riverDash(4242, 90, 60, 160, 120, 5.5, 1, 0, 0.7);
  const d2 = riverDash(4242, 90, 60, 160, 120, 5.5, 1, 0, 0.7);
  ok(d1.cx === d2.cx && d1.cy === d2.cy && d1.a === d2.a, 'riverDash недетерминирован');
  // Сид мира меняет картину в среднем: сравниваем среднюю яркость двух миров.
  let m1 = 0, m2 = 0;
  for (let i = 0; i < 300; i++) {
    m1 += speclePhase(11, i % 17, i * 3 % 23, 4).a;
    m2 += speclePhase(20260, i % 17, i * 3 % 23, 4).a;
  }
  ok(Math.abs(m1 - m2) > 1e-6, 'разные сиды дали идущую россыпь — хэш вырожден');
  // Периодичность: фаза повторяется через личный цикл клетки, ошибки не плывут.
  for (let i = 0; i < 50; i++) {
    const x = i * 7 % 61, y = i * 11 % 47;
    const j = hash4(4242, x, y, 41);
    const cycle = SPECLE_CYCLE_MIN + j * (SPECLE_CYCLE_MAX - SPECLE_CYCLE_MIN);
    const p1 = speclePhase(4242, x, y, 13.7);
    const p2 = speclePhase(4242, x, y, 13.7 + cycle * 7);
    near(p1.u, p2.u, 1e-6, `период спекла ${x},${y}`);
    near(p1.a, p2.a, 1e-6, `период яркости ${x},${y}`);
  }
});

// --------------------------------------------------------- диапазоны фаз
t('диапазоны: позиции/яркости спеклов внутри клетки и [0..1]', () => {
  for (let i = 0; i < 400; i++) {
    const x = i * 13 % 97, y = i * 29 % 89;
    for (let tt = 0; tt <= 20; tt += 0.37) {
      const sp = speclePhase(4242, x, y, tt);
      ok(Number.isFinite(sp.u) && Number.isFinite(sp.v) && Number.isFinite(sp.a), 'NaN в speclePhase');
      ok(sp.u >= 0 && sp.u <= 1 && sp.v >= 0 && sp.v <= 1, `позиция вне клетки: ${sp.u},${sp.v}`);
      ok(sp.a >= 0 && sp.a <= 1, `яркость вне [0..1]: ${sp.a}`);
      // Личный цикл клетки обязан лежать в заявленных рамках.
      const j = hash4(4242, x, y, 41);
      const cycle = SPECLE_CYCLE_MIN + j * (SPECLE_CYCLE_MAX - SPECLE_CYCLE_MIN);
      ok(cycle >= SPECLE_CYCLE_MIN && cycle <= SPECLE_CYCLE_MAX, 'цикл вне рамок констант');
    }
  }
});

t('диапазоны: пена дышит ровно между FOAM_W_MIN и FOAM_W_MAX', () => {
  for (let i = 0; i < 400; i++) {
    const x = i * 17 % 83, y = i * 7 % 71;
    for (let tt = 0; tt <= 12; tt += 0.29) {
      const fe = foamEdge(7, x, y, tt);
      ok(Number.isFinite(fe.w) && Number.isFinite(fe.k), 'NaN в foamEdge');
      ok(fe.w >= FOAM_W_MIN - 1e-12 && fe.w <= FOAM_W_MAX + 1e-12, `ширина пены вне рамок: ${fe.w}`);
      ok(fe.k >= 0 && fe.k <= 1, `фаза пены вне [0..1]: ${fe.k}`);
    }
  }
  // Такт с прибоем water.js: частота обязана совпадать с sin(this.time*0.85).
  ok(FOAM_PERIOD === 0.85, 'FOAM_PERIOD разошёлся с прибоем water._compose');
});

t('диапазоны: вспышка течения живёт в своей клетке, направление — наружу к морю', () => {
  for (let i = 0; i < 200; i++) {
    const x = 20 + i % 120, y = 5 + i * 3 % 110;
    const d = riverDash(4242, x, y, 160, 120, i * 0.213, 1, 0, 0.9);
    ok(Number.isFinite(d.cx) && Number.isFinite(d.cy) && Number.isFinite(d.a), 'NaN в riverDash');
    ok(Math.abs(d.cx - (x + 0.5)) <= 0.576, `чёрточка ушла по X из клетки: ${d.cx - x - 0.5}`);
    ok(Math.abs(d.cy - (y + 0.5)) <= 0.001, 'горизонтальная ось сместила Y');
    ok(d.len >= 0.16 && d.len <= 0.42 + 1e-12, `длина вне рамок: ${d.len}`);
    ok(d.a >= 0 && d.a <= 0.65, `яркость течения вне рамок: ${d.a}`);
  }
  // Знак направления проверяем в контролируемой фазе k=0.75 (travel > 0):
  // время подбираем так, чтобы личная фаза клетки легла в нужную точку цикла.
  const signAt = (x, y, ax, ay) => {
    const j = hash4(4242, x, y, 67);
    const tt = FLOW_CYCLE * (0.75 - j + 1);   // ((tt/FLOW_CYCLE)+j)%1 === 0.75
    return riverDash(4242, x, y, 160, 120, tt, ax, ay, 0.8);
  };
  ok(signAt(10, 40, 1, 0).cx < 10.5, 'в левой половине течение должно идти влево');
  ok(signAt(150, 40, 1, 0).cx > 150.5, 'в правой половине течение должно идти вправо');
  ok(signAt(80, 20, 0, 1).cy < 20.5, 'в верхней половине течение должно идти вверх');
  ok(signAt(80, 100, 0, 1).cy > 100.5, 'в нижней половине течение должно идти вниз');
});

t('ось русла: вертикаль/горизонталь опознаются, озеро и перекрёсток — нет', () => {
  const V = riverAxis(true, true, false, false);
  ok(V && V.ax === 0 && V.ay === 1, 'вертикальное русло не опознано');
  const Hr = riverAxis(false, false, true, true);
  ok(Hr && Hr.ax === 1 && Hr.ay === 0, 'горизонтальное русло не опознано');
  ok(riverAxis(true, true, true, true) === null, 'перекрёсток принят за русло');
  ok(riverAxis(false, false, false, false) === null, 'суша принята за русло');
});

// ---------------------------------------------------------------- потолок
function runFrames(sim, q, z, cw, ch, frames = 5) {
  const ctx = fakeCtx();
  const fx = new WaterFx(q);
  const ox = -(sim.world.w * 32 - cw) / 2, oy = -(sim.world.h * 32 - ch) / 2;
  let last = { ...ctx.n };
  const total = { arc: 0, fill: 0, fillRect: 0, stroke: 0 };
  for (let i = 0; i < frames; i++) {
    // Потолок заявлен НА КАДР: перед каждым кадром счётчики обнуляются.
    for (const k of Object.keys(ctx.n)) ctx.n[k] = 0;
    fx.draw(sim, ctx, ox, oy, z, cw, ch, 1 / 60, null, q);
    last = { ...ctx.n };
    for (const k of Object.keys(total)) total[k] += ctx.n[k];
  }
  return { ctx, fx, last, total };
}

t('потолок: на сплошном прибое ни один счётчик не превышает WATER_LIMITS', () => {
  const sim = mockSim(coastWorld());
  const { last } = runFrames(sim, QUALITY.ultra, 32, 1920, 1080);
  ok(last.arc > 100, `спеклов слишком мало для пробы потолка: ${last.arc}`);
  ok(last.arc <= WATER_LIMITS.specles, `спеклы пробили потолок: ${last.arc}`);
  ok(last.fill <= WATER_LIMITS.specles, `заливки спеклов пробили потолок: ${last.fill}`);
  ok(last.fillRect > 20, `пены слишком мало для пробы потолка: ${last.fillRect}`);
  ok(last.fillRect <= WATER_LIMITS.foam, `пена пробила потолок: ${last.fillRect}`);
  ok(last.stroke > 5, `течения слишком мало для пробы потолка: ${last.stroke}`);
  ok(last.stroke <= WATER_LIMITS.dashes, `вспышки пробили потолок: ${last.stroke}`);
});

t('потолок: площадь 4K зажата клампом — счётчики как на 1080p', () => {
  const sim = mockSim(seaWorld());
  const small = runFrames(sim, QUALITY.ultra, 32, 1920, 1080, 1).last;
  const huge = runFrames(sim, QUALITY.ultra, 32, 3840, 2160, 1).last;
  ok(huge.arc <= WATER_LIMITS.specles, `4K пробил потолок спеклов: ${huge.arc}`);
  ok(small.arc > 0 && huge.arc > 0, 'на открытой воде спеклов нет вовсе');
  ok(huge.arc === small.arc, `кламп площади не сработал: ${small.arc} против ${huge.arc}`);
});

// ------------------------------------------------------------------- гейты
t('ноль активности на eco: слой молчит, но часы идут', () => {
  const sim = mockSim(coastWorld(), { seasonIdx: 1 });
  const { total, fx } = runFrames(sim, QUALITY.eco, 32, 1920, 1080, 10);
  ok(total.arc + total.fill + total.fillRect + total.stroke === 0,
    `eco нарисовал элементы: ${JSON.stringify(total)}`);
  ok(fx.time > 0.1, 'часы слоя не тикают даже в молчании');
});

t('зимнее затишье: на сезоне 3 слой молчит целиком', () => {
  const sim = mockSim(coastWorld(), { seasonIdx: 3 });
  const { total } = runFrames(sim, QUALITY.ultra, 32, 1920, 1080);
  ok(total.arc + total.fill + total.fillRect + total.stroke === 0,
    `зимой вода мерцает: ${JSON.stringify(total)}`);
});

t('дальний зум: ниже lod.waterMinZoom пресета слой молчит', () => {
  const sim = mockSim(coastWorld());
  // ultra: waterMinZoom 0.4 → пиксель на тайл 32*0.4=12.8, берём заведомо ниже.
  const { total } = runFrames(sim, QUALITY.ultra, 10, 1920, 1080);
  ok(total.arc + total.fill + total.fillRect + total.stroke === 0,
    `издалека видны блики: ${JSON.stringify(total)}`);
});

t('безопасность: пустые данные не роняют кадр и не рисуют ничего', () => {
  const fx = new WaterFx(null);                 // без пресета в конструкторе
  fx.draw(null, null, 0, 0, 32, 100, 100, 0.016, null, null);          // всё пусто
  fx.draw(mockSim({}), fakeCtx(), 0, 0, 32, 100, 100, 0.016, null, QUALITY.high);  // мир без tiles
  fx.draw(mockSim({ w: 0, h: 0, seed: 1, tiles: new Uint8Array(0) }),
    fakeCtx(), 0, 0, 32, 100, 100, 0.016, null, QUALITY.high);       // карта нулевая
  const ctx = fakeCtx();
  new WaterFx(QUALITY.ultra).draw(mockSim(coastWorld()), ctx, 0, 0, 0, 100, 100, 0.016, null, QUALITY.ultra); // z=0
  ok(ctx.n.arc + ctx.n.fillRect + ctx.n.stroke === 0, 'z=0 что-то нарисовал');
  // Отрицательный dt зажат, часы не убегают назад.
  const fx2 = new WaterFx(QUALITY.ultra);
  fx2.draw(mockSim({ w: 1, h: 1, seed: 1, tiles: new Uint8Array([TILE.WATER]) }), null, 0, 0, 32, 10, 10, -5, null, QUALITY.ultra);
  ok(fx2.time === 0, 'отрицательный dt сдвинул часы назад');
});

console.log(`\nИтого: ${pass} прошло, ${fail} упало`);
process.exit(fail ? 1 : 0);
