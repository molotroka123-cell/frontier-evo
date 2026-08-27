// ui/building_drawer.js — палитра строительства «ФРОНТИР» в духе C&C:Generals
// (агент UI-2, переработка шторки агент 19).
//
// ЗАЧЕМ ПЕРЕДЕЛАНО. Старая шторка показывала здания КАРТОЧКАМИ-СПИСКОМ: на
// 58 построек уходил длинный скролл, и выбор превращался в чтение. Игрок
// попросил палитру как в Command & Conquer: Generals — плотная сетка
// КВАДРАТНЫХ плиток-иконок, где решение принимается за один взгляд. Текст
// не выброшен, а переехал туда, где ему место: ховер/долгий тап открывают
// тултип с именем, ценой по ресурсам, выработкой словами и причиной
// недоступности — ровно тот же контент, что был на карточках.
//
// ЧТО ВНУТРИ:
//   • сетка квадратных плиток (~62px, 4 в ряд): крупная иконка по центру,
//     стоимость — мини-бейдж в правом нижнем углу (моно 10px); недоступное
//     затемнено + красный уголок; выбранное при постановке (sim.placing) —
//     янтарная рамка с пульсом;
//   • вертикальная колонка табов-иконок слева от сетки (5 категорий,
//     подпись только в тултипе таба) — экономия ширины против старых пилюль;
//   • лента очереди стройки под сеткой: строящиеся площадки с заливкой
//     прогресса снизу вверх + чертежи из sim.build.queue штриховкой;
//   • тёмный металл с фасками, янтарь #c8a24a; CSS инжектится <style>.
//
// ПРАВИЛА СЛОЯ (сохранены от шторки):
//   • клик по плитке зовёт СУЩЕСТВУЮЩУЮ функцию выбора здания —
//     hud.cb.startPlacing(id) из main.js; своего размещения здесь нет;
//   • открытие ловится ОПРОСОМ hud.tab (250 мс): Command Dock, родные вкладки
//     и клавиша B меняют только hud.tab — опрос одного поля покрывает все пути;
//   • симуляция только читается (window.__frontier.hud/.sim), без мутаций;
//   • файл самодостаточен: CSS инжектится <style>, повторный запуск гасится
//     флагом на window;
//   • импорт модуля в node безопасен: DOM спрятан за маркером «DOM-ЧАСТЬ».
//
// ПОЧЕМУ КАТЕГОРИИ ЯВНО ТАБЛИЦЕЙ. Категория — решение дизайнера, а не выводимое
// поле: у BUILDINGS нет атрибута «класс», а вывод его из полей давал бы
// «Храм → счастье → Жильё». Явная карта id→категория ниже; незнакомым id
// назначается запасная «Мастерские»: туда на фронте попадают стадии
// производственных цепочек (EXTRA_BUILDINGS доливаются рантаймом) — это всё
// производственные здания, потерь не бывает.

import { RES, ERAS, TECHS, BUILDINGS } from '../core/data.js';
import { tileSpriteUrl } from './tile_sprites.js';

// ===== ЧИСТАЯ ЧАСТЬ (без DOM; ниже маркер DOM-части — тесты сканируют её) =====

// Порядок табов = порядок в задании; ключи короткие, чтобы жить в data-атрибутах.
export const CATEGORIES = [
  { key: 'home',      ru: 'Жильё и Быт' },
  { key: 'extract',   ru: 'Добыча и Склады' },
  { key: 'workshops', ru: 'Мастерские' },
  { key: 'defense',   ru: 'Оборона и Стены' },
  { key: 'culture',   ru: 'Культ и Чудеса' },
];

// Иконки табов. Подписи категорий на кнопках НЕ рисуются (экономия ширины —
// колонка узкая), имя игрок читает в тултипе таба; иконка обязана намекать
// однозначно: дом, кирка, шестерня, щит, портик.
export const CATEGORY_ICONS = {
  home: '🏠', extract: '⛏️', workshops: '⚙️', defense: '🛡️', culture: '🏛️',
};

// Запасная категория для id вне явной карты (см. комментарий выше).
export const FALLBACK_CAT = 'workshops';

// Явная карта «id → категория». Каждое здание из BUILDINGS ровно один раз;
// полноту карты гоняет тест, так что новое здание без категории зазвенит сразу.
export const CATEGORY_OF = {
  // — Жильё и Быт: крыша над головой и повседневная жизнь (лечебницы и
  //   канализация тут, а не в «Мастерских», потому что игрок ищет их словом
  //   «быт», а не «производство»).
  campfire:    'home', hut:         'home', story_fire:  'home',
  stone_house: 'home', apartment:   'home', skyscraper:  'home',
  aqueduct:    'home', sewers:      'home', clinic:      'home', hospital: 'home',
  // — Добыча и Склады: сырьё, еда и потолки склада. Торговля и финансы тоже
  //   здесь: рынок/банк/сокровищница «добывают» золото как шахта — камень.
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
  // — Оборона и Стены: военные постройки; Замок здесь, хоть он даёт и жильё —
  //   игрок ищет его по слову «оборона».
  palisade:    'defense', stone_walls:'defense', barracks:'defense',
  armory:      'defense', castle:     'defense',
  // — Культ и Чудеса: вера, зрелища, наука и финальные мегапроекты. Наука
  //   живёт здесь, а не в «Мастерских»: знания в ФРОНТИРЕ — культурный путь
  //   к Шпилю.
  temple:      'culture', amphitheater:'culture', media_tower:'culture',
  academy:     'culture', university:  'culture', press:      'culture',
  observatory: 'culture', lab:         'culture', datacenter: 'culture',
  biolab:      'culture', ai_core:     'culture', spaceport:  'culture',
  spire:       'culture',
};

// Иконки плиток. У BUILDINGS поля иконки нет; эмодзи стандартного набора
// читаются офлайн и при 27px на плитке остаются различимыми.
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
// Стадии цепочек (EXTRA_BUILDINGS) и будущие здания получают кран — плитка без
// иконки выглядит как баг, кран выглядит как «стройка».
const ICON_FALLBACK = '🏗';

export function iconOf(id) { return ICONS[id] || ICON_FALLBACK; }

export function categoryOf(id) { return CATEGORY_OF[id] || FALLBACK_CAT; }

// Полное разложение таблицы зданий по категориям БЕЗ потерь: порядок внутри
// категории наследует порядок BUILDINGS (эпохи по возрастанию).
export function categoriesOfBuildings(table) {
  const out = {};
  for (const c of CATEGORIES) out[c.key] = [];
  for (const id of Object.keys(table || {})) out[categoryOf(id)].push(id);
  return out;
}

// Родительный падеж для строки склада: «+300 к максимуму ЕДЫ».
const GEN = { food: 'еды', wood: 'дерева', stone: 'камня', steel: 'стали', gold: 'золота', knowledge: 'знаний' };

function meta(r) { return RES.find(q => q.id === r); }

// Эпоха здания = эпоха, которую ОТКРЫВАЕТ его технология-требование. Готовый
// BUILDING_ERA_IDX не годится: он берёт счётчик эпох ДО строки с полем era, и
// Шахта (req: bronze) получала бы «Каменный век».
const ERA_OF_TECH = (() => {
  const m = {}; let e = 0;
  for (const t of TECHS) { if (t.era) e++; m[t.id] = e; }
  return m;
})();

// Числа как в hud.num: целые без хвоста, дробные с одним знаком.
function fmt(v) { return Number.isInteger(v) ? String(v) : String(+v.toFixed(1)); }

// Выработка словами: одна строка на смысл, только реально существующие поля.
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
  // Множители печатаются как есть (×1.15, ×1.25): округление превратило бы
  // честные «×1.25» в «×1.3».
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
// sim.lackCost, иначе тултип обещал бы одну цену, а списывалась другая.
export function priceBadges(cost, costMult) {
  const m = costMult || 1;
  const rows = Object.entries(cost || {});
  if (!rows.length) return [{ icon: '', ru: 'Бесплатно', n: '' }];
  return rows.map(([r, v]) => {
    const md = meta(r);
    return { icon: (md && md.icon) || r, ru: (md && md.ru) || r, n: Math.ceil(v * m) };
  });
}

// Чего не хватает, в формате sim.lackCost: «🪵5 🪨2».
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

// Модель содержимого тултипа (бывшая модель карточки). ctx — снимок состояния,
// а не симуляция: { techs, res, costMult, uniqueAlive }. Приоритет причин
// копирует panel_build (hud.js): технология → уже построено → не хватает.
export function cardModel(id, def, ctx) {
  const c = ctx || {};
  const techs = c.techs || { has: () => false };
  const alive = c.uniqueAlive || { has: () => false };
  const locked = !!(def.req && !techs.has(def.req));
  const built = !!(def.unique && alive.has(id));
  const lack = lackStr(def.cost, c.res, c.costMult || 1);
  let reason = '';
  if (locked) {
    // Имя технологии берём из TECHS: игроку показываются слова игры.
    const t = TECHS.find(q => q.id === def.req);
    reason = `Нужна технология: ${t ? t.name : def.req}`;
  } else if (built) reason = 'Уже построено';
  else if (lack) reason = `Не хватает: ${lack}`;
  const eraIdx = def.req ? (ERA_OF_TECH[def.req] ?? 0) : 0;
  return {
    id,
    name: def.name,
    icon: iconOf(id),
    // Data-URL нарисованного спрайта для плитки, либо null → эмодзи-фолбэк.
    spriteUrl: tileSpriteUrl(id),
    eraRu: (ERAS[eraIdx] || {}).ru || '',
    price: priceBadges(def.cost, c.costMult),
    out: effectLines(def),
    desc: def.desc || '',
    disabled: locked || built || !!lack,
    // Дорогую, но открытую технологией плитку нажать можно: призрак ставится,
    // деньги спросят при подтверждении — так же ведёт родная вкладка.
    clickable: !locked && !built,
    reason,
  };
}

// Короткая цена для углового бейджа плитки: «🪵14», «🪵20🪨10», бесплатно — «∞».
// Полная расшифровка по ресурсам живёт в тултипе, бейдж обязан помещаться
// в угол квадрата даже у трёхресурсного дома поздней эпохи.
function tileCostStr(price) {
  if (price.length === 1 && price[0].n === '') return '∞';
  return price.map(b => `${b.icon}${b.n}`).join('');
}

// Разметка одной плитки. selected — по этому зданию прямо сейчас идёт
// постановка (янтарная рамка + пульс делаю классом, анимацию гасит
// prefers-reduced-motion). Недоступная плитка получает ft-tile-off (затемнение
// + красный уголок через ::after в CSS), но остаётся с тултипом: игрок должен
// видеть ЦЕНА/ВЫРАБОТКА/ПРИЧИНА даже на запертой иконке.
export function tileHtml(m, selected) {
  const cls = 'ft-tile' + (m.disabled ? ' ft-tile-off' : '') + (selected ? ' ft-tile-sel' : '');
  return `<button type="button" class="${cls}"${m.clickable ? ` data-ft-build="${m.id}"` : ''}`
    + ` data-ft-id="${m.id}" aria-label="${m.name}">`
    + (m.spriteUrl
      ? `<img class="ft-tile-img" src="${m.spriteUrl}" alt="" aria-hidden="true">`
      : `<span class="ft-tile-ic" aria-hidden="true">${m.icon}</span>`)
    + `<span class="ft-tile-cost" aria-hidden="true">${tileCostStr(m.price)}</span></button>`;
}

// Плитки одной категории одной строкой. placingId — здание, которое игрок
// ставит прямо сейчас (sim.placing.id): его плитка подсвечивается. Незнакомый
// id (сейв из будущего) молча пропускаем — пустая плитка хуже отсутствующей.
export function tilesHtml(ids, ctx, placingId) {
  return (ids || []).map(id => {
    const def = BUILDINGS[id];
    return def ? tileHtml(cardModel(id, def, ctx), !!placingId && placingId === id) : '';
  }).join('');
}

// Тултип плитки: то, что раньше было карточкой — имя+эпоха, цена по ресурсам
// словами, выработка словами, причина недоступности. Показывается по ховеру
// или долгому тапу (DOM-часть ниже).
export function tipHtml(m) {
  const free = m.price.length === 1 && m.price[0].n === '';
  const price = free
    ? '<div class="ft-tip-free">Бесплатно</div>'
    : m.price.map(b =>
        `<div class="ft-tip-row"><span>${b.icon}</span><span>${b.ru}</span><b>${b.n}</b></div>`).join('');
  const outs = m.out.map(s => `<div>${s}</div>`).join('');
  return `<div class="ft-tip-name">${m.icon} ${m.name}<i>${m.eraRu}</i></div>`
    + (m.desc ? `<div class="ft-tip-desc">${m.desc}</div>` : '')
    + `<div class="ft-tip-price">${price}</div>`
    + (outs ? `<div class="ft-tip-out">${outs}</div>` : '')
    + (m.reason ? `<div class="ft-tip-reason">${m.reason}</div>` : '');
}

// Тултип таба категории: подпись, которую не стали рисовать на кнопке.
export function catTipHtml(catKey, count) {
  const c = CATEGORIES.find(q => q.key === catKey);
  if (!c) return '';
  return `<div class="ft-tip-name">${CATEGORY_ICONS[catKey] || ''} ${c.ru}</div>`
    + `<div class="ft-tip-dim">зданий: ${count | 0}</div>`;
}

// Узкая вертикальная колонка табов-иконок. Подписи — только aria-label и
// тултип: на плиточной палитре текстовые пилюли съели бы треть ширины.
export function tabRailHtml(activeKey) {
  return CATEGORIES.map(c =>
    `<button type="button" class="ft-bd-tab${c.key === activeKey ? ' ft-bd-on' : ''}"`
    + ` data-ft-cat="${c.key}" aria-label="${c.ru}" title="">${CATEGORY_ICONS[c.key] || '?'}</button>`).join('');
}

// Модель ленты очереди стройки. Читает ТОЛЬКО чтением: строящиеся площадки —
// это sim.buildings с done:false (прогресс = progress/buildDays), чертежи —
// sim.build.queue (build2). Ничего не мутируем и не вызываем у симуляции:
// функция получает снимок и возвращает описания.
export function queueModel(simLike) {
  const s = simLike || {};
  const out = [];
  const bs = Array.isArray(s.buildings) ? s.buildings : [];
  for (const b of bs) {
    if (!b || b.done || b.destroyed) continue;
    const def = BUILDINGS[b.id];
    if (!def) continue;
    const bd = Math.max(0, Number(b.buildDays) || 0);
    const pr = Math.max(0, Number(b.progress) || 0);
    out.push({ kind: 'site', id: b.id, icon: iconOf(b.id), name: def.name, frac: bd > 0 ? Math.min(1, pr / bd) : 0 });
  }
  const q = s.build && Array.isArray(s.build.queue) ? s.build.queue : [];
  for (const p of q) {
    if (!p || !BUILDINGS[p.id]) continue;
    out.push({ kind: 'plan', id: p.id, icon: iconOf(p.id), name: BUILDINGS[p.id].name, frac: 0 });
  }
  // Лента — обзор, а не журнал: больше полутора десятков клеток не показываем,
  // полные списки и так есть в родной панели.
  return out.slice(0, 14);
}

// Лента под сеткой: квадратик строящегося объекта с заливкой прогресса снизу
// вверх (высота <i> в процентах) и штрихованный чертёж без заливки.
export function queueRibbonHtml(rows) {
  const list = rows || [];
  if (!list.length) return '';
  return list.map(r => {
    const pct = Math.round(Math.max(0, Math.min(1, Number(r.frac) || 0)) * 100);
    return `<span class="ft-q${r.kind === 'plan' ? ' ft-q-plan' : ''}"`
      + ` data-ft-q="${r.id}" data-ft-qk="${r.kind}" data-ft-p="${pct}"`
      + ` role="img" aria-label="${r.name}, ${r.kind === 'site' ? pct + '%' : 'чертёж'}">`
      + `<i style="height:${pct}%"></i><b aria-hidden="true">${r.icon}</b></span>`;
  }).join('');
}

// Тултип клетки ленты: что строится и сколько осталось, либо почему чертёж ждёт.
export function queueTipHtml(row) {
  if (!row) return '';
  const pct = Math.round(Math.max(0, Math.min(1, Number(row.frac) || 0)) * 100);
  if (row.kind === 'plan') {
    return `<div class="ft-tip-name">📐 ${row.icon} ${row.name}</div>`
      + '<div class="ft-tip-dim">Чертёж: ждёт материалов или очереди</div>';
  }
  return `<div class="ft-tip-name">${row.icon} ${row.name}</div>`
    + `<div class="ft-tip-dim">Строится: ${pct}%</div>`
    + `<div class="ft-tip-dim">Готовность растут строители на площадке</div>`;
}

// Видима ли палитра. Состояние — аргументы: вкладка «Стройка», партия начата,
// игрок не свернул, нет внешней причины прятать (covered).
export function drawerVisible(st) {
  return !!st && st.tab === 'build' && !st.closed && !!st.started && !st.covered;
}

// ===== DOM-ЧАСТЬ (браузер; в node не исполняется) =====

// Брейкпоинт телефона — тот же 820px, что в index.html и у дока; константу не
// импортируем из dock.js, чтобы палитра не зависела от соседа целиком.
function ensureCss() {
  if (document.getElementById('ft-bd-css')) return;
  const st = document.createElement('style');
  st.id = 'ft-bd-css';
  st.textContent = `
#ftBDrawer {
  position: fixed; left: 10px; top: 64px; bottom: 78px; width: 344px; z-index: 32;
  display: flex; flex-direction: column;
  /* Тёмный металл с фаской: световая кромка сверху, тень снизу. */
  background:
    linear-gradient(180deg, rgba(255,255,255,0.045), rgba(0,0,0,0.16)),
    linear-gradient(180deg, #262319, #191712);
  border: 1px solid #454033;
  border-radius: var(--radius, 12px);
  color: var(--text, #ece5d3);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.05), inset 0 -1px 0 rgba(0,0,0,0.55),
    0 12px 34px rgba(0, 0, 0, 0.55);
  transform: translateX(-116%); opacity: 0; visibility: hidden; pointer-events: none;
  transition: transform 0.22s ease, opacity 0.18s ease, visibility 0s linear 0.18s;
}
#ftBDrawer.open {
  transform: none; opacity: 1; visibility: visible; pointer-events: auto;
  transition: transform 0.22s ease, opacity 0.18s ease;
}
@media (prefers-reduced-motion: reduce) { #ftBDrawer { transition: none; } }
.ft-bd-top {
  display: flex; align-items: center; gap: 8px; padding: 9px 12px;
  font-family: var(--serif, Georgia, serif); letter-spacing: 0.5px; font-size: 13px;
  border-bottom: 1px solid #14120c;
  box-shadow: inset 0 -1px 0 rgba(255,255,255,0.04);
}
.ft-bd-x {
  margin-left: auto; width: 26px; height: 26px; border-radius: 6px;
  background: linear-gradient(180deg, #33302a, #24211b); color: var(--dim, #a89f8e);
  border-color: #4c4636 #15130d #15130d #4c4636; border-style: solid; border-width: 1px;
  cursor: pointer; font-size: 15px; line-height: 1;
}
.ft-bd-x:hover { color: #f0e6cd; filter: brightness(1.18); }
/* Тело: узкая колонка табов слева + основная часть (сетка и лента). */
.ft-bd-body { flex: 1; min-height: 0; display: flex; }
.ft-bd-rail {
  flex: 0 0 42px; display: flex; flex-direction: column; gap: 5px;
  padding: 8px 5px;
  background: linear-gradient(180deg, #211e17, #17150f);
  border-right: 1px solid #14120c;
  box-shadow: inset -1px 0 0 rgba(255,255,255,0.03);
}
.ft-bd-tab {
  width: 32px; height: 32px; padding: 0; border-radius: 6px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  font-size: 15px; line-height: 1; color: var(--dim, #a89f8e);
  background: linear-gradient(180deg, #332f26, #24211a);
  border-style: solid; border-width: 1px;
  border-color: #4c4636 #15130d #15130d #4c4636;
}
.ft-bd-tab:hover { color: var(--text, #ece5d3); filter: brightness(1.16); }
.ft-bd-tab.ft-bd-on {
  color: #201807;
  background: linear-gradient(180deg, #d8b25c, #c8a24a 45%, #96762f);
  border-color: #ecd08a #6b5526 #6b5526 #ecd08a;
  box-shadow: 0 0 9px rgba(200, 162, 74, 0.4);
}
.ft-bd-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
/* Сетка квадратных плиток: ~4 в ряд на десктопной ширине, квадрат задаёт
   aspect-ratio, размер плавает в коридоре 56–64px. */
.ft-bd-grid {
  flex: 1; min-height: 0; overflow-y: auto; padding: 8px;
  display: grid; grid-template-columns: repeat(auto-fill, minmax(58px, 1fr));
  gap: 7px; align-content: start;
  scrollbar-width: thin; scrollbar-color: rgba(200,162,74,.35) transparent;
}
.ft-tile {
  position: relative; aspect-ratio: 1 / 1; width: 100%; padding: 0;
  display: flex; align-items: center; justify-content: center;
  font: inherit; color: inherit; cursor: pointer; border-radius: 5px;
  background: linear-gradient(165deg, #3b372c 0%, #2b2820 55%, #22201a 100%);
  border-style: solid; border-width: 1px;
  /* Фаска плитки: свет сверху-слева, тень снизу-справа — «фрезерованный» вид. */
  border-color: #56503d #16140e #16140e #56503d;
  transition: filter 0.12s ease, border-color 0.12s ease;
}
.ft-tile:hover { filter: brightness(1.16); }
.ft-tile:focus-visible { outline: 2px solid #c8a24a; outline-offset: 1px; }
.ft-tile-ic { font-size: 27px; line-height: 1; text-shadow: 0 2px 3px rgba(0,0,0,0.65); }
/* Стоимость — маленький бейдж в правом нижнем углу, моно 10px. */
.ft-tile-cost {
  position: absolute; right: 2px; bottom: 2px;
  max-width: calc(100% - 4px); overflow: hidden; white-space: nowrap;
  text-overflow: ellipsis; padding: 0 3px; border-radius: 3px;
  font-family: var(--mono, Consolas, monospace); font-size: 10px; line-height: 1.2;
  color: #ead9ae; background: rgba(9, 8, 5, 0.74);
  border: 1px solid rgba(200, 162, 74, 0.22);
}
/* Недоступно: затемнение + красный уголок-треугольник сверху справа. */
.ft-tile-off { opacity: 0.42; filter: saturate(0.35); }
.ft-tile-off .ft-tile-ic { filter: grayscale(0.5); }
.ft-tile-img { width: 40px; height: 40px; object-fit: contain; image-rendering: auto;
  filter: drop-shadow(0 2px 3px rgba(0,0,0,0.55)); pointer-events: none; }
.ft-tile-off .ft-tile-img { filter: grayscale(0.55) brightness(0.8); }
.ft-tile-off::after {
  content: ''; position: absolute; top: 0; right: 0;
  border-top: 13px solid #a83a2a; border-left: 13px solid transparent;
  border-top-right-radius: 4px;
}
.ft-tile-off:not([data-ft-build]) { cursor: default; }
.ft-tile-off[data-ft-build]:hover { filter: brightness(1.1) saturate(0.35); }
/* Выбранная при постановке: янтарная рамка с медленным пульсом. */
.ft-tile-sel {
  border-color: #c8a24a;
  animation: ftTilePulse 0.95s ease-in-out infinite alternate;
}
@keyframes ftTilePulse {
  from { box-shadow: 0 0 0 1px rgba(200,162,74,0.85), 0 0 5px rgba(200,162,74,0.25); }
  to   { box-shadow: 0 0 0 2px #c8a24a, 0 0 15px rgba(200,162,74,0.6); }
}
@media (prefers-reduced-motion: reduce) {
  .ft-tile-sel { animation: none; box-shadow: 0 0 0 2px #c8a24a; }
}
/* Лента очереди стройки: квадратики площадок и чертежей. */
.ft-bd-queue {
  flex: 0 0 auto; display: flex; gap: 5px; align-items: center;
  min-height: 38px; padding: 5px 8px; overflow-x: auto;
  background: linear-gradient(180deg, #1b1913, #15130e);
  border-top: 1px solid #14120c;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
  scrollbar-width: thin; scrollbar-color: rgba(200,162,74,.35) transparent;
}
.ft-q {
  position: relative; flex: 0 0 auto; width: 28px; height: 28px; border-radius: 4px;
  display: flex; align-items: center; justify-content: center; overflow: hidden;
  background: linear-gradient(180deg, #2c2921, #201d16);
  border-style: solid; border-width: 1px;
  border-color: #4c4636 #15130d #15130d #4c4636;
}
/* Прогресс-заливка снизу вверх: высоту задаёт инлайн-стиль из модели. */
.ft-q i {
  position: absolute; left: 0; right: 0; bottom: 0;
  background: linear-gradient(180deg, #e3c06a, #c8a24a);
}
.ft-q b {
  position: relative; font-weight: 400; font-size: 14px; line-height: 1;
  filter: drop-shadow(0 1px 1px rgba(0,0,0,0.8));
}
/* Чертёж: ещё не стройка — штриховая рамка и штриховая заливка вместо янтаря. */
.ft-q-plan { border-style: dashed; border-color: #8a7034; opacity: 0.85; }
.ft-q-plan i { background: repeating-linear-gradient(45deg, transparent 0 3px, rgba(200,162,74,0.28) 3px 5px); }
/* Ховер-тултип: один общий div рядом с курсором, не системный title. */
#ftBdTip {
  position: fixed; z-index: 80; max-width: 236px; padding: 7px 9px;
  border-radius: 8px; pointer-events: none; opacity: 0;
  transition: opacity 0.09s ease;
  font-size: 11px; line-height: 1.45; color: var(--text, #ece5d3);
  background: linear-gradient(180deg, #2c2921, #1d1b14);
  border: 1px solid rgba(200, 162, 74, 0.5);
  box-shadow: 0 10px 26px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.05);
}
#ftBdTip.show { opacity: 1; }
.ft-tip-name { font-weight: 600; margin-bottom: 2px; }
.ft-tip-name i {
  font-style: normal; margin-left: 6px;
  font-family: var(--mono, Consolas, monospace); font-size: 8.5px; color: var(--dim, #a89f8e);
}
.ft-tip-desc { color: var(--dim, #a89f8e); font-size: 10px; margin-bottom: 2px; }
.ft-tip-price {
  display: flex; flex-direction: column; gap: 1px; margin: 3px 0; padding: 3px 0;
  border-top: 1px solid var(--gold-faint, rgba(201,162,39,0.14));
  border-bottom: 1px solid var(--gold-faint, rgba(201,162,39,0.14));
}
.ft-tip-row { display: flex; gap: 5px; font-family: var(--mono, Consolas, monospace); font-size: 10.5px; }
.ft-tip-row b { margin-left: auto; font-family: inherit; }
.ft-tip-free { font-family: var(--mono, Consolas, monospace); font-size: 10.5px; }
.ft-tip-out { font-size: 10.5px; }
.ft-tip-reason { margin-top: 3px; color: var(--warn, #e8c886); }
.ft-tip-dim { color: var(--dim, #a89f8e); font-size: 10.5px; }
@media (max-width: 820px) {
  /* Телефон: нижний лист поверх интерфейса; колонка табов остаётся слева —
     42px ширины лист не съедает, а привычка «табы слева» единая. */
  #ftBDrawer { left: 8px; right: 8px; width: auto; top: auto;
    bottom: calc(8px + var(--safe-bottom, 0px)); height: 47vh;
    transform: translateY(112%); }
  #ftBDrawer.open { transform: none; }
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

const state = { cat: 'home', closed: false, lastGrid: '', lastQueue: '' };

// Телефонный расклад? На нём палитра — нижний лист, и во время постановки
// она закрыла бы кнопки ✓/✗ подтверждения: там прячемся (covered), как старая
// шторка. На десктопе листа нет — палитра Generals остаётся открытой, и
// выбранная плитка показывает янтарную рамку с пульсом.
function phoneLayout() {
  try { return window.matchMedia('(max-width: 820px)').matches; } catch { return false; }
}

// Каркас палитры: живёт, пока живёт страница; перестраиваются только сетка
// (смена категории/ресурсов) и лента (прогресс каждый тик).
function shellHtml() {
  return `<div class="ft-bd-top"><span class="ft-bd-title">🏗 Строительство</span>`
    + `<button type="button" class="ft-bd-x" data-ft-close aria-label="Свернуть палитру">×</button></div>`
    + `<div class="ft-bd-body"><div class="ft-bd-rail"></div>`
    + `<div class="ft-bd-main"><div class="ft-bd-grid"></div><div class="ft-bd-queue" hidden></div></div></div>`;
}

// ---------- тултип: один div на всё, показ по hover / focus / long-press -----

let tipEl = null;

function ensureTip() {
  if (tipEl && document.body.contains(tipEl)) return tipEl;
  tipEl = document.createElement('div');
  tipEl.id = 'ftBdTip';
  tipEl.setAttribute('role', 'tooltip');
  document.body.appendChild(tipEl);
  return tipEl;
}

function hideTip() { if (tipEl) tipEl.classList.remove('show'); }

function showTip(el, html) {
  if (!html) return hideTip();
  const t = ensureTip();
  t.innerHTML = html;
  t.classList.add('show');
  // Ставим справа от плитки (шторка у левого края), при нехватке места — слева;
  // по вертикали держим в экране.
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  let x = r.right + 8;
  if (x + t.offsetWidth > vw - 8) x = Math.max(8, r.left - t.offsetWidth - 8);
  let y = Math.min(Math.max(8, r.top - 6), vh - t.offsetHeight - 8);
  t.style.left = `${x}px`;
  t.style.top = `${y}px`;
}

// Чей тултип: таб (data-ft-cat), клетка ленты (data-ft-q) или плитка
// (data-ft-id). Модель плитки собирается КАЖДЫЙ раз заново со свежим снимком
// ресурсов — цена и причина в тултипе не могут устареть.
function tipFor(el) {
  const d = el.dataset;
  const F = window.__frontier || {};
  if (d.ftQ !== undefined) {
    return queueTipHtml({ kind: d.ftQk, id: d.ftQ, frac: (Number(d.ftP) || 0) / 100 });
  }
  if (d.ftCat) {
    const n = (categoriesOfBuildings(BUILDINGS)[d.ftCat] || []).length;
    return catTipHtml(d.ftCat, n);
  }
  const def = BUILDINGS[d.ftId];
  return def ? tipHtml(cardModel(d.ftId, def, ctxFromSim(F.sim))) : '';
}

function bindTips(root) {
  const SEL = '[data-ft-cat],[data-ft-id],[data-ft-q]';
  let outTimer = 0;
  root.addEventListener('mouseover', (e) => {
    const el = e.target && e.target.closest ? e.target.closest(SEL) : null;
    if (!el || !root.contains(el)) return;
    clearTimeout(outTimer);
    showTip(el, tipFor(el));
  });
  const soonHide = () => { clearTimeout(outTimer); outTimer = setTimeout(hideTip, 60); };
  root.addEventListener('mouseleave', soonHide);
  root.addEventListener('focusout', soonHide);
  root.addEventListener('focusin', (e) => {
    const el = e.target && e.target.closest ? e.target.closest(SEL) : null;
    if (el) showTip(el, tipFor(el));
  });
  // Скролл сетки и уход со страницы прячут тултип: он позиционируется по
  // координатам элемента на момент показа.
  root.addEventListener('scroll', hideTip, true);
  window.addEventListener('blur', hideTip);
  // Долгий тап (тач): 450 мс без движения — показать тултип, как ховер.
  let lp = null;
  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    const el = e.target && e.target.closest ? e.target.closest(SEL) : null;
    if (!el) return;
    lp = { el, x: e.clientX, y: e.clientY, t: setTimeout(() => showTip(el, tipFor(el)), 450) };
  });
  root.addEventListener('pointermove', (e) => {
    if (lp && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 12) {
      clearTimeout(lp.t); lp = null; hideTip();
    }
  });
  const lpEnd = () => { if (lp) { clearTimeout(lp.t); lp = null; } };
  root.addEventListener('pointerup', lpEnd);
  root.addEventListener('pointercancel', lpEnd);
}

// Один слушатель на весь корень (делегирование): плитки пересоздаются каждым
// тиком, вешать обработчик на каждую — плодить утечки.
function bindClicks(root) {
  root.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('[data-ft-cat],[data-ft-close],[data-ft-build]');
    if (!t) return;
    if ('ftClose' in t.dataset) { state.closed = true; root.classList.remove('open'); hideTip(); return; }
    if (t.dataset.ftCat) {
      state.cat = t.dataset.ftCat;
      state.lastGrid = '';               // принудительная перерисовка сетки
      render(root);
      return;
    }
    // КЛИК ПО ПЛИТКЕ = СУЩЕСТВУЮЩИЙ выбор здания. Функция одна на всю игру:
    // startPlacing из main.js, переданный в hud.bind(). Своего размещения
    // палитра не заводит — иначе два источника правды о placing.
    const id = t.dataset.ftBuild;
    const F = window.__frontier;
    if (!F || !F.hud || !F.hud.cb || typeof F.hud.cb.startPlacing !== 'function') return;
    try { if (F.audio) F.audio.play('click'); } catch { /* звук не критичен */ }
    F.hud.cb.startPlacing(id);
  });
  // Esc сворачивает палитру, НО пока идёт постановка здания Esc занят отменой
  // постановки (main.js) — не отбираем у игрока этот жест.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const F = window.__frontier;
    if (F && F.sim && F.sim.placing) return;
    if (root.classList.contains('open')) { state.closed = true; root.classList.remove('open'); hideTip(); }
  });
}

// Тик рендера: читает __frontier, решает видимость, обновляет сетку и ленту.
function render(root) {
  const F = window.__frontier || {};
  const hud = F.hud, sim = F.sim;
  // «Партия начата» — тот же признак, что у дока: стартовый экран (#overlay
  // без .hidden) ещё висит — палитра молчит.
  const ov = document.getElementById('overlay');
  const started = !ov || ov.classList.contains('hidden');
  const vis = drawerVisible({
    tab: hud ? hud.tab : '',
    closed: state.closed,
    started,
    covered: !!(sim && sim.placing) && phoneLayout(),
  });
  // Уход со вкладки «Стройка» сбрасывает ручное закрытие: игрок, свернувший
  // палитру крестиком и ушедший в Науку, вернувшись снова её получит.
  if (hud && hud.tab !== 'build') state.closed = false;
  root.classList.toggle('open', vis);
  if (!vis) { hideTip(); return; }
  // Сетка: перерисовываем только если строка поменялась — скролл жив, пока
  // контент тот же (тик ресурсов без изменений не трогает DOM).
  const ids = categoriesOfBuildings(BUILDINGS)[state.cat] || [];
  const placingId = sim && sim.placing ? String(sim.placing.id) : null;
  const grid = `<div class="ft-bd-grid">${tilesHtml(ids, ctxFromSim(sim), placingId)}</div>`;
  if (grid !== state.lastGrid) {
    state.lastGrid = grid;
    const el = root.querySelector('.ft-bd-grid');
    if (el) el.outerHTML = grid;
    hideTip();                          // элемент под курсором заменён
  }
  // Лента очереди: прогресс меняется постоянно, сравнение строк тут просто
  // экономит присвоение innerHTML пустой ленте; данные читаются каждый тик.
  const rib = queueRibbonHtml(queueModel(sim));
  if (rib !== state.lastQueue) {
    state.lastQueue = rib;
    const box = root.querySelector('.ft-bd-queue');
    if (box) {
      box.innerHTML = rib;
      box.hidden = !rib;
    }
  }
  // Подсветка активного таба: колонка статична, класс переключаем точечно.
  for (const b of root.querySelectorAll('[data-ft-cat]'))
    b.classList.toggle('ft-bd-on', b.dataset.ftCat === state.cat);
}

function start() {
  ensureCss();
  let root = document.getElementById('ftBDrawer');
  if (!root) {
    root = document.createElement('aside');
    root.id = 'ftBDrawer';
    root.setAttribute('aria-label', 'Палитра строительства');
    root.innerHTML = shellHtml();
    document.body.appendChild(root);
    root.querySelector('.ft-bd-rail').innerHTML = tabRailHtml(state.cat);
    bindClicks(root);
    bindTips(root);
  }
  // Опрос вместо подписок (образец — dock.js): hud.tab меняют родные вкладки,
  // Command Dock и клавиша B, событий наружу никто не шлёт; 250 мс опрос пары
  // полей дешевле любого хука и не требует правки чужого кода.
  setInterval(() => {
    try { render(root); } catch { /* HUD мог пересоздаться между чтениями */ }
  }, 250);
}

if (typeof document !== 'undefined' && typeof window !== 'undefined' && !window.__frontierBuildingDrawer) {
  window.__frontierBuildingDrawer = { version: 2, palette: true };
  start();
}

/* ПОДКЛЮЧЕНИЕ — app/src/main.js (уже подключено строкой

import './ui/building_drawer.js';

   сразу после './ui/topbar.js'). index.html правок не требует: модуль сам
   ставит свой DOM, CSS и ждёт window.__frontier опросом (250 мс), а до начала
   партии скрыт вместе с доком (#overlay без .hidden).

   Правки ui/dock.js, ui/hud.js и main.js НЕ ТРЕБУЮТСЯ: открытие ловится
   опросом hud.tab (док дёргает setTab('build')), клик по плитке зовёт
   существующий hud.cb.startPlacing, очередь читается напрямую из
   sim.buildings (площадки) и sim.build.queue (чертежи build2) без мутаций.
*/
