// ui/topbar.js — «приборная» полоса ресурсов «ФРОНТИР» в духе C&C: Generals.
//
// ЗАЧЕМ. Родная #topbar перегружена: десять пилюль, эпоха, дата — на узком
// экране она уезжает горизонтальной прокруткой. Эта полоса — читаемая выжимка
// для взгляда: Золото/Дерево/Камень/Сталь/Еда/Население крупным числом, с
// ёмкостью склада и бейджем суточного прироста (+14/д зелёным, −3/д красным).
// Внешность — военный металл: сегменты-ячейки со скошенными углами (clip-path),
// тонкие янтарные риски по краям ячеек, моно-цифры табличного типа с фикс
// шириной — разряды не прыгают при тике производства.
//
// ОТКУДА ПРИРОСТ. Ядро не хранит скоростей добычи (см. комментарий над
// tickRates в ui/hud.js: производство размазано по жителям и списывается
// кусками), готовых полей прироста в sim нет. Поэтому модуль меряет сам —
// дельтой между границами игровых суток: запоминает склад в момент смены дня и
// делит разницу на число прошедших дней. Никаких мутаций sim: только чтение
// sim.res / sim.resCap / sim.day и методов-читалок (villagers.length,
// housingCap()). Между сменами суток показывается последний замер — так число
// не мигает четыре раза в секунду.
//
// СЛОЙ И ЗАПУСК. Чистые функции (формат чисел, бейдж, трекер прироста)
// отделены маркером DOM-части и тестируются в node без DOM; весь рантайм
// спрятан за typeof document. Опрос window.__frontier.sim каждые 250 мс — тот
// же паттерн, что в menuskin.js: main.js подменяет объект симуляции при новой
// партии/загрузке, трекер замечает подмену по ссылке и начинает замер заново.
// На ширине ≤ 820 px (брейкпоинт index.html) полоса стартует свёрнутой до
// кнопки-чипа; разворот — кликом.

// ===== ЧИСТАЯ ЧАСТЬ (без DOM; ниже маркер DOM-части — тесты сканируют её) =====

// Порядок — как в задании: деньги и материалы первыми, еда и люди последними.
// ru-имя «Сталь», а не «Железо»: так ресурс назван в core/data.js (RES), и
// игрок видит одно слово везде.
export const BAR_RES = [
  { id: 'gold',  icon: '🪙', ru: 'Золото' },
  { id: 'wood',  icon: '🪵', ru: 'Дерево' },
  { id: 'stone', icon: '🪨', ru: 'Камень' },
  { id: 'steel', icon: '⚙️', ru: 'Сталь' },
  { id: 'food',  icon: '🍞', ru: 'Еда' },
];
export const POP_ICON = '👥';
export const POP_RU = 'Население';

// Потолки склада ядро считает бесконечными как 99999 (resCap.gold/knowledge) —
// знаменатель у таких ресурсов не показываем, как и родная #topbar.
export const UNLIMITED_CAP = 99999;

// Крупное целое: дробные остатки от производства игроку не нужны, а тысячи
// разделяем узким пробелом, чтобы 12345 читалось с одного взгляда.
export function fmtNum(v) {
  const n = Math.max(0, Math.floor(Number(v) || 0));
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F');
}

// Бейдж суточного прироста. Типографский минус (−, U+2212): дефис в интерфейсе
// выглядит опечаткой. Неизвестный замер (первый день партии) даёт null —
// бейдж тогда рисуется точкой, а не нулём, который был бы ложью.
export function rateBadge(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return { text: '·', cls: 'off' };
  const a = Math.abs(v);
  if (a < 0.05) return { text: `0/д`, cls: 'zero' };
  const num = a >= 10 ? Math.round(a) : +a.toFixed(1);
  return { text: `${v > 0 ? '+' : '\u2212'}${num}/д`, cls: v > 0 ? 'up' : 'dn' };
}

// Моментальный снимок склада: только данные, нужные трекеру, без ссылок на sim.
export function snapshotOf(simLike) {
  const res = {};
  for (const r of BAR_RES) res[r.id] = Number(simLike.res && simLike.res[r.id]) || 0;
  return { day: Math.floor(Number(simLike.day) || 0), res };
}

// Шаг трекера прироста. Семантика:
//   • первый вызов или скачок дня назад (загрузка сейва, новая партия) —
//     замер начинается заново, rates = null;
//   • день тот же — возвращаем прошлый замер без пересчёта;
//   • день сдвинулся на dN>0 — rates = Δсклада / dN за сутки.
// Функция чистая: принимает и возвращает трекер, ничего не помнит сама.
export function advanceRates(tracker, snap) {
  if (!tracker || tracker.day === null || tracker.day === undefined ||
      snap.day < tracker.day || tracker.res === null) {
    return { day: snap.day, res: { ...snap.res }, rates: null };
  }
  if (snap.day === tracker.day) {
    return { day: tracker.day, res: tracker.res, rates: tracker.rates || null };
  }
  const span = snap.day - tracker.day;
  const rates = {};
  for (const r of BAR_RES) {
    rates[r.id] = ((snap.res[r.id] - tracker.res[r.id]) / span);
  }
  return { day: snap.day, res: { ...snap.res }, rates };
}

// Одна ячейка-сегмент полосы строкой — чистая функция: и тестам видна, и
// innerHTML меняется только когда строка реально изменилась (меньше перерисовок).
// Структура: внешняя грань (.ft-res, тёмно-янтарная рамка под clip-path) и
// внутренняя плита (.ft-res-in) с содержимым — пара даёт эффект фрезерованной
// пластины без настоящих border, которые clip-path отрезал бы на скосах.
export function segHtml(item, value, cap, badge) {
  const lim = cap && cap < UNLIMITED_CAP;
  const full = lim && value >= cap - 0.5;
  // cls (ft-gold/ft-food) нужен CSS'у свёрнутого режима: какие два чипа остаются.
  return `<span class="ft-res${item.cls ? ' ' + item.cls : ''}${full ? ' ft-full' : ''}" title="${item.ru}">
    <span class="ft-res-in">
      <span class="ft-ic" aria-hidden="true">${item.icon}</span>
      <b class="ft-num">${fmtNum(value)}</b>${lim ? `<small class="ft-cap">/${fmtNum(cap)}</small>` : ''}
      <i class="ft-rate ${badge.cls}">${badge.text}</i>
    </span>
  </span>`;
}

// Население: прирост людьми ведёт само жильё, бейдж суточного прироста здесь
// только путает — вместо него свободных мест нет/есть хвостом.
export function popSegHtml(pop, cap) {
  const room = Math.max(0, (Number(cap) || 0) - pop);
  return `<span class="ft-res ft-pop" title="${POP_RU}">
    <span class="ft-res-in">
      <span class="ft-ic" aria-hidden="true">${POP_ICON}</span>
      <b class="ft-num">${fmtNum(pop)}</b><small class="ft-cap">/${fmtNum(cap)}</small>
      ${room > 0 ? `<i class="ft-rate off">+${fmtNum(room)}</i>` : `<i class="ft-rate dn">полно</i>`}
    </span>
  </span>`;
}

// Исторические имена экспортов сохранены (тесты и соседи могли их читать):
// пилюли стали сегментами, но контракт функций прежний.
const pillHtml = segHtml;
const popPillHtml = popSegHtml;
export { pillHtml, popPillHtml };

// ===== DOM-ЧАСТЬ (браузер; в node не исполняется) =====

function ensureCss() {
  if (document.getElementById('ft-topbar-css')) return;
  const st = document.createElement('style');
  st.id = 'ft-topbar-css';
  st.textContent = `
#ftResBar {
  --ft-metal: #1a1d18;      /* базовый тёмный металл прибора */
  --ft-metal-hi: #242820;   /* верхняя фаска */
  --ft-metal-lo: #101309;   /* нижняя фаска */
  --ft-amber: #c8a24a;      /* янтарь: риски, рамки, активные состояния */
  --ft-red: #b0413e;        /* красный тревоги: минусовой прирост, полный склад */
  --ft-cut: polygon(7px 0, 100% 0, 100% calc(100% - 7px),
                    calc(100% - 7px) 100%, 0 100%, 0 7px); /* скос двух углов */
  position: fixed; top: calc(44px + var(--safe-top, 0px)); left: 50%;
  transform: translateX(-50%); z-index: 18;
  display: flex; align-items: center; gap: 4px; max-width: min(94vw, 880px);
  padding: 4px 8px;
  background-color: var(--ft-metal);
  background-image:
    repeating-linear-gradient(135deg, rgba(255,255,255,0.02) 0 2px, transparent 2px 7px),
    linear-gradient(180deg, #262b21 0%, var(--ft-metal) 45%, var(--ft-metal-lo) 100%);
  /* Не пиллюли: приборная планка — прямые кромки, янтарный шов сверху. */
  border-top: 1px solid rgba(200, 162, 74, 0.75);
  border-bottom: 1px solid rgba(0, 0, 0, 0.9);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.05),
    inset 0 -1px 0 rgba(255, 255, 255, 0.03),
    0 6px 18px rgba(0, 0, 0, 0.45);
}
@supports not ((backdrop-filter: blur(10px)) or (-webkit-backdrop-filter: blur(10px))) {
  #ftResBar { background-color: #14170f; }
}
/* Центр верхней кромки свободен у всех оверлеев игры (alerts слева, timeBox
   справа, тосты ниже), но перекрытие всё равно мягкое: pointer-events оставляем,
   z-index держим НИЖЕ родных полос (19/20), чтобы они всегда были доступны. */

/* Сегмент-ячейка: тёмно-янтарная грань (рамка) + внутренняя плита. Настоящий
   border нельзя — clip-path режет углы вместе с ним, поэтому рамка сделана
   фоном внешнего слоя, а внутренняя вставка повторяет скос со сдвигом 1px. */
.ft-res {
  position: relative; padding: 0; white-space: nowrap;
  background: linear-gradient(180deg, rgba(200, 162, 74, 0.38), rgba(200, 162, 74, 0.16));
  clip-path: var(--ft-cut);
}
.ft-res-in {
  position: relative; margin: 1px;
  display: inline-flex; align-items: center; gap: 3px;
  padding: 2px 8px 2px 10px;
  background:
    linear-gradient(180deg, #22261e 0%, var(--ft-metal) 55%, #15180f 100%);
  clip-path: var(--ft-cut);
}
/* Тонкие янтарные риски по краям плиты — «риски шкалы», как на приборной доске:
   делят ряд чисел на ячейки даже без чтения подписей. */
.ft-res-in::before, .ft-res-in::after {
  content: ''; position: absolute; top: 5px; bottom: 5px; width: 1px;
  background: linear-gradient(180deg, transparent, rgba(200, 162, 74, 0.34) 30%, rgba(200, 162, 74, 0.34) 70%, transparent);
}
.ft-res-in::before { left: 5px; }
.ft-res-in::after { right: 5px; }

.ft-res .ft-ic { font-size: 12px; align-self: center; }
/* Числа — моно и табличные, ширина фиксирована в ch: 999→1000 не двигает
   соседние ячейки, глаз не теряет позицию значения. */
.ft-res .ft-num {
  font-family: var(--mono, monospace); font-size: 14px; font-weight: 700;
  font-variant-numeric: tabular-nums; min-width: 4.5ch; text-align: right;
  color: var(--text, #ece5d3);
}
.ft-res .ft-cap { font-family: var(--mono, monospace); font-size: 9px; color: #8a8577; }
.ft-res .ft-rate { font-style: normal; font-size: 8px; font-weight: 700; margin-left: 1px; letter-spacing: -0.2px; }
.ft-res .ft-rate.up { color: #8bbf5f; }
/* Красный семейства #b0413e, чуть осветлённый для контраста на тёмном металле:
   сам #b0413e оставлен рамкам и состоянию полного склада. */
.ft-res .ft-rate.dn { color: #c95a52; }
.ft-res .ft-rate.zero { color: #8a8577; }
.ft-res .ft-rate.off { color: #8a8577; opacity: 0.7; }
/* Полный склад — тревога: янтарная грань вспыхивает, число греется. */
.ft-res.ft-full { background: linear-gradient(180deg, rgba(200, 162, 74, 0.75), rgba(176, 65, 62, 0.45)); }
.ft-res.ft-full .ft-num { color: var(--warn, #e8c886); }
#ftResToggle {
  flex-shrink: 0; width: 26px; height: 26px; margin-left: 2px;
  display: inline-flex; align-items: center; justify-content: center;
  background: linear-gradient(180deg, #22261e, #14170f);
  color: var(--accent, #c9a227);
  border: 1px solid rgba(200, 162, 74, 0.4);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
  cursor: pointer; font-size: 11px; line-height: 1;
}
#ftResToggle:hover { background: rgba(200, 162, 74, 0.18); }
/* Свёрнутый режим: остаются чип-кнопка и две главные цифры — золото и еда:
   это валюта решений «могу ли строить/пережду ли зиму». */
#ftResBar.collapsed .ft-res { display: none; }
#ftResBar.collapsed .ft-res.ft-gold, #ftResBar.collapsed .ft-res.ft-food { display: inline-flex; }
#ftResBar.collapsed .ft-res .ft-cap, #ftResBar.collapsed .ft-res .ft-rate { display: none; }
@media (max-width: 820px) {
  /* На телефоне родной timeBox (пауза/скорость) занимает ту же верхнюю строку:
     опускаем прибор ниже него, чтобы плиты не срастались. */
  #ftResBar { gap: 3px; padding: 3px 6px; top: calc(80px + var(--safe-top, 0px)); }
  .ft-res-in { padding: 2px 6px 2px 8px; }
  .ft-res .ft-num { font-size: 12px; min-width: 3.5ch; }
}`;
  document.head.appendChild(st);
}

function buildRoot() {
  let root = document.getElementById('ftResBar');
  if (!root) {
    root = document.createElement('div');
    root.id = 'ftResBar';
    root.innerHTML =
      BAR_RES.map(r => `<span data-ft-slot="${r.id}"></span>`).join('') +
      `<span data-ft-slot="pop"></span>` +
      `<button id="ftResToggle" type="button" title="Свернуть/развернуть ресурсы" aria-label="Свернуть или развернуть полосу ресурсов">▾</button>`;
    document.body.appendChild(root);
    root.querySelector('#ftResToggle').addEventListener('click', () => {
      const collapsed = root.classList.toggle('collapsed');
      root.querySelector('#ftResToggle').textContent = collapsed ? '▸' : '▾';
    });
  }
  // На телефоне стартуем свёрнутыми: пять крупных чисел плюс родная шапка
  // просто не влезают в 390 px, а золото/еда свёрнутый режим оставляет.
  if (typeof matchMedia === 'function' && matchMedia('(max-width: 820px)').matches &&
      !root.dataset.ftInit) {
    root.classList.add('collapsed');
    root.querySelector('#ftResToggle').textContent = '▸';
  }
  root.dataset.ftInit = '1';
  return root;
}

function render(root, sim, tracker) {
  // Смена объекта симуляции (новая партия, загрузка сейва) определяется
  // снаружи: сюда приходит уже сброшенный трекер.
  const t0 = advanceRates(tracker, snapshotOf(sim));
  const caps = sim.resCap || {};
  const parts = [];
  for (const r of BAR_RES) {
    const b = rateBadge(t0.rates ? t0.rates[r.id] : null);
    const cls = r.id === 'gold' ? 'ft-gold' : r.id === 'food' ? 'ft-food' : '';
    parts.push(segHtml({ ...r, cls }, sim.res[r.id] || 0, caps[r.id], b));
  }
  parts.push(popSegHtml(sim.villagers.length, typeof sim.housingCap === 'function' ? sim.housingCap() : 0));
  const html = parts.join('');
  // innerHTML трогаем только по изменению: полоса обновляется 4 раза в секунду,
  // а числа меняются гораздо реже — экономим layout браузера.
  if (html !== render._last) { render._last = html; applySlots(root, parts); }
  return t0;
}

// Слоты держат постоянными узлами: классы ft-gold/ft-food из segHtml нужны
// CSS'у свёрнутого режима, поэтому содержимое раскладываем по обёрткам.
function applySlots(root, parts) {
  const slots = root.querySelectorAll('[data-ft-slot]');
  slots.forEach((slot, i) => {
    if (slot._ftHtml !== parts[i]) { slot._ftHtml = parts[i]; slot.innerHTML = parts[i]; }
  });
}

function start() {
  ensureCss();
  const root = buildRoot();
  let tracker = { day: null, res: null, sim: null, rates: null };
  setInterval(() => {
    try {
      const F = window.__frontier;
      const sim = F && F.sim;
      // Прячем до начала партии и на экране победы: там свои полноэкранные
      // композиции, и полоса поверх них — шум.
      const ov = document.getElementById('overlay');
      const win = document.getElementById('victory');
      const show = sim && F.hud && ov && ov.classList.contains('hidden') &&
        !(win && win.classList.contains('show'));
      root.style.display = show ? 'flex' : 'none';
      if (!show) return;
      const t0 = render(root, sim, tracker.sim === sim ? tracker : { day: null, res: null });
      // render возвращает только {day,res,rates}: ссылку на sim храним рядом,
      // чтобы на следующем тике узнать подмену симуляции (новая партия/сейв).
      tracker = { sim, day: t0.day, res: t0.res, rates: t0.rates };
    } catch { /* кадр без данных не повод ронять цикл */ }
  }, 250);
}

if (typeof document !== 'undefined' && typeof window !== 'undefined' && !window.__frontierTopbar) {
  window.__frontierTopbar = { version: 2 };
  start();
}

/* ПОДКЛЮЧЕНИЕ — app/src/main.js

   Модуль самоинициируется при импорте; в main.js строки 13–14 уже стоят:

import './ui/dock.js';
import './ui/topbar.js';

   Модуль ничего не требует от порядка инициализации: до первого тика, где есть
   window.__frontier.sim, он молчит. В index.html вставок нет — скрипт один
   (<script type="module" src="src/main.js"></script>), и dev-режим, и
   frontier.html получают модуль через bundle.
*/
