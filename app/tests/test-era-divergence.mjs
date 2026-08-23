// Тест дифференциации эпох (A6 «ЭПОХИ/НАУКА»).
// Запуск: node app/tests/test-era-divergence.mjs
//
// БЫЛО: наука соседа держалась только на линейной черте science/5, и к концу
// долгого прогона все фракции стояли вплотную по eraIndex — «научный» архетип
// ничем не уезжал от орды. Стало: civ_ai умножает дневной вклад в знания на
// архетипный множитель с полом и потолком (SCI_ARCH_FLOOR/CEIL), поэтому
// учёные и мирные со временем ускоряются, а соседи расходятся по эпохам.
//
// ═══ ПОДКЛЮЧЕНИЕ (tools/test-all.mjs; сам runner НЕ правится) ═══
// Якорь: `const files = readdirSync(DIR).filter(f => f.endsWith('.mjs')).sort();`
// Grep-число якоря = 1 (проверено Select-String, строка 48).
// Вставка НЕ требуется: runner сам подхватывает все app/tests/*.mjs через
// readdirSync — новый набор попадает в `npm test` без единой правки раннера.
import { readFileSync } from 'node:fs';
import { createRng, makeNoise2D } from '../src/core/rng.js';
import { generateWorld, findFactionSpawns } from '../src/core/world.js';
import { FACTIONS, WALKABLE } from '../src/core/data.js';
import { createCivAi, tickCivAi, civReport } from '../src/core/systems/civ_ai.js';
import { scienceArchMult, SCI_ARCH_FLOOR, SCI_ARCH_CEIL } from '../src/core/systems/civ_ai.js';
import { createDiplomacy, tickDiplomacy } from '../src/core/systems/diplomacy_ext.js';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('OK', name); } catch (e) { fail++; console.log('FAIL', name, '—', e.message); if (process.env.CIVDEBUG) console.log(e.stack); } };
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };

// ---------- Стенд ----------
// Тот же стенд, что в test-civ-ai (тот же generateWorld и findFactionSpawns):
// мир и соседи как в ядре, игрок — неподвижная деревня-сосед.
function makeWorld(seed) {
  const rng = createRng(seed);
  rng.noise = makeNoise2D(createRng(seed ^ 0x9e3779b9)); // как в конструкторе Simulation
  return { world: generateWorld(seed, rng), rng };
}

function spawnFactions(world, rng, count) {
  const picks = FACTIONS.slice(0, count);
  const spawns = findFactionSpawns(world, rng, count, world.startX, world.startY);
  const taken = spawns.slice();
  return picks.map((def, i) => {
    let s = spawns[i];
    if (!s) { // запасное место, если точек с шагом 22 не набралось
      for (let k = 0; k < 3000 && !s; k++) {
        const x = rng.int(6, world.w - 7), y = rng.int(6, world.h - 7);
        if (!WALKABLE.has(world.tiles[y * world.w + x])) continue;
        if (Math.hypot(x - world.startX, y - world.startY) < 16) continue;
        if (taken.some(p => Math.hypot(p.x - x, p.y - y) < 12)) continue;
        s = { x, y }; taken.push(s);
      }
    }
    if (!s) throw new Error('не нашлось места под фракцию');
    return {
      id: def.id, def, P: 12, era: 0, knowPts: 0, techCount: 1,
      armyPts: 4, wallPts: 0, goldPts: 0,
      settlements: [{ x: s.x, y: s.y, capital: true }],
      alive: true, weak: false,
    };
  });
}

// Прогон фиксированной длины. marks — дни, в которые снимается слепок эпох:
// разброс надо мерить ВО ВРЕМЕНИ, а финальный отчёт его уже не помнит.
function run(seed, days, marks = []) {
  const { world, rng } = makeWorld(seed);
  const fs = spawnFactions(world, rng, FACTIONS.length);
  const st = createCivAi(fs);
  const D = createDiplomacy();
  const relations = {};
  for (const f of fs) relations[f.id] = 0;
  const playerWars = [];
  const snap = {};
  for (let d = 0; d < days; d++) {
    const player = { armyPower: 10 + d * 0.02, era: Math.floor(d / 400), techs: new Set(['fire']), gold: 200,
      settlements: [{ x: world.startX, y: world.startY }] };
    const out = tickCivAi(st, {
      day: d, rng, world, factions: fs, diplo: D, relations,
      difficulty: 'normal', playerWars, player,
    });
    for (const w of out.warOnPlayer) if (!playerWars.includes(w.fid)) playerWars.push(w.fid);
    tickDiplomacy(D, {
      day: d, rng, difficulty: 'normal', factions: fs, relations,
      playerWars, treaties: [], player, trespass: [],
    });
    if (d % 80 === 0) playerWars.length = 0; // мир с игроком заключает ядро; здесь — простейшая замена
    if (marks.includes(d)) snap[d] = civReport(st, fs).map(r => ({ id: r.id, era: r.era, techs: r.techs, alive: r.alive }));
  }
  return { fs, st, snap, report: civReport(st, fs) };
}

const SEED = 4242;          // сид зафиксирован: тест доказывает свойство, а не лотерею
const DAYS = 2400;          // N сотен дней: 24 сотни, хватит уехать на пару эпох
const MID = DAYS / 2;
const spreadEra = rows => {
  const e = rows.filter(r => r.alive).map(r => r.era);
  return Math.max(...e) - Math.min(...e);
};
const sigmaEra = rows => {
  const e = rows.filter(r => r.alive).map(r => r.era);
  const m = e.reduce((a, b) => a + b, 0) / e.length;
  return Math.sqrt(e.reduce((a, b) => a + (b - m) ** 2, 0) / e.length);
};

// ---------- Юнит-проверки множителя ----------
t('множитель архетипа зажат полом и потолком', () => {
  for (let s = 0; s <= 9; s++) for (let a = 0; a <= 9; a++) {
    const m = scienceArchMult({ science: s, aggression: a });
    ok(m >= SCI_ARCH_FLOOR - 1e-12, `ниже пола при science=${s} aggression=${a}: ${m}`);
    ok(m <= SCI_ARCH_CEIL + 1e-12, `выше потолка при science=${s} aggression=${a}: ${m}`);
  }
});

t('наука ускоряет, агрессия тормозит, нейтрал даёт единицу', () => {
  const sci = scienceArchMult({ science: 9, aggression: 5 });
  const mid = scienceArchMult({ science: 5, aggression: 5 });
  const war = scienceArchMult({ science: 5, aggression: 9 });
  ok(sci > mid, `учёный ${sci} не больше нейтрального ${mid}`);
  ok(war < mid, `воинственный ${war} не меньше нейтрального ${mid}`);
  ok(mid === 1, `нейтральные черты дали ${mid}, ожидалась 1`);
});

// ---------- Главное доказательство: прогон 24 сотен дней ----------
console.log(`\n=== сид ${SEED}: ${DAYS} дней (${DAYS / 100} сотни) ===`);
const r = run(SEED, DAYS, [600, MID, DAYS - 1]);
const end = r.snap[DAYS - 1], mid = r.snap[MID], early = r.snap[600];
const byId = Object.fromEntries(end.map(x => [x.id, x]));
const cog = byId.cog, wolves = byId.wolves; // научный архетип против воинственного
console.log('конец:', end.slice().sort((a, b) => b.era - a.era || b.techs - a.techs)
  .map(x => `${x.id}:${x.era}/${x.techs}`).join(' '));
console.log(`разброс эпох: день ${600} → ${spreadEra(early)}, день ${MID} → ${spreadEra(mid)}, день ${DAYS - 1} → ${spreadEra(end)}`);
console.log(`ког vs волки: эпоха ${cog.era} против ${wolves.era}, техи ${cog.techs} против ${wolves.techs}`);

t('научный архетип обгоняет воинственный строго больше порога', () => {
  // Пороги взяты ниже измеренных значений (3 эпохи и 12 техов): проверяем
  // свойство «уехал вперёд», а не хрупкое равенство до последнего теха.
  // Запас знаний (knowPts) сознательно НЕ проверяется: воинственный меньше
  // тратит на дорогие техи, и неиспользованный запас копится у него же.
  ok(cog.era - wolves.era > 2, `разница эпох ${cog.era - wolves.era}, ждали >2`);
  ok(cog.techs - wolves.techs > 8, `разница техов ${cog.techs - wolves.techs}, ждали >8`);
});

t('соседи расходятся по эпохам: разброс растёт со временем', () => {
  const se = spreadEra(end), sm = spreadEra(mid);
  ok(se >= sm + 1, `разброс не вырос: ${sm} → ${se}`);
  ok(sigmaEra(end) > sigmaEra(early), `σ не выросла: ${sigmaEra(early).toFixed(2)} → ${sigmaEra(end).toFixed(2)}`);
});

t('детерминизм: два прогона одного сида бит-в-бит', () => {
  const a = JSON.stringify(run(SEED, DAYS).report);
  const b = JSON.stringify(run(SEED, DAYS).report);
  ok(a === b, 'один сид дал разные результаты');
  ok(JSON.stringify(r.report) === a, 'слепок основного прогона не воспроизвёл себя');
});

t('в модуле нет Math.random', () => {
  const src = readFileSync(new URL('../src/core/systems/civ_ai.js', import.meta.url), 'utf8');
  ok(!/Math\.random/.test(src), 'найден Math.random — детерминизм сломан');
});

console.log(`\nИТОГО: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
