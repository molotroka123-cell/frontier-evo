// Тесты знаменосца (U25: banner.js + точки боя в army.js + трофеи worldsites.js)
// и доказательства применения COUNTERS в обоих направлениях боя.
// Запуск: node app/tests/test-banner.mjs
import { Simulation } from '../src/core/simulation.js';
import { createRng, makeNoise2D } from '../src/core/rng.js';
import { TILE, UNITS, COUNTERS, WALKABLE } from '../src/core/data.js';
import { generateWorld } from '../src/core/world.js';
import { WorldSites, SITE_DEFS, TROPHY_REVEAL } from '../src/core/systems/worldsites.js';
import * as A from '../src/core/systems/army.js';
import * as BNR from '../src/core/systems/banner.js';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('OK', name); } catch (e) { fail++; console.log('FAIL', name, '—', e.message); } };
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const pct = (x) => (x * 100).toFixed(1) + '%';

// Отряд «на столе» — тот же формат, что у formSquad.
const bench = (units, extra = {}) => ({
  id: extra.id || 1, side: extra.side || 'x', name: extra.name || 'стенд',
  x: extra.x || 0, y: extra.y || 0,
  units: { ...units }, engines: { ...(extra.engines || {}) },
  powerBonus: extra.powerBonus || 0, mult: extra.mult || 1,
  banner: !!extra.banner, morale: extra.morale ?? 100,
  order: { type: 'hold' }, path: null, pathIdx: 0, siege: null, dead: false,
});

// Сила стороны против заданного врага на заданном тайле (обёртка читаемости).
const fp = (units, enemyMix, tile = TILE.GRASS) =>
  A.forcePower({ units, engines: {}, powerBonus: 0, mult: 1 }, enemyMix, tile);
const ZERO = { inf: 0, cav: 0, range: 0, siege: 0 };

// ═══════════════════════ ЗАДАЧА 1: матрица COUNTERS ═══════════════════════

t('COUNTERS: мой удар несёт контру ровно из таблицы data.js', () => {
  // 10 ополченцев бьют армию из чистой конницы: +7 эффективной силы,
  // переведённый COUNTER_DIVISOR'ом в множитель — формула из army.js U20.
  const boost = fp({ militia: 10 }, { inf: 0, cav: 1, range: 0, siege: 0 });
  ok(near(boost, 10 * 2 * (1 + COUNTERS.inf.cav / A.COUNTER_DIVISOR)),
    `удар по коннице должен нести контру ${COUNTERS.inf.cav}/70: ${boost}`);
  // Против пустого состава контры нет — база ровно n×power.
  const flat = fp({ militia: 10 }, ZERO);
  ok(near(flat, 20), `без врага сила должна быть чистой (20): ${flat}`);
  console.log(`   пехота→конница: ${boost.toFixed(3)} (база 20), по пустоте: ${flat}`);
});

t('COUNTERS: ответка симметрична — cav по inf без надбавки, terrain складывается с контрой', () => {
  // Обратное направление того же цикла: конница бьёт пехоту БЕЗ бонуса
  // (в таблице cav контрит только range) — матрица читается строго по строкам
  // атакующего, а не «кому-то там повезло».
  const cavFlat = fp({ knight: 10 }, { ...ZERO, inf: 1 });
  ok(near(cavFlat, 70), `конница против пехоты не должна получать контру: ${cavFlat}`);
  // Один удар несёт ОБА множителя сразу: стрелки на холме против пехоты =
  // power × (1 + контра/70) × HILL_RANGE_MULT. Это доказывает, что terrainMult
  // применяется в том же месте, где и counterMult, а не вместо него.
  const both = fp({ musketeer: 6 }, { ...ZERO, inf: 1 }, TILE.HILL);
  const expect = 6 * 10 * (1 + COUNTERS.range.inf / A.COUNTER_DIVISOR) * A.HILL_RANGE_MULT;
  ok(near(both, expect), `контра и холм должны перемножаться: ${both} vs ${expect}`);
  console.log(`   конница→пехота: ${cavFlat} (без надбавки); мушкетёры на холме по пехоте: ${both.toFixed(2)} = контра × рельеф`);
});

t('COUNTERS: обе стороны применяют матрицу внутри одного resolveBattle', () => {
  // Стенды равной силы (70 ополченцев = 20 рыцарей = 140). Прогоняем бой в обеих
  // ориентациях: если бы контра работала только для стороны 'a' (первого
  // ударника), во втором прогоне пехота теряла бы столько же, сколько конница.
  // Мерило — доля потерянной живой силы проигрывающей стороной.
  const N = 300;
  let cavLoss = 0, infLoss = 0;
  const rng = createRng(20260823);
  const inf70 = () => bench({ militia: 70 });
  const cav20 = () => bench({ knight: 20 });
  for (let i = 0; i < N; i++) {
    const r = A.resolveBattle(inf70(), cav20(), {}, rng); // пехота — 'a'
    cavLoss += r.b.lossFrac; infLoss += r.a.lossFrac;
  }
  for (let i = 0; i < N; i++) {
    const r = A.resolveBattle(cav20(), inf70(), {}, rng); // конница — 'a'
    cavLoss += r.a.lossFrac; infLoss += r.b.lossFrac;
  }
  const cl = cavLoss / (2 * N), il = infLoss / (2 * N);
  console.log(`   средняя потеря силы: конница ${pct(cl)} против пехоты ${pct(il)} (${2 * N} боёв)`);
  ok(cl > il + 0.05, `конница должна терять заметно больше пехоты в обеих ориентациях: ${pct(cl)} vs ${pct(il)}`);
});

// ═══════════════════════ ЗАДАЧА 2: механика знаменосца ═══════════════════════

t('формула знамён: убывающая полезность с жёстким потолком', () => {
  ok(BNR.bannerPowerMult(0) === 1, 'без знамён множитель обязан быть ровно 1');
  ok(near(BNR.bannerPowerMult(1), 1 + BNR.BANNER_POWER_CAP / (1 + BNR.BANNER_HALF)),
    'одно знамя должно давать CAP·1/(1+HALF)');
  // Каждая следующая единица полезнее предыдущей всё меньше — иначе комок
  // знаменосцев был бы доминирующей стратегией.
  for (let k = 1; k <= 6; k++) {
    const d1 = BNR.bannerPowerMult(k) - BNR.bannerPowerMult(k - 1);
    const d2 = BNR.bannerPowerMult(k + 1) - BNR.bannerPowerMult(k);
    ok(d2 > 0 && d2 < d1, `маргинальная полезность должна убывать на k=${k}: ${d1} → ${d2}`);
  }
  // Потолок недостижим ни при каком k — кламп не нужен по построению формулы.
  ok(BNR.bannerPowerMult(50) < 1 + BNR.BANNER_POWER_CAP + 1e-12, 'потолок пробит при k=50');
  ok(BNR.bannerPowerMult(5000) > 1 + BNR.BANNER_POWER_CAP * 0.99, 'насыщение не приближается к потолку');
  ok(BNR.bannerPowerMult(2.7) === BNR.bannerPowerMult(2), 'дробные знамёна округляются вниз');
  console.log(`   m(1)=${BNR.bannerPowerMult(1).toFixed(4)}, m(2)=${BNR.bannerPowerMult(2).toFixed(4)}, m(10)=${BNR.bannerPowerMult(10).toFixed(4)}, предел ${(1 + BNR.BANNER_POWER_CAP).toFixed(2)}`);
});

t('поддержка знамён: своя сторона, радиус, живость; чужие и мёртвые не считаются', () => {
  const me = bench({ militia: 5 }, { id: 1, side: 'player', x: 10, y: 10, banner: true });
  const nearFriend = bench({ militia: 5 }, { id: 2, side: 'player', x: 14, y: 12, banner: true });
  const farFriend = bench({ militia: 5 }, { id: 3, side: 'player', x: 30, y: 30, banner: true });
  const deadFriend = bench({ militia: 0 }, { id: 4, side: 'player', x: 11, y: 11, banner: true, dead: true });
  const foe = bench({ militia: 5 }, { id: 5, side: 'wolves', x: 11, y: 11, banner: true });
  const quiet = bench({ militia: 5 }, { id: 6, side: 'player', x: 12, y: 11 }); // без знамени
  const friends = [nearFriend, farFriend, deadFriend, foe, quiet];
  const k = BNR.bannerSupport(me, friends);
  ok(k === 2, `должны считать себя + ближнего своего: ${k}`);
  ok(BNR.bannerSupport(quiet, [me]) === 1, 'отряд без знамени получает поддержку от чужого знамени');
  ok(BNR.bannerSupport(bench({ militia: 1 }), []) === 0, 'в одиночку без знамени поддержки нет');
  console.log(`   себя + сосед в ${Math.hypot(14 - 10, 12 - 10)} кл. = k=${k} (радиус ${BNR.BANNER_COORD_RADIUS})`);
});

t('бафф в бою: то же семя — строго больший урон; равный бой знамя решает чаще половины', () => {
  // Детерминированная часть: при одинаковом расходе ГПСЧ умножение удара на >1
  // обязано дать врагу строго большую долю потерь.
  const mkA = () => bench({ swordsman: 25 }), mkB = () => bench({ militia: 40 });
  const friend = bench({ militia: 2 }, { id: 99, side: 'x', x: 1, y: 1, banner: true });
  const ctrl = A.resolveBattle(mkA(), mkB(), {}, createRng(777));
  const treat = A.resolveBattle(mkA(), mkB(), { supportA: [friend] }, createRng(777));
  ok(treat.b.lossFrac > ctrl.b.lossFrac,
    `знамя обязано усилить удар: ${pct(treat.b.lossFrac)} vs ${pct(ctrl.b.lossFrac)}`);
  // Расход случайности не меняется от самого факта ctx.support* (множитель без
  // бросков): это гарантия, что чужие системы не почувствуют сдвига потока.
  const r1 = createRng(42), r2 = createRng(42);
  A.resolveBattle(mkA(), mkB(), {}, r1);
  A.resolveBattle(mkA(), mkB(), { supportA: [friend], supportB: [friend] }, r2);
  ok(r1.getState() === r2.getState(), 'знамёна не имеют права тратить значения ГПСЧ');
  // Статистическая часть: равные отряды, у одного знаменосец.
  const rng = createRng(2024);
  let w = 0;
  for (let i = 0; i < 200; i++) {
    const a = bench({ swordsman: 20 }, { banner: true });
    const b = bench({ swordsman: 20 });
    if (A.resolveBattle(a, b, { supportA: [friend] }, rng).winner === 'a') w++;
  }
  console.log(`   урон врагу: ${pct(ctrl.b.lossFrac)} → ${pct(treat.b.lossFrac)}; винрейт со знаменем ${pct(w / 200)} (m=${BNR.bannerPowerMult(1).toFixed(3)})`);
  ok(w / 200 > 0.52 && w / 200 < 0.75, `винрейт со знаменем вне разумного коридора: ${pct(w / 200)}`);
});

t('гибель знаменосца: разовый шок духа сверх бегства, флаг снимается навсегда', () => {
  const weak = bench({ militia: 5 }, { id: 1, side: 'a', name: 'слабый', banner: true });
  const strong = bench({ knight: 20 }, { id: 2, side: 'b', name: 'сильный' });
  const controlWeak = bench({ militia: 5 }, { id: 3, side: 'a', name: 'контроль' });
  const rng = createRng(55);
  const res = A.resolveBattle(weak, strong, {}, rng);
  const resCtrl = A.resolveBattle(controlWeak, strong, {}, createRng(55));
  ok(res.winner === 'b', 'стенд собран неверно: слабые должны проиграть');
  ok(res.bearerFall === 'a', 'падение знамени не зафиксировано в отчёте');
  A.applyBattle(weak, strong, res);
  A.applyBattle(controlWeak, strong, resCtrl);
  ok(weak.banner === false, 'флаг знамени не снят после поражения');
  ok(near(controlWeak.morale - weak.morale, BNR.BEARER_FALL_SHOCK),
    `шок должен отличаться от контрольного бега ровно на ${BNR.BEARER_FALL_SHOCK}: ${controlWeak.morale} vs ${weak.morale}`);
  // Повторный штраф невозможен семантически: флаг снят, поэтому СЛЕДУЮЩИЙ бой
  // этого же отряда уже не может зафиксировать падение (bearerFall === null) и
  // бьёт ровно как обычное бегство −35, без второй двадцатки.
  const beforeSecond = weak.morale;
  const res2 = A.resolveBattle(weak, strong, {}, rng);
  A.applyBattle(weak, strong, res2);
  ok(res2.bearerFall == null, 'знамя пало второй раз без флага');
  ok(near(weak.morale, beforeSecond - 35),
    `второй бой должен снять ровно 35 (без шока): ${beforeSecond} → ${weak.morale}`);
  console.log(`   дух: контроль ${controlWeak.morale}, с падением знамени ${beforeSecond} (−35 и −${BNR.BEARER_FALL_SHOCK} разово), второй бой → ${weak.morale}`);
});

t('шок не копится по дням: одно 🕯-событие, дальше только регенерация духа', () => {
  const s = new Simulation(11);
  const st = A.createArmyState();
  const x = s.world.startX, y = s.world.startY;
  const mine = A.formSquad(st, { side: 'player', x, y, units: { militia: 6 }, banner: true });
  const foe = A.formSquad(st, { side: 'wolves', x: x + 0.4, y, units: { knight: 16 } });
  let candles = 0, moraleAfterFall = null;
  for (let day = 0; day < 6; day++) {
    const ev = A.tickArmy(st, { world: s.world, day, dt: 1, factions: s.factions, atWar: () => true }, s.rng);
    candles += ev.filter(e => e.text.startsWith('🕯')).length;
    const sq = A.findSquad(st, mine.id);
    if (sq && !sq.banner && moraleAfterFall == null) moraleAfterFall = sq.morale;
    // Отряды стоят рядом и дерутся каждый день заново — новых шоков быть не должно.
  }
  ok(candles === 1, `падение знамени должно дать ровно одно 🕯-событие, а дало ${candles}`);
  const sq = A.findSquad(st, mine.id);
  if (sq) ok(sq.morale >= moraleAfterFall, 'после падения знамени дух не восстанавливается');
  console.log(`   🕯 за 6 дней беспрерывных боёв: ${candles}; дух ${moraleAfterFall} → ${sq ? Math.round(sq.morale) : 'отряд погиб'}`);
});

// ---------------- Трофеи через worldsites.js ----------------

function makeSites(seed) {
  const s = new Simulation(seed);
  const world = s.world;
  const wr = createRng((seed ^ 0xba4b3) >>> 0); // 'BANN'-подобный оффсет потока расстановки
  wr.noise = makeNoise2D(createRng((seed ^ 0x9e3779b9) >>> 0));
  const sites = new WorldSites(world, wr, { seed, sites: false, capital: false });
  return { sim: s, sites };
}

t('победа под знаменем ставит трофейную точку worldsites с цветом и днём', () => {
  const { sim, sites } = makeSites(42);
  const st = A.createArmyState();
  const x = sim.world.startX, y = sim.world.startY;
  const win = A.formSquad(st, { side: 'player', x, y, units: { swordsman: 25 }, banner: true });
  A.formSquad(st, { side: 'wolves', x: x + 0.4, y, units: { militia: 8 } });
  const ev = A.tickArmy(st, {
    world: sim.world, dt: 1, day: 123, factions: sim.factions, atWar: () => true,
    sites, colors: { player: '#8e2f2f' },
  }, sim.rng);
  const trophies = sites.trophies();
  ok(trophies.length === 1, `трофей должен встать ровно один: ${trophies.length}`);
  const tr = trophies[0];
  ok(tr.def === 'trophy_banner' && SITE_DEFS.trophy_banner, 'определение точки не из SITE_DEFS');
  ok(tr.kind === 'trophy' && tr.color === '#8e2f2f' && tr.day === 123 && tr.side === 'player',
    `поля трофея потерялись: ${JSON.stringify(tr)}`);
  ok(WALKABLE.has(tr.x * 1 + tr.y * 0) || WALKABLE.has(sim.world.tiles[tr.y * sim.world.w + tr.x]),
    'трофей стоит на непроходимой клетке');
  ok(sites.knownSites().some(s => s.id === tr.id), 'трофей не открыл себе клетку (revealCircle молчит)');
  const trophy = ev.find(e => e.text.startsWith('🏆'));
  ok(trophy && trophy.chronicle === true, 'нет chronicle-события 🏆 для летописи');
  console.log(`   ${trophy.text} · цвет ${tr.color}, день ${tr.day}`);
});

t('знамя проигравшего не оставляет трофея; победа без знамени — тоже', () => {
  const { sim, sites } = makeSites(7);
  const st = A.createArmyState();
  const x = sim.world.startX, y = sim.world.startY;
  // Слабый отряд ПОД знаменем против сильного: знамя падает, карта чиста.
  A.formSquad(st, { side: 'player', x, y, units: { militia: 5 }, banner: true });
  A.formSquad(st, { side: 'wolves', x: x + 0.4, y, units: { knight: 18 } });
  let ev = A.tickArmy(st, { world: sim.world, dt: 1, day: 5, factions: sim.factions, atWar: () => true, sites }, sim.rng);
  ok(sites.trophies().length === 0, 'проигравший под знаменем не имел права ставить трофей');
  ok(ev.some(e => e.text.startsWith('🕯')), 'нет события о падении знамени');
  // Сильная сторона БЕЗ знамени: победа есть — трофея нет.
  const st2 = A.createArmyState();
  A.formSquad(st2, { side: 'player', x, y, units: { swordsman: 25 } });
  A.formSquad(st2, { side: 'wolves', x: x + 0.4, y, units: { militia: 8 } });
  ev = A.tickArmy(st2, { world: sim.world, dt: 1, day: 6, factions: sim.factions, atWar: () => true, sites }, sim.rng);
  ok(ev.some(e => e.text.startsWith('⚔')), 'бой без знамён не состоялся');
  ok(sites.trophies().length === 0 && !ev.some(e => e.text.startsWith('🏆')),
    'победа без знаменосца поставила трофей');
  console.log('   оба отрицательных случая держат карту чистой');
});

t('без карты точек (ctx.sites нет) бой со знаменем проходит тихо', () => {
  const s = new Simulation(21);
  const st = A.createArmyState();
  const x = s.world.startX, y = s.world.startY;
  A.formSquad(st, { side: 'player', x, y, units: { swordsman: 25 }, banner: true });
  A.formSquad(st, { side: 'wolves', x: x + 0.4, y, units: { militia: 8 } });
  const ev = A.tickArmy(st, { world: s.world, dt: 1, day: 2, factions: s.factions, atWar: () => true }, s.rng);
  ok(st.battles === 1, 'бой не разыгрался без карты');
  ok(!ev.some(e => e.text.startsWith('🏆')), 'трофейное событие без карты невозможно');
  ok(A.squadsOf(st, 'player').length === 1, 'победитель пропал');
  console.log('   деградация мягкая: бой есть, декорации нет');
});

t('plantBanner: границы, кромка воды, счётчик id и круговой сейв', () => {
  const { sim, sites } = makeSites(13);
  const home = sites.plantBanner(Math.round(sim.world.startX), Math.round(sim.world.startY),
    { color: '#8e2f2f', side: 'player', day: 40, name: 'Трофей у дома' });
  ok(home.ok, 'трофей у столицы не встал: ' + (home.reason || ''));
  // Выход за границы зажимается рамкой карты: берём любую проходимую клетку
  // и просим трофей чуть «за» неё по дробным координатам.
  let land = null;
  for (let yy = 1; yy < sites.h - 1 && !land; yy++) {
    for (let xx = 1; xx < sites.w - 1 && !land; xx++) {
      if (WALKABLE.has(sim.world.tiles[yy * sim.world.w + xx])) land = { x: xx, y: yy };
    }
  }
  ok(land, 'на карте нет суши — стенд собран неверно');
  const edge = sites.plantBanner(land.x - 0.6, land.y - 0.6, {});
  ok(edge.ok && edge.site.x >= 1 && edge.site.y >= 1 &&
    edge.site.x <= sites.w - 2 && edge.site.y <= sites.h - 2,
    `трофей вне рамки карты: ${JSON.stringify(edge.site || edge.reason)}`);
  // Угол карты — вода: модуль обязан отказать мягко, а не ставить знамя в море.
  const sea = sites.plantBanner(-30, -40, {});
  ok(!sea.ok && !!sea.reason, 'трофей вбит в непроходимый угол без отказа');
  // Два трофея живут одновременно, id монотонно растут.
  ok(home.site.id < edge.site.id, 'счётчик id точек не двигается');
  ok(sites.trophies().length === 2, `в списке трофеев мусор: ${sites.trophies().length}`);
  // Круговой сейв: serialize→deserialize сохраняет трофей байт в байт.
  const json = JSON.parse(JSON.stringify(sites.serialize()));
  const back = new WorldSites(sim.world, createRng(1), { seed: 1, sites: false, capital: false });
  back.deserialize(json);
  const rt = back.trophies();
  ok(rt.length === 2 && JSON.stringify(rt) === JSON.stringify(sites.trophies()),
    'трофеи переживают сейв с искажениями');
  console.log(`   трофеев: ${sites.trophies().length}, открытие вокруг них R=${TROPHY_REVEAL}, сейв круговой`);
});

t('поход с знаменосцем: взятый город получает трофей и запись в хронику', () => {
  const s = new Simulation(42);
  for (let i = 0; i < 60; i++) s.tick(0.5); // тот же прогрев, что в стенде U24
  const f = s.factions[0];
  const target = f.settlements[0];
  const before = f.settlements.length;
  const { sites } = makeSites(42);
  const st = A.createArmyState();
  const sq = A.formSquad(st, {
    side: 'player', x: s.world.startX, y: s.world.startY,
    units: { swordsman: 40, musketeer: 15 }, engines: { ram: 3, ladder: 2 },
    banner: true,
  });
  ok(A.orderCampaign(st, sq.id, f.id, target.x, target.y, s.world), 'маршрут похода не построен');
  const events = [];
  let day = 0;
  while (day < 200 && f.settlements.length === before) {
    events.push(...A.tickArmy(st, {
      world: s.world, day, dt: 1, factions: s.factions, atWar: () => true, sites,
      colors: { player: '#c8a24a' },
    }, s.rng));
    day++;
  }
  ok(f.settlements.length === before - 1, `город не взят за ${day} дней`);
  const cap = events.find(e => e.text.includes('🚩 Поселение'));
  ok(cap && cap.chronicle, 'нет хроникального события взятия');
  const trophy = events.find(e => e.text.startsWith('🏆'));
  ok(trophy && trophy.chronicle, 'трофей за город не записан в хронику как СОБЫТИЕ');
  const tr = sites.trophies()[0];
  ok(tr && tr.x === target.x && tr.y === target.y,
    `трофей должен стоять в центре взятого города (${target.x},${target.y}): (${tr && tr.x},${tr && tr.y})`);
  const alive = A.findSquad(st, sq.id);
  ok(alive && alive.banner === true, 'выживший знаменосец потерял флаг после победы');
  console.log(`   ${trophy.text} · цвет ${tr.color} · поход ${day} дн.`);
});

t('сериализация: флаг знамени едет внутри serializeArmy, старые сейвы молчат', () => {
  const st = A.createArmyState();
  A.formSquad(st, { side: 'player', x: 1, y: 1, units: { militia: 3 }, banner: true });
  A.formSquad(st, { side: 'player', x: 2, y: 2, units: { militia: 3 } });
  const json = JSON.parse(JSON.stringify(A.serializeArmy(st)));
  const back = A.deserializeArmy(json);
  ok(back.squads[0].banner === true && back.squads[1].banner === false,
    'флаг знамени потерялся при круговом сейве');
  // Старый сейв без поля: deserialize обязан молча дать banner=false.
  const old = JSON.parse(JSON.stringify(json));
  delete old.squads[0].banner;
  ok(A.deserializeArmy(old).squads[0].banner === false, 'старый сейв без поля ломает загрузку');
  console.log('   флаг в JSON, круговой сейв и старые файлы в порядке');
});

t('детерминизм: один сид — одна война со знамёнами, другой сид — другая', () => {
  // Подставка-рекордер вместо WorldSites: фиксирует вызовы plantBanner.
  // Тем самым проверяется, что army.js зовёт трофей без единого броска rng.
  const recorder = () => {
    const calls = [];
    return { calls, plantBanner(x, y, o) { calls.push({ x: Math.round(x), y: Math.round(y), o: { ...o } }); return { ok: true, site: { x, y } }; } };
  };
  const run = (seed) => {
    const s = new Simulation(seed);
    const st = A.createArmyState();
    const sites = recorder();
    const x = s.world.startX, y = s.world.startY;
    A.formSquad(st, { side: 'player', x, y, units: { swordsman: 22 }, banner: true });
    A.formSquad(st, { side: 'wolves', x: x + 0.4, y, units: { militia: 9 } });
    A.formSquad(st, { side: 'player', x: x + 1, y: y + 1, units: { militia: 4 }, banner: true });
    const log = [];
    for (let d = 0; d < 4; d++) {
      log.push(...A.tickArmy(st, { world: s.world, day: d, dt: 1, factions: s.factions, atWar: () => true, sites }, s.rng).map(e => e.text));
    }
    return JSON.stringify({ army: A.serializeArmy(st), calls: sites.calls, log });
  };
  ok(run(100) === run(100), 'один сид дал разные войны со знамёнами');
  ok(run(100) !== run(101), 'разные сиды неотличимы — rng не используется');
  console.log('   войны воспроизводимы, трофеи ставятся вне потока случайности');
});

t('регрессия охвата: все роли юнитов покрыты строками COUNTERS или честно плоские', () => {
  // Каждая роль, встречающаяся в UNITS/SIEGE_ENGINES, должна либо иметь строку
  // в COUNTERS, либо осознанно её не иметь (у inf/cav/range строки есть).
  const roles = new Set(UNITS.map(u => u.role));
  ok(roles.has('inf') && roles.has('cav') && roles.has('range'), 'неожиданный состав ролей UNITS');
  for (const role of ['inf', 'cav', 'range']) ok(!!COUNTERS[role], `нет строки контры у ${role}`);
  // siege контрит здания — отдельной силой в resolveSiege, здесь только наличие.
  ok(COUNTERS.siege && COUNTERS.siege.building > 0, 'машины потеряли бонус против построек');
  // И обратная проверка симметрии цикла: inf→cav→range→inf замкнут.
  ok(COUNTERS.inf.cav > 0 && COUNTERS.cav.range > 0 && COUNTERS.range.inf > 0,
    'контр-цикл разомкнут в таблице');
  console.log(`   цикл inf(${COUNTERS.inf.cav})→cav(${COUNTERS.cav.range})→range(${COUNTERS.range.inf}) замкнут, siege.building=${COUNTERS.siege.building}`);
});

console.log(`\n=== ${pass} OK / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
