// app/tests/test-faction-town.mjs — проверки процедурной отрисовки поселений
// фракций (render/faction_town.js). Запуск: node app/tests/test-faction-town.mjs
//
// Слой рисующий, поэтому проверяется журнал вызовов подставного 2D-контекста:
// геометрия сцен по ступеням, замкнутость стен, варианты знамени, дым руин,
// ночные окна, габариты силуэта, Y-сортировка, детерминизм, дисциплина кэша
// выпечки и главный запрет — никаких записей в симуляцию.
//
// settlement_view здесь ПОДМЕНЯЕТСЯ стабом через loader-hook: его собственные
// сценарии покрывает test-settlement-view.mjs, а этому юнит-тесту нужна
// управляемая выдача {tier,walls,atWar,damaged,pop,banner}. Файл хука пишется
// во временный каталог ОС, репозиторий он не затрагивает.
import { register } from 'node:module';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

let ok = 0, fail = 0;
function t(name, cond, extra = '') {
  if (cond) { ok++; return; }
  fail++;
  console.log(`  FAIL: ${name}${extra ? ' — ' + extra : ''}`);
}

// ---------------------------------------------------------------------------
// Стаб производного вида: читает ровно один подвес sim.__view и возвращает
// свежий объект — модуль отрисовки не имеет права ни кэшировать его вслепую,
// ни мутировать.
const stubSrc = `
export function settlementView(sim, f, st) {
  const v = sim && sim.__view;
  if (v) return { tier: v.tier | 0, walls: v.walls | 0, atWar: !!v.atWar,
    damaged: !!v.damaged, pop: v.pop | 0, banner: v.banner | 0 };
  return { tier: 1, walls: 0, atWar: false, damaged: false, pop: 10, banner: 1 };
}
export function invalidateSettlementViews() {}
`;
const hooksSrc = `const STUB = ${JSON.stringify(stubSrc)};
export function resolve(spec, ctx, next) {
  if (spec.includes('settlement_view')) return { url: 'stub:settlement-view', shortCircuit: true };
  return next(spec, ctx);
}
export function load(url, ctx, next) {
  if (url === 'stub:settlement-view') return { format: 'module', source: STUB, shortCircuit: true };
  return next(url, ctx);
}`;
const hooksPath = join(tmpdir(), 'opencode', 'town-stub-hooks.mjs');
mkdirSync(dirname(hooksPath), { recursive: true });
writeFileSync(hooksPath, hooksSrc);
register(pathToFileURL(hooksPath).href);
const { drawFactionTown, bannerCacheSize } = await import('../src/render/faction_town.js');

// ---------------------------------------------------------------------------
// Подставной канвас: каждый canvas несёт СВОЙ журнал — выпечка знамени идёт
// на отдельном контексте, и её содержимое тоже проверяем.
let canvasesMade = 0;
function fakeCanvas(w = 0, h = 0) {
  const log = [];
  const cv = { width: w, height: h, _fake: true, get log() { return log; } };
  cv.getContext = () => recorder(log);
  canvasesMade++;
  return cv;
}
function recorder(log) {
  const ctx = {
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1,
    beginPath() { log.push(['beginPath']); },
    closePath() { log.push(['closePath']); },
    moveTo(x, y) { log.push(['moveTo', x, y]); },
    lineTo(x, y) { log.push(['lineTo', x, y]); },
    arc(x, y, r) { log.push(['arc', x, y, r]); },
    ellipse(x, y, rx, ry) { log.push(['ellipse', x, y, rx, ry]); },
    stroke() { log.push(['stroke', this.strokeStyle, this.lineWidth]); },
    fill() { log.push(['fill', this.fillStyle]); },
    fillRect(x, y, w, h) { log.push(['fillRect', x, y, w, h, this.fillStyle]); },
    drawImage(img, ...a) { log.push(['drawImage', img, ...a.map(n => Math.round(n * 100) / 100)]); },
    createRadialGradient() { log.push(['grad']); return { addColorStop() {} }; },
  };
  return ctx;
}
globalThis.document = { createElement: () => fakeCanvas() };

// ---------------------------------------------------------------------------
// Подставные участники. Симуляция — только то, что слой вправе читать,
// плюс serialize() как сторож от записи.
function freshView(over = {}) {
  return { tier: 1, walls: 0, atWar: false, damaged: false, pop: 20, banner: 1, ...over };
}
function makeSim(view, x = 300, y = 200) {
  const f = { id: 7, def: { color: '#b04a3a' } };
  const s = { x, y, capital: true };
  const sim = {
    world: { seed: 99 }, day: 3, factions: [f], log: [], aiWars: [], wars: {},
    __view: view,
    serialize() { return { day: this.day, seed: this.world.seed, fac: [this.factions[0].id] }; },
  };
  return { sim, f, s };
}
const Z = 32;
const SX = 500, SY = 400;
function drawOnce(sim, f, s, opts = {}) {
  const log = [];
  drawFactionTown(recorder(log), SX, SY, Z, f, s, sim, { time: 1.5, ...opts });
  return log;
}

// --- разбор журнала ---------------------------------------------------------
// Треугольник = путь из одного moveTo и ровно двух lineTo (крыши, шатры).
function triangles(log) {
  const res = [];
  let cur = null;
  for (const e of log) {
    const k = e[0];
    if (k === 'beginPath') cur = { pts: 0, moved: false, multi: false };
    else if (cur) {
      if (k === 'moveTo') { if (cur.moved) cur.multi = true; cur.moved = true; }
      else if (k === 'lineTo') cur.pts++;
      else if (k === 'fill' || k === 'stroke') { if (!cur.multi && cur.pts === 2 && cur.moved) res.push(cur); cur = null; }
    }
  }
  return res.length;
}
// Контактные тени: пара «ellipse → fill(rgba(0,0,0,0.25))».
function shadows(log) {
  let pend = null; const arr = [];
  for (const e of log) {
    if (e[0] === 'ellipse') pend = e;
    else if (e[0] === 'fill' && pend && e[1] === 'rgba(0,0,0,0.25)') { arr.push(pend); pend = null; }
    else if (e[0] !== 'ellipse') pend = null;
  }
  return arr;
}
// Клубы дыма: пара «arc → fill(rgba(96,92,90,…))».
function smokePuffs(log) {
  let pend = null; let n = 0;
  for (const e of log) {
    if (e[0] === 'arc') pend = e;
    else if (e[0] === 'fill' && pend && String(e[1]).startsWith('rgba(96,92,90')) { n++; pend = null; }
    else if (e[0] !== 'arc') pend = null;
  }
  return n;
}
const warmFills = (log) => log.filter(e => e[0] === 'fillRect' && String(e[5]).startsWith(`rgba(255,182,88`)).length;
const NIGHT = { L: { mul: 0.42, tint: [22, 34, 86, 0.46], sunAz: -2.36, glow: 1, sky: '#000', shadowLen: 2 } };

// ===========================================================================
{
  // --- 1..2: ступень 0 — шатёр из двух треугольников и костёр -------------
  const v0 = freshView({ tier: 0 });
  const a = makeSim(v0);
  const l0 = drawOnce(a.sim, a.f, a.s);
  t('tier 0 — ровно два треугольных пути (шатёр)', triangles(l0) === 2, `${triangles(l0)}`);
  t('tier 0 — костёр горит оранжевым пламенем', l0.some(e => e[0] === 'fill' && e[1] === '#ff9a3c'));

  // --- 3..4: число построек растёт со ступенью -----------------------------
  const countByTier = {};
  for (const tier of [0, 1, 2, 4]) {
    const m = makeSim(freshView({ tier }));
    countByTier[tier] = shadows(drawOnce(m.sim, m.f, m.s)).length;
  }
  t('построек больше на каждой следующей ступени 0<1<2<4',
    countByTier[0] < countByTier[1] && countByTier[1] < countByTier[2] && countByTier[2] < countByTier[4],
    JSON.stringify(countByTier));
  t('город (t4) несёт не меньше шести построек', countByTier[4] >= 6, `${countByTier[4]}`);

  // --- 5..6: каменные стены — замкнутый контур ----------------------------
  const hasWallContour = (log) => {
    for (let i = 0; i < log.length; i++) {
      if (log[i][0] !== 'closePath') continue;
      for (let j = i + 1; j < log.length; j++) {
        if (log[j][0] === 'closePath') break;
        if (log[j][0] === 'stroke') {
          return log[j][1] === '#6f6a60' && log[j][2] >= Z * 0.05;
        }
      }
    }
    return false;
  };
  const mw = makeSim(freshView({ tier: 4, walls: 2 }));
  t('walls=2 рисует замкнутый контур стен (closePath+stroke)', hasWallContour(drawOnce(mw.sim, mw.f, mw.s)));
  const mn = makeSim(freshView({ tier: 4, walls: 0 }));
  t('walls=0 — контура стен нет', !hasWallContour(drawOnce(mn.sim, mn.f, mn.s)));

  // --- 7..9: знамя меняется вариантом выреза и войной ---------------------
  const imgs = [];
  for (const b of [0, 1, 2]) {
    const mb = makeSim(freshView({ banner: b }));
    const lg = drawOnce(mb.sim, mb.f, mb.s);
    imgs.push(lg.find(e => e[0] === 'drawImage')[1]);
  }
  t('три варианта знамени — три разных испечённых полотна',
    imgs[0] !== imgs[1] && imgs[1] !== imgs[2] && imgs[0] !== imgs[2]);
  t('геометрия полотнища вариантов различается',
    JSON.stringify(imgs[0].log) !== JSON.stringify(imgs[1].log)
    && JSON.stringify(imgs[1].log) !== JSON.stringify(imgs[2].log));
  const mPeace = makeSim(freshView({ banner: 1, atWar: false }));
  const peaceImg = drawOnce(mPeace.sim, mPeace.f, mPeace.s).find(e => e[0] === 'drawImage')[1];
  const mWar = makeSim(freshView({ banner: 1, atWar: true }));
  const warImg = drawOnce(mWar.sim, mWar.f, mWar.s).find(e => e[0] === 'drawImage')[1];
  t('atWar добавляет красную кайму в выпечку знамени',
    warImg.log.some(e => e[0] === 'stroke' && e[1] === '#c0392b')
    && !peaceImg.log.some(e => e[0] === 'stroke' && e[1] === '#c0392b'));

  // --- 10: повреждение — дым и обугленный дом ------------------------------
  const md = makeSim(freshView({ tier: 2, damaged: true }));
  const ld = drawOnce(md.sim, md.f, md.s);
  const mc = makeSim(freshView({ tier: 2, damaged: false }));
  const lc = drawOnce(mc.sim, mc.f, mc.s);
  t('damaged даёт столб дыма над руиной', smokePuffs(ld) >= 3, `${smokePuffs(ld)}`);
  t('уцелевший посёлок не дымит', smokePuffs(lc) === 0);
  t('обугленный дом нарисован тёмным коробом',
    ld.some(e => e[0] === 'fillRect' && e[5] === '#33302c'));

  // --- 11..12: детерминизм -------------------------------------------------
  const d1 = makeSim(freshView({ tier: 3 }));
  const d2 = makeSim(freshView({ tier: 3 }));
  t('одинаковый вход → идентичная последовательность вызовов',
    JSON.stringify(drawOnce(d1.sim, d1.f, d1.s, NIGHT))
    === JSON.stringify(drawOnce(d2.sim, d2.f, d2.s, NIGHT)));
  const d3 = makeSim(freshView({ tier: 3 }), 301, 200);
  t('другие координаты → другой разброс построек',
    JSON.stringify(drawOnce(d1.sim, d1.f, d1.s)) !== JSON.stringify(drawOnce(d3.sim, d3.f, d3.s)));

  // --- 13: ночные окна ------------------------------------------------------
  const nw = makeSim(freshView({ tier: 3 }));
  const dayLog = drawOnce(nw.sim, nw.f, nw.s, { L: { tint: [255, 246, 224, 0.05], glow: 0 } });
  const nightLog = drawOnce(nw.sim, nw.f, nw.s, NIGHT);
  t('днём тёплых окон нет', warmFills(dayLog) === 0, `${warmFills(dayLog)}`);
  t('ночью окон 2–4 по ступени', warmFills(nightLog) >= 2 && warmFills(nightLog) <= 4, `${warmFills(nightLog)}`);
  const halfLog = drawOnce(nw.sim, nw.f, nw.s, { L: { tint: [34, 42, 98, 0.42], glow: 0.5 } });
  t('альфа окон пропорциональна L.glow',
    halfLog.some(e => e[0] === 'fillRect' && e[5] === 'rgba(255,182,88,0.625)'));

  // --- 14: кэш знамён не распухает ----------------------------------------
  const beforeBakes = canvasesMade;
  for (let i = 0; i < 50; i++) {
    const mf = { id: i % 15, def: { color: '#b04a3a' } };
    const ms = { x: 300, y: 200, capital: false };
    drawOnce(makeSim(freshView({ banner: i % 3, atWar: i % 2 === 0 })).sim, mf, ms);
  }
  t('после 50 кадров с десятками комбинаций кэш ≤12', bannerCacheSize() <= 12, `${bannerCacheSize()}`);
  t('кэш при этом реально работает (не пуст и не перепекается бесконечно)',
    bannerCacheSize() > 0 && canvasesMade - beforeBakes <= 12, `${canvasesMade - beforeBakes}`);

  // --- 15: НЕТ записи в симуляцию ------------------------------------------
  // Каждая ступень — свой sim: снимок берём до отрисовки и сверяем после,
  // не трогая вход между снимками (иначе проверка ловила бы саму себя).
  const snapFn = (o) => JSON.stringify(o, (k, v) => (typeof v === 'function' ? undefined : v));
  let noWrite = true;
  for (const tier of [0, 1, 2, 3, 4]) {
    const m = makeSim(freshView({ tier, walls: tier % 3, atWar: tier % 2 === 0, damaged: tier > 2 }));
    const before = snapFn([m.sim.serialize(), m.sim]);
    drawOnce(m.sim, m.f, m.s, NIGHT);
    if (snapFn([m.sim.serialize(), m.sim]) !== before) noWrite = false;
  }
  t('КРИТИЧНО: serialize() и весь sim не изменились от отрисовки', noWrite);

  // --- 16: габарит силуэта --------------------------------------------------
  const gb = makeSim(freshView({ tier: 4, walls: 2 }));
  const gl = drawOnce(gb.sim, gb.f, gb.s);
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const e of gl) {
    const pts = [];
    if (e[0] === 'moveTo' || e[0] === 'lineTo') pts.push([e[1], e[2]]);
    else if (e[0] === 'fillRect') pts.push([e[1], e[2]], [e[1] + e[3], e[2] + e[4]]);
    else if (e[0] === 'arc') pts.push([e[1] + e[3], e[2] + e[3]], [e[1] - e[3], e[2] - e[3]]);
    else if (e[0] === 'ellipse') pts.push([e[1] + e[3], e[2] + e[4]], [e[1] - e[3], e[2] - e[4]]);
    else if (e[0] === 'drawImage') pts.push([e[2], e[3]], [e[2] + e[4], e[3] + e[5]]);
    for (const [px, py] of pts) {
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
    }
  }
  t('силуэт не шире 3.2z', maxX - minX <= 3.2 * Z + 0.75, `${(maxX - minX).toFixed(1)} > ${(3.2 * Z).toFixed(1)}?`);
  t('силуэт не выше 2.6z над якорем', SY - minY <= 2.6 * Z + 0.75, `${(SY - minY).toFixed(1)}`);
  t('подошва не уползает глубже полутора клеток', maxY - SY <= 1.5 * Z + 1, `${(maxY - SY).toFixed(1)}`);

  // --- 17: Y-сортировка внутри модуля ---------------------------------------
  const ys = shadows(gl).map(e => e[2]);
  let sorted = true;
  for (let i = 1; i < ys.length; i++) if (ys[i] < ys[i - 1] - 0.01) sorted = false;
  t('дальние дома рисуются раньше ближних (тени по Y неубывают)', sorted);

  // --- 18: дальний план — одна точка с флажком ------------------------------
  const lodLog = [];
  drawFactionTown(recorder(lodLog), SX, SY, 6, gb.f, gb.s, gb.sim, {});
  t('при z<7 посёлок — точка с блотом знамени, без полной сцены',
    lodLog.filter(e => e[0] === 'drawImage').length === 1
    && lodLog.filter(e => e[0] === 'fillRect').length === 1
    && lodLog.length < 8, `len=${lodLog.length}`);

  // --- 19: запрет градиентов/фильтров за кадр и в исходнике -----------------
  const gradLog = [];
  drawFactionTown(recorder(gradLog), SX, SY, Z, gb.f, gb.s, gb.sim, NIGHT);
  t('в кадре нет createRadialGradient', !gradLog.some(e => e[0] === 'grad'));
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '../src/render/faction_town.js'), 'utf8');
  const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  t('в исходнике нет Math.random / rng / градиентов / filter',
    !/Math\.random/.test(code) && !/\brng\b/.test(code)
    && !/createRadialGradient/.test(code) && !/\.filter\s*=/.test(code));
  t('слой тянет вид из settlement_view и hash2 из palette',
    src.includes("from '../core/systems/settlement_view.js'") && src.includes("hash2 } from './palette.js'"));

  // --- 20..25: РАЗНООБРАЗИЕ ПРОТИВ ДЕТЕРМИНИЗМА ----------------------------
  // Два требования тянут в разные стороны и потому проверяются вместе:
  //   • соседние поселения ОДНОГО яруса не должны быть клонами;
  //   • одно и то же поселение обязано выглядеть одинаково в любом кадре,
  //     у любого игрока и после перезагрузки сейва.
  // Единственный законный источник разнообразия — хеш от координат и
  // sim.world.seed (см. siteDice): ни Math.random, ни общий поток sim.
  //
  // Подставной кэш спрайтов возвращает пустышку и ЗАПИСЫВАЕТ запрошенные id —
  // так виден сам состав улицы, а не только геометрия.
  function stubSprites(seen) {
    return {
      building(id) {
        seen.push(id);
        return { cv: { width: 64, height: 80 } };
      },
    };
  }
  const layout = (x, y, tier, seed = 99) => {
    const m = makeSim(freshView({ tier }), x, y);
    m.sim.world.seed = seed;
    const seen = [], log = [];
    drawFactionTown(recorder(log), SX, SY, Z, m.f, m.s, m.sim, { time: 1.5, sprites: stubSprites(seen) });
    return { geom: JSON.stringify(log), street: seen.join(','), seen };
  };

  // Шесть разных мест на каждом ярусе — все раскладки обязаны различаться.
  let cloneAt = '', sameStreet = '';
  for (const tier of [1, 2, 3, 4]) {
    const spots = [[300, 200], [301, 200], [300, 201], [317, 244], [58, 91], [140, 7]];
    const geoms = new Set(), streets = new Set();
    for (const [x, y] of spots) {
      const L = layout(x, y, tier);
      geoms.add(L.geom); streets.add(L.street);
    }
    if (geoms.size !== spots.length) cloneAt += ` t${tier}:${geoms.size}/${spots.length}`;
    // Состав улицы обязан различаться хотя бы у трёх мест из шести: пул шире
    // числа слотов, и полное совпадение выдало бы возврат к жёсткому списку.
    if (streets.size < 3) sameStreet += ` t${tier}:${streets.size}`;
  }
  t('поселения одного яруса на РАЗНЫХ координатах дают разные раскладки', cloneAt === '', cloneAt);
  t('состав улицы тоже разный, а не только сдвиги', sameStreet === '', sameStreet);

  // Одно и то же поселение — покадрово одинаковое. Между прогонами рисуются
  // чужие посёлки: скрытого состояния между вызовами быть не должно.
  const ref = layout(317, 244, 3);
  layout(58, 91, 4); layout(300, 200, 1);
  const again = layout(317, 244, 3);
  layout(140, 7, 2);
  const third = layout(317, 244, 3);
  t('одно и то же поселение — всегда одна и та же раскладка',
    ref.geom === again.geom && ref.geom === third.geom);
  t('и всегда та же улица', ref.street === again.street && ref.street === third.street);

  // Сид мира входит в жребий: те же координаты в другом мире застроены иначе.
  const w1 = layout(317, 244, 3, 99), w2 = layout(317, 244, 3, 4242);
  t('другой sim.world.seed → другая раскладка на тех же координатах',
    w1.geom !== w2.geom || w1.street !== w2.street);

  // «Лицо» яруса на месте: столицу должно быть видно по замку, и ровно по
  // одному — раньше запись доставалась башенному слоту и замок пропадал.
  const cap = layout(317, 244, 4);
  t('в столице (t4) ровно один замок, и он нарисован спрайтом',
    cap.seen.filter(id => id === 'castle').length === 1, cap.seen.join(','));
}

console.log(`=== ${ok} OK / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
