// ui/villager_story.js — карточка-биография жителя (G6), мечта игрока
// «наблюдать за жизнью королевы и отдельных жителей — у каждого своя история».
//
// ЗАЧЕМ. Инспектор (ui/inspector.js) показывает жителю две строки: занят и
// здоровье. Это справка «кто передо мной», но не история. Эта карточка —
// биография: имя, возраст, статус (правитель/ремесленник/ребёнок), родня,
// если она известна модулю населения, и ЛЕНТА СОБЫТИЙ жизни — факты,
// собранные из sim.chronicle/sim.log по имени жителя, плюс вехи, выведенные
// из его же чисел (день рождения = сегодня − возраст; совершеннолетие через
// 1600 дней; нынешнее ремесло). Ни одного выдуманного факта: что не лежит
// в данных — то не попадает в ленту.
//
// ПРАВИЛА СЛОЯ. Карточка — ЧИСТЫЙ ПОТРЕБИТЕЛЬ: sim читается, не пишется.
// Никаких команд ядра у жителя в игре не существует, поэтому кнопок здесь
// нет вовсе — как у villagerCard инспектора, это контракт, а не упущение.
//
// ГРАНИЦЫ КАДРА. Геометрия повторяет инспектора: правый нижний угол,
// снизу зарезервированы DOCK_FREE_PX (76 px) + safe-area под Command Dock.
// z-index 27 — НА ОДИН выше инспектора (26): при клике по жителю оба слоя
// откроют карточку в одном углу, и биография честно перекрывает сводку —
// игрок видит ОДНУ карточку, а не две дерущиеся. Дока (30) и модалок (70)
// мы не достаём.
//
// СВЯЗЬ С FOLLOW-КАМЕРОЙ (G5 работает параллельно, договорённость по имени):
// мы публикуем window.__frontierStory = { setTarget, clear, isOpen }.
//   • setTarget(villager | 'ruler' | null) — явное указание цели;
//   • параллельно модуль СА читает window.__frontierFollow (состояние
//     follow_cam.js): ключи ростера 'ruler' | 'p<pid>' | 'i<index>'
//     разрешаются обратно в жителя без помощи со стороны G5. Если G5
//     захочет явную связку — достаточно звать window.__frontierStory
//     .setTarget(entry.ref) при смене цели; опрос это переживает.
//
// ЧИСТАЯ ЧАСТЬ спрятана за маркером ниже и тестируется под node без
// document/window — тем же способом, что ui/dock.js и ui/inspector.js.

// ===== ЧИСТАЯ ЧАСТЬ (без DOM; тесты сканируют границу по маркеру) =====

import { DOCK_FREE_PX, jobRu } from './inspector.js';
import { YEAR, ageYears, profTitle, traitTitle, plural } from '../core/systems/population.js';

// Период пересчёта открытой карточки, мс. Взят равным INSPECTOR_POLL_MS (400):
// числа меняются раз в игровой день, чаще обновлять нечего, а два разных
// ритма опроса в одном углу экрана только жгли бы кадры впустую.
export const STORY_POLL_MS = 400;

// Сколько последних записей ленты показываем. Летопись растёт весь тиран-
// час игры, а карточка обязана остаться карточкой: хвост — самое важное,
// шапка ленты честно сообщает, сколько записей старше осталось за кадром.
export const FEED_MAX = 30;

// Совершеннолетие в днях: 16 лет × YEAR(100). Та же величина живёт в ядре
// (ADULT_AGE = 1600 дней в link_industry.js, 16 лет в population.js), но
// наружу ни один из них её не экспортирует, поэтому выводим здесь из
// экспортного YEAR — числа не разъедутся, даже если год удлинят.
export const ADULT_DAYS = 16 * YEAR;

function esc(s) {
  // Экранирование: имена приходят из генератора, тексты ленты — из летописи,
  // а карточка строится innerHTML'ом; случайная «<» сломала бы разметку.
  // Своя копия (у инспектора та же не экспортирована): пять строк дешевле,
  // чем раздувание чужого публичного контракта.
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function isWoman(v) {
  // Пол выдаёт модуль населения (v.sex 'м'/'ж'); где поля нет — игра по
  // умолчанию говорит о жителе в мужском роде, как и obituary в ядре.
  return !!(v && v.sex === 'ж');
}

function numOr(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

// Подпись дня в ленте. Отрицательные дни — законные: стартовые жители старше
// самого поселения (ядро выдаёт им возраст 18–90 лет при основании), и их
// день рождения уходит в минус относительно дня 0.
export function fmtDay(day) {
  const d = Math.round(numOr(day, 0));
  return d >= 0 ? `День ${d}` : `За ${-d} дн. до основания`;
}

// Приведение цели к каноническому виду { v, ruler }. Понимает три формы:
// объект жителя (из pick/ростера), маркер 'ruler' или {kind:'ruler'} от
// follow-камеры. У трона нет записи в villagers, поэтому для него строится
// псевдожитель: возраст правителя политика хранит ГОДАМИ — переводим в дни
// той же шкалой YEAR, чтобы вся карточка жила в одной системе счисления.
export function asSubject(sim, t) {
  if (!t) return null;
  const pol = (sim && sim.politics && sim.politics.state) || null;
  const r = pol ? pol.ruler : null;
  if (t === 'ruler' || t.kind === 'ruler') {
    if (!r) return null;
    return {
      v: { name: r.name, age: Math.max(0, Math.round(numOr(r.age, 0)) * YEAR), hp: 100 },
      ruler: r,
    };
  }
  const v = t.v || t;
  if (!v || typeof v.name !== 'string' || !v.name) return null;
  // Связь «житель—трон» только по имени: ядро не держит ссылок между ними.
  return { v, ruler: r && r.name === v.name ? r : null };
}

// Статус одной строкой. Правитель проверяется ПЕРВЫМ: династия умеет венчать
// детей, и «ребёнок на троне» должен называться правителем, а не ребёнком.
export function statusOf(sim, v) {
  if (!v) return 'Житель';
  const pol = (sim && sim.politics && sim.politics.state) || null;
  if (pol && pol.ruler && pol.ruler.name === v.name) return 'Правитель';
  if (ageYears(v) < 16) return 'Ребёнок';
  if (v.prof || (v.job && v.job !== 'idle')) return 'Ремесленник';
  return 'Житель';
}

// Родня одним значением для строки карточки. Живых родичей ищем по pid среди
// текущих жителей: умершие из массива удалены ядром, и перечислить их мы
// честно не можем — лучше молча показать меньше, чем выдумывать имена.
export function kinOf(sim, v) {
  if (!v) return null;
  const vs = (sim && Array.isArray(sim.villagers)) ? sim.villagers : [];
  const parts = [];
  if (v.partner != null) {
    const p = vs.find(o => o && o.pid === v.partner);
    if (p) parts.push(`${p.sex === 'ж' ? 'Супруга' : 'Супруг'}: ${p.name}`);
  }
  if (Array.isArray(v.parents) && v.parents.length) {
    const names = v.parents
      .map(pid => { const p = vs.find(o => o && o.pid === pid); return p ? p.name : null; })
      .filter(Boolean);
    if (names.length) parts.push(`Родители: ${names.join(', ')}`);
  }
  if (numOr(v.children, 0) > 0) parts.push(`Детей: ${Math.round(numOr(v.children, 0))}`);
  return parts.length ? parts.join('; ') : null;
}

// ---------- ЛЕНТА: единственный источник фактов о жизни ----------

// storyOf(sim, villager) → [{day, текст}] по возрастанию дня.
// Детерминирована: тот же sim и тот же житель дают байт-в-байт тот же ответ.
// Источники ровно три, все — чтение:
//   1) выведенные вехи из чисел самого жителя (рождение, совершеннолетие,
//      вступление на трон);
//   2) заслуги из v.deeds (модуль населения хранит их БЕЗ дат — поэтому они
//      честно ставятся на «сегодня», а не на выдуманный день подвига);
//   3) буквальные упоминания имени в sim.chronicle и sim.log.
export function storyOf(sim, t) {
  const s = asSubject(sim, t);
  if (!s) return [];
  const v = s.v;
  const today = numOr(sim && sim.day, 0);
  const she = isWoman(v);
  const out = [];

  // ВЕХА: рождение. Возраст ядро прибавляет раз в день (onNewDay), значит
  // день рождения восстанавливается обратным ходом без остатка.
  const ageDays = Math.max(0, Math.round(numOr(v.age, 0)));
  const birthDay = today - ageDays;
  out.push({ day: birthDay, text: she ? 'Родилась.' : 'Родился.' });

  // ВЕХА: совершеннолетие. Ставится только если уже наступило — будущего в
  // ленте прошлого не бывает.
  const adultDay = birthDay + ADULT_DAYS;
  if (adultDay <= today) {
    out.push({
      day: adultDay,
      text: she ? 'Выросла: совершеннолетие (16 лет).' : 'Вырос: совершеннолетие (16 лет).',
    });
  }

  // ВЕХА: трон. День восшествия политик хранит в ruler.since.
  if (s.ruler) {
    out.push({
      day: Math.max(birthDay, Math.round(numOr(s.ruler.since, 0))),
      text: she ? 'Вступила на трон.' : 'Вступил на трон.',
    });
  }

  // Заслуги: даты модуль населения не хранит принципиально (строки без дня),
  // поэтому привязываем их к сегодняшнему дню с формулировкой «в послужном
  // списке», а не «в такой-то день совершил».
  if (Array.isArray(v.deeds)) {
    for (const d of v.deeds) {
      if (!d) continue;
      out.push({ day: today, text: `В послужном списке: ${String(d).replace(/\.+\s*$/, '')}.` });
    }
  }

  // Нынешнее ремесло/занятие. День НАЗНАЧЕНИЯ ядро нигде не хранит — честная
  // формулировка «нынче», запись стоит на сегодняшнем дне и потому замыкает
  // ленту, какой бы длинной она ни была.
  if (v.prof) {
    out.push({ day: today, text: `Нынче — ремесло: ${profTitle(v)}.` });
  } else if (v.job && v.job !== 'idle') {
    out.push({ day: today, text: `Нынче: ${jobRu(v).toLowerCase()}.` });
  }

  // Упоминания по имени: летопись и журнал читаются как есть, без правок —
  // каждая строка уже написана ядром человеческим языком. Ищем ТОЛЬКО полное
  // имя в именительном падеже (ядро пишет о жителях именно так): ловля на
  // склонённые формы и обрезанные имена означала бы приписывание чужих строк
  // тёзкам — молчание здесь честнее выдуманной биографии.
  const name = v.name;
  const chronicle = (sim && Array.isArray(sim.chronicle)) ? sim.chronicle : [];
  const log = (sim && Array.isArray(sim.log)) ? sim.log : [];
  for (const e of chronicle) {
    if (e && typeof e.text === 'string' && e.text.indexOf(name) >= 0) {
      out.push({ day: Math.round(numOr(e.day, 0)), text: e.text.trim() });
    }
  }
  for (const e of log) {
    if (e && typeof e.text === 'string' && e.text.indexOf(name) >= 0) {
      out.push({ day: Math.round(numOr(e.day, 0)), text: e.text.trim() });
    }
  }

  // Дедупликация: одна и та же строка могла попасть и в лог, и в летопись.
  const seen = new Set();
  const uniq = out.filter(e => {
    const k = e.day + '\u0001' + e.text;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Сортировка по дню с явным тай-брейком по порядку вставки: стабильность
  // Array.sort гарантируется не всеми движками, а детерминизм у нас — контракт.
  for (let i = 0; i < uniq.length; i++) uniq[i]._i = i;
  uniq.sort((a, b) => a.day - b.day || a._i - b._i);
  return uniq.map(e => ({ day: e.day, text: e.text }));
}

// Модель карточки. Возвращает null, только когда о цели нечего сказать даже
// имени (асSubject не сработал) — тогда вызывающий код просто не открывает
// карточку; пустая же ЛЕНТА — не повод прятать карточку, рисуется заглушка.
export function storyCard(sim, t) {
  const s = asSubject(sim, t);
  if (!s) return null;
  const v = s.v;
  const she = isWoman(v);
  const rows = [];
  const years = ageYears(v);
  rows.push({ k: 'Возраст', v: `${years} ${plural(years, 'год', 'года', 'лет')}` });
  rows.push({ k: 'Статус', v: statusOf(sim, v) });
  // Ремесло показываем формулировкой модуля населения: «опытный рудокоп»
  // несёт ранг в самом слове — второй строки «ранг N» карточке не нужно.
  if (v.prof || v.job !== undefined) rows.push({ k: 'Ремесло', v: v.prof ? profTitle(v) : jobRu(v) });
  const trait = traitTitle(v);
  if (trait) rows.push({ k: 'Характер', v: trait });
  const kin = kinOf(sim, v);
  if (kin) rows.push({ k: 'Родня', v: kin });
  // Мёртвый герой остаётся в истории сознательно: follow-камера могла вести
  // его до последнего вздоха, и гасить биографию в момент смерти — значит
  // выбрасывать финал, ради которого ленту и читают.
  if (!(numOr(v.hp, 1) > 0)) {
    rows.push({ k: 'Судьба', v: she ? 'Покинула мир живых' : 'Покинул мир живых', cls: 'bad' });
  }

  const all = storyOf(sim, t);
  const cut = Math.max(0, all.length - FEED_MAX);
  const feed = all.slice(cut).map(e => ({ label: fmtDay(e.day), text: e.text }));
  return {
    title: v.name,
    emoji: s.ruler ? '👑' : '🧍',
    rows,
    feed,
    earlier: cut,
  };
}

// Разметка одной детерминированной строкой. Контракт с DOM-частью — только
// data-ft-close; никаких id и случайных чисел внутри, поэтому два вызова
// на одном состоянии обязаны дать байт-в-байт равный HTML.
export function storyHtml(card) {
  if (!card) return '';
  const rows = card.rows.map(r =>
    `<div class="ft-st-row"><span>${esc(r.k)}</span><b${r.cls ? ` class="${r.cls}"` : ''}>${esc(r.v)}</b></div>`
  ).join('');
  let feed;
  if (card.feed && card.feed.length) {
    const evs = card.feed.map(e =>
      `<div class="ft-st-ev"><span class="ft-st-day">${esc(e.label)}</span>` +
      `<span class="ft-st-txt">${esc(e.text)}</span></div>`
    ).join('');
    const more = card.earlier > 0
      ? `<div class="ft-st-more">…и ещё ${card.earlier} более ранних записей</div>`
      : '';
    feed = `${more}${evs}`;
  } else {
    // Вежливая заглушка: житель есть, фактов о нём летопись не сохранила.
    feed = '<div class="ft-st-empty">Летопись пока молчит: ни упоминаний, ни вех.</div>';
  }
  return `<div class="ft-st-head">
    <span class="ft-st-prev" aria-hidden="true">${card.emoji}</span>
    <span class="ft-st-ttl">${esc(card.title)}</span>
    <button class="ft-st-x" type="button" data-ft-close aria-label="Закрыть">×</button>
  </div>
  <div class="ft-st-body">${rows}</div>
  <div class="ft-st-feed"><div class="ft-st-cap">Лента жизни</div>${feed}</div>`;
}

// ---------- Разрешение цели follow-камеры (G5) ----------

// Читает состояние window.__frontierFollow (передано параметром F — функция
// чистая и тестируется в node). Ключи ростера follow_cam.js:
//   'ruler'  — трон (жителя-объекта у него нет),
//   'p<pid>' — житель по постоянному идентификатору population.js,
//   'i<idx>' — житель по индексу массива (до первой синхронизации pid).
export function followTarget(F) {
  const st = F && F.__frontierFollow;
  if (!st || st.phase !== 'follow') return null;
  const sim = F.sim;
  if (!sim) return null;
  const key = st.key;
  if (key === 'ruler') {
    const pol = sim.politics && sim.politics.state;
    return pol && pol.ruler ? { kind: 'ruler' } : null;
  }
  const vs = Array.isArray(sim.villagers) ? sim.villagers : [];
  if (typeof key === 'string' && key.charAt(0) === 'p') {
    const pid = Number(key.slice(1));
    const v = vs.find(x => x && x.pid === pid);
    return v ? { kind: 'v', v } : null;
  }
  if (typeof key === 'string' && key.charAt(0) === 'i') {
    const i = Number(key.slice(1));
    const v = Number.isInteger(i) ? vs[i] : null;
    return v && v.hp > 0 ? { kind: 'v', v } : null;
  }
  return null;
}

// ===== DOM-ЧАСТЬ (браузер; в node не исполняется) =====

function ensureCss() {
  // Инжект по образцу dock/inspector: стилю нечего делать в отдельном файле
  // сборки, идемпотентность — через id тега. Цвета — только переменные
  // theme.css, чтобы карточка пережила смену палитры.
  if (document.getElementById('ft-story-css')) return;
  const st = document.createElement('style');
  st.id = 'ft-story-css';
  st.textContent = `
#ftStory {
  position: fixed;
  /* 84px > DOCK_FREE_PX(76): Command Dock внизу кликабелен целиком */
  right: 10px;
  bottom: calc(${DOCK_FREE_PX + 8}px + var(--safe-bottom, 0px));
  z-index: 27; /* инспектор 26 · док 30 · консоль 35 · модалки 70 */
  width: min(300px, calc(100vw - 20px));
  max-height: calc(100vh - ${DOCK_FREE_PX + 24}px);
  background: var(--panel, rgba(20,18,16,0.92));
  border: 1px solid var(--panel-border, rgba(201,162,39,0.35));
  border-radius: var(--radius, 12px);
  color: var(--text, #ece5d3);
  font-size: 12px; line-height: 1.45;
  box-shadow: 0 10px 30px rgba(0,0,0,0.45), inset 0 1px 0 rgba(201,162,39,0.14);
  display: none; padding: 10px 12px;
  overflow: hidden;
}
#ftStory.show { display: flex; flex-direction: column; }
.ft-st-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.ft-st-prev {
  flex: 0 0 auto; width: 34px; height: 34px; border-radius: 8px;
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.07);
  display: flex; align-items: center; justify-content: center; font-size: 19px;
}
.ft-st-ttl {
  flex: 1 1 auto; min-width: 0; font-family: var(--serif, Georgia, serif);
  font-weight: 700; letter-spacing: 0.3px; font-size: 13px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ft-st-x {
  flex: 0 0 auto; width: 24px; height: 24px; border-radius: 7px;
  border: 1px solid rgba(255,255,255,0.12); background: transparent;
  color: var(--dim, #a89f8e); font-size: 14px; line-height: 1; cursor: pointer;
}
.ft-st-x:hover { color: var(--text); border-color: var(--accent, #c9a227); }
.ft-st-row {
  display: flex; justify-content: space-between; gap: 10px;
  padding: 3px 0; border-bottom: 1px solid rgba(255,255,255,0.05);
}
.ft-st-row span { color: var(--dim, #a89f8e); flex: 0 0 auto; }
.ft-st-row b { font-family: var(--mono, monospace); font-weight: 600; text-align: right; min-width: 0; overflow-wrap: anywhere; }
.ft-st-row b.bad { color: var(--bad, #ef9a9a); }
.ft-st-feed {
  margin-top: 8px; min-height: 0; overflow-y: auto;
  border-top: 1px solid rgba(201,162,39,0.25); padding-top: 6px;
  scrollbar-width: thin;
}
.ft-st-cap {
  font-family: var(--serif, Georgia, serif); font-weight: 700;
  color: var(--accent, #c9a227); letter-spacing: 0.4px;
  font-size: 11px; text-transform: uppercase; margin-bottom: 4px;
}
.ft-st-more { color: var(--dim, #a89f8e); font-style: italic; padding: 2px 0 4px; }
.ft-st-ev { display: flex; gap: 8px; padding: 3px 0; align-items: baseline; }
.ft-st-day {
  flex: 0 0 auto; min-width: 64px; text-align: right;
  font-family: var(--mono, monospace); font-size: 10px;
  color: var(--accent, #c9a227); opacity: 0.85; white-space: nowrap;
}
.ft-st-txt { min-width: 0; overflow-wrap: anywhere; }
.ft-st-empty { color: var(--dim, #a89f8e); font-style: italic; padding: 6px 0; }
/* Телефон: как у инспектора — поднимаем над связкой «нижний шит → док →
   миникарта», чей угол посчитан в minimap.js. */
@media (max-width: 820px) {
  #ftStory { right: 8px; bottom: calc(168px + var(--safe-bottom, 0px)); }
}`;
  document.head.appendChild(st);
}

let root = null;
let target = null;   // каноническая цель {kind:'v',v} | {kind:'ruler'} — ссылки на живые данные sim
let lastHtml = '';

function ensureRoot() {
  if (root) return root;
  root = document.createElement('div');
  root.id = 'ftStory';
  document.body.appendChild(root);
  // Один делегированный слушатель на всю жизнь карточки: крестик
  // перечитывается после каждой перерисовки innerHTML.
  root.addEventListener('click', e => {
    const close = e.target.closest && e.target.closest('[data-ft-close]');
    if (close) hide();
  });
  return root;
}

function hide() {
  target = null;
  lastHtml = '';
  if (root) root.classList.remove('show');
}

function sameTarget(a, b) {
  if (!a || !b) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'v') return a.v === b.v;
  return true; // трон один — любые ruler-цели считаются одной и той же
}

function openTarget(t) {
  target = t;
  refresh(true);
}

function refresh(force) {
  const F = window.__frontier;
  if (!root || !target) return;
  const sim = F && F.sim;
  if (!sim || !Number.isFinite(sim.day)) return;
  const card = storyCard(sim, target);
  if (!card) { hide(); return; }
  const html = storyHtml(card);
  if (!force && html === lastHtml) return;
  lastHtml = html;
  root.innerHTML = html;
  root.classList.add('show');
}

// --- ввод: та же схема, что у main.js/inspector.js (pointerdown/up + порог) ---

let downPos = null, downMaxPointers = 0;

function bindInput() {
  const canvas = document.getElementById('game');
  if (!canvas) return;

  canvas.addEventListener('pointerdown', e => {
    downPos = { x: e.clientX, y: e.clientY };
    downMaxPointers = 1;
  }, { passive: true });
  canvas.addEventListener('pointermove', e => {
    if (!downPos) return;
    // Второй палец (щипок зума) — жест камеры, не выбор: запоминаем максимум,
    // чтобы click после щипка не открыл карточку в точке «среднего пальца».
    if (e.pointerType === 'touch') downMaxPointers = Math.max(downMaxPointers, 1);
  }, { passive: true });
  canvas.addEventListener('pointercancel', () => { downPos = null; }, { passive: true });

  canvas.addEventListener('click', e => {
    const F = window.__frontier;
    if (!F || !F.sim || !F.renderer) return;
    const sim = F.sim;
    // Пока игрок ставит здание, кликом владеет призрак стройки (main.js).
    if (sim.placing) { hide(); return; }
    // Щипок двумя пальцами — это зум, а не выбор объекта.
    if (downMaxPointers > 1) { downPos = null; downMaxPointers = 0; return; }
    // Перетащили карту — клика не было.
    if (downPos && Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 6) {
      downPos = null; return;
    }
    downPos = null;
    // Миникарта обрабатывается своим обработчиком main.js (тап-прыжок камеры).
    const m = F.renderer.minimapRect;
    if (m && e.clientX >= m.x && e.clientX <= m.x + m.w && e.clientY >= m.y && e.clientY <= m.y + m.h) {
      return;
    }
    const w = F.renderer.screenToWorld(e.clientX, e.clientY);
    // Хит-тест — из существующего конвейера выбора (тот же pick, что рисует
    // кольцо выделения); сведение целей — переиспользованная модель
    // инспектора, чтобы приоритет «житель важнее здания» был ровно один.
    const hit = F.renderer.select
      ? F.renderer.select.pick(sim, w.x, w.y)
      : { kind: 't', b: null, v: null };
    const t = resolveTargetOf(sim, hit, w.x, w.y);
    if (!t || t.kind !== 'v') { hide(); return; } // здания и города — территория инспектора
    // Повторный клик по тому же жителю закрывает карточку — как кольцо
    // выделения в select.selectAt снимается повторным тапом.
    if (sameTarget(target, t)) { hide(); return; }
    openTarget(t);
  });

  // «Клик вне» — любое нажатие вне карточки гасит её. Захват ДО чужих
  // обработчиков: закрытие не должно зависеть от чужого stopPropagation.
  document.addEventListener('pointerdown', e => {
    if (root && root.classList.contains('show') && !root.contains(e.target)) hide();
  }, true);

  // Пересчёт открытой карточки и подсмотр цели follow-камеры. innerHTML
  // переставляется только при изменении строки.
  setInterval(() => {
    try { followSync(); refresh(false); } catch { /* кадр без данных не повод ронять таймер */ }
  }, STORY_POLL_MS);
}

function resolveTargetOf(sim, hit, wx, wy) {
  // Локальная копия сведения инспектора, обрезанная до нужного: города нам
  // не нужны, а тянуть следом settlementView ради отсечённого результата —
  // лишняя работа на каждый клик.
  if (hit && hit.kind === 'v' && hit.v) return { kind: 'v', v: hit.v };
  if (hit && hit.kind === 'b' && hit.b) return { kind: 'b', b: hit.b };
  void wx; void wy;
  return null;
}

// Подсмотр цели follow-камеры. Правило смены: режим наблюдателя перехватывает
// карточку ТОЛЬКО когда он сам выбрал новую цель (ключ сменился) — иначе
// ручной клик по соседу мгновенно затирался бы следующим тиком опроса.
let adoptedKey = null;

function followSync() {
  const F = window.__frontier;
  const st = F && F.__frontierFollow;
  if (!st || st.phase !== 'follow' || typeof st.key !== 'string') return;
  if (st.key === adoptedKey) return; // эту цель уже показывали
  const t = followTarget(F);
  if (!t) return;
  adoptedKey = st.key;
  openTarget(t);
}

function start() {
  ensureCss();
  ensureRoot();
  bindInput();
}

// Публикация API для соседних агентов (G5/follow-камера и ручные сценарии).
// Повторный запуск в браузере гасится флагом window — как у инспектора.
if (typeof document !== 'undefined' && typeof window !== 'undefined' && !window.__frontierStory) {
  window.__frontierStory = {
    version: 1,
    // setTarget(villager | {kind:'ruler'} | 'ruler' | null)
    setTarget(t) {
      if (!t) { hide(); return; }
      // Явная цель сильнее автоподсмотра: followSync примет ключ камеры лишь
      // однажды, поэтому чужие вызовы setTarget не затираются следующим тиком.
      openTarget(t);
    },
    clear: hide,
    isOpen: () => !!target,
  };
  start();
}
