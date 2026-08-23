// Тесты карточки-инспектора (app/src/ui/inspector.js) — W20.
// Запуск: node app/tests/test-inspector.mjs
//
// DOM в node нет и не нужен: у inspector.js чистая часть (модели карточек,
// поиск целей, разметка) отделена от рендера маркером «DOM-ЧАСТЬ», как у
// ui/dock.js. Сам импорт модуля — уже проверка: он обязан проходить без
// document/window, иначе чистую часть нельзя протестировать.
//
// Симуляции здесь подставные (минимальные объекты ровно с теми полями, которые
// читают чистые функции и ядро build2/settlement_view): инспектор — потребитель,
// и его модели обязаны работать на ЧТЕНИИ чужого состояния, не требуя живого
// Simulation.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const {
  SETTLEMENT_HIT_R, INSPECTOR_POLL_MS, DOCK_FREE_PX,
  emojiForBuilding, staffOf, jobRu,
  buildingCard, villagerCard, enemyCityCard,
  settlementAt, resolveTarget, aliveTarget,
  cardHtml,
} = await import('../src/ui/inspector.js');
const { settlementView } = await import('../src/core/systems/settlement_view.js');
const { BUILDINGS } = await import('../src/core/data.js');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('OK', name); } catch (e) { fail++; console.log('FAIL', name, '—', e.message); } };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || ''} ждали ${JSON.stringify(b)}, получили ${JSON.stringify(a)}`); };
const ok = (v, m) => { if (!v) throw new Error(m || 'ложь'); };

const HERE = join(dirname(fileURLToPath(import.meta.url)));
const CODE = readFileSync(join(HERE, '..', 'src', 'ui', 'inspector.js'), 'utf8');

// ---------- подставные данные ----------

// Минимальный sim для canUpgrade/build2: технология открыта, денег хватает.
function affordSim() {
  return {
    techs: new Set(['masonry', 'castles']),
    godmode: false,
    lackCost: () => null,
    villagers: [],
    buildings: [],
    factions: [],
    // settlement_view: сид/день/реестры войн и лог — читаются только эти поля
    seed: 4242, day: 7, eraIndex: 0, wars: [], aiWars: [], log: [],
  };
}

function workerAt(b) { return { name: 'Работяга', hp: 100, job: 'work', target: { kind: 'work', b } }; }

// ---------- константы контракта ----------

t('нижняя зона дока держится свободной (76px)', () => {
  eq(DOCK_FREE_PX, 76);
});

t('период опроса и радиус попадания по городу разумны', () => {
  eq(INSPECTOR_POLL_MS, 400);
  ok(SETTLEMENT_HIT_R > 1.5 && SETTLEMENT_HIT_R < 2.2, `радиус ${SETTLEMENT_HIT_R} между клеткой и двумя`);
});

// ---------- модель карточки здания ----------

t('здание: прочность, работники, эффективность из состояния sim', () => {
  const sim = affordSim();
  const b = { id: 'farm', x: 3, y: 4, size: 1, done: true, destroyed: false, hp: 90, workers: [] };
  // Трое из четырёх мест заняты — эффективность 75% при целом здании.
  sim.villagers = [workerAt(b), workerAt(b), workerAt(b), { name: 'Гуляка', hp: 1, job: 'idle', target: null }];
  const card = buildingCard(sim, b);
  ok(card, 'карточка построена');
  eq(card.kind, 'b');
  eq(card.title, BUILDINGS.farm.name);
  const row = k => card.rows.find(r => r.k === k);
  eq(row('Прочность').v, '90 / 100');
  eq(row('Работники').v, '3 из 4');
  eq(row('Эффективность').v, '75%');
  eq(staffOf(sim, b), 3);
});

t('ветхое здание теряет эффективность и краснеет', () => {
  const sim = affordSim();
  const b = { id: 'farm', x: 0, y: 0, size: 1, done: true, destroyed: false, hp: 25, workers: [] };
  sim.villagers = [workerAt(b), workerAt(b), workerAt(b), workerAt(b)];
  const row = buildingCard(sim, b).rows.find(r => r.k === 'Прочность');
  eq(row.v, '25 / 100');
  eq(row.cls, 'bad');
  // Штат полон, но ниже REPAIR_CRITICAL ядро считает здание вполсилы:
  // ровно половина эффективности — это жёлтая зона, а не «норма».
  const eff = buildingCard(sim, b).rows.find(r => r.k === 'Эффективность');
  eq(eff.v, '50%');
  eq(eff.cls, 'warn');
});

t('стройплощадка: прогресс и бригада, без строки эффективности', () => {
  const sim = affordSim();
  const b = { id: 'farm', x: 1, y: 1, size: 1, done: false, destroyed: false, progress: 0.5, buildDays: 2, workers: [{}, {}] };
  const card = buildingCard(sim, b);
  ok(card.rows.some(r => r.k === 'Статус' && /Строится 25%/.test(r.v)), 'процент стройки посчитан');
  eq(card.rows.find(r => r.k === 'Стройителей').v, '2');
  ok(!card.rows.some(r => r.k === 'Эффективность'), 'эффективности у недостроя нет');
});

t('снесённое здание не получает карточку вовсе', () => {
  const sim = affordSim();
  eq(buildingCard(sim, { id: 'farm', done: true, destroyed: true, hp: 90 }), null);
});

// ---------- кнопки только существующих действий ----------

t('улучшение есть тогда, когда ядро разрешает (canUpgrade)', () => {
  const sim = affordSim();
  const hut = { id: 'hut', x: 2, y: 2, size: 1, done: true, destroyed: false, hp: 60 };
  const acts = buildingCard(sim, hut).actions;
  // У хижины с прочностью 60/100 законны ровно две кнопки: улучшение и ремонт.
  eq(acts.filter(a => a.id === 'upgrade').length, 1);
  ok(/Каменный дом/.test(acts.find(a => a.id === 'upgrade').ru), 'кнопка называет цель улучшения');

  // Фермы в таблице UPGRADE нет — действия нет.
  const farm = { id: 'farm', x: 0, y: 0, size: 1, done: true, destroyed: false, hp: 100 };
  eq(buildingCard(sim, farm).actions.length, 0);

  // Технология закрыта — кнопки нет (мёртвых кнопок инспектор не рисует).
  sim.techs.delete('masonry');
  eq(buildingCard(sim, hut).actions.filter(a => a.id === 'upgrade').length, 0);
});

t('ремонт предлагается только повреждённому и только если действие существует', () => {
  const sim = affordSim();
  const hurt = { id: 'lumber', x: 0, y: 0, size: 1, done: true, destroyed: false, hp: 50 };
  const acts = buildingCard(sim, hurt).actions;
  eq(acts.filter(a => a.id === 'repair').length, 1);
  const whole = { id: 'lumber', x: 0, y: 0, size: 1, done: true, destroyed: false, hp: 100 };
  eq(buildingCard(sim, whole).actions.filter(a => a.id === 'repair').length, 0);
});

t('никогда нет кнопок несуществующих действий: ни сноса, ни назначения', () => {
  const sim = affordSim();
  const b = { id: 'market', x: 0, y: 0, size: 1, done: true, destroyed: false, hp: 10 };
  sim.techs.add('banking');
  const all = [
    ...buildingCard(sim, b).actions,
    ...(villagerCard(sim, { name: 'Айна', hp: 80, job: 'idle', target: null }) || { actions: [] }).actions,
  ];
  for (const a of all) {
    ok(a.id !== 'demolish' && a.id !== 'assign' && a.id !== 'destroy',
      `действия «${a.id}» в игре не существует`);
  }
  ok(all.every(a => a.id === 'upgrade' || a.id === 'repair'),
    'у здания допустимы только улучшение/ремонт');
});

// ---------- вражеский город из settlement_view ----------

function factionTown(P, defense) {
  return {
    id: 'wolves',
    def: { id: 'wolves', name: 'Волчий Предел', traits: { defense } },
    P, era: 0, alive: true,
    settlements: [{ x: 10, y: 12, capital: true }],
  };
}

t('город: тир, стены и население приходят из settlementView', () => {
  const sim = affordSim();
  const f = factionTown(30, 9);
  const s = f.settlements[0];
  const view = settlementView(sim, f, s);
  const card = enemyCityCard(sim, f, s);
  ok(card, 'карточка города построена');
  eq(card.kind, 's');
  eq(card.title, 'Волчий Предел');
  const val = k => card.rows.find(r => r.k === k).v;
  // P=30 при порогах [14,28,·,·] даёт базу 2, столица +1 → тир 3;
  // стены: по тиру 1, по обороне 9 → 2; берётся минимум → частокол.
  eq(view.tier, 3);
  eq(val('Ступень'), String(view.tier));
  eq(view.walls, 1);
  eq(val('Стены'), 'частокол');
  eq(view.pop, 30);
  eq(val('Население'), '30');
  eq(val('Столица'), 'Да');
});

t('война и свежий ущерб видны и подсвечены', () => {
  const sim = affordSim();
  sim.wars = [{ fid: 'wolves' }];
  sim.log = [{ day: 6, text: '⚔ Отряд вышел к (11,13)' }];
  const f = factionTown(8, 2);
  const s = f.settlements[0];
  const card = enemyCityCard(sim, f, s);
  const war = card.rows.find(r => r.k === 'Война');
  eq(war.v, 'Да');
  eq(war.cls, 'bad');
  eq(card.rows.find(r => r.k === 'Свежий ущерб').v, 'Есть');
});

t('мирный целый город без предупреждений и без действий', () => {
  const sim = affordSim();
  const f = factionTown(8, 2);
  const card = enemyCityCard(sim, f, f.settlements[0]);
  eq(card.rows.find(r => r.k === 'Война').v, 'Нет');
  ok(!card.rows.some(r => r.k === 'Свежий ущерб'), 'ущерба нет — строки нет');
  // Карточка фракции недоступна — кнопок нет вообще: воевать/дарить из
  // инспектора нельзя, этих обработчиков у карточки города не выдумывали.
  eq(card.actions.length, 0);
});

t('hasFactionCard открывает кнопку только вместе с валидным городом', () => {
  const sim = affordSim();
  const f = factionTown(8, 2);
  const card = enemyCityCard(sim, f, f.settlements[0], { hasFactionCard: true });
  eq(card.actions.length, 1);
  eq(card.actions[0].id, 'faction');
});

// ---------- житель ----------

t('житель: имя, занятие с местом работы, здоровье', () => {
  const sim = affordSim();
  const b = { id: 'smithy', x: 5, y: 5, size: 1, done: true, destroyed: false, hp: 100 };
  const v = { name: 'Огнеслав Крепкий', hp: 100, job: 'work', target: { kind: 'work', b } };
  const card = villagerCard(sim, v);
  eq(card.title, 'Огнеслав Крепкий');
  eq(card.rows.find(r => r.k === 'Занят').v, 'Работает: Кузница');
  eq(card.rows.find(r => r.k === 'Здоровье').cls, '');
  eq(card.actions.length, 0, 'у жителя нет и не может быть кнопок');
  eq(jobRu({ hp: 1, job: 'idle', target: null }), 'Без дела');
  eq(jobRu({ hp: 1, job: 'deadfall', target: null }), 'Носит валежник');
});

t('мертвый житель не получает карточку', () => {
  eq(villagerCard({}, { name: 'X', hp: 0, job: 'idle', target: null }), null);
});

// ---------- попадание по целям ----------

t('settlementAt находит город в радиусе и игнорирует мёртвых', () => {
  const sim = affordSim();
  const f = factionTown(8, 2);
  sim.factions.push(f); // settlementAt читает реестр фракций sim, как pick — villagers
  f.alive = false;
  eq(settlementAt(sim, 10.2, 12.2), null, 'мёртвая фракция не ловит клики');
  f.alive = true;
  const hit = settlementAt(sim, 10.5, 11.8);
  ok(hit && hit.s === f.settlements[0], 'центр города пойман');
  eq(settlementAt(sim, 14.5, 12.5), null, 'за радиусом пусто');
});

t('resolveTarget сохраняет приоритет конвейера выбора: житель > здание > город', () => {
  const sim = affordSim();
  const f = factionTown(8, 2);
  sim.factions.push(f);
  const b = { id: 'hut', x: 0, y: 0, size: 1, done: true, destroyed: false, hp: 100 };
  const v = { name: 'V', hp: 1, job: 'idle', target: null };
  eq(resolveTarget(sim, { kind: 'v', v }, 99, 99).kind, 'v');
  eq(resolveTarget(sim, { kind: 'b', b }, 99, 99).kind, 'b');
  // Город ищется только когда pick дал пустую землю.
  const t2 = resolveTarget(sim, { kind: 't' }, 10.2, 12.2);
  ok(t2 && t2.kind === 's', 'пустая земля над городом отдаёт город');
  eq(resolveTarget(sim, { kind: 't' }, 40, 40), null);
});

t('aliveTarget замечает исчезновение цели', () => {
  const sim = affordSim();
  const b = { id: 'hut', x: 0, y: 0, size: 1, done: true, destroyed: false, hp: 100 };
  sim.buildings.push(b);
  const t2 = { kind: 'b', b };
  ok(aliveTarget(sim, t2));
  b.destroyed = true;
  ok(!aliveTarget(sim, t2), 'снесённое здание гасит карточку');
});

// ---------- детерминизм HTML ----------

t('cardHtml детерминирован и экранирует данные мира', () => {
  const sim = affordSim();
  const b = { id: 'farm', x: 0, y: 0, size: 1, done: true, destroyed: false, hp: 90 };
  sim.villagers = [workerAt(b)];
  const c1 = buildingCard(sim, b);
  eq(cardHtml(c1), cardHtml(buildingCard(sim, b)), 'одно состояние — один HTML');

  const evil = villagerCard(sim, { name: '<img src=x onerror=1>', hp: 100, job: 'idle', target: null });
  const html = cardHtml(evil);
  ok(!html.includes('<img'), 'имя жителя экранировано');
  ok(html.includes('&lt;img'), 'экранирование сохранило текст');

  const town = enemyCityCard(sim, factionTown(30, 9), factionTown(30, 9).settlements[0]);
  ok(cardHtml(town) !== html, 'разные карточки — разный HTML');
});

t('в разметке есть крестик и data-ft-act у каждой кнопки', () => {
  const sim = affordSim();
  const hut = { id: 'hut', x: 0, y: 0, size: 1, done: true, destroyed: false, hp: 50 };
  sim.techs.add('masonry');
  const html = cardHtml(buildingCard(sim, hut));
  ok(html.includes('data-ft-close'), 'крестик закрытия на месте');
  ok(html.includes('aria-label="Закрыть"'), 'крестик подписан для скринридера');
  ok((html.match(/data-ft-act="upgrade"/g) || []).length === 1);
  ok((html.match(/data-ft-act="repair"/g) || []).length === 1);
});

// ---------- эмодзи-фолбэк ----------

t('эмодзи здания выводится из его же данных и стабилен', () => {
  eq(emojiForBuilding(BUILDINGS.farm), '🍞');
  eq(emojiForBuilding(BUILDINGS.hut), '🏠');
  eq(emojiForBuilding(BUILDINGS.palisade), '🛡️');
  eq(emojiForBuilding(undefined), '🏗️');
});

// ---------- дисциплина чистой части ----------

t('pure/DOM части разделены маркером, в чистой нет document/window', () => {
  const noComments = CODE
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');
  const cut = noComments.indexOf('function ensureCss');
  ok(cut > 0, 'DOM-часть начинается с ensureCss');
  ok(CODE.includes('===== DOM-ЧАСТЬ'), 'маркер раздела на месте');
  const pure = noComments.slice(0, cut);
  ok(!/\bdocument\b/.test(pure), 'в чистой части нет document');
  ok(!/\bwindow\b/.test(pure), 'в чистой части нет window');
  ok(!/querySelector|createElement|innerHTML/.test(pure), 'чистая часть не строит DOM сама');
  // DOM-часть наоборот обязана ждать браузера: автозапуск под флагом окна.
  ok(CODE.includes('__frontierInspector'), 'повторный запуск погашен флагом');
});

console.log(`\n=== ${pass} OK / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
