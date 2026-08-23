// Тесты шторки строительства (app/src/ui/building_drawer.js) — агент 19.
// Запуск: node app/tests/test-building-drawer.mjs
//
// DOM в node нет, и он здесь не нужен: у building_drawer.js чистая часть
// (категории, разложение BUILDINGS, модель и HTML карточек, правило видимости)
// отделена от рендера маркером «DOM-ЧАСТЬ». Сам импорт модуля — уже проверка:
// он обязан проходить без document/window, иначе шторку нельзя бы тестировать.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BUILDINGS } from '../src/core/data.js';

const {
  CATEGORIES, FALLBACK_CAT, CATEGORY_OF,
  iconOf, categoryOf, categoriesOfBuildings,
  effectLines, priceBadges, cardModel, cardHtml, cardsHtml, drawerHtml,
  drawerVisible,
} = await import('../src/ui/building_drawer.js');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('OK', name); } catch (e) { fail++; console.log('FAIL', name, '—', e.message); } };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || ''} ждали ${b}, получили ${a}`); };
const ok = (v, m) => { if (!v) throw new Error(m || 'ложь'); };

const HERE = dirname(fileURLToPath(import.meta.url));
const CODE = readFileSync(join(HERE, '..', 'src', 'ui', 'building_drawer.js'), 'utf8');

// ---------- 1. Категории: состав и порядок из задания ----------
t('ровно пять категорий с названиями из задания', () => {
  eq(CATEGORIES.length, 5);
  eq(CATEGORIES.map(c => c.ru).join('|'),
    ['Жильё и Быт', 'Добыча и Склады', 'Мастерские', 'Оборона и Стены', 'Культ и Чудеса'].join('|'));
  // ключи уникальны — они живут в data-атрибутах табов
  eq(new Set(CATEGORIES.map(c => c.key)).size, 5);
});

// ---------- 2. Полнота распределения БЕЗ ПОТЕРЬ ----------
t('каждое здание BUILDINGS явно отнесено ровно к одной категории', () => {
  const ids = Object.keys(BUILDINGS);
  // явная карта покрывает все id без чужих
  for (const id of ids) {
    ok(CATEGORY_OF[id], `здания ${id} нет в CATEGORY_OF`);
    ok(CATEGORIES.some(c => c.key === CATEGORY_OF[id]), `${id}: неизвестная категория ${CATEGORY_OF[id]}`);
  }
  eq(Object.keys(CATEGORY_OF).length, ids.length, 'в карте нет лишних id');
  // разложение теряет и дублирует ровно ничего
  const byCat = categoriesOfBuildings(BUILDINGS);
  const flat = CATEGORIES.flatMap(c => byCat[c.key]);
  eq(flat.length, ids.length, `суммарно карточек ${flat.length}, а зданий ${ids.length}`);
  eq(new Set(flat).size, ids.length, 'дубликаты между категориями');
  eq([...new Set(flat)].sort().join('|'), [...ids].sort().join('|'), 'наборы id разошлись');
});

t('незнакомый id не пропадает, а уходит в запасную категорию', () => {
  eq(categoryOf('такого_нет_нигде'), FALLBACK_CAT);
  // рантайм доливает EXTRA_BUILDINGS (стадии цепочек) в BUILDINGS — проверяем
  // ту же устойчивость на синтетической таблице с лишним зданием.
  const extended = { ...BUILDINGS, chain_stage_x: { name: 'Стадия', cost: { wood: 1 } } };
  const byCat = categoriesOfBuildings(extended);
  const flat = CATEGORIES.flatMap(c => byCat[c.key]);
  eq(flat.length, Object.keys(extended).length, 'расширенная таблица потеряла здания');
  ok(byCat[FALLBACK_CAT].includes('chain_stage_x'), 'лишнее здание попало в запасную категорию');
});

t('у каждого здания есть иконка (неизвестным — запасной кран)', () => {
  for (const id of Object.keys(BUILDINGS)) ok(iconOf(id).length > 0, `${id}: пустая иконка`);
  ok(iconOf('нет_такого') === iconOf(Object.keys(BUILDINGS)[0]) || iconOf('нет_такого').length > 0, 'запасная иконка есть');
  eq(iconOf('campfire'), '🔥');
});

// ---------- 3. Карточка: цена + выработка словами + причина ----------
const RICH = { techs: new Set(['farming']), res: { wood: 100, stone: 100 }, costMult: 1, uniqueAlive: new Set() };

t('доступная карточка: цена бейджами, выработка словами, клик разрешён', () => {
  const m = cardModel('farm', BUILDINGS.farm, RICH);
  eq(m.disabled, false);
  eq(m.clickable, true);
  eq(m.reason, '');
  // цена бейджами: 🪵14 из BUILDINGS.farm.cost
  const b = m.price.find(p => p.icon === '🪵');
  ok(b && b.n === 14, `бейдж дерева с ценой 14, получили ${JSON.stringify(m.price)}`);
  // выработка словами
  ok(m.out.some(s => s.includes('Даёт 🍞3') && s.includes('в день с рабочего')), `строка выработки еды: ${m.out.join(' / ')}`);
  ok(m.out.some(s => s.includes('Рабочих мест: 4')), 'число рабочих мест названо словами');
  const html = cardHtml(m);
  ok(html.includes('data-ft-build="farm"'), 'кликабельная карточка несёт data-ft-build');
  ok(!html.includes('ft-bd-off'), 'доступная карточка не серая');
});

t('недоступная карточка содержит цену, выработку И причину одновременно', () => {
  const POOR = { techs: new Set(), res: {}, costMult: 1, uniqueAlive: new Set() };
  const m = cardModel('farm', BUILDINGS.farm, POOR);
  eq(m.disabled, true);
  eq(m.clickable, false, 'закрытое технологией здание не ставится');
  ok(m.reason.startsWith('Нужна технология: Земледелие'), `причина технологии: ${m.reason}`);
  const html = cardHtml(m);
  ok(html.includes('ft-bd-badge'), 'цена на месте даже у недоступной');
  ok(html.includes('в день с рабочего'), 'выработка на месте');
  ok(html.includes('ft-bd-reason'), 'причина недоступности показана словами');
  ok(!html.includes('data-ft-build'), 'серая карточка без клика');
});

t('дефицитный карточке причина — «Не хватает X» в формате sim.lackCost', () => {
  // Технологии гончарства открыты, но склад почти пуст: только дефицит цены.
  const POOR_BAG = { techs: new Set(['pottery']), res: { wood: 3 }, costMult: 1, uniqueAlive: new Set() };
  const m = cardModel('granary', BUILDINGS.granary, POOR_BAG);
  eq(m.reason, 'Не хватает: 🪵17 🪨8', `формат дефицита как у sim.lackCost: ${m.reason}`);
  eq(m.disabled, true);
  eq(m.clickable, true, 'дорогую карточку можно нажать — призрак ставится и без денег');
});

t('три формата причин: технология / уже построено / не хватает X', () => {
  const none = { techs: new Set(), res: {}, costMult: 1, uniqueAlive: new Set() };
  ok(cardModel('temple', BUILDINGS.temple, none).reason === 'Нужна технология: Теология',
    'имя технологии, а не id');
  // Замок уже стоит и технология открыта — «Уже построено» побеждает кошелёк.
  const built = { techs: new Set(['castles']), res: {}, costMult: 1, uniqueAlive: new Set(['castle']) };
  ok(cardModel('castle', BUILDINGS.castle, built).reason === 'Уже построено', 'уникальное живое');
  const poorRes = { techs: new Set(['pottery']), res: { wood: 3 }, costMult: 1, uniqueAlive: new Set() };
  ok(cardModel('granary', BUILDINGS.granary, poorRes).reason === 'Не хватает: 🪵17 🪨8',
    `формат дефицита как у sim.lackCost: ${cardModel('granary', BUILDINGS.granary, poorRes).reason}`);
  // приоритет причин — как у panel_build: технология важнее кошелька
  ok(cardModel('castle', BUILDINGS.castle,
    { techs: new Set(), res: {}, costMult: 1, uniqueAlive: new Set(['castle']) }).reason.includes('технология'));
});

t('эпоха показана чипом на каждой карточке', () => {
  const m = cardModel('mine', BUILDINGS.mine, RICH);   // req bronze → Бронзовый век
  ok(m.eraRu.length > 0, 'чип эпохи заполнен');
  ok(cardHtml(m).includes(`ft-bd-era">${m.eraRu}`), 'эпоха попала в разметку');
  ok(m.eraRu === 'Бронзовый век', `эпоха шахты: ${m.eraRu}`);
});

t('выработка словами покрывает все числовые поля данных', () => {
  const cases = [
    ['hut', s => s.some(x => x.includes('Жильё для 4 жителей'))],
    ['campfire', s => s.some(x => x.includes('+0.3 в день'))],
    ['granary', s => s.some(x => x.includes('Склад: +300 еды'))],
    ['palisade', s => s.some(x => x.includes('Оборона +2 за сегмент стены'))],
    ['aqueduct', s => s.some(x => x.includes('Счастье: +6 всем'))],
    ['factory', s => s.some(x => x.includes('Тратит 🪨1/день'))],
    ['bank', s => s.some(x => x.includes('Всё золото ×1.25'))],
    ['power_plant', s => s.some(x => x.includes('Промышленность +25%'))],
    ['spire', s => s.some(x => x.includes('Мегапроект'))],
    ['castle', s => s.some(x => x.includes('только один'))],
  ];
  for (const [id, check] of cases) {
    ok(check(effectLines(BUILDINGS[id])), `${id}: строка выработки не найдена`);
  }
  // бесплатные здания получают текстовый бейдж «Бесплатно», а не пустой span
  const badges = priceBadges({}, 1);
  eq(badges[0].ru, 'Бесплатно');
  ok(cardHtml(cardModel('campfire', BUILDINGS.campfire, RICH)).includes('>Бесплатно<'), 'бейдж бесплатности виден');
});

t('карточки всех пяти категорий собираются в одну строку без пустышек', () => {
  const byCat = categoriesOfBuildings(BUILDINGS);
  let totalCards = 0;
  for (const c of CATEGORIES) {
    const html = cardsHtml(byCat[c.key], {});
    const n = (html.match(/ft-bd-card/g) || []).length;
    eq(n, byCat[c.key].length, `${c.ru}: карточек в HTML столько же, сколько id`);
    totalCards += n;
  }
  eq(totalCards, Object.keys(BUILDINGS).length, 'сумма карточек по всем табам равна числу зданий');
});

// ---------- 4. Детерминизм HTML ----------
t('HTML-строки детерминированы: два вызова — одна строка', () => {
  const byCat = categoriesOfBuildings(BUILDINGS);
  for (const c of CATEGORIES) {
    eq(cardsHtml(byCat[c.key], RICH), cardsHtml(byCat[c.key], RICH), c.ru);
  }
  eq(drawerHtml(byCat, 'home'), drawerHtml(byCat, 'home'));
  eq(drawerHtml(byCat, 'home'), drawerHtml(categoriesOfBuildings(BUILDINGS), 'home'),
    'пересборка таблицы не меняет строку');
  // модель тоже стабильна (не тянуть время/случайность в карточки)
  eq(JSON.stringify(cardModel('farm', BUILDINGS.farm, RICH)),
    JSON.stringify(cardModel('farm', BUILDINGS.farm, RICH)));
});

t('drawerHtml: каркас — пять табов, активный подсвечен, крестик на месте', () => {
  const html = drawerHtml(categoriesOfBuildings(BUILDINGS), 'extract');
  eq((html.match(/data-ft-cat="/g) || []).length, 5, 'пять табов-кнопок');
  ok(html.includes('ft-bd-tab ft-bd-on"'), 'активный таб подсвечен классом');
  ok(html.includes('data-ft-cat="extract"'), 'активный передан аргументом');
  ok((html.match(/data-ft-close/g) || []).length === 1, 'один крестик');
  ok(html.includes('ft-bd-list'), 'контейнер списка на месте');
});

// ---------- 5. Правило видимости ----------
t('видимость: стройка+начата+не закрыта+не placing, иначе скрыта', () => {
  const base = { tab: 'build', closed: false, started: true, placing: false };
  eq(drawerVisible(base), true, 'базовый случай открыт');
  eq(drawerVisible({ ...base, tab: 'research' }), false, 'чужая вкладка');
  eq(drawerVisible({ ...base, closed: true }), false, 'закрыта игроком');
  eq(drawerVisible({ ...base, placing: true }), false, 'идёт постановка здания');
  eq(drawerVisible({ ...base, started: false }), false, 'партия не начата');
  eq(drawerVisible(null), false, 'нет состояния — нет шторки');
});

// ---------- 6. Гигиена слоёв: чистая часть без DOM ----------
t('pure/DOM части разделены маркером, в чистой нет document/window', () => {
  // Комментарии выбрасываем: слово «document» в поясняющем тексте — не обращение.
  const noComments = CODE
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');
  const cut = noComments.indexOf('function ensureCss');
  ok(cut > 0, 'DOM-часть начинается с ensureCss');
  ok(CODE.includes('===== DOM-ЧАСТЬ'), 'маркер раздела на месте');
  const pure = noComments.slice(0, cut);
  ok(!/\bdocument\b/.test(pure), 'в чистой части нет document');
  ok(!/\bwindow\b/.test(pure), 'в чистой части нет window');
  ok(!/querySelector|createElement|innerHTML|outerHTML|addEventListener/.test(pure),
    'чистая часть не строит DOM и не слушает события сама');
});

console.log(`\n=== ${pass} OK / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
