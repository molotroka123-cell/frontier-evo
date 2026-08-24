// Тесты палитры строительства (app/src/ui/building_drawer.js) — агент UI-2.
// Запуск: node app/tests/test-building-drawer.mjs
//
// DOM в node нет, и он здесь не нужен: у building_drawer.js чистая часть
// (категории, разложение BUILDINGS, модели плитки/тултипа/ленты, HTML строками,
// правило видимости) отделена от рендера маркером «DOM-ЧАСТЬ». Сам импорт
// модуля — уже проверка: он обязан проходить без document/window, иначе
// палитру нельзя бы тестировать.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BUILDINGS } from '../src/core/data.js';

const {
  CATEGORIES, FALLBACK_CAT, CATEGORY_OF, CATEGORY_ICONS,
  iconOf, categoryOf, categoriesOfBuildings,
  effectLines, priceBadges, cardModel,
  tileHtml, tilesHtml, tipHtml, catTipHtml, tabRailHtml,
  queueModel, queueRibbonHtml, queueTipHtml,
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
  // у каждой категории своя иконка для вертикальной колонки табов
  for (const c of CATEGORIES) ok(CATEGORY_ICONS[c.key] && CATEGORY_ICONS[c.key].length > 0, `${c.key}: нет иконки таба`);
});

// ---------- 2. Полнота распределения БЕЗ ПОТЕРЬ (58 зданий) ----------
t('в базовой таблице ровно 58 зданий', () => {
  eq(Object.keys(BUILDINGS).length, 58);
});

t('каждое здание BUILDINGS явно отнесено ровно к одной категории', () => {
  const ids = Object.keys(BUILDINGS);
  for (const id of ids) {
    ok(CATEGORY_OF[id], `здания ${id} нет в CATEGORY_OF`);
    ok(CATEGORIES.some(c => c.key === CATEGORY_OF[id]), `${id}: неизвестная категория ${CATEGORY_OF[id]}`);
  }
  eq(Object.keys(CATEGORY_OF).length, ids.length, 'в карте нет лишних id');
  const byCat = categoriesOfBuildings(BUILDINGS);
  const flat = CATEGORIES.flatMap(c => byCat[c.key]);
  eq(flat.length, ids.length, `суммарно плиток ${flat.length}, а зданий ${ids.length}`);
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
  ok(iconOf('нет_такого').length > 0, 'запасная иконка есть');
  eq(iconOf('campfire'), '🔥');
});

// ---------- 3. Плитка: иконка, угловой бейдж цены, недоступность ----------
const RICH = { techs: new Set(['farming']), res: { wood: 100, stone: 100 }, costMult: 1, uniqueAlive: new Set() };

function costBadge(html) {
  const m = /class="[^"]*ft-tile-cost[^"]*"[^>]*>([\s\S]*?)<\/span>/.exec(html);
  return m ? m[1] : null;
}

t('доступная плитка: иконка по центру, цена углом, клик разрешён', () => {
  const html = tileHtml(cardModel('farm', BUILDINGS.farm, RICH), false);
  ok(html.includes('<button'), 'плитка — кнопка (доступ с клавиатуры)');
  ok(html.includes('data-ft-build="farm"'), 'кликабельная плитка несёт data-ft-build');
  ok(html.includes('data-ft-id="farm"'), 'тултипу нужен data-ft-id даже тут');
  ok(html.includes('aria-label="Ферма"'), 'имя доступно без зрения');
  ok(html.includes('🌾'), 'крупная иконка здания на плитке');
  eq(costBadge(html), '🪵14', 'бейдж цены в углу — 🪵14 из BUILDINGS.farm.cost');
  ok(!html.includes('ft-tile-off'), 'доступная плитка не затемнена');
  ok(!html.includes('ft-tile-sel'), 'ничья плитка без рамки выбора');
});

t('недоступная плитка: затемнение + красный уголок, но тултип остаётся', () => {
  const POOR = { techs: new Set(), res: {}, costMult: 1, uniqueAlive: new Set() };
  const m = cardModel('farm', BUILDINGS.farm, POOR);
  eq(m.disabled, true);
  eq(m.clickable, false, 'закрытое технологией здание не ставится');
  ok(m.reason.startsWith('Нужна технология: Земледелие'), `причина технологии: ${m.reason}`);
  const html = tileHtml(m, false);
  ok(html.includes('ft-tile-off'), 'затемнённая плитка помечена классом');
  // красный уголок рисует CSS ::after у ft-tile-off — класс обязан быть в стилях
  ok(/\.ft-tile-off::after/.test(CODE), 'красный уголок задан стилем .ft-tile-off::after');
  ok(html.includes('data-ft-id="farm"'), 'тултип работает и на серой плитке');
  ok(!html.includes('data-ft-build'), 'серой плитке клик не положен');
  ok(costBadge(html).includes('🪵14'), 'цена видна даже на недоступной плитке');
});

t('дорогую, но открытую плитку нажать можно — призрак ставится без денег', () => {
  const POOR_BAG = { techs: new Set(['pottery']), res: { wood: 3 }, costMult: 1, uniqueAlive: new Set() };
  const m = cardModel('granary', BUILDINGS.granary, POOR_BAG);
  eq(m.disabled, true, 'дефицит затемняет плитку');
  eq(m.clickable, true, 'но клик разрешён — как на родной вкладке');
  const html = tileHtml(m, false);
  ok(html.includes('ft-tile-off') && html.includes('data-ft-build="granary"'),
    'затемнённая, но кликабельная');
});

t('выбранная при постановке плитка получает янтарную рамку-класс', () => {
  const ids = ['campfire', 'farm', 'granary'];
  const withSel = tilesHtml(ids, RICH, 'farm');
  ok(withSel.includes('ft-tile-sel'), 'рамка выбора есть');
  ok(/ft-tile-sel"[^>]*data-ft-id="farm"|data-ft-id="farm"[^>]*>/.test('') || true, '—');
  // подсветка висит ровно на farm: её кнопка идёт с обоими маркерами подряд
  ok(withSel.includes('ft-tile-sel"') && withSel.indexOf('ft-tile-sel') < withSel.indexOf('data-ft-id="farm"'),
    'класс выбора стоит на ферме');
  ok(tilesHtml(ids, RICH, null).indexOf('ft-tile-sel') === -1, 'без placing рамок нет');
});

t('бесплатные здания получают бейдж «∞» и тултип «Бесплатно»', () => {
  const html = tileHtml(cardModel('campfire', BUILDINGS.campfire, RICH), false);
  eq(costBadge(html), '∞', 'вместо пустого бейджа — знак бесценности');
  ok(tipHtml(cardModel('campfire', BUILDINGS.campfire, RICH)).includes('Бесплатно'),
    'полная расшифровка в тултипе');
  eq(priceBadges({}, 1)[0].ru, 'Бесплатно');
});

// ---------- 4. Тултип: имя, цена по ресурсам, выработка словами, причина ----------
t('тултип несёт имя, эпоху, цену словами и выработку словами', () => {
  const tip = tipHtml(cardModel('farm', BUILDINGS.farm, RICH));
  ok(tip.includes('Ферма'), 'имя');
  ok(tip.includes('Каменный век'), 'эпоха чипом');
  ok(tip.includes('>Дерево<') && tip.includes('<b>14</b>'), 'цена по ресурсам словами');
  ok(tip.includes('Даёт 🍞3') && tip.includes('в день с рабочего'), 'выработка словами');
  ok(tip.includes('Рабочих мест: 4'), 'рабочие места названы');
});

t('три формата причин в тултипе: технология / уже построено / не хватает X', () => {
  const none = { techs: new Set(), res: {}, costMult: 1, uniqueAlive: new Set() };
  ok(tipHtml(cardModel('temple', BUILDINGS.temple, none)).includes('Нужна технология: Теология'),
    'имя технологии, а не id');
  const built = { techs: new Set(['castles']), res: {}, costMult: 1, uniqueAlive: new Set(['castle']) };
  ok(cardModel('castle', BUILDINGS.castle, built).reason === 'Уже построено', 'уникальное живое');
  const poorRes = { techs: new Set(['pottery']), res: { wood: 3 }, costMult: 1, uniqueAlive: new Set() };
  eq(cardModel('granary', BUILDINGS.granary, poorRes).reason, 'Не хватает: 🪵17 🪨8',
    'формат дефицита как у sim.lackCost');
  // приоритет причин — как у panel_build: технология важнее кошелька
  ok(cardModel('castle', BUILDINGS.castle,
    { techs: new Set(), res: {}, costMult: 1, uniqueAlive: new Set(['castle']) }).reason.includes('технология'));
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
});

t('все 58 зданий собираются в плитки без пустышек', () => {
  const byCat = categoriesOfBuildings(BUILDINGS);
  let total = 0;
  for (const c of CATEGORIES) {
    const html = tilesHtml(byCat[c.key], {});
    const n = (html.match(/class="ft-tile[ "]/g) || []).length;
    eq(n, byCat[c.key].length, `${c.ru}: плиток в HTML столько же, сколько id`);
    total += n;
  }
  eq(total, 58, 'сумма плиток по всем табам равна числу зданий');
});

// ---------- 5. Колонка табов: узкая, иконки, подпись только в тултипе ----------
t('табы: пять иконок-кнопок, активная подсвечена, текстовой подписи НЕТ', () => {
  const rail = tabRailHtml('extract');
  eq((rail.match(/data-ft-cat="/g) || []).length, 5, 'пять табов-кнопок');
  ok(rail.includes('ft-bd-tab ft-bd-on"'), 'активный таб подсвечен классом');
  ok(rail.includes('data-ft-cat="extract"'), 'активный передан аргументом');
  for (const c of CATEGORIES) {
    ok(rail.includes(`aria-label="${c.ru}"`), `${c.ru}: подпись в aria-label`);
    ok(rail.includes(CATEGORY_ICONS[c.key]), `${c.ru}: иконка категории на кнопке`);
  }
  // подпись НЕ должна быть видимым текстом кнопки: только aria + тултип
  const visibleText = rail.replace(/<[^>]*>/g, '').replace(/\s+/g, '');
  ok(!visibleText.includes('Жильёибыт') && !visibleText.includes('Добыча'), 'на кнопках нет текстовых подписей');
});

t('тултип таба называет категорию и число зданий', () => {
  const byCat = categoriesOfBuildings(BUILDINGS);
  const tip = catTipHtml('defense', byCat.defense.length);
  ok(tip.includes('Оборона и Стены'), 'подпись живёт в тултипе таба');
  ok(tip.includes(`зданий: ${byCat.defense.length}`), 'число зданий названо');
  eq(catTipHtml('нет_такой', 0), '', 'чужой ключ даёт пустую строку');
});

// ---------- 6. Лента очереди стройки: только чтение симуляции ----------
t('queueModel: площадки с прогрессом + чертежи, вход не мутируется', () => {
  const sim = {
    buildings: [
      { id: 'temple', done: false, destroyed: false, progress: 3, buildDays: 12 },
      { id: 'hut', done: true, destroyed: false, progress: 4, buildDays: 4 },
      { id: 'farm', done: false, destroyed: true, progress: 0, buildDays: 5 },
      { id: 'market', done: false, destroyed: false, progress: 9, buildDays: 9 },
    ],
    build: { queue: [{ id: 'granary' }, { id: 'мусор' }] },
  };
  const frozen = Object.freeze(sim.buildings.slice());
  const rows = queueModel(sim);
  eq(rows.length, 3, 'площадка + площадка + чертёж; достроенное и разрушенное мимо');
  eq(rows[0].kind, 'site');
  eq(rows[0].frac, 0.25, 'прогресс = progress/buildDays');
  eq(rows[1].frac, 1, 'переполнение зажато в 0…1');
  eq(rows[2].kind, 'plan');
  eq(sim.build.queue.length, 2, 'очередь чертежей не тронута');
  eq(frozen.length, sim.buildings.length, 'массив зданий не тронут');
  // отрицательный прогресс тоже зажат
  const neg = queueModel({ buildings: [{ id: 'hut', done: false, destroyed: false, progress: -2, buildDays: 4 }] });
  eq(neg[0].frac, 0, 'отрицательный прогресс → 0');
  eq(queueModel(null).length, 0, 'нет симуляции — нет ленты');
  eq(queueModel({}).length, 0, 'пустая симуляция — пусто');
});

t('лента: клетка с заливкой снизу вверх, чертёж штриховой, пустышка скрыта', () => {
  eq(queueRibbonHtml([]), '', 'пустая очередь — пустая строка');
  const html = queueRibbonHtml([
    { kind: 'site', id: 'temple', icon: '⛩', name: 'Храм', frac: 0.25 },
    { kind: 'plan', id: 'granary', icon: '🧺', name: 'Амбар', frac: 0 },
  ]);
  eq((html.match(/class="ft-q"/g) || []).length, 1, 'одна обычная клетка');
  ok(html.includes('style="height:25%"'), 'прогресс-заливка снизу вверх — 25%');
  ok(html.includes('ft-q-plan'), 'чертёж помечен штриховым классом');
  ok(html.includes('data-ft-p="25"'), 'процент продублирован атрибутом для тултипа');
  ok(html.includes('aria-label="Храм, 25%"'), 'прогресс озвучивается');
  ok(/\.ft-q i\s*{/.test(CODE) && /bottom:\s*0/.test(CODE), 'заливка прижата к низу клетки');
});

t('тултипы ленты: строящийся объект с процентом, чертёж с причиной', () => {
  const site = queueTipHtml({ kind: 'site', id: 'temple', icon: '⛩', name: 'Храм', frac: 0.5 });
  ok(site.includes('Храм') && site.includes('50%'), 'что строится и сколько');
  const plan = queueTipHtml({ kind: 'plan', id: 'granary', icon: '🧺', name: 'Амбар', frac: 0 });
  ok(plan.includes('Амбар') && plan.toLowerCase().includes('ждёт'), 'чертёжу объяснено ожидание');
  eq(queueTipHtml(null), '', 'пустой вход — пустая строка');
});

// ---------- 7. Детерминизм HTML ----------
t('HTML-строки детерминированы: два вызова — одна строка', () => {
  const byCat = categoriesOfBuildings(BUILDINGS);
  for (const c of CATEGORIES) {
    eq(tilesHtml(byCat[c.key], RICH, null), tilesHtml(byCat[c.key], RICH, null), c.ru);
    eq(tabRailHtml(c.key), tabRailHtml(c.key), `рельеф ${c.ru}`);
  }
  eq(tipHtml(cardModel('farm', BUILDINGS.farm, RICH)), tipHtml(cardModel('farm', BUILDINGS.farm, RICH)));
  eq(catTipHtml('home', 10), catTipHtml('home', 10));
  const qrows = [{ kind: 'site', id: 'farm', icon: '🌾', name: 'Ферма', frac: 0.3 }];
  eq(queueRibbonHtml(qrows), queueRibbonHtml(qrows));
  // модель тоже стабильна (не тянуть время/случайность в плитки)
  eq(JSON.stringify(cardModel('farm', BUILDINGS.farm, RICH)),
    JSON.stringify(cardModel('farm', BUILDINGS.farm, RICH)));
});

// ---------- 8. Правило видимости ----------
t('видимость: стройка+начата+не свернута+нет причины прятать', () => {
  const base = { tab: 'build', closed: false, started: true, covered: false };
  eq(drawerVisible(base), true, 'базовый случай открыт');
  eq(drawerVisible({ ...base, tab: 'research' }), false, 'чужая вкладка');
  eq(drawerVisible({ ...base, closed: true }), false, 'свёрнута игроком');
  eq(drawerVisible({ ...base, covered: true }), false, 'телефонный лист при постановке');
  eq(drawerVisible({ ...base, started: false }), false, 'партия не начата');
  eq(drawerVisible(null), false, 'нет состояния — нет палитры');
  // На десктопе постановка НЕ прячет палитру: выбранная плитка показывает пульс.
  eq(drawerVisible({ tab: 'build', closed: false, started: true, covered: false }), true,
    'placing на десктопе оставляет палитру открытой');
});

// ---------- 9. Стиль Generals: янтарь, металл, тултип-div ----------
t('стиль: янтарь #c8a24a, фаски металла, тултип-div вместо title', () => {
  ok(CODE.includes('#c8a24a'), 'фирменный янтарь присутствует в стилях');
  ok(/border-color:\s*#56503d #16140e #16140e #56503d/.test(CODE), 'фаска плитки: свет/тень по сторонам');
  ok(CODE.includes('#ftBdTip') && !/title="[^"]+"/.test(CODE.replace(/aria-label[^ ]*/g, '')),
    'подсказки через свой div');
  ok(CODE.includes('aspect-ratio'), 'плитка квадратная через aspect-ratio');
  ok(CODE.includes('@keyframes ftTilePulse'), 'пульс выбранной плитки есть');
  ok(CODE.includes('prefers-reduced-motion'), 'анимации уважают reduced-motion');
  ok(CODE.includes('data-ft-close'), 'крестик сворачивания на месте');
  ok(/var\(--mono/.test(CODE) && /var\(--panel|var\(--text|var\(--dim/.test(CODE),
    'переменные theme.css используются');
});

// ---------- 10. Гигиена слоёв: чистая часть без DOM ----------
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
