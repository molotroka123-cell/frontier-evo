// Тесты атмосферного слоя (app/src/render/atmosphere.js).
// Запуск: node app/tests/test-atmosphere.mjs
//
// Канваса в node нет, поэтому здесь подставной document — как в
// test-city-lights.mjs и test-postfx.mjs. Проверяется не картинка, а то,
// за что модуль отвечает по правилам проекта: ДЕТЕРМИНИЗМ позиций (тот же
// вход — та же частица, ни одного Math.random и rng ядра), ПОТОЛКИ частиц
// по пресетам, МОЛЧАНИЕ на eco и на пустом симе, ДИАПАЗОНЫ фаз и альф,
// ОТСЕЧЕНИЕ вне камеры. Пиксели проверит глаз.
const noop = () => {};

// Подставной document: модуль проверяет только его существование, чтобы
// молчать в node; здесь мы его подсовываем, чтобы дойти до draw-путей.
globalThis.document = { createElement: () => ({ width: 0, height: 0 }) };

function fakeCtx() {
  return {
    canvas: { width: 1280, height: 720 },
    fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    calls: {
      beginPath: 0, fill: 0, stroke: 0, arc: 0, quad: 0,
      moveTo: 0, lineTo: 0, closePath: 0, save: 0, restore: 0,
    },
    modes: [],
    _op(name) { this.calls[name]++; },
    beginPath() { this._op('beginPath'); },
    moveTo() { this._op('moveTo'); },
    lineTo() { this._op('lineTo'); },
    closePath() { this._op('closePath'); },
    quadraticCurveTo() { this._op('quad'); },
    arc() { this._op('arc'); },
    fill() { this.modes.push(this.globalCompositeOperation); this._op('fill'); },
    stroke() { this._op('stroke'); },
    save() { this._op('save'); },
    restore() { this._op('restore'); },
  };
}

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('OK', name); } catch (e) { fail++; console.log('FAIL', name, '—', e.message); } };
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const near = (a, b, eps, msg) => ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
const same = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg);

// --------------------------------------------------------------- заготовки
const RECT = { x0: 25, y0: 29, x1: 65, y1: 53 };   // видимая область, тайлы
const bld = (id, x, y, o = {}) => ({ id, x, y, size: 1, done: true, destroyed: false, ...o });
const squad = (x, y, nx, ny) => ({
  id: 'sq', side: 'player', dead: false, x, y,
  path: nx === null ? null : [{ x, y }, { x: nx, y: ny }], pathIdx: 1,
});
function simOf(opts = {}) {
  const s = {
    world: { seed: opts.seed === undefined ? 2026 : opts.seed, w: 96, h: 96 },
    day: opts.day === undefined ? 5 : opts.day,
    buildings: [], factions: [],
  };
  if (opts.squads) s.armyState = { squads: opts.squads };
  return s;
}
// Матрица качеств берётся из настоящего пресета — потолки сверяются с ним.
const { QUALITY } = await import('../src/render/quality.js');
const { lightAt } = await import('../src/render/palette.js');
const {
  ATMO_LIMITS, SMOKE_LIFE, DUST_LIFE, SPARK_LIFE,
  hash4, windAt, smokePuff, marchDust, fireSpark, crownSway, flagPose,
  planFrame, AtmosphereFX,
} = await import('../src/render/atmosphere.js');

// Пока выполняются чистые функции, случайность запрещена под страхом броска:
// это прямая проверка правила «render не зовёт sim.rng и Math.random».
const origRandom = Math.random;
Math.random = () => { throw new Error('Math.random в атмосфере запрещён'); };
try {

// ------------------------------------------------------------ чистые функции
t('хеш детерминирован, лежит в [0,1) и различает входы', () => {
  for (let i = 0; i < 500; i++) {
    const v = hash4(2026, i * 7919 % 1000, i * 104729 % 1000, i);
    ok(v >= 0 && v < 1, `хеш вне [0,1): ${v}`);
    ok(v === hash4(2026, i * 7919 % 1000, i * 104729 % 1000, i), 'хеш не воспроизводится');
  }
  let diff = 0;
  for (let n = 0; n < 50; n++) if (hash4(2026, 40, 40, n) !== hash4(777, 40, 40, n)) diff++;
  ok(diff >= 40, `сид мира почти не меняет хеш (${diff}/50)`);
});

t('ветер — медленная синусоида дня+сида в заявленных диапазонах', () => {
  for (const seed of [7, -12345, 2026]) {
    for (let day = 0; day <= 200; day += 7) {
      for (let tt = 0; tt <= 120; tt += 1.37) {
        const w = windAt(seed, day, tt);
        ok(Math.abs(w.x) <= 1 + 1e-9, `ветер X вне [-1..1]: ${w.x}`);
        ok(Math.abs(w.y) <= 0.25, `ветер Y вне [-0.25..0.25]: ${w.y}`);
        ok(Number.isFinite(w.x) && Number.isFinite(w.y), 'ветер NaN');
      }
    }
  }
  // Медленность: за секунду направление почти не меняется...
  const a = windAt(2026, 40, 100), b = windAt(2026, 40, 101);
  ok(Math.abs(a.x - b.x) < 0.02, 'ветер дрожит покадрово, а не ползёт фронтом');
  // ...а от дня к дню и от сида к сиду картина другая.
  ok(windAt(2026, 40, 0).x !== windAt(2026, 41, 0).x || windAt(2026, 40, 0).y !== windAt(2026, 41, 0).y,
    'завтра обязан дуть другой ветер');
  same(windAt(2026, 40, 33.3), windAt(2026, 40, 33.3), 'ветер не воспроизводится');
});

t('дым: фазы в диапазонах, клуб всегда выше трубы и растёт', () => {
  const w = windAt(2026, 9, 12);
  let maxY = -Infinity;
  for (let tt = 0; tt < SMOKE_LIFE * 2; tt += 0.11) {
    for (let slot = 0; slot < ATMO_LIMITS.puffsPerCol; slot++) {
      const p = smokePuff(2026, 40.71, 40.08, slot, w, tt, 17);
      ok(p.k >= 0 && p.k < 1, `фаза вне [0..1): ${p.k}`);
      ok(p.a >= 0 && p.a <= 0.34 + 1e-9, `альфа дыма вне диапазона: ${p.a}`);
      ok(p.r >= 0.13 - 1e-9 && p.r <= 0.51 + 1e-9, `радиус вне диапазона: ${p.r}`);
      ok(Number.isFinite(p.x + p.y), 'позиция NaN');
      maxY = Math.max(maxY, p.y);
    }
  }
  ok(maxY < 40.08, `клуб опустился ниже устья трубы (${maxY})`);
  // Детерминизм серии: два независимых прогона совпадают кадр в кадр.
  const run = (f) => Array.from({ length: 30 }, (_, fr) =>
    JSON.stringify(smokePuff(2026, 40.71, 40.08, 3, w, tt0 + fr * 0.05, fr)));
  const tt0 = 1.7;
  same(run(), run(), 'серия кадров дыма не воспроизводится');
});

t('пыль марша: стоит отряд — пыли нет, идёт — шлейф позади', () => {
  const w = windAt(2026, 3, 5);
  ok(marchDust(2026, 40, 40, 1, 0, 0, 1, 0, 2) === null, 'стоящий отряд поднимает пыль');
  ok(marchDust(2026, 40, 40, 1, 0, 0, 1, 0) === null, 'moving по умолчанию не маршевый');
  for (let tt = 0; tt < DUST_LIFE * 2; tt += 0.07) {
    for (let slot = 0; slot < ATMO_LIMITS.puffsPerRow; slot++) {
      const p = marchDust(2026, 40, 40, 1, 0, slot, tt, 1, 3);
      ok(p.a >= 0 && p.a <= 0.42 + 1e-9, `альфа пыли вне диапазона: ${p.a}`);
      ok(p.r > 0 && p.r <= 0.40 + 1e-9, `радиус пыли вне диапазона: ${p.r}`);
      ok(p.x <= 40 + 0.02 + 1e-9, `клуб убежал далеко вперёд колонны (${p.x})`);
    }
  }
  same(marchDust(2026, 40.3, 39.7, 0.6, -0.8, 4, 0.5, 1, 9),
    marchDust(2026, 40.3, 39.7, 0.6, -0.8, 4, 0.5, 1, 9), 'пыль не воспроизводится');
});

t('искры: нулевая интенсивность молчит, живые летят вверх', () => {
  ok(fireSpark(2026, 40, 40, 0, 1, 0, 2) === null, 'угасший костёр сыплет искры');
  ok(fireSpark(2026, 40, 40, 0, 1, 0.005) === null, 'интенсивность ниже порога должна молчать');
  const w = windAt(2026, 3, 5);
  for (let tt = 0; tt < SPARK_LIFE * 2; tt += 0.03) {
    for (let slot = 0; slot < ATMO_LIMITS.sparksPerFire; slot++) {
      const p = fireSpark(2026, 40, 40, slot, tt, 1, 4);
      ok(p.a >= 0 && p.a <= 0.85 + 1e-9, `альфа искры вне диапазона: ${p.a}`);
      ok(p.r > 0 && p.r <= 0.052 + 1e-9, `радиус искры вне диапазона: ${p.r}`);
      ok(p.y < 40, 'искра летит вниз');
    }
  }
  same(fireSpark(2026, 41.5, 42.5, 2, 0.4, 0.8, 11),
    fireSpark(2026, 41.5, 42.5, 2, 0.4, 0.8, 11), 'искры не воспроизводятся');
});

t('колыхание крон: амплитуда пропорциональна гибкости и ветру', () => {
  const calm = windAt(2026, 21, 0), storm = { x: 1, y: 0 };
  const extrema = (wind, flex) => {
    let m = 0;
    for (let tt = 0; tt < 40; tt += 0.25) {
      const c = crownSway(2026, 44, 45, wind, tt, flex);
      m = Math.max(m, Math.abs(c.dx), Math.abs(c.dy));
      ok(Number.isFinite(c.dx + c.dy), 'крона NaN');
    }
    return m;
  };
  ok(extrema(storm, 2) > extrema(storm, 0.4), 'гибкая берёза качается как дуб');
  ok(extrema(storm, 1) > extrema(calm, 1), 'в шторм качается сильнее штиля');
  ok(extrema(storm, 2) <= 0.07 * 2 + 1e-9, 'амплитуда вылезла за 0.07×flex');
  same(crownSway(2026, 44, 45, calm, 7.7, 1), crownSway(2026, 44, 45, calm, 7.7, 1),
    'колыхание не воспроизводится');
});

t('флаг: при штиле полотнище висит, при ветре летит и трепещется', () => {
  const calm = { x: 0.05, y: 0 }, storm = { x: 1, y: 0 };
  const scan = (wind) => {
    let tipYmin = Infinity, tipYmax = -Infinity;
    for (let tt = 0; tt < 30; tt += 0.2) {
      const p = flagPose(2026, 50, 51, wind, tt);
      ok(Number.isFinite(p.tipX + p.tipY + p.midX + p.midY + p.botDy), 'ткань NaN');
      ok(p.tipX >= 0.82 - 1e-9 && p.tipX <= 0.92 + 1e-9, `длина полотнища вне [0.82..0.92]: ${p.tipX}`);
      ok(p.botDy >= 0.47 - 1e-9 && p.botDy <= 0.63 + 1e-9, `нижняя кромка вне диапазона: ${p.botDy}`);
      ok(p.midX < p.tipX, 'середина ткани дальше кончика');
      tipYmin = Math.min(tipYmin, p.tipY); tipYmax = Math.max(tipYmax, p.tipY);
    }
    return [tipYmin, tipYmax];
  };
  const [calmMin] = scan(calm);
  const [, stormMax] = scan(storm);
  ok(calmMin > stormMax, `висящий флаг должен быть ниже летящего (${calmMin} vs ${stormMax})`);
  same(flagPose(2026, 50, 51, storm, 12.3), flagPose(2026, 50, 51, storm, 12.3),
    'флаг не воспроизводится');
});

// ------------------------------------------------------------------- план
t('потолок частиц соблюдается на ultra даже при огромной площади экрана', () => {
  const sim = simOf();
  for (let i = 0; i < 24; i++) sim.buildings.push(bld('smithy', 26 + i, 30 + i));
  sim.armyState = { squads: Array.from({ length: 16 }, (_, i) => squad(30 + i, 35 + i, 31 + i, 36)) };
  const fires = Array.from({ length: 25 }, (_, i) => ({ id: i, x: 27 + i, y: 31, i: 1 }));
  sim.factions.push({
    alive: true, def: { color: '#ff0000' },
    settlements: Array.from({ length: 12 }, (_, i) => ({ x: 26 + i * 2, y: 50, capital: true })),
  });
  // areaK=3 больше внутреннего клампа кадра — проверяется именно жёсткий
  // ATMO_LIMITS: сколько бы плотность ни запросила, слой больше не возьмёт.
  const plan = planFrame(sim, RECT, QUALITY.ultra, 3, fires);
  ok(plan.smoke.length <= ATMO_LIMITS.smokeCols, `колонн дыма больше потолка: ${plan.smoke.length}`);
  ok(plan.dust.length <= ATMO_LIMITS.dustRows, `отрядов с пылью больше потолка: ${plan.dust.length}`);
  ok(plan.fires.length <= ATMO_LIMITS.fires, `точек огня больше потолка: ${plan.fires.length}`);
  ok(plan.flags.length <= ATMO_LIMITS.flags, `флагов больше потолка: ${plan.flags.length}`);
  ok(plan.smoke.length === 10 && plan.dust.length === 8 && plan.fires.length === 20 && plan.flags.length === 8,
    'на ultra потолки обязаны выбираться целиком');
});

t('плотность пресета режет источники: medium берёт половину', () => {
  const sim = simOf();
  for (let i = 0; i < 10; i++) sim.buildings.push(bld('foundry', 30 + i * 2, 32 + (i % 2)));
  sim.armyState = { squads: Array.from({ length: 10 }, (_, i) => squad(30 + i, 40, 31 + i, 41)) };
  const fires = Array.from({ length: 18 }, (_, i) => ({ id: i, x: 30 + i, y: 45, i: 1 }));
  const plan = planFrame(sim, RECT, QUALITY.medium, 1, fires);
  ok(plan.smoke.length === 5, `ожидалось 5 колонн на medium, а их ${plan.smoke.length}`);
  ok(plan.dust.length === 4, `ожидалось 4 отряда на medium, а их ${plan.dust.length}`);
  ok(plan.fires.length === 10, `ожидалось 10 огней на medium, а их ${plan.fires.length}`);
  // Даже при particles=0.1 ceil оставляет минимум один источник: редкость
  // должна читаться, а не исчезать совсем.
  const rare = planFrame(sim, RECT, { id: 'low', particles: 0.1 }, 1, fires);
  ok(rare.smoke.length === 1 && rare.dust.length === 1,
    `редкий слой вымерз (${rare.smoke.length}/${rare.dust.length})`);
});

t('eco и пустой сим дают полностью пустой план', () => {
  const rich = simOf();
  for (let i = 0; i < 30; i++) rich.buildings.push(bld('factory', 30 + i, 32));
  rich.armyState = { squads: [squad(30, 40, 31, 41)] };
  rich.factions.push({ alive: true, def: { color: '#fff' }, settlements: [{ x: 40, y: 45, capital: true }] });
  for (const q of [QUALITY.eco, null, { id: 'medium', particles: 0 }]) {
    const plan = planFrame(rich, RECT, q, 1, []);
    ok(plan.smoke.length + plan.dust.length + plan.fires.length + plan.flags.length === 0,
      `пресет ${q && q.id} не молчит`);
  }
  // Пустой сим и мусор во входах — план пуст, ничего не падает.
  for (const s of [null, {}, simOf()]) {
    const plan = planFrame(s, RECT, QUALITY.high, 1, null);
    ok(plan.smoke.length + plan.dust.length + plan.flags.length === 0, 'пустой сим не пуст');
  }
  ok(planFrame(simOf(), { x0: NaN, y0: 0, x1: 1, y1: 1 }, QUALITY.high, 1, []).smoke.length === 0,
    'битый прямоугольник камеры должен давать пустой план');
});

t('план отсекает всё вне камеры до расчёта позиций', () => {
  const far = simOf();
  far.buildings.push(bld('smithy', 300, 300), bld('campfire', 310, 305));
  far.armyState = { squads: [squad(320, 320, 321, 320)] };
  far.factions.push({ alive: true, def: { color: '#fff' }, settlements: [{ x: 330, y: 330, capital: true }] });
  const plan = planFrame(far, RECT, QUALITY.ultra, 1, [{ id: 1, x: 340, y: 340, i: 1 }]);
  ok(plan.smoke.length === 0, 'дымящая труба за горизонтом попала в план');
  ok(plan.dust.length === 0, 'марш за горизонтом попал в план');
  ok(plan.fires.length === 0, 'костёр за горизонтом попал в план');
  ok(plan.flags.length === 0, 'столица за горизонтом попала в план');

  const near = simOf();
  near.buildings.push(bld('smithy', 30, 31), bld('campfire', 33, 31));
  near.armyState = { squads: [squad(30, 40, 31, 40)] };
  near.factions.push({ alive: true, def: { color: '#fff' }, settlements: [{ x: 40, y: 45, capital: true }] });
  const p2 = planFrame(near, RECT, QUALITY.ultra, 1, [{ id: 1, x: 35, y: 35, i: 1 }]);
  ok(p2.smoke.length === 1 && p2.fires.length === 2 && p2.dust.length === 1 && p2.flags.length === 1,
    'источники в кадре потерялись');
});

t('план свежий: правка результата не портит следующий кадр', () => {
  const sim = simOf();
  sim.buildings.push(bld('smithy', 30, 31));
  const a = planFrame(sim, RECT, QUALITY.high, 1, []);
  a.smoke.length = 0; a.fires.push({ x: 0, y: 0, i: 1 });
  const b = planFrame(sim, RECT, QUALITY.high, 1, []);
  ok(b.smoke.length === 1 && b.fires.length === 0, 'план переиспользует чужие массивы');
});

t('руины и недострои не дымят и не греют', () => {
  const sim = simOf();
  sim.buildings.push(
    bld('factory', 30, 31, { destroyed: true }),
    bld('power_plant', 33, 31, { done: false }),
    bld('campfire', 36, 31, { destroyed: true }),
  );
  const plan = planFrame(sim, RECT, QUALITY.ultra, 1, []);
  ok(plan.smoke.length === 0 && plan.fires.length === 0, 'руины дымят');
});

t('мертвые и стоящие отряды пыли не поднимают', () => {
  const sim = simOf({ squads: [
    { ...squad(30, 40, 31, 40), dead: true },
    squad(33, 40, null, null),          // путь закончился/не задан
    { ...squad(36, 40, 37, 40), pathIdx: 5 }, // pathIdx за пределом пути
  ] });
  const plan = planFrame(sim, RECT, QUALITY.ultra, 1, []);
  ok(plan.dust.length === 0, 'стоящие отряды пилят пыль');
});

t('реестр огней: FIFO-потолок, снятие точки и очистка', () => {
  const fx = new AtmosphereFX(QUALITY.high);
  let lastId = 0;
  for (let i = 0; i < ATMO_LIMITS.fires + 5; i++) lastId = fx.addFire(i, i, 1);
  ok(fx.fires.length === ATMO_LIMITS.fires, `реестр раздулся до ${fx.fires.length}`);
  ok(fx.fires[0].id === 6, 'новая точка не вытеснила самую старую');
  ok(lastId === ATMO_LIMITS.fires + 5, 'идентификаторы не монотонны');
  ok(fx.removeFire(lastId) === true && fx.removeFire(99999) === false, 'removeFire врёт про результат');
  fx.clearFires();
  ok(fx.fires.length === 0, 'clearFires не чистит');
  fx.addFire(1, 1, 5);
  ok(fx.fires[0].i === 1, `интенсивность вышла из [0..1]: ${fx.fires[0].i}`);
});

// ------------------------------------------------------------------ отрисовка
const NOON = lightAt(0.5), MIDNIGHT = lightAt(0);

t('в node без канваса frame безопасен и часы всё равно идут', () => {
  const fx = new AtmosphereFX(QUALITY.high);
  // dt зажат сверху 50 мс — скачок паузы не должен телепортировать дым,
  // поэтому часы сверяем с зажатым значением, а не с входом.
  fx.frame(simOf(), null, 0, 0, 32, 1280, 720, 0.04, NOON, QUALITY.high);
  near(fx.time, 0.04, 1e-9, 'часы не пошли без канваса');
  fx.frame(null, fakeCtx(), 0, 0, 32, 1280, 720, 99, NOON, QUALITY.high);
  near(fx.time, 0.09, 1e-9, 'часы не пережили паузу по правилу clamp 50 мс');
});

t('eco-качество: ноль активности при полном городе', () => {
  const sim = simOf();
  for (let i = 0; i < 12; i++) sim.buildings.push(bld('smithy', 30 + i, 31));
  sim.buildings.push(bld('campfire', 40, 45));
  sim.armyState = { squads: [squad(30, 40, 31, 40)] };
  sim.factions.push({ alive: true, def: { color: '#fff' }, settlements: [{ x: 40, y: 45, capital: true }] });
  const fx = new AtmosphereFX(QUALITY.eco);
  const ctx = fakeCtx();
  fx.frame(sim, ctx, -800, -952, 32, 1280, 720, 0.016, MIDNIGHT, QUALITY.eco);
  const sum = Object.values(ctx.calls).reduce((a, b) => a + b, 0);
  ok(sum === 0, `на eco слой рисует (${sum} операций)`);
});

t('ночь: костёр даёт пятно в lighter и искры; день молчит', () => {
  const mkSim = () => { const s = simOf(); s.buildings.push(bld('campfire', 40, 41)); return s; };
  const ox = -800, oy = -952;
  const nightFx = new AtmosphereFX(QUALITY.high);
  const nc = fakeCtx();
  nightFx.time = 1.0;   // фиксированное время — детерминированный кадр
  nightFx.frame(mkSim(), nc, ox, oy, 32, 1280, 720, 0, MIDNIGHT, QUALITY.high);
  ok(nc.calls.save >= 1 && nc.calls.restore >= 1, 'режим lighter не обёрнут save/restore');
  ok(nc.modes.includes('lighter'), 'пятно тепла рисуется обычной краской вместо света');
  ok(nc.calls.arc >= 4, `пятно и искры не нарисованы (${nc.calls.arc} дуг)`);
  const dayFx = new AtmosphereFX(QUALITY.high);
  const dc = fakeCtx();
  dayFx.time = 1.0;
  dayFx.frame(mkSim(), dc, ox, oy, 32, 1280, 720, 0, NOON, QUALITY.high);
  ok(dc.modes.every((m) => m !== 'lighter'), 'днём включён аддитивный свет');
  ok(dc.calls.arc === 0, 'днём костёр искрит');
});

t('труба дымит одним и тем же кадром дважды, альфа сбрасывается', () => {
  // Труба в середине кадра, а не у верхней кромки: столб обязан уходить
  // ВВЕРХ за экран, и источник у края честно весь отсёкся бы как мусор.
  const mkSim = () => { const s = simOf(); s.buildings.push(bld('smithy', 30.5, 40)); return s; };
  const run = () => {
    const fx = new AtmosphereFX(QUALITY.high);
    fx.time = 2.5;
    const ctx = fakeCtx();
    fx.frame(mkSim(), ctx, -800, -952, 32, 1280, 720, 0, NOON, QUALITY.high);
    return ctx;
  };
  const a = run(), b = run();
  ok(a.calls.fill > 0, 'труба не дымит');
  ok(a.calls.fill === b.calls.fill && a.modes.length === b.modes.length,
    `кадр нестабилен: ${a.calls.fill} против ${b.calls.fill}`);
  ok(a.globalAlpha === 1, `альфа не сброшена после слоя (${a.globalAlpha})`);
  ok(a.modes.every((m) => m === 'source-over'), 'дым рисуется в lighter');
});

t('столица в кадре машет флагом: заливка плюс кромка', () => {
  const sim = simOf();
  sim.factions.push({ alive: true, def: { color: '#c9a227' }, settlements: [{ x: 40, y: 45, capital: true }] });
  const fx = new AtmosphereFX(QUALITY.high);
  fx.time = 3.3;
  const ctx = fakeCtx();
  ctx.fillStyle = '';
  fx.frame(sim, ctx, -800, -952, 32, 1280, 720, 0, NOON, QUALITY.high);
  ok(ctx.calls.quad >= 1 && ctx.calls.fill >= 1 && ctx.calls.stroke >= 1,
    'полотнище не нарисовано кривой с кромкой');
  ok(ctx.fillStyle === '#c9a227' || ctx.strokeStyle === '#c9a227',
    `цвет фракции потерян (${ctx.fillStyle}/${ctx.strokeStyle})`);
  // Мёртвая фракция и неглавное поселение флага не дают.
  const quiet = simOf();
  quiet.factions.push({
    alive: false, def: { color: '#000' },
    settlements: [{ x: 40, y: 45, capital: true }],
  }, );
  const q2 = simOf();
  q2.factions.push({ alive: true, def: { color: '#000' }, settlements: [{ x: 40, y: 45, capital: false }] });
  const c1 = fakeCtx(), c2 = fakeCtx();
  const f1 = new AtmosphereFX(QUALITY.high); f1.time = 1; f1.frame(quiet, c1, -800, -952, 32, 1280, 720, 0, NOON, QUALITY.high);
  const f2 = new AtmosphereFX(QUALITY.high); f2.time = 1; f2.frame(q2, c2, -800, -952, 32, 1280, 720, 0, NOON, QUALITY.high);
  ok(c1.calls.stroke === 0 && c2.calls.stroke === 0, 'флаг рисуется над мёртвой/не главной точкой');
});

t('смена пресета на лету глушит и оживляет слой', () => {
  const sim = simOf();
  sim.buildings.push(bld('workshop', 30, 31));
  const fx = new AtmosphereFX(QUALITY.high);
  const c1 = fakeCtx();
  fx.frame(sim, c1, -800, -952, 32, 1280, 720, 0.016, NOON, QUALITY.high);
  ok(c1.calls.fill > 0, 'слой не работает на high');
  const c2 = fakeCtx();
  fx.setQuality(QUALITY.eco);
  fx.frame(sim, c2, -800, -952, 32, 1280, 720, 0.016, NOON, QUALITY.eco);
  ok(c2.calls.fill === 0, 'после setQuality(eco) слой продолжает рисовать');
});

t('вырожденные камера и время не роняют кадр', () => {
  const fx = new AtmosphereFX(QUALITY.high);
  const ctx = fakeCtx();
  fx.frame(simOf(), ctx, 0, 0, 0, 1280, 720, 0.016, NOON, QUALITY.high);       // z=0
  fx.frame(simOf(), ctx, 0, 0, NaN, 1280, 720, 0.016, NOON, QUALITY.high);     // z=NaN
  fx.frame(simOf(), ctx, 0, 0, 32, 0, 0, 0.016, NOON, QUALITY.high);           // пустой экран
  fx.frame(simOf(), ctx, 0, 0, 32, 1280, 720, -5, NOON, QUALITY.high);         // отрицательный dt
  fx.frame(simOf(), ctx, 0, 0, 32, 1280, 720, 99, NOON, QUALITY.high);         // скачок паузы
  ok(fx.time <= 0.116, `dt не зажат сверху (${fx.time})`);
});

} finally {
  Math.random = origRandom; // вернуть случайность миру — тесты её честно вернут
}

console.log(`\nИтого: ${pass} пройдено, ${fail} провалено`);
process.exit(fail ? 1 : 0);
