// Регрессии агента W2 «СИМУЛЯЦИЯ-ФИКСЫ» — один файл на пять багов, repro-first:
// сначала красный тест, потом фикс в core/simulation.js + core/data.js.
//   1. Робозавод (workers === 0) не производил ничего — выработка шла только
//      через жителей на рабочих местах (tickVillagers -> produceAt), а assignJob
//      такие здания пропускает.
//   2. Погода ферм входила в урожай дважды: базовый mult уже содержал
//      WEATHER.gather, ветка фермы домножала ещё и на WEATHER.farm (дождь
//      0.85*1.15 ~= 0.98 вместо обещанных +15%, снег 0.28 вместо 0.4).
//   3. Голодный кризис не знал про потолок амбаров: при 58+ жителях порог
//      «5 дней запаса» больше крыши хранилища — город с полными амбарами жил
//      в режиме вечного голода, рост вставал молча.
//   4. Аура кузницы (+10% добычи соседям, def.aura) читалась только мельницей
//      для ферм; сама кузница никого не усиливала.
//   5. В сейве не ехали pendingEvent/eventCooldown, штрафы событий
//      (farmPenaltyDays/dcPenaltyDays), мирные пакты (_peacePacts) и
//      однодневные кэши отчётов связей (sys.dynLinks и подобные) — после
//      загрузки счастье и панели до вечера считали по пустым отчётам.
// Запуск: node app/tests/test-sim-fixes.mjs
import { Simulation } from '../src/core/simulation.js';
import { SAVE_VERSION, WEATHER, BUILDINGS } from '../src/core/data.js';

let ok = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); ok++; console.log('OK', name); }
  catch (e) { fail++; console.log('FAIL', name, '—', e.message); }
};
const must = (cond, msg) => { if (!cond) throw new Error(msg); };
const runDays = (sim, days) => { for (let i = 0; i < days * 4; i++) sim.tick(0.25); };

// ════════════════ 1. Робозавод: workers === 0 производит сам ════════════════

t('робозавод без единого рабочего даёт сталь по паспорту (~3/день)', () => {
  const sim = new Simulation(4242);
  sim.placeFree('robo_factory', sim.world.startX + 2, sim.world.startY);
  sim.res.steel = 0;
  runDays(sim, 2);
  must(sim.res.steel > 3, `за 2 дня робозавод дал ${sim.res.steel.toFixed(2)}⚙️ вместо >3 (паспорт 3.0/день)`);
});

// ════════════════ 2. Погода ферм: коэффициент применяется один раз ════════════════

function farmGainPerDay(weather) {
  const sim = new Simulation(4242);
  // Здание подсовываем напрямую в список: раскладка тайлов и жители тут не
  // участвуют — проверяем чистую формулу produceAt.
  const b = { id: 'farm', x: sim.world.startX + 3, y: sim.world.startY + 3, done: true, hp: 100, workers: [] };
  sim.buildings.push(b);
  sim.weather = weather;
  sim.seasonIdx = 0;             // не зима: зимой ферма честно стоит
  sim.res.food = 0;
  sim.produceAt(b, 1, 1);
  return sim.res.food;
}

t('дождь даёт фермам +15%, а не парадоксальные -2% (двойное перемножение погоды)', () => {
  const sun = farmGainPerDay('sun'), rain = farmGainPerDay('rain');
  const ratio = rain / sun;
  must(Math.abs(ratio - WEATHER.rain.farm) < 0.005,
    `дождь/ясно = ${ratio.toFixed(4)}, ожидалось ${WEATHER.rain.farm} (было 0.85*1.15=${(0.85 * 1.15).toFixed(4)})`);
});

t('снег режет фермы до 0.4, а не до 0.28 (погода собирательства не должна домножать поле)', () => {
  const sun = farmGainPerDay('sun'), snow = farmGainPerDay('snow');
  const ratio = snow / sun;
  must(Math.abs(ratio - WEATHER.snow.farm) < 0.005,
    `снег/ясно = ${ratio.toFixed(4)}, ожидалось ${WEATHER.snow.farm}`);
});

// ════════════════ 3. Крыша амбаров: полный склад — не голод ════════════════

t('еда под потолок амбаров при 58 жителях — НЕ кризис: карьер работает', () => {
  const sim = new Simulation(4242);
  while (sim.villagers.length < 58) sim.spawnVillager(sim.world.startX, sim.world.startY);
  const q = sim.placeFree('quarry', sim.world.startX + 6, sim.world.startY + 6);
  sim.res.food = sim.resCap.food;            // амбары полны под крышу (200)
  must(!sim.inFoodCrisis(), 'inFoodCrisis() должен быть false, когда склад физически полон');
  // Сажаем жителя на место вручную — как это сделал бы onArrive.
  const v = sim.villagers[0];
  v.x = q.x + 0.5; v.y = q.y + 0.5;
  v.target = { kind: 'work', b: q, x: q.x, y: q.y };
  v.atWork = true; v.shift = 4;
  runDays(sim, 1);
  must(sim.res.stone > 0.05, `камень не растёт при еде под крышу (${sim.res.stone.toFixed(3)}) — город зажат ложным кризисом`);
});

t('рост остановлен полной крышей — одно понятное событие в летописи, без спама', () => {
  const sim = new Simulation(99);
  // жильё выше населения: иначе счастье упадёт и блокировка роста будет не из-за крыши
  for (let i = 0; i < 17; i++) {
    sim.placeFree('hut', sim.world.startX - 12 + (i % 8) * 3, sim.world.startY - 6 + Math.floor(i / 8) * 3);
  }
  while (sim.villagers.length < 67) sim.spawnVillager(sim.world.startX, sim.world.startY);
  sim.techs.add('pottery'); sim.techs.add('laws');   // счастье заведомо выше 45
  sim.res.food = sim.resCap.food;                     // 200 < 67*3 — запасу на новорождённого некуда лезть
  const before = sim.chronicle.length;
  sim.onNewDay();
  const hits = sim.chronicle.slice(before).filter(c => /Амбары полны/.test(c.text));
  must(hits.length === 1, `ождалось одно событие о крыше амбаров, в летописи ${hits.length}`);
  sim.onNewDay();
  const hits2 = sim.chronicle.filter(c => /Амбары полны/.test(c.text));
  must(hits2.length === 1, `событие дублируется каждый день (${hits2.length})`);
});

// ════════════════ 4. Аура кузницы: +10% добыче соседей ════════════════

function quarryGain(sim, b) {
  sim.res.stone = 0;
  sim.produceAt(b, 1, 1);
  return sim.res.stone;
}

t('карьер рядом с кузницей даёт ровно +10% против дальнего; кузница себя не усиливает', () => {
  const sim = new Simulation(7);
  sim.placeFree('smithy', 10, 10);
  const near = { id: 'quarry', x: 11, y: 11, done: true, hp: 100, workers: [] };   // dist ~1.41 <= 2
  const far = { id: 'quarry', x: 40, y: 40, done: true, hp: 100, workers: [] };
  sim.buildings.push(near, far);
  sim.weather = 'sun';
  const gNear = quarryGain(sim, near), gFar = quarryGain(sim, far);
  must(gFar > 0, 'дальней карьере не дал ничего — тест сломан');
  must(Math.abs(gNear / gFar - 1.1) < 1e-9, `близкий/дальний = ${(gNear / gFar).toFixed(6)}, ожидалось 1.1`);
  // Сама поставленная кузница: соседних других кузниц нет, самоусиления быть не должно
  const sm = sim.buildings.find(b => b.id === 'smithy');
  const gSelf = quarryGain(sim, sm);
  // без самоусиления отношение равно паспортному 0.8 камня / 1.0 у карьера
  const passport = BUILDINGS.smithy.out.stone / BUILDINGS.quarry.out.stone;
  must(Math.abs(gSelf / gFar - passport) < 1e-9, `кузница усилила саму себя (${(gSelf / gFar).toFixed(4)} вместо ${passport})`);
});

// ════════════════ 5. Сейв v4: события, пакты, штрафы, дневные кэши ════════════════

const DAY_CACHE_KEYS = ['winterReport', 'borderStats', 'ecoLinks', 'memLinks', 'buildLinks',
  'masterLinks', 'herdsReport', 'intelLinks', 'nbrLinks', 'indLinks', 'warLinks',
  'dynLinks', 'betrayals', '_repelledSeen'];

t(`SAVE_VERSION поднят до 4`, () => {
  must(SAVE_VERSION === 4, `SAVE_VERSION = ${SAVE_VERSION}, ожидалось 4`);
});

t('в сейв едут pendingEvent, eventCooldown, штрафы событий, мирные пакты и дневные кэши отчётов', () => {
  const sim = new Simulation(4242);
  runDays(sim, 30);   // прогрев: у связей появляются однодневные отчёты
  sim.pendingEvent = { id: 'tribute', ru: 'Требование дани', text: 'тест',
    choice: { a: { ru: 'Заплатить' }, b: { ru: 'Отказать' } }, _tributeFid: 'wolves' };
  sim.eventCooldown = 7;
  sim.farmPenaltyDays = 13;
  sim.dcPenaltyDays = 5;
  sim._peacePacts = { wolves: sim.day + 50 };
  const json = JSON.stringify(sim.serialize());
  const data = JSON.parse(json);
  must(data.version === SAVE_VERSION, 'версия сейва не текущая');
  must(data.pendingEvent && data.pendingEvent.id === 'tribute' && data.pendingEvent._tributeFid === 'wolves',
    'pendingEvent не попал в сейв');
  must(data.eventCooldown === 7 && data.farmPenaltyDays === 13 && data.dcPenaltyDays === 5,
    'cooldown/штрафы событий не попали в сейв');
  must(data.peacePacts && data.peacePacts.wolves === sim.day + 50, 'мирный пакт не попал в сейв');
  for (const k of DAY_CACHE_KEYS) {
    must(data.dayReports && (k in data.dayReports), `дневной кэш ${k} отсутствует в сейве`);
  }
  const r = Simulation.deserialize(json);
  must(r.ok === true, `загрузка упала: ${r.reason}`);
  const L = r.sim;
  must(L.pendingEvent && L.pendingEvent.id === 'tribute' && L.pendingEvent._tributeFid === 'wolves',
    'pendingEvent потерян при загрузке');
  must(L.eventCooldown === 7 && L.farmPenaltyDays === 13 && L.dcPenaltyDays === 5,
    'cooldown/штрафы потеряны при загрузке');
  must(L.atPeaceTreaty('wolves') === true, 'мирный пакт не работает после загрузки');
  for (const k of DAY_CACHE_KEYS) {
    must(JSON.stringify(L.sys[k]) === JSON.stringify(data.dayReports[k]), `кэш ${k} разошёлся при круге`);
  }
  // Круг бит-в-бит. Известное исключение (НЕ поле этой регрессии): sys.emp.sites.fog
  // пакуется из последнего СУТОЧНОГО обновления тумана, а empireRestore при
  // загрузке переигрывает updateFog по текущим позициям жителей — клетка, на
  // которой житель стоит между дневными пересчётами, раскрывается заново.
  // Ломается только точное равенство строки, не поведение; глобальный круг
  // остаётся за app/tests/test-e2e-save.mjs (600 дней, зелёный).
  const canon = (j) => { const o = JSON.parse(j); if (o.sys && o.sys.emp && o.sys.emp.sites) delete o.sys.emp.sites.fog; return JSON.stringify(o); };
  must(canon(JSON.stringify(L.serialize())) === canon(json), 'круг serialize→deserialize→serialize разошёлся вне fog');
});

t('миграция v3→v4: старый сейв получает дефолты и читается', () => {
  const sim = new Simulation(777);
  runDays(sim, 40);
  const snap = JSON.parse(JSON.stringify(sim.serialize()));
  snap.version = 3;
  for (const k of ['pendingEvent', 'eventCooldown', 'farmPenaltyDays', 'dcPenaltyDays', 'peacePacts', 'dayReports']) delete snap[k];
  const r = Simulation.deserialize(JSON.stringify(snap));
  must(r.ok === true, `миграция v3 упала: ${r.reason}`);
  must(r.sim.pendingEvent === null, 'после миграции висит чужое событие');
  must(r.sim.eventCooldown > 0, 'cooldown после миграции должен быть положительным дефолтом');
  must(r.sim.farmPenaltyDays === 0 && r.sim.dcPenaltyDays === 0, 'штрафы после миграции должны быть нулями');
  must(r.sim.atPeaceTreaty('wolves') === false, 'несуществующий пакт действует после миграции');
  must(r.sim.day === sim.day, 'миграция потеряла день партии');
});

console.log(`\n=== ${ok} OK / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
