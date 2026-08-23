// Тесты модуля обучения первых 10 минут. Запуск: node app/tests/test-tutorial10.mjs
// Модуль — контент (ui/tutorial10.js), движок шагов — ui/coach.js: здесь
// проверяем предикаты, монотонность прогресса и сверку имён с core/data.js.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Simulation } from '../src/core/simulation.js';
import { BUILDINGS, TECHS, RES } from '../src/core/data.js';
import { TUTORIAL10, tutorialProgress } from '../src/ui/tutorial10.js';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('OK', name); } catch (e) { fail++; console.log('FAIL', name, '—', e.message); } };
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const eq = (a, b, msg) => ok(a === b, `${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

const MODULE_PATH = fileURLToPath(new URL('../src/ui/tutorial10.js', import.meta.url));
const TEST_PATH = fileURLToPath(import.meta.url);

// Здание «как из placeFree»: сразу готовое, рядом со стартом.
function put(sim, id) {
  const def = BUILDINGS[id];
  sim.buildings.push({
    id, x: sim.world.startX + 2 + sim.buildings.length, y: sim.world.startY + 2,
    size: def.size || 1, progress: 0, buildDays: 0.01, workers: [], done: true,
    eraBuilt: sim.eraIndex, hp: def.wall || 100,
  });
}

// Прогон всех предикатов: строго boolean и дважды одинаково.
function runAll(sim) {
  const one = TUTORIAL10.map(st => {
    let r;
    try { r = st.check(sim); } catch (e) { throw new Error(`${st.id}.check бросил ${e.message}`); }
    ok(typeof r === 'boolean', `${st.id}.check вернул ${typeof r}, а не boolean`);
    return r;
  });
  const two = TUTORIAL10.map(st => { try { return st.check(sim); } catch (e) { return `throw:${e.message}`; } });
  eq(JSON.stringify(one), JSON.stringify(two), `${sim.seed}: check недетерминирован`);
  for (const st of TUTORIAL10) {
    if (!st.skipIf) continue;
    let r;
    try { r = st.skipIf(sim); } catch (e) { throw new Error(`${st.id}.skipIf бросил ${e.message}`); }
    ok(typeof r === 'boolean', `${st.id}.skipIf вернул ${typeof r}, а не boolean`);
  }
  return one;
}

// --------------------------------------------------------------- структура
t('структура: 8–12 шагов, поля на месте, id уникальны', () => {
  ok(Array.isArray(TUTORIAL10), 'TUTORIAL10 — не массив');
  ok(TUTORIAL10.length >= 8 && TUTORIAL10.length <= 12, `шагов ${TUTORIAL10.length}, надо 8–12`);
  const ids = new Set();
  for (const st of TUTORIAL10) {
    ok(st && typeof st === 'object', 'шаг — не объект');
    ok(typeof st.id === 'string' && /^[a-z_]{3,}$/.test(st.id), `плохой id: ${st.id}`);
    ok(!ids.has(st.id), `id повторяется: ${st.id}`); ids.add(st.id);
    ok(typeof st.title === 'string' && st.title.length > 3, `пустой title у ${st.id}`);
    ok(typeof st.hint === 'string' && st.hint.length > 10, `пустой hint у ${st.id}`);
    ok(typeof st.check === 'function', `check у ${st.id} — не функция`);
    ok(st.skipIf === undefined || typeof st.skipIf === 'function', `skipIf у ${st.id} — не функция`);
  }
});

t('порядок шагов стабильный (снимок последовательности id)', () => {
  const EXPECTED = ['food_first', 'wood_line', 'home_hut', 'goals_track', 'first_tech',
    'stone_quarry', 'winter_granary', 'rich_palisade', 'first_market', 'winter_survived'];
  eq(TUTORIAL10.map(s => s.id).join('>'), EXPECTED.join('>'), 'порядок шагов уехал');
});

// ------------------------------------------------------- новая партия
t('фикстура Simulation(seed): первый шаг не закрыт', () => {
  const s = new Simulation(20260730);
  const flags = runAll(s);
  eq(flags[0], false, 'первый шаг закрыт на новой партии — так не должно быть');
  const p = tutorialProgress(s);
  eq(p.total, TUTORIAL10.length, 'total не совпадает с числом шагов');
  eq(p.done, 0, `на новой партии done=${p.done}`);
  eq(p.current, 'food_first', 'current указывает не на первый шаг');
  ok(typeof p.current === 'string' || p.current === null, 'current — не id и не null');
});

t('check возвращает boolean на разных сидах и стадиях партии', () => {
  for (const seed of [7, 20260730, 424242]) {
    const fresh = new Simulation(seed);
    runAll(fresh);
    const mid = new Simulation(seed);
    mid.techs.add('tools'); mid.techs.add('pottery'); mid.day = 88;
    put(mid, 'forager'); put(mid, 'lumber'); put(mid, 'hut');
    runAll(mid);
  }
});

// --------------------------------------------- сверка имён с data.js
t('шаги ссылаются только на существующие id зданий/технологий/ресурсов', () => {
  const KNOWN = new Set([
    ...Object.keys(BUILDINGS),
    ...TECHS.map(x => x.id),
    ...RES.map(r => r.id),
  ]);
  const src = readFileSync(MODULE_PATH, 'utf8');
  // Токены от трёх букв: короткие ('fs' из примера grep-команды) — не id-и.
  const stepIds = new Set(TUTORIAL10.map(st => st.id));   // свои id шагов — не имена данных
  const quoted = new Set(
    [...src.matchAll(/'([a-z_]{3,})'/g)].map(m => m[1]).filter(tk => !stepIds.has(tk))
  );
  ok(quoted.size > 0, 'в модуле не найдено ни одного id-литерала — сверка пуста');
  for (const tk of quoted) ok(KNOWN.has(tk), `модуль ссылается на несуществующее «${tk}»`);
  for (const m of src.matchAll(/\.res\.([a-z_]+)/g)) ok(KNOWN.has(m[1]), `.res.${m[1]} нет среди ресурсов`);
  for (const m of src.matchAll(/\.resCap\.([a-z_]+)/g)) ok(KNOWN.has(m[1]), `.resCap.${m[1]} нет среди ресурсов`);
  console.log(`   сверено имён: ${quoted.size} id-литералов против ${KNOWN.size} записей data.js`);
});

t('цены и названия в подсказках — настоящие, из BUILDINGS/TECHS', () => {
  const src = readFileSync(MODULE_PATH, 'utf8');
  for (const [id, def] of Object.entries(BUILDINGS)) {
    if (!src.includes(`'${id}'`)) continue;                       // здание не упомянуто — не наша забота
    ok(src.includes(def.name), `упомянуто «${id}», но его имя «${def.name}» в подсказках не найдено`);
  }
  for (const techDef of TECHS) {
    if (!src.includes(`'${techDef.id}'`)) continue;
    ok(src.includes(techDef.name), `технология «${techDef.id}» названа не по-игровому`);
  }
});

// ------------------------------------------------------------- семантика
t('лестница: закрытие шагов открывает следующие, skipIf прозрачен', () => {
  const s = new Simulation(5150);
  eq(tutorialProgress(s).done, 0, 'старт не должен быть пройден');
  put(s, 'forager');
  let p = tutorialProgress(s);
  eq(p.done, 1, 'собиратели не закрыли первый шаг');
  eq(p.current, 'wood_line', 'после собирателей текущий — лесопилка');
  put(s, 'lumber'); put(s, 'hut');
  p = tutorialProgress(s);
  eq(p.done, 4, 'хижина+лесопилка должны закрыть и шаг про Цели (4)');
  eq(p.current, 'first_tech', 'дальше по лестнице — технологии');
  s.techs.add('tools');
  eq(tutorialProgress(s).done, 5, '«Орудия труда» не засчитаны');
});

t('skipIf прячет ранние шаги, но не блокирует лестницу', () => {
  const s = new Simulation(777);
  // Амбар требует Гончарство, рынок — Торговлю: на новой партии оба вне дела.
  const g = TUTORIAL10.find(st => st.id === 'winter_granary');
  const mk = TUTORIAL10.find(st => st.id === 'first_market');
  eq(g.skipIf(s), true, 'амбар без Гончарства не должен быть «по делу»');
  eq(mk.skipIf(s), true, 'рынок без Торговли не должен быть «по делу»');
  s.techs.add('pottery');
  eq(g.skipIf(s), false, 'Гончарство открыто, а амбар всё ещё спрятан');
  // Прозрачность: спрятанные шаги не мешают закрывать хвост лестницы.
  put(s, 'forager'); put(s, 'lumber'); put(s, 'hut'); s.day = 150;
  const p = tutorialProgress(s);
  ok(p.done >= 4, `первые шаги не посчитались: done=${p.done}`);
  eq(p.current, 'first_tech', 'спрятанный шаг перехватил current');
});

t('частокол показывается только при достатке, зима — по календарю', () => {
  const wall = TUTORIAL10.find(st => st.id === 'rich_palisade');
  const wint = TUTORIAL10.find(st => st.id === 'winter_survived');
  const poor = new Simulation(31);
  poor.techs.add('masonry');
  eq(wall.skipIf(poor), true, 'без дерева частокол не должен требоваться сразу');
  poor.res.wood = 60;
  eq(wall.skipIf(poor), false, 'кладка есть, дерево есть — пора ставить частокол');
  const cal = new Simulation(32);
  cal.day = 99;
  eq(wint.check(cal), false, 'зима (75–99) ещё идёт, а шаг закрыт');
  cal.day = 101;
  eq(wint.check(cal), true, 'весна наступила, а шаг не закрыт');
});

// ------------------------------------------------------------------ чистота
t('чистота: serialize() до и после всех предикатов идентичен', () => {
  const probe = (sim, tag) => {
    const before = JSON.stringify(sim.serialize());
    runAll(sim);
    tutorialProgress(sim);
    tutorialProgress(sim);
    const after = JSON.stringify(sim.serialize());
    eq(after, before, `${tag}: предикаты меняют состояние симуляции`);
  };
  probe(new Simulation(9090), 'новая партия');
  const busy = new Simulation(9091);
  busy.techs.add('tools'); busy.techs.add('trade'); busy.res.wood = 55; busy.day = 120;
  put(busy, 'forager'); put(busy, 'market');
  probe(busy, 'развитая партия');
});

// ------------------------------------------------- монотонность на прогоне
t('tutorialProgress монотонен на прогоне 200 дней (партия ведётся по урокам)', () => {
  const s = new Simulation(20260730);
  const plan = [
    { day: 2, act: () => put(s, 'forager') },
    { day: 6, act: () => put(s, 'lumber') },
    { day: 10, act: () => put(s, 'hut') },
    { day: 14, act: () => s.techs.add('tools') },
    { day: 18, act: () => put(s, 'quarry') },
    { day: 22, act: () => { s.techs.add('pottery'); put(s, 'granary'); } },
    { day: 26, act: () => { s.techs.add('masonry'); put(s, 'palisade'); } },
    { day: 30, act: () => { s.techs.add('trade'); put(s, 'market'); } },
  ];
  let prev = -1, planIdx = 0, lastDay = -1;
  // tick(dt) идёт в игровых днях: 0.5 × 400 тиков ≈ 200 дней.
  for (let i = 0; i < 5000 && s.day <= 200; i++) {
    while (planIdx < plan.length && s.day >= plan[planIdx].day) plan[planIdx++].act();
    s.tick(0.5);
    if (s.day === lastDay) continue;
    lastDay = s.day;
    if (s.day > 20) s.res.food = Math.max(s.res.food, 180);   // урок «запас на зиму» выполняется
    if (s.day > 20) s.res.wood = Math.max(s.res.wood, 80);
    const p = tutorialProgress(s);
    ok(Number.isInteger(p.done) && p.done >= 0 && p.done <= p.total, `done сломался: ${p.done}`);
    ok(p.done >= prev, `прогресс откатился на дне ${s.day}: ${prev} → ${p.done}`);
    prev = p.done;
  }
  ok(prev === TUTORIAL10.length, `за 200 дней уроков пройдено ${prev} из ${TUTORIAL10.length}`);
  eq(tutorialProgress(s).current, null, 'при полном прохождении current должен стать null');
  console.log(`   сид ${s.seed}: все ${prev} шагов закрыты к дню ${s.day}, откатов нет`);
});

t('брошенная партия ничего не закрывает сама (60 дней без игрока)', () => {
  const s = new Simulation(999);
  for (let i = 0; i < 120; i++) s.tick(0.5);   // tick — в днях: 120 × 0.5 = 60 дней
  const p = tutorialProgress(s);
  eq(p.done, 0, `без игрока само закрылось ${p.done} шагов`);
  eq(p.current, 'food_first', 'брошенная партия должна ждать первого шага');
});

// -------------------------------------------------------------- кодировка
t('UTF-8 без BOM, переводы строк только LF (модуль и тест)', () => {
  for (const [tag, path, mustContain] of [
    ['tutorial10.js', MODULE_PATH, 'Собиратели'],
    ['test-tutorial10.mjs', TEST_PATH, 'монотонен'],
  ]) {
    const buf = readFileSync(path);
    ok(!(buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF), `${tag}: начинается с BOM`);
    ok(!buf.includes(13), `${tag}: найден CR — в файле CRLF вместо LF`);
    const txt = buf.toString('utf8');
    ok(txt.includes(mustContain), `${tag}: кириллица не читается как UTF-8`);
    ok(!/\?{2,}/.test(txt.slice(0, 400)), `${tag}: похоже на битую кодировку в шапке`);
  }
});

// ------------------------------------------- мост в coach.js описан честно
t('блок ПОДКЛЮЧЕНИЯ: якоря существуют и описаны с командой проверки', () => {
  const src = readFileSync(MODULE_PATH, 'utf8');
  const coach = readFileSync(fileURLToPath(new URL('../src/ui/coach.js', import.meta.url)), 'utf8').split(/\r?\n/);
  for (const anchor of ["from '../core/data.js';", 'const REMINDERS = [', 'renderCard(step, ok)']) {
    const hits = coach.filter(l => l.includes(anchor)).length;
    eq(hits, 1, `якорь «${anchor}» в coach.js встречается ${hits} раз, а должен 1`);
    ok(src.includes(anchor), `якорь «${anchor}» не описан в блоке ПОДКЛЮЧЕНИЯ`);
  }
  ok(/node -e "/.test(src), 'нет готовой grep-команды для перепроверки якорей');
});

console.log(`\n=== ${pass} OK / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
