// Тесты производного вида поселений (settlement_view). Запуск: node app/tests/test-settlement-view.mjs
// Ключевые доказательства: вид читает только существующие поля sim, детерминирован,
// кэшируется в пределах дня и НЕ меняет sim.serialize().
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/core/simulation.js';
import { hash2 } from '../src/render/palette.js';
import { settlementView, invalidateSettlementViews } from '../src/core/systems/settlement_view.js';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('OK', name); } catch (e) { fail++; console.log('FAIL', name, '—', e.message); if (process.env.SVDEBUG) console.log(e.stack); } };
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };

const KEYS = ['tier', 'walls', 'atWar', 'damaged', 'pop', 'banner'];
const capOf = f => f.settlements[0];

// Запись лога ровно в том формате, каким wire_army.js пишет выход отряда набега
const raidLogLine = (sim, x, y, squad) => ({
  day: sim.day,
  text: `⚔ ${squad} вышел в поле (${x},${y}): Копейщики ×25. Перехватите его — иначе он дойдёт до поселения.`,
  type: 'warn',
});

t('форма объекта: шесть полей, целые числа в границах', () => {
  const sim = new Simulation(501, { factions: 3 });
  const f = sim.factions[0];
  const v = settlementView(sim, f, capOf(f));
  ok(JSON.stringify(Object.keys(v)) === JSON.stringify(KEYS), `поля: ${Object.keys(v)}`);
  ok(Number.isInteger(v.tier) && v.tier >= 0 && v.tier <= 4, `tier=${v.tier}`);
  ok(Number.isInteger(v.walls) && v.walls >= 0 && v.walls <= 2, `walls=${v.walls}`);
  ok(typeof v.atWar === 'boolean' && typeof v.damaged === 'boolean', 'atWar/damaged не boolean');
  ok(Number.isInteger(v.pop) && v.pop >= 0, `pop=${v.pop}`);
  ok(Number.isInteger(v.banner) && v.banner >= 0 && v.banner <= 2, `banner=${v.banner}`);
});

t('в модуле нет Math.random', () => {
  const src = readFileSync(new URL('../src/core/systems/settlement_view.js', import.meta.url), 'utf8');
  ok(!/Math\.random/.test(src), 'найден Math.random — детерминизм сломан');
});

t('tier растёт по P через пороги эпохи 0', () => {
  const sim = new Simulation(502, { factions: 3 });
  const f = sim.factions[0];
  const s = capOf(f);
  const seen = [];
  for (const P of [8, 16, 32, 56, 90]) {
    f.P = P;
    invalidateSettlementViews();
    seen.push(settlementView(sim, f, s).tier);
  }
  ok(JSON.stringify(seen) === JSON.stringify([1, 2, 3, 4, 4]), `ступени столицы: ${seen}`);
});

t('capital даёт +1 ступень против посёлка, потолок 4 не пробивается', () => {
  const sim = new Simulation(503, { factions: 3 });
  const f = sim.factions[0];
  const hamlet = { x: capOf(f).x + 10, y: capOf(f).y + 10, capital: false };
  f.settlements.push(hamlet);
  for (const P of [16, 90]) {
    f.P = P;
    invalidateSettlementViews();
    const ct = settlementView(sim, f, capOf(f)).tier;
    const ht = settlementView(sim, f, hamlet).tier;
    ok(ct === ht + 1 || (P > 80 && ct === 4 && ht === 4), `P=${P}: столица ${ct} vs посёлок ${ht}`);
  }
  f.P = 200; invalidateSettlementViews();
  ok(settlementView(sim, f, capOf(f)).tier === 4, 'столица выше 4 не прыгает');
  ok(settlementView(sim, f, hamlet).tier === 4, 'посёлок выше 4 не прыгает');
});

t('пороги масштабируются эпохой: тот же P даёт иную ступень в поздней эре', () => {
  const early = new Simulation(504, { factions: 3 });
  const late = new Simulation(505, { factions: 3, startEra: 6 });
  ok(late.eraIndex === 6 && early.eraIndex === 0, 'эпохи фиксур не те');
  const fe = early.factions[0], fl = late.factions[0];
  fe.P = 45; fl.P = 45;
  invalidateSettlementViews();
  ok(settlementView(early, fe, capOf(fe)).tier === 3, 'эпоха 0, P=45 — ждём 3');
  ok(settlementView(late, fl, capOf(fl)).tier === 2, 'эпоха 6, P=45 — ждём 2 (пороги ×3.1)');
});

t('walls растут от черты defense при равном размере города', () => {
  const sim = new Simulation(506, { factions: 8 });
  const turtle = sim.factions.find(x => x.def.traits.defense >= 8);
  const mid = sim.factions.find(x => x.def.traits.defense >= 4 && x.def.traits.defense <= 6);
  const naked = sim.factions.find(x => x.def.traits.defense <= 3);
  ok(turtle && mid && naked, 'среди 8 фракций должны быть оборотистые и голые');
  for (const f of [turtle, mid, naked]) { f.P = 90; }
  invalidateSettlementViews();
  ok(settlementView(sim, turtle, capOf(turtle)).walls === 2, 'defense≥8 → каменные стены (2)');
  ok(settlementView(sim, mid, capOf(mid)).walls === 1, 'defense 4..6 → частокол (1)');
  ok(settlementView(sim, naked, capOf(naked)).walls === 0, 'defense≤3 → без стен (0)');
});

t('walls требуют ступени города: малый город без стен даже у «черепахи»', () => {
  const sim = new Simulation(507, { factions: 8 });
  const f = sim.factions.find(x => x.def.traits.defense >= 8);
  const s = capOf(f);
  f.P = 8; invalidateSettlementViews();
  ok(settlementView(sim, f, s).walls === 0, 'tier 1 — ещё ничего не построено');
  f.P = 20; invalidateSettlementViews();
  ok(settlementView(sim, f, s).walls === 1, 'tier 2 — частокол');
  f.P = 56; invalidateSettlementViews();
  ok(settlementView(sim, f, s).walls === 2, 'tier 4 — каменные стены');
});

t('atWar появляется после declareWarOnPlayer и гаснет после мира', () => {
  const sim = new Simulation(508, { factions: 3 });
  const f = sim.factions[0];
  sim.day++;
  ok(settlementView(sim, f, capOf(f)).atWar === false, 'до войны уже воюем');
  sim.declareWarOnPlayer(f); // публичный API ядра: пишет в открытый реестр sim.wars
  sim.day++;
  ok(settlementView(sim, f, capOf(f)).atWar === true, 'война объявлена, но вид этого не видел');
  sim.endWar(f.id, true);
  sim.day++;
  ok(settlementView(sim, f, capOf(f)).atWar === false, 'мир заключён, но вид всё ещё воюет');
});

t('atWar для войны ИИ-ИИ из открытого реестра sim.aiWars видна обеим сторонам', () => {
  const sim = new Simulation(509, { factions: 3 });
  const [a, b, c] = sim.factions;
  sim.aiWars.push({ a: a.id, b: b.id, ws: 0 }); // прямая установка поля, которое читает функция
  sim.day++;
  ok(settlementView(sim, a, capOf(a)).atWar === true, `${a.id} не видит свою войну`);
  ok(settlementView(sim, b, capOf(b)).atWar === true, `${b.id} не видит свою войну`);
  ok(settlementView(sim, c, capOf(c)).atWar === false, `${c.id} втянут в чужую войну`);
});

t('damaged после записи рейда с координатами рядом; далёкое поселение чисто', () => {
  const sim = new Simulation(510, { factions: 3 });
  const f = sim.factions[0];
  const s = capOf(f);
  sim.log.push(raidLogLine(sim, s.x + 2, s.y - 1, '«Стальные волки»'));
  sim.day++;
  ok(settlementView(sim, f, s).damaged === true, 'рейд у бортa поселения не замечен');
  const far = { x: s.x + 40, y: s.y + 40, capital: false };
  ok(settlementView(sim, f, far).damaged === false, 'рейд за 40 клеток испортил чужой город');
});

t('damaged видит только свежее окно лога: старые записи за пределом уже не видно', () => {
  const sim = new Simulation(511, { factions: 3 });
  const f = sim.factions[0];
  const s = capOf(f);
  sim.log.push(raidLogLine(sim, s.x + 1, s.y + 1, '«Клинки»'));
  for (let i = 0; i < 31; i++) sim.log.push({ day: sim.day, text: `Караван прибыл: запись №${i}.`, type: 'info' });
  sim.day++;
  ok(settlementView(sim, f, s).damaged === false, 'запись старше окна последних 30 должна остыть');
});

t('pop — это floor(P / число поселений), целое и неотрицательное', () => {
  const sim = new Simulation(512, { factions: 3 });
  const f = sim.factions[0];
  const s = capOf(f);
  f.P = 30; invalidateSettlementViews();
  ok(settlementView(sim, f, s).pop === 30, 'одно поселение несёт всё население');
  f.settlements.push({ x: s.x + 12, y: s.y + 4, capital: false });
  invalidateSettlementViews();
  ok(settlementView(sim, f, s).pop === 15, 'два поселения делят пополам');
  f.settlements.push({ x: s.x - 11, y: s.y + 7, capital: false });
  invalidateSettlementViews();
  ok(settlementView(sim, f, s).pop === 10, 'три поселения — треть каждому (вниз)');
});

t('banner — детерминированный hash2 от координат, вариант 0..2, стабилен по дням', () => {
  const sim = new Simulation(513, { factions: 3 });
  const f = sim.factions[0];
  const s = capOf(f);
  const b = settlementView(sim, f, s).banner;
  ok(b === (((hash2(s.x | 0, s.y | 0) * 3) | 0)), `banner=${b}, а хеш говорит иначе`);
  sim.day++;
  ok(settlementView(sim, f, s).banner === b, 'знамя сменилось со сменой дня — оно же примета места');
});

t('кэш: в пределах дня тот же объект (===); день++ и инвалидация пересчитывают', () => {
  const sim = new Simulation(514, { factions: 2 });
  const f = sim.factions[0];
  const s = capOf(f);
  const v1 = settlementView(sim, f, s);
  ok(settlementView(sim, f, s) === v1, 'повторный вызов в пределах дня вернул новый объект');
  sim.day++;
  f.P += 20; // данные изменились вместе с днём
  const v2 = settlementView(sim, f, s);
  ok(v2 !== v1, 'после смены дня объект не пересоздан');
  ok(v2.tier > v1.tier, 'пересчёт не увидел новые данные');
  f.P += 60;
  invalidateSettlementViews();
  const v3 = settlementView(sim, f, s);
  ok(v3 !== v2 && v3.tier > v2.tier, 'invalidateSettlementViews не заставил пересчитать');
});

t('детерминизм: одинаковые сиды → идентичные views, разные сиды → разные миры', () => {
  const dump = sim => {
    invalidateSettlementViews();
    const out = [];
    for (const f of sim.factions) for (const s of f.settlements) out.push(settlementView(sim, f, s));
    return JSON.stringify(out);
  };
  const coords = sim => JSON.stringify(sim.factions.map(f => f.settlements.map(s => [s.x, s.y])));
  const a = dump(new Simulation(321, { factions: 4 }));
  const b = dump(new Simulation(321, { factions: 4 }));
  ok(a === b, 'один сид дал разные views');
  const c = new Simulation(322, { factions: 4 });
  ok(coords(c) !== coords(new Simulation(321, { factions: 4 })), 'разные сиды дали одинаковые координаты — сравнивать views было бы нечестно');
});

t('КРИТИЧНО: sim.serialize() не изменился от вызовов settlementView', () => {
  const sim = new Simulation(555, { factions: 4 });
  // Шумный сетап ДО снимка: война и запись рейда в лог.
  sim.declareWarOnPlayer(sim.factions[0]);
  const s = capOf(sim.factions[0]);
  sim.log.push(raidLogLine(sim, s.x + 1, s.y, '«Тестовый набег»'));
  sim.aiWars.push({ a: sim.factions[1].id, b: sim.factions[2].id, ws: 5 });
  const before = JSON.stringify(sim.serialize());
  for (const f of sim.factions) for (const st of f.settlements) settlementView(sim, f, st);
  for (const f of sim.factions) for (const st of f.settlements) settlementView(sim, f, st); // повторно из кэша
  const after = JSON.stringify(sim.serialize());
  ok(before === after, 'вызовы settlementView поменяли сериализацию симуляции');
});

console.log(`\nИТОГО: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
