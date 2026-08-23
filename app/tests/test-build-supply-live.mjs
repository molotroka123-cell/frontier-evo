// Живое доказательство дыры Б: подвоз (build_supply.js) подключён к ядру.
//
// Модуль и его юнит-тесты зелёные, но пока integrate.js не зовёт applySupply,
// в ИГРЕ подвоза нет: очередь доставок не существует вовсе. Здесь партия на
// 600 дней с честной нехваткой материалов обязана показать, что очередь
// РЕАЛЬНО движется: площадка попадает в доставки с полной нуждой, строители
// работают, нужда тает день ото дня, здание достраивается — а отчёт подвоза
// переживает сохранение и восстановление.
//
// Без подключения тест красный (отчёта нет ни одного дня), с блоком — зелёный.
// Запуск: node app/tests/test-build-supply-live.mjs
import { Simulation } from '../src/core/simulation.js';
import { buildPlan, systemsSerialize, systemsRestore } from '../src/core/systems/integrate.js';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('OK ', name); } catch (e) { fail++; console.log('FAIL', name, '—', e.message); } };
const ok = (c, m) => { if (!c) throw new Error(m || 'проверка не прошла'); };

const DAYS = 600;

// Склад умышленно скудный по дереву и камню: чертежи сперва ждут подвоза,
// и стройки растягиваются на дни. Еда в достатке — голод не должен убивать
// строителей и подменять причину простоя очереди.
function game(seed = 4242) {
  const s = new Simulation(seed, {});
  s.execCommand('godmode');
  s.execCommand('unlockall');
  for (const [r, n] of [['food', 99999], ['wood', 24], ['stone', 60], ['gold', 40]]) {
    s.execCommand(`give ${r} ${n}`);
  }
  s.godmode = false;                 // цены снова настоящие: нехватка настоящая
  return s;
}

const centerOf = (sim) => ({ x: Math.round(sim.world.startX), y: Math.round(sim.world.startY) });

// Клетка под чертёж: годится и место, где строить можно сразу, и место,
// где мешает только нехватка материалов — чертёж для того и существует,
// чтобы застолбить его без денег.
function spotForPlan(sim, id, tx, ty, rMax = 7) {
  for (let r = 0; r <= rMax; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const chk = sim.canPlace(id, tx + dx, ty + dy);
        if (chk.ok || /^Не хватает:/.test(chk.reason || '')) return { x: tx + dx, y: ty + dy };
      }
    }
  }
  return null;
}

function tryPlan(sim, id, tx, ty, rMax = 7) {
  const p = spotForPlan(sim, id, tx, ty, rMax);
  if (!p) return false;
  return buildPlan(sim, id, p.x, p.y).ok === true;
}

const unitsOfNeed = (need) => Object.values(need || {}).reduce((a, q) => a + (Number(q) || 0), 0);

console.log('--- Партия 600 дней: игрок строит при нехватке материалов ---');
const sim = game();
const c = centerOf(sim);

// Первая разнарядка: замок сознательно не по карману (камня 60 из 160), он
// стартует только когда материал накопится — и потому живёт в очереди дольше всех.
let planned = 0;
for (const id of ['hut', 'hut', 'granary', 'castle', 'sawmill', 'quarry', 'farm', 'granary']) {
  const tx = c.x + ((planned % 4) - 1) * 4;
  const ty = c.y + (((planned / 4) | 0) - 1) * 4;
  if (tryPlan(sim, id, tx, ty)) planned++;
}
t('чертежи приняты ядром, включая не по карману', () => ok(planned >= 5, `принято ${planned} из 8`));

const firstSeen = new Map();   // площадка → нужда в день первого попадания в очередь
const lastSeen = new Map();    // площадка → нужда в последний день наблюдения
const doneSeen = new Set();    // площадки из очереди доставок, что достроились
let pendDays = 0;              // дней с непустой очередью доставок
let firstPendDay = -1;
let wiredBreakDay = 0;         // первый день, когда отчёта подвоза не оказалось
let serFailDay = 0;            // день, когда сейв не нёс отчёт подвоза
let serMismatch = false;

for (let day = 1; day <= DAYS; day++) {
  for (let q = 0; q < 4; q++) sim.tick(0.25);

  // Караван на 150-й день и ещё один на 320-й: замок и товарная станция
  // наконец по карману. Без подкидки камень мог бы копиться слишком долго.
  if (sim.day === 150 || sim.day === 320) sim.res.stone += 150;

  // Каждые 20 дней игрок размечает новые дворы из длинной сметы: стройки
  // обязаны перекрываться, иначе очередь подвоза пустует и её движения
  // за партию не видно.
  if (sim.day % 20 === 0) {
    const cycle = ['train_station', 'sewers', 'temple', 'amphitheater', 'granary',
      'sawmill', 'barracks', 'aqueduct', 'quarry', 'hut'];
    const j = (sim.day / 20) | 0;
    tryPlan(sim, cycle[j % cycle.length], c.x + (sim.day % 13) - 6, c.y + (sim.day % 11) - 5);
    tryPlan(sim, cycle[(j + 2) % cycle.length], c.x - (sim.day % 7) + 3, c.y + (sim.day % 17) - 8);
  }

  // Середина партии: сохранение и загрузка. Отчёт подвоза обязан пережить круг.
  // Проверка идёт ДО guard'а по подключению: без блока она обязана гореть тоже.
  if (sim.day === Math.floor(DAYS / 2)) {
    const data = systemsSerialize(sim);
    if (!(data.supply && data.supply.report)) { serFailDay = sim.day; }
    else {
      const snapshot = JSON.stringify(data.supply.report);
      const had = sim.sys.supplyLinks;
      sim.sys.supplyLinks = null;          // эмуляция потери поля при загрузке
      systemsRestore(sim, data);
      const restored = sim.sys.supplyLinks ? JSON.stringify(sim.sys.supplyLinks) : 'null';
      if (restored !== snapshot) serMismatch = true;
      sim.sys.supplyLinks = had;           // мир партии дальше живёт как жил
    }
  }

  const L = sim.sys ? sim.sys.supplyLinks : null;
  if (!(L && L.flags && Array.isArray(L.flags.deliveries))) {
    if (!wiredBreakDay) wiredBreakDay = sim.day;
    continue;
  }
  if (L.flags.deliveries.length > 0) {
    pendDays++;
    if (firstPendDay < 0) firstPendDay = sim.day;
    for (const d of L.flags.deliveries) {
      const k = `${d.bx},${d.by}`;
      const u = unitsOfNeed(d.need);
      if (!firstSeen.has(k)) firstSeen.set(k, u);
      lastSeen.set(k, u);
    }
  }
  for (const b of sim.buildings) {
    if (b.done && !b.destroyed && firstSeen.has(`${b.x},${b.y}`)) doneSeen.add(`${b.x},${b.y}`);
  }
}

console.log(`    дней с pending>0: ${pendDays}, первый: ${firstPendDay}, достроено из очереди: ${doneSeen.size}`);

t('отчёт подвоза присутствует каждый игровой день',
  () => ok(wiredBreakDay === 0, `день ${wiredBreakDay}: sim.sys.supplyLinks отсутствует — модуль не подключён`));
t('очередь доставок реально существовала (pending>0)', () =>
  ok(pendDays >= 30, `дней с непустой очередью всего ${pendDays}, первый ${firstPendDay}`));
t('очередь двигается: нужда площадки тает по мере стройки', () => {
  let moved = 0;
  for (const [k, u0] of firstSeen) {
    if (lastSeen.get(k) < u0) moved++;
  }
  ok(moved >= 1, `ни на одной из ${firstSeen.size} площадок нужда не убывала`);
});
t('доставленное достраивается: стройка прогрессирует до конца', () =>
  ok(doneSeen.size >= 1, `из ${firstSeen.size} площадок очереди не достроилась ни одна`));
t('сериализация: отчёт подвоза переживает сейв и восстановление', () => {
  ok(serFailDay === 0, `день ${serFailDay}: в systemsSerialize нет поля supply`);
  ok(!serMismatch, 'отчёт после restore не совпал с отчётом до save');
});

console.log(`\n=== ${pass} OK / ${fail} FAIL ===`);
if (fail) process.exit(1);
