// Тесты усиленной модели поведения поселений-соседей: фортификация столицы,
// умная экспансия, гарнизонное удержание резерва, безнадёжные деревни.
// Плюс регресс старых инвариантов (техи, постройки, реестр дипломатии, казна).
// Запуск: node app/tests/test-civ-settlement.mjs
import { Simulation } from '../src/core/simulation.js';
import { TECHS, BUILDINGS } from '../src/core/data.js';
import { createDiplomacy, openWar, isAtWar, warStats, allianceList } from '../src/core/systems/diplomacy_ext.js';
import {
  createCivAi, tickCivAi, civOf, civReport, RES_IDS,
  PLAYER_SETTLE_GAP, EXPANSION_PLAYER_FEAR,
} from '../src/core/systems/civ_ai.js';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('OK', name); } catch (e) { fail++; console.log('FAIL', name, '—', e.message); if (process.env.CIVDEBUG) console.log(e.stack); } };
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };

const WALLS = ['palisade', 'stone_walls', 'castle']; // стены; казарма считается отдельно
const DEFENSIVE = [...WALLS, 'barracks'];

// ---------- Стенд: настоящая Simulation(seed,{factions:N}) с правкой черт ----------
// def фракций подменяется КЛОНОМ (глобальную таблицу FACTIONS не трогаем):
// так в двух прогонах одного сида различаются только нужные черты.
function makeSim(seed, patches = []) {
  const n = Math.max(1, patches.length);
  const sim = new Simulation(seed, { factions: n });
  sim.factions.forEach((f, i) => {
    if (!patches[i]) return;
    f.def = { ...f.def, traits: { ...f.def.traits, ...patches[i] } };
  });
  return sim;
}

// Прокрутка дней: только tickCivAi, ровно как это делает integrate.systemsFactions.
// from — с какого дня продолжать: дни не должны повторяться, модуль тикает раз в день.
function drive(sim, st, D, days, { power = 10, pset = null, war = null, warDay = 0, from = 0 } = {}) {
  const ev = { built: [], founded: [] };
  const fs = sim.factions;
  for (let d = from + 1; d <= from + days; d++) {
    if (war && d === warDay) openWar(D, war[0], war[1], d, 'тест');
    const out = tickCivAi(st, {
      day: d, rng: sim.rng, world: sim.world, factions: fs, diplo: D,
      relations: sim.relations, difficulty: 'normal', playerWars: [],
      player: { armyPower: power, era: 0, settlements: pset || [{ x: sim.world.startX, y: sim.world.startY }] },
    });
    for (const b of out.built) ev.built.push(b);
    for (const fo of out.founded) ev.founded.push(fo);
  }
  return ev;
}

const countIds = (ev, ids) => ev.built.filter(b => ids.includes(b.id)).length;
const distTo = (pset, s) => Math.min(...pset.map(p => Math.hypot(p.x - s.x, p.y - s.y)));
const aliveTownsOf = f => f.settlements.filter(s => !s.dead);

// ═══════════════ 1. Фортификация столицы ═══════════════
// Один и тот же сид прокручивается дважды: defense=9 против defense=1.
function runFort(seed, defenseValue) {
  const sim = makeSim(seed, [{ defense: defenseValue }, { defense: defenseValue }]);
  const st = createCivAi(sim.factions);
  const D = createDiplomacy();
  const builtLog = [];
  let firstWallDay = Infinity;
  for (let d = 1; d <= 500; d++) {
    const out = tickCivAi(st, {
      day: d, rng: sim.rng, world: sim.world, factions: sim.factions, diplo: D,
      relations: sim.relations, difficulty: 'normal', playerWars: [],
      player: { armyPower: 1, era: 0, settlements: [{ x: sim.world.startX, y: sim.world.startY }] },
    });
    if (out.built.some(b => WALLS.includes(b.id)) && firstWallDay === Infinity) firstWallDay = d;
    for (const b of out.built) builtLog.push(b);
  }
  return {
    walls: countIds({ built: builtLog }, WALLS),
    defensive: countIds({ built: builtLog }, DEFENSIVE),
    firstWallDay,
  };
}

const FORT_SEEDS = [11, 22, 33];
const fort = {};
for (const seed of FORT_SEEDS) fort[seed] = { r9: runFort(seed, 9), r1: runFort(seed, 1) };

t('фортификация: за 500 дней у defense=9 стен больше, чем у defense=1', () => {
  const s9 = FORT_SEEDS.reduce((s, k) => s + fort[k].r9.walls, 0);
  const s1 = FORT_SEEDS.reduce((s, k) => s + fort[k].r1.walls, 0);
  ok(s9 > s1, `стен при defense=9: ${s9}, при defense=1: ${s1}`);
  ok(s9 >= FORT_SEEDS.length * 2, `оборонительный народ построил слишком мало стен (${s9})`);
});

t('фортификация: defense=9 укрепляется раньше — первая стена в среднем раньше', () => {
  const sum = key => FORT_SEEDS.reduce((s, k) => s + Math.min(fort[k][key].firstWallDay, 500), 0);
  ok(sum('r9') < sum('r1'), `сумма дней первой стены: defense=9 → ${sum('r9')}, defense=1 → ${sum('r1')}`);
});

t('фортификация: у defense=9 больше весь защитный набор (стены+казармы)', () => {
  const wins = FORT_SEEDS.filter(k =>
    fort[k].r9.defensive > fort[k].r1.defensive ||
    (fort[k].r9.defensive === fort[k].r1.defensive && fort[k].r9.walls > fort[k].r1.walls)
  ).length;
  ok(wins > FORT_SEEDS.length / 2, `defense=9 выиграл лишь ${wins} из ${FORT_SEEDS.length} сидов`);
});

// ═══════════════ 2. Умная экспансия ═══════════════
// Игрок стоит в 12 клетках от столицы и очень силён. Робкий народ (агрессия 3)
// обязан обходить его широкой дугой; смелый (агрессия 8) селится где выгодно.
function runExp(seed, aggression) {
  const patch = [{ aggression, expansion: 9 }, { aggression, expansion: 9 }];
  const sim = makeSim(seed, patch);
  const st = createCivAi(sim.factions);
  const cap = sim.factions[0].settlements[0];
  const pset = [{ x: cap.x + 12, y: cap.y }];
  for (const f of sim.factions) {
    f.P = 45;
    const c = civOf(st, f.id);
    c.res.food += 3000; c.res.wood += 3000; // потолок склада всё равно прижмёт до 400/город
  }
  const ev = drive(sim, st, createDiplomacy(), 700, { power: 99999, pset });
  const spots = [];
  for (const f of sim.factions) for (const s of aliveTownsOf(f)) if (!s.capital) spots.push(s);
  const dists = spots.map(s => distTo(pset, s));
  return { dists };
}

const EXP_SEEDS = [41, 42, 43];
const scaredRuns = EXP_SEEDS.map(s => runExp(s, 3));
const boldRuns = EXP_SEEDS.map(s => runExp(s, 8));

t('экспансия: робкий народ держит законный минимум дистанции от сильного игрока', () => {
  const n = scaredRuns.reduce((s, r) => s + r.dists.length, 0);
  ok(n >= 3, `испуганные фракции почти ничего не основали (${n}) — стенд сломан`);
  const close = scaredRuns.reduce((s, r) => s + r.dists.filter(d => d < PLAYER_SETTLE_GAP).length, 0);
  ok(close === 0, `робкие основали ${close} посёлков ближе законных ${PLAYER_SETTLE_GAP} клеток`);
});

t('экспансия: робкий народ обходит сильного игрока по широкой дуге (FEAR)', () => {
  const minD = Math.min(...scaredRuns.flatMap(r => r.dists));
  ok(minD >= EXPANSION_PLAYER_FEAR, `минимальная дистанция робких ${minD.toFixed(1)} < FEAR=${EXPANSION_PLAYER_FEAR}`);
});

t('экспансия: смелому народу близость сильного игрока не мешает селиться', () => {
  const boldDists = boldRuns.flatMap(r => r.dists);
  ok(boldDists.length >= 3, 'смелая фракция ничего не основала — стенд сломан');
  const closeBold = boldDists.filter(d => d < EXPANSION_PLAYER_FEAR).length;
  ok(closeBold > 0, `смелые ни разу не селились ближе FEAR=${EXPANSION_PLAYER_FEAR} — различие с робкими пусто`);
  const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  ok(mean(scaredRuns.flatMap(r => r.dists)) > mean(boldDists),
    'средняя дистанция робких не больше смелых');
});

// ═══════════════ 3. Гарнизон: удержание резерва при войне ═══════════════
{
  const sim = makeSim(71, [{ aggression: 4, expansion: 6 }, { aggression: 4, expansion: 6 }]);
  const st = createCivAi(sim.factions);
  const D = createDiplomacy();
  const far = [{ x: 2, y: 2 }];
  for (const f of sim.factions) {
    f.P = 40;
    const c = civOf(st, f.id);
    c.res.food += 2000; c.res.wood += 2000;
  }
  drive(sim, st, D, 60, { power: 0.001, pset: far }); // мирный этап
  const holdPeace = sim.factions.reduce((s, f) => s + civOf(st, f.id).holdDays, 0);

  for (const f of sim.factions) { const c = civOf(st, f.id); c.res.food += 2000; c.res.wood += 2000; }
  const before = sim.factions.reduce((s, f) => s + aliveTownsOf(f).length, 0);
  drive(sim, st, D, 120, { power: 0.001, pset: far, war: [sim.factions[0].id, sim.factions[1].id], warDay: 61, from: 60 });
  const holdWar = sim.factions.reduce((s, f) => s + civOf(st, f.id).holdDays, 0);
  const after = sim.factions.reduce((s, f) => s + aliveTownsOf(f).length, 0);

  t('гарнизон: в мирный день резерв дома не удерживается (holdDays == 0)', () => {
    ok(holdPeace === 0, `в мире нагулялось ${holdPeace} дней удержания`);
  });
  t('гарнизон: при войне армия удерживается дома (holdDays > 0)', () => {
    ok(isAtWar(D, sim.factions[0].id, sim.factions[1].id), 'война не открылась в реестре diplomacy_ext');
    ok(holdWar > 0, `за войну нагулялось ${holdWar} дней удержания`);
  });
  t('гарнизон: во время войны новых выселков не основывают', () => {
    ok(after === before, `во время войны посёлков стало ${after} вместо ${before}`);
  });
}

// ═══════════════ 4. Безнадёжная деревня ═══════════════
function despairFixture(seed) {
  const sim = makeSim(seed, [{}]);
  const st = createCivAi(sim.factions);
  const f = sim.factions[0];
  const cap = f.settlements[0];
  f.settlements.push({ x: cap.x + 12, y: cap.y, capital: false }); // дальний посёлок
  f.P = 5;
  const c = civOf(st, f.id);
  c.res.food = 0; // вечный голод: приход P*0.16 меньше расхода P*0.35
  return { sim, st, f, cap, c };
}

t('безнадёжная деревня: голод 10+ дней при людности<3 — посёлок покидается', () => {
  const fx = despairFixture(81);
  fx.c.res.wood = 780; // склад забит под две деревни (потолок 400*2)
  drive(fx.sim, fx.st, createDiplomacy(), 40, { power: 0.001 });
  const dead = fx.f.settlements.filter(s => s.dead);
  ok(fx.c.migrations === 1, `миграций ${fx.c.migrations}, ожидалась 1`);
  ok(dead.length === 1, `мёртвых посёлков ${dead.length}, ожидался 1`);
  ok(!fx.cap.dead, 'столицу бросили — так нельзя');
  ok(dead[0] !== fx.cap, 'брошен не дальний посёлок');
});

t('безнадёжная деревня: отчёт показывает живые города, мёртвый склад сжимается', () => {
  const fx = despairFixture(82);
  fx.c.res.wood = 780;
  ok(civReport(fx.st, [fx.f])[0].towns === 2, 'до ухода towns должно быть 2');
  drive(fx.sim, fx.st, createDiplomacy(), 30, { power: 0.001 });
  const rep = civReport(fx.st, [fx.f])[0];
  ok(rep.towns === 1, `после ухода towns=${rep.towns}, ожидалась 1`);
  ok(rep.migrations === 1, `в отчёте миграций ${rep.migrations}`);
  ok(fx.c.res.wood <= 400 + 1e-6, `склад мёртвой деревни всё ещё кормит: wood=${fx.c.res.wood.toFixed(0)}`);
});

t('безнадёжная деревня: роста нет — люди уходят, а не плодятся', () => {
  const fx = despairFixture(83);
  drive(fx.sim, fx.st, createDiplomacy(), 35, { power: 0.001 });
  ok(fx.c.starveDays >= 10, `голода не было: starveDays=${fx.c.starveDays}`);
  ok(fx.f.P <= 5 + 1e-9, `население выросло при вечном голоде: ${fx.f.P.toFixed(2)}`);
  ok(aliveTownsOf(fx.f).length === 1 || fx.c.migrations === 0, 'посёлок брошен дважды?');
});

// ═══════════════ 5. Детерминизм ═══════════════
function summary(seed) {
  const sim = makeSim(seed);
  const st = createCivAi(sim.factions);
  const ev = drive(sim, st, createDiplomacy(), 300);
  const rep = civReport(st, sim.factions).map(r => ({
    id: r.id, buildings: r.buildings, founded: r.founded,
    migrations: r.migrations, holdDays: r.holdDays, troops: Math.round(r.troops),
  }));
  return JSON.stringify({
    builtN: ev.built.length, builtList: ev.built.map(b => b.id), founded: ev.founded,
    migrations: rep.reduce((s, r) => s + r.migrations, 0), rep,
  });
}
t('детерминизм: один сид — одинаковые постройки и миграции за 300 дней', () => {
  ok(summary(909) === summary(909), 'один сид дал разные результаты');
});
t('детерминизм: разные сиды живут по-разному', () => {
  ok(summary(909) !== summary(910), 'разные сиды дали один результат');
});

// ═══════════════ 6. Регресс: старые инварианты торговли/дипломатии ═══════════════
{
  const sim = makeSim(303);
  const st = createCivAi(sim.factions);
  const D = createDiplomacy();
  drive(sim, st, D, 600);

  t('регресс: дерево технологий проходится по prereq, без дыр', () => {
    for (const f of sim.factions) {
      const techs = civOf(st, f.id).techs;
      ok(techs.length > 3, `${f.id}: всего ${techs.length} техов`);
      const known = new Set();
      for (const id of techs) {
        const def = TECHS.find(x => x.id === id);
        ok(def, `${f.id}: неизвестная технология ${id}`);
        ok(def.prereq.every(p => known.has(p)), `${f.id}: ${id} изучен без предпосылок`);
        known.add(id);
      }
      ok(f.techCount === techs.length, `${f.id}: techCount рассинхронизирован`);
    }
  });

  t('регресс: все постройки легальны и открыты технологиями', () => {
    for (const f of sim.factions) {
      const c = civOf(st, f.id);
      const known = new Set(c.techs);
      for (const bid of Object.keys(c.buildings)) {
        ok(BUILDINGS[bid], `неизвестное здание ${bid}`);
        const req = BUILDINGS[bid].req;
        ok(!req || known.has(req), `${f.id}: ${bid} без технологии ${req}`);
      }
    }
  });

  t('регресс: wars/alliances ведутся только реестром diplomacy_ext', () => {
    for (const f of sim.factions) {
      const c = civOf(st, f.id);
      ok(!('wars' in c) && !('enemies' in c), `${f.id}: у модуля свой список войн — двойной учёт`);
    }
    const ws = warStats(D, 600);
    ok(Number.isFinite(ws.finished) && ws.finished >= 0, 'warStats вернул мусор');
    ok(Array.isArray(allianceList(D)), 'allianceList вернул не массив');
  });

  t('регресс: казна конечна и неотрицательна (экономика торговли цела)', () => {
    for (const f of sim.factions) {
      const c = civOf(st, f.id);
      for (const k of RES_IDS) {
        ok(Number.isFinite(c.res[k]), `${f.id}.${k} = ${c.res[k]}`);
        ok(c.res[k] >= -1e-6, `${f.id}.${k} ушёл в минус`);
      }
    }
  });
}

console.log(`\n=== ${pass} OK / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
