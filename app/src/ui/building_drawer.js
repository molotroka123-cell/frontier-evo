// ui/building_drawer.js — выдвижная шторка строительства «ФРОНТИР» (агент 19).
//
// ЗАЧЕМ. Вкладка «Стройка» в правой панели перегружена: ~58 зданий сплошным
// списком по эпохам. Шторка — тот же выбор здания, но с категориями-табами
// («Жильё и Быт», «Добыча и Склады», «Мастерские», «Оборона и Стены», «Культ
// и Чудеса») и крупными карточками: иконка, цена бейджами, выработка словами,
// серые недоступные с причиной. НИ ОДНОЙ новой механики выбора здесь нет.
//
// ПРАВИЛА СЛОЯ (те же, что у ui/dock.js):
//   • клик по карточке зовёт СУЩЕСТВУЮЩУЮ функцию выбора здания —
//     hud.cb.startPlacing(id), которую main.js передал в hud.bind() и которую
//     дёргает родная вкладка «Стройка» (bindPanel → [data-build], hud.js);
//     своего размещения шторка не заводит вовсе;
//   • открытие подслушивается ОПРОСОМ hud.tab (250 мс), а не правкой чужого
//     кода: Command Dock (ui/dock.js) открывает стройку через hud.setTab('build')
//     и событий наружу не шлёт, родные вкладки и клавиша B ведут себя так же —
//     опрос одного поля ловит ВСЕ пути входа в стройку сразу;
//   • ядро симуляции не мутируется ни одним байтом: читаются только
//     window.__frontier.hud/.sim (их заводит main.js);
//   • файл самодостаточен: CSS инжектится <style> по образцу ensureCss из
//     ui/menuskin.js, повторный запуск гасится флагом на window;
//   • импорт модуля в node безопасен: вся DOM-часть спрятана за проверкой
//     typeof document — чистые функции тестируются без подставного DOM.
//
// ПОЧЕМУ КАТЕГОРИИ ЯВНО ТАБЛИЦЕЙ. Категория — это решение дизайнера, а не
// выводимое поле: у BUILDINGS нет атрибута «класс», и выводить его из полей
// (out/housing/wall…) значило бы получать «Храм → счастье → Жильё и Быт».
// Поэтому явная карта id→категория ниже, а незнакомым id назначается запасная
// категория «Мастерские»: туда на работающем фронте попадают стадии
// производственных цепочек (EXTRA_BUILDINGS доливаются в BUILDINGS рантаймом
// в wire_production.js) — это всё производственные здания, потерь не бывает.

import { RES, ERAS, TECHS, BUILDINGS } from '../core/data.js';

// ===== ЧИСТАЯ ЧАСТЬ (без DOM; ниже маркер DOM-части — тесты сканируют её) =====

// Порядок табов = порядок в задании; ключи короткие, чтобы жить в data-атрибутах.
export const CATEGORIES = [
  { key: 'home',      ru: 'Жильё и Быт' },
  { key: 'extract',   ru: 'Добыча и Склады' },
  { key: 'workshops', ru: 'Мастерские' },
  { key: 'defense',   ru: 'Оборона и Стены' },
  { key: 'culture',   ru: 'Культ и Чудеса' },
];

// Запасная категория для id вне явной карты (см. комментарий выше: стадии
// производственных цепочек — производственные здания).
export const FALLBACK_CAT = 'workshops';

// Явная карта «id → категория». Каждое здание из BUILDINGS ровно один раз;
// распределение держится рядом с этой таблицей и тестируется на полноту,
// так что новое здание без категории тест зазвенит сразу.
export const CATEGORY_OF = {
  // — Жильё и Быт: крыша над головой и повседневная жизнь (лечебницы и
  //   канализация тут, а не в «Мастерских», потому что игрок ищет их словом
  //   «быт», а не «производство»).
  campfire:    'home', hut:         'home', story_fire:  'home',
  stone_house: 'home', apartment:   'home', skyscraper:  'home',
  aqueduct:    'home', sewers:      'home', clinic:      'home', hospital: 'home',
  // — Добыча и Склады: сырьё, еда и потолки склада. Торговля и финансы тоже
  //   здесь: рынок/банк/сокровищница «добывают» золото как шахта — камень,
  //   отдельной экономической категории в шторке нет.
  forager:     'extract', lumber:  'extract', quarry:   'extract',
  hunter_lodge:'extract', pasture: 'extract', farm:     'extract',
  mill:        'extract', port:    'extract', mine:     'extract',
  granary:     'extract', woodshed:'extract', stoneyard:'extract', depot: 'extract',
  market:      'extract', treasury:'extract', bank:     'extract',
  stock_exchange:'extract', guild_hall:'extract', shipyard:'extract',
  train_station:'extract', airport:'extract',
  // — Мастерские: тяжёлое производство и энергетика (паровая и далее).
  smithy:      'workshops', workshop:'workshops', factory:'workshops',
  robo_factory:'workshops', foundry:'workshops', power_plant:'workshops',
  npp:         'workshops', solar:   'workshops', fusion_reactor:'workshops',
  // — Оборона и Стены: военные постройки; Замок здесь, а не в «Жилье», хоть он
  //   даёт и жильё — игрок ищет его по слову «оборона».
  palisade:    'defense', stone_walls:'defense', barracks:'defense',
  armory:      'defense', castle:     'defense',
  // — Культ и Чудеса: вера, зрелища, наука и финальные мегапроекты. Наука
  //   (академии, лаборатории, ИИ) живёт здесь, а не в «Мастерских»: знания в
  //   ФРОНТИРЕ — культурный путь к Шпилю, и искать Университет игрок идёт
  //   вместе с Храмом, а не с Кузницей.
  temple:      'culture', amphitheater:'culture', media_tower:'culture',
  academy:     'culture', university:  'culture', press:      'culture',
  observatory: 'culture', lab:         'culture', datacenter: 'culture',
  biolab:      'culture', ai_core:     'culture', spaceport:  'culture',
  spire:       'culture',
};

// Иконки карточек. У BUILDINGS своего поля иконки нет, рисовать канвас-спрайты
// ради списка — из пушки; эмодзи из стандартного набора читаются офлайн.
const ICONS = {
  campfire: '🔥', hut: '🛖', forager: '🌿', lumber: '🪓', quarry: '⛏️',
  story_fire: '🎶', hunter_lodge: '🏹', pasture: '🐄', farm: '🌾',
  granary: '🧺', woodshed: '🪵', stoneyard: '🪨', depot: '📦', mine: '⚒️',
  smithy: '🔨', market: '🏪', stone_house: '🏠', palisade: '🚧',
  barracks: '⚔', armory: '🛡', treasury: '💰', port: '⚓', aqueduct: '🌉',
  temple: '⛩', clinic: '⚕️', amphitheater: '🎭', academy: '🏛️',
  castle: '🏰', university: '🎓', mill: '🌀', guild_hall: '🧰', bank: '🏦',
  stone_walls: '🧱', press: '🖨️', observatory: '🔭', shipyard: '⛵',
  foundry: '🔩', workshop: '🧵', train_station: '🚂', factory: '🏭',
  sewers: '🚰', stock_exchange: '📈', power_plant: '⚡', lab: '🧪',
  apartment: '🏢', media_tower: '📡', hospital: '🏥', airport: '✈️',
  npp: '☢️', datacenter: '💾', solar: '🔆', robo_factory: '🤖',
  biolab: '🧬', skyscraper: '🌆', ai_core: '🧠', fusion_reactor: '⚛️',
  spaceport: '🚀', spire: '🗼',
};
// Стадии цепочек (EXTRA_BUILDINGS) и любые будущие здания получают кран —
// карточка без иконки выглядит как баг, кран выглядит как «стройка».
const ICON_FALLBACK = '🏗';

export function iconOf(id) { return ICONS[id] || ICON_FALLBACK; }

export function categoryOf(id) { return CATEGORY_OF[id] || FALLBACK_CAT; }

// Полное разложение таблицы зданий по категориям БЕЗ потерь: порядок внутри
// категории наследует порядок BUILDINGS (эпохи идут по возрастанию), а любой
// id, которого нет в CATEGORY_OF, уходит в запасную категорию — поэтому на
// фронте, где BUILDINGS расширены EXTRA_BUILDINGS, потерь тоже не бывает.
export function categoriesOfBuildings(table) {
  const out = {};
  for (const c of CATEGORIES) out[c.key] = [];
  for (const id of Object.keys(table || {})) out[categoryOf(id)].push(id);
  return out;
}

// Родительный падеж для строки склада: «+300 к максимуму ЕДЫ», а не «едa».
const GEN = { food: 'еды', wood: 'дерева', stone: 'камня', steel: 'стали', gold: 'золота', knowledge: 'знаний' };

function meta(r) { return RES.find(q => q.id === r); }

// Эпоха здания = эпоха, которую ОТКРЫВАЕТ его технология-требование, а не та,
// во время которой технология появилась. Готовый BUILDING_ERA_IDX из data.js
// тут не годится: он берёт счётчик эпох ДО строки с полем era, и Шахта
// (req: bronze) получала бы «Каменный век». Чип на карточке обязан говорить
// языком игрока: бронза — это Бронзовый век.
const ERA_OF_TECH = (() => {
  const m = {}; let e = 0;
  for (const t of TECHS) { if (t.era) e++; m[t.id] = e; }
  return m;
})();

// Числа как в hud.num: целые без хвоста, дробные с одним знаком — иначе
// «2.1999999999» из плавающей точки расползается по карточкам.
function fmt(v) { return Number.isInteger(v) ? String(v) : String(+v.toFixed(1)); }

// Выработка словами: одна строка на смысл, без пиктограмм-загадок. Берём
// только реально существующие поля BUILDINGS — ничего не придумываем.
export function effectLines(def) {
  const L = [];
  if (def.out) {
    for (const [r, v] of Object.entries(def.out)) {
      const m = meta(r);
      L.push(`Даёт ${(m && m.icon) || r}${fmt(v)} в день с рабочего`);
    }
    if (def.workers) L.push(`Рабочих мест: ${def.workers}`);
  }
  if (def.know) L.push(`Знания поселению: +${fmt(def.know)} в день`);
  if (def.housing) L.push(`Жильё для ${def.housing} жителей`);
  if (def.happy) L.push(`Счастье: +${def.happy} всем`);
  if (def.cap) L.push('Склад: ' + Object.entries(def.cap).map(([r, v]) => `+${v} ${GEN[r] || r}`).join(', '));
  if (def.defense) L.push(def.wall ? `Оборона +${def.defense} за сегмент стены` : `Оборона +${def.defense}`);
  if (def.wall && !def.defense) L.push(`Прочность стены: ${def.wall}`);
  if (def.medicine) L.push(`Болезни ×${fmt(def.medicine)}`);
  if (def.industry) L.push(`Промышленность ${def.industry >= 1 ? '+' : ''}${Math.round((def.industry - 1) * 100)}%`);
  // Множители печатаются как есть из данных (×1.15, ×1.25): округление до
  // одного знака превратило бы честные «×1.25» в «×1.3» — карточка стала бы
  // спорить с описанием технологии.
  if (def.goldMult) L.push(`Всё золото ×${def.goldMult}`);
  if (def.armyMult) L.push(`Сила армии ×${def.armyMult}`);
  if (def.caravanMult) L.push(`Караваны ×${def.caravanMult}`);
  if (def.birthMult) L.push(`Рождаемость ×${def.birthMult}`);
  if (def.marketBoost) L.push(`Курсы рынка ×${def.marketBoost}`);
  if (def.radiusBonus) L.push(`Радиусы эффектов +${def.radiusBonus}`);
  if (def.consume) L.push('Тратит ' + Object.entries(def.consume).map(([r, v]) => `${(meta(r) || {}).icon || r}${fmt(v)}/день`).join(' '));
  if (def.aura) L.push(`Аура: радиус ${def.aura.r}, множитель ×${fmt(def.aura.gather || def.aura.farm)}`);
  if (def.special === 'train') L.push('Обучает бойцов за еду и золото');
  if (def.special === 'missions') L.push('Миссии: Луна и Марс');
  if (def.special === 'spire') L.push('Мегапроект: 5 стадий');
  if (def.unique) L.push('Можно построить только один');
  return L;
}

// Цена бейджами: ceil(v × costMult) — та же арифметика, что у hud.costStr и
// sim.lackCost, иначе карточка обещала бы одну цену, а списывалась другая.
export function priceBadges(cost, costMult) {
  const m = costMult || 1;
  const rows = Object.entries(cost || {});
  if (!rows.length) return [{ icon: '', ru: 'Бесплатно', n: '' }];
  return rows.map(([r, v]) => {
    const md = meta(r);
    return { icon: (md && md.icon) || r, ru: (md && md.ru) || r, n: Math.ceil(v * m) };
  });
}

// Чего не хватает, в формате sim.lackCost: «🪵5 🪨2» — дефицит с учётом того,
// что уже лежит на складе. Дублируем формулу честно (ceil нужного минус floor
// имеющегося), потому что чистая функция не может трогать симуляцию.
function lackStr(cost, res, m) {
  const parts = [];
  for (const [r, v] of Object.entries(cost || {})) {
    const need = Math.ceil(v * m);
    const have = Math.floor((res && res[r]) || 0);
    if (have < need) {
      const md = meta(r);
      parts.push(`${(md && md.icon) || r}${need - have}`);
    }
  }
  return parts.length ? parts.join(' ') : null;
}

// Модель карточки. ctx — снимок состояния, а не симуляция: { techs: Set-подобный
// с .has(), res, costMult, uniqueAlive }. Приоритет причин копирует panel_build
// (hud.js): технология → уже построено → не хватает. Отдельного «эпохального»
// замка у зданий в ФРОНТИРЕ нет — эпоха приходит через технологию, поэтому она
// показана постоянным чипом справа в шапке карточки.
export function cardModel(id, def, ctx) {
  const c = ctx || {};
  const techs = c.techs || { has: () => false };
  const alive = c.uniqueAlive || { has: () => false };
  const locked = !!(def.req && !techs.has(def.req));
  const built = !!(def.unique && alive.has(id));
  const lack = lackStr(def.cost, c.res, c.costMult || 1);
  let reason = '';
  if (locked) {
    // Имя технологии берём прямо из TECHS: игроку показываются слова игры
    // («Земледелие»), а не служебные id.
    const t = TECHS.find(q => q.id === def.req);
    reason = `Нужна технология: ${t ? t.name : def.req}`;
  } else if (built) reason = 'Уже построено';
  else if (lack) reason = `Не хватает: ${lack}`;
  const eraIdx = def.req ? (ERA_OF_TECH[def.req] ?? 0) : 0;
  return {
    id,
    name: def.name,
    icon: iconOf(id),
    eraRu: (ERAS[eraIdx] || {}).ru || '',
    price: priceBadges(def.cost, c.costMult),
    out: effectLines(def),
    desc: def.desc || '',
    disabled: locked || built || !!lack,
    // Кликабельность — ровно как у родной вкладки: панель строить даёт и без
    // полного кошелька (призрак ставится, деньги спросят при подтверждении).
    clickable: !locked && !built,
    reason,
  };
}

export function cardHtml(m) {
  // Бесплатные здания (cost {} — Кострище, Шпиль) получают текстовый бейдж,
  // иначе span с пустой строкой схлопнется в невидимую точку.
  const badges = m.price.map(b =>
    `<span class="ft-bd-badge" title="${b.ru}">${b.n === '' ? b.ru : b.icon + b.n}</span>`).join('');
  const outs = m.out.map(s => `<div>${s}</div>`).join('');
  return `<div class="ft-bd-card${m.disabled ? ' ft-bd-off' : ''}"${m.clickable ? ` data-ft-build="${m.id}"` : ''} role="button">
    <div class="ft-bd-head"><span class="ft-bd-ic" aria-hidden="true">${m.icon}</span>`
    + `<span class="ft-bd-name">${m.name}</span><span class="ft-bd-era">${m.eraRu}</span></div>`
    + `<div class="ft-bd-price">${badges}</div>`
    + (outs ? `<div class="ft-bd-out">${outs}</div>` : '')
    + (m.desc ? `<div class="ft-bd-desc">${m.desc}</div>` : '')
    + (m.reason ? `<div class="ft-bd-reason">${m.reason}</div>` : '')
    + `</div>`;
}

// Карточки одной категории одной строкой. Отдельно от drawerHtml, потому что
// DOM-часть перерисовывает ТОЛЬКО список (шапку и табы трогать незачем), а
// скролл списка не должен сбрасываться при каждом тике ресурсов.
export function cardsHtml(ids, ctx) {
  return (ids || []).map(id => {
    const def = BUILDINGS[id];
    // Незнакомый id (сейв из будущего, рассинхрон веток) молча пропускаем:
    // пустая карточка хуже отсутствующей.
    return def ? cardHtml(cardModel(id, def, ctx)) : '';
  }).join('');
}

// Вся внутренность шторки одной строкой: шапка с крестиком, табы категорий,
// карточки активной категории. Чистая функция ради детерминизм-теста; DOM-часть
// собирает каркас сама, а контент берёт из cardsHtml со свежим снимком state.
export function drawerHtml(byCat, activeKey) {
  const tabs = CATEGORIES.map(c =>
    `<button type="button" class="ft-bd-tab${c.key === activeKey ? ' ft-bd-on' : ''}"
      data-ft-cat="${c.key}">${c.ru}</button>`).join('');
  const cards = cardsHtml((byCat[activeKey] || []), {});
  return `<div class="ft-bd-top"><span class="ft-bd-title">🏗 Строительство</span>`
    + `<button type="button" class="ft-bd-x" data-ft-close aria-label="Свернуть шторку">×</button></div>`
    + `<div class="ft-bd-tabs">${tabs}</div>`
    + `<div class="ft-bd-list">${cards}</div>`;
}

// Видима ли шторка. Всё состояние — аргументы: шторка обязана исчезать, пока
// идёт постановка здания (внизу свои ✓/✗) и пока не начата партия.
export function drawerVisible(st) {
  return !!st && st.tab === 'build' && !st.closed && !!st.started && !st.placing;
}

// ===== DOM-ЧАСТЬ (браузер; в node не исполняется) =====

// Брейкпоинт телефона — тот же 820px, что в index.html и у дока; константу не
// импортируем из dock.js, чтобы шторка не зависела от соседа целиком.
function ensureCss() {
  if (document.getElementById('ft-bd-css')) return;
  const st = document.createElement('style');
  st.id = 'ft-bd-css';
  st.textContent = `
#ftBDrawer {
  position: fixed; left: 10px; top: 64px; bottom: 78px; width: 348px; z-index: 32;
  display: flex; flex-direction: column;
  background: var(--panel, rgba(20, 18, 16, 0.92));
  border: 1px solid var(--panel-border, rgba(201, 162, 39, 0.35));
  border-radius: var(--radius, 12px);
  color: var(--text, #ece5d3);
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(201, 162, 39, 0.14);
  transform: translateX(-116%); opacity: 0; visibility: hidden; pointer-events: none;
  transition: transform 0.22s ease, opacity 0.18s ease, visibility 0s linear 0.18s;
}
#ftBDrawer.open {
  transform: none; opacity: 1; visibility: visible; pointer-events: auto;
  transition: transform 0.22s ease, opacity 0.18s ease;
}
@media (prefers-reduced-motion: reduce) { #ftBDrawer { transition: none; } }
.ft-bd-top {
  display: flex; align-items: center; gap: 8px; padding: 10px 12px;
  border-bottom: 1px solid var(--gold-faint, rgba(201, 162, 39, 0.14));
  font-family: var(--serif, Georgia, serif); letter-spacing: 0.5px;
}
.ft-bd-x {
  margin-left: auto; width: 26px; height: 26px; border-radius: 8px;
  background: rgba(236, 229, 211, 0.05); color: var(--dim, #a89f8e);
  border: 1px solid var(--gold-line, rgba(201, 162, 39, 0.35));
  cursor: pointer; font-size: 15px; line-height: 1;
}
.ft-bd-x:hover { color: var(--text, #ece5d3); background: rgba(201, 162, 39, 0.16); }
.ft-bd-tabs { display: flex; flex-wrap: wrap; gap: 4px; padding: 8px 10px; border-bottom: 1px solid var(--gold-faint, rgba(201, 162, 39, 0.14)); }
.ft-bd-tab {
  padding: 4px 9px; border-radius: 999px; cursor: pointer;
  font-size: 10px; font-weight: 600; letter-spacing: 0.3px; font-family: inherit;
  background: rgba(236, 229, 211, 0.04); color: var(--dim, #a89f8e);
  border: 1px solid rgba(201, 162, 39, 0.18);
}
.ft-bd-tab:hover { color: var(--text, #ece5d3); }
.ft-bd-tab.ft-bd-on {
  background: var(--accent, #c9a227); color: #1c1608;
  border-color: var(--accent, #c9a227);
}
.ft-bd-list {
  overflow-y: auto; padding: 8px; display: grid;
  grid-template-columns: 1fr 1fr; gap: 8px; align-content: start;
  scrollbar-width: thin; scrollbar-color: var(--gold-line, rgba(201,162,39,.35)) transparent;
}
.ft-bd-card {
  background: rgba(236, 229, 211, 0.04);
  border: 1px solid rgba(201, 162, 39, 0.18);
  border-radius: 10px; padding: 8px; min-width: 0;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}
@media (hover: hover) and (pointer: fine) {
  .ft-bd-card[data-ft-build]:hover { border-color: var(--accent, #c9a227); background: rgba(201, 162, 39, 0.09); }
}
/* Недоступное — серым и без курсора-руки, но кликабельные «дорогие» карточки
   остаются нажимаемыми: так же ведёт себя родная вкладка «Стройка». */
.ft-bd-off { opacity: 0.55; filter: grayscale(0.75); }
.ft-bd-card:not([data-ft-build]) { cursor: default; }
.ft-bd-head { display: flex; align-items: baseline; gap: 6px; }
.ft-bd-ic { font-size: 17px; line-height: 1; }
.ft-bd-name { font-weight: 600; font-size: 12px; }
.ft-bd-era { margin-left: auto; font-family: var(--mono, monospace); font-size: 8px; color: var(--dim, #a89f8e); white-space: nowrap; }
.ft-bd-price { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
.ft-bd-badge {
  font-family: var(--mono, monospace); font-size: 11px; padding: 1px 6px;
  border-radius: 999px; background: var(--gold-faint, rgba(201, 162, 39, 0.14));
  border: 1px solid var(--gold-line, rgba(201, 162, 39, 0.35));
}
.ft-bd-out { margin-top: 5px; font-size: 10.5px; line-height: 1.4; }
.ft-bd-desc { margin-top: 3px; font-size: 9.5px; line-height: 1.35; color: var(--dim, #a89f8e); }
.ft-bd-reason { margin-top: 5px; font-size: 10px; color: var(--warn, #e8c886); }
@media (max-width: 820px) {
  /* Телефон: нижний лист поверх интерфейса, док в этот момент закрыт им —
     крестик шторки всегда в зоне большого пальца. */
  #ftBDrawer { left: 8px; right: 8px; width: auto; top: auto;
    bottom: calc(8px + var(--safe-bottom, 0px)); height: 47vh;
    transform: translateY(112%); }
  #ftBDrawer.open { transform: none; }
  .ft-bd-list { grid-template-columns: 1fr 1fr; }
}`;
  document.head.appendChild(st);
}

// Снимок состояния для чистых функций. Только чтение полей симуляции — те же,
// что читает panel_build: технологии, склад, множитель цены, живые уникальные.
function ctxFromSim(sim) {
  if (!sim) return {};
  return {
    techs: sim.techs,
    res: sim.res,
    costMult: typeof sim.costMult === 'function' ? sim.costMult() : 1,
    uniqueAlive: new Set((sim.buildings || []).filter(b => !b.destroyed).map(b => b.id)),
  };
}

const state = { cat: 'home', closed: false, lastList: '' };

// Каркас шторки: шапка с крестиком и табы живут, пока живёт страница,
// перерисовывается только список карточек.
function shellHtml() {
  const tabs = CATEGORIES.map(c =>
    `<button type="button" class="ft-bd-tab" data-ft-cat="${c.key}">${c.ru}</button>`).join('');
  return `<div class="ft-bd-top"><span class="ft-bd-title">🏗 Строительство</span>`
    + `<button type="button" class="ft-bd-x" data-ft-close aria-label="Свернуть шторку">×</button></div>`
    + `<div class="ft-bd-tabs">${tabs}</div>`
    + `<div class="ft-bd-list"></div>`;
}

// Один слушатель на весь корень (делегирование): карточки пересоздаются каждым
// тиком, вешать обработчик на каждую — плодить утечки.
function bindClicks(root) {
  root.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('[data-ft-cat],[data-ft-close],[data-ft-build]');
    if (!t) return;
    if ('ftClose' in t.dataset) { state.closed = true; root.classList.remove('open'); return; }
    if (t.dataset.ftCat) {
      state.cat = t.dataset.ftCat;
      state.lastList = '';               // принудительная перерисовка списка
      render(root);
      return;
    }
    // КЛИК ПО КАРТОЧКЕ = СУЩЕСТВУЮЩИЙ выбор здания. Функция одна на всю игру:
    // startPlacing из main.js, переданный в hud.bind() и вызываемый родной
    // вкладкой «Стройка» через [data-build] (hud.js → bindPanel). Своего
    // размещения шторка не заводит — иначе два источника правды о placing.
    const id = t.dataset.ftBuild;
    const F = window.__frontier;
    if (!F || !F.hud || !F.hud.cb || typeof F.hud.cb.startPlacing !== 'function') return;
    try { if (F.audio) F.audio.play('click'); } catch { /* звук не критичен */ }
    F.hud.cb.startPlacing(id);
  });
  // Esc сворачивает шторку так же, как крестик; постановка здания (placing)
  // прячет её и без того — см. render().
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (root.classList.contains('open')) { state.closed = true; root.classList.remove('open'); }
  });
}

// Тик рендера: читает __frontier, решает видимость и обновляет список.
function render(root) {
  const F = window.__frontier || {};
  const hud = F.hud, sim = F.sim;
  // «Партия начата» — тот же признак, что у дока: стартовый экран (#overlay
  // без .hidden) ещё висит — шторка молчит.
  const ov = document.getElementById('overlay');
  const started = !ov || ov.classList.contains('hidden');
  const vis = drawerVisible({
    tab: hud ? hud.tab : '',
    closed: state.closed,
    started,
    placing: !!(sim && sim.placing),
  });
  // Уход со вкладки «Стройка» сбрасывает ручное закрытие: игрок, свернувший
  // шторку крестиком и ушедший в Науку, вернувшись к стройке снова получит
  // шторку; а тот, кто свернул её и остался на стройке, тишины не просил.
  if (hud && hud.tab !== 'build') state.closed = false;
  root.classList.toggle('open', vis);
  if (!vis) return;
  const ids = categoriesOfBuildings(BUILDINGS)[state.cat] || [];
  const html = `<div class="ft-bd-list">${cardsHtml(ids, ctxFromSim(sim))}</div>`;
  if (html !== state.lastList) {         // скролл жив, пока контент не менялся
    state.lastList = html;
    const list = root.querySelector('.ft-bd-list');
    if (list) list.outerHTML = html;
  }
  for (const b of root.querySelectorAll('[data-ft-cat]'))
    b.classList.toggle('ft-bd-on', b.dataset.ftCat === state.cat);
}

function start() {
  ensureCss();
  let root = document.getElementById('ftBDrawer');
  if (!root) {
    root = document.createElement('aside');
    root.id = 'ftBDrawer';
    root.setAttribute('aria-label', 'Шторка строительства');
    root.innerHTML = shellHtml();
    document.body.appendChild(root);
    bindClicks(root);
  }
  // Опрос вместо подписок (образец — dock.js): hud.tab меняют родные вкладки,
  // Command Dock и клавиша B, событий наружу никто не шлёт; 250 мс опрос пары
  // полей дешевле любого хука и не требует правки чужого кода.
  setInterval(() => {
    try { render(root); } catch { /* HUD мог пересоздаться между чтениями */ }
  }, 250);
}

if (typeof document !== 'undefined' && typeof window !== 'undefined' && !window.__frontierBuildingDrawer) {
  window.__frontierBuildingDrawer = { version: 1 };
  start();
}

/* ПОДКЛЮЧЕНИЕ — app/src/main.js (index.html правок НЕ требует)

   Модуль самоинициируется при импорте (как './ui/dock.js' рядом): esbuild
   собирает bundle от main.js, поэтому одной строки импорта достаточно и для
   dev-режима, и для собранного frontier.html.

   ЯКОРЬ (строка 14 main.js; проверено Grep: совпадений в файле = 1):

import './ui/topbar.js';

   ВСТАВИТЬ СРАЗУ ПОСЛЕ:

// Шторка строительства W19: сама ставит свой DOM и CSS, ждёт __frontier опросом.
import './ui/building_drawer.js';

   ПОРЯДОК НЕ ВАЖЕН: шторка ждёт window.__frontier опросом (250 мс), а до
   начала партии скрыта вместе с доком (#overlay без .hidden).

   app/index.html — вставок нет. Правки ui/dock.js и ui/hud.js НЕ ТРЕБУЮТСЯ:
   открытие ловится опросом hud.tab (док дёргает setTab('build'), main.js:13
   уже подключён, Grep: совпадений = 1), клик зовёт существующий
   hud.cb.startPlacing (hud.js:509, Grep: совпадений = 1).
*/