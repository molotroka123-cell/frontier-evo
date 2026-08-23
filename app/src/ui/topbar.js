// ui/topbar.js — компактная верхняя полоса ресурсов «ФРОНТИР» (W3).
//
// ЗАЧЕМ. Родная #topbar перегружена: десять пилюль, эпоха, дата — на узком
// экране она уезжает горизонтальной прокруткой. Эта полоса — читаемая выжимка
// для взгляда: Золото/Дерево/Камень/Сталь/Еда/Население крупным числом, с
// ёмкостью склада и бейджем суточного прироста (+14/д зелёным, −3/д красным).
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

// Одна пилюля полосы строкой — чистая функция: и тестам видна, и innerHTML
// меняется только когда строка реально изменилась (меньше перерисовок).
export function pillHtml(item, value, cap, badge) {
  const lim = cap && cap < UNLIMITED_CAP;
  const full = lim && value >= cap - 0.5;
  // cls (ft-gold/ft-food) нужен CSS'у свёрнутого режима: какие два чипа остаются.
  return `<span class="ft-res${item.cls ? ' ' + item.cls : ''}${full ? ' ft-full' : ''}" title="${item.ru}">
    <span class="ft-ic" aria-hidden="true">${item.icon}</span>
    <b class="ft-num">${fmtNum(value)}</b>${lim ? `<small class="ft-cap">/${fmtNum(cap)}</small>` : ''}
    <i class="ft-rate ${badge.cls}">${badge.text}</i>
  </span>`;
}

// Население: прирост людьми ведёт само жильё, бейдж суточного прироста здесь
// только путает — вместо него свободных мест нет/есть хвостом.
export function popPillHtml(pop, cap) {
  const room = Math.max(0, (Number(cap) || 0) - pop);
  return `<span class="ft-res ft-pop" title="${POP_RU}">
    <span class="ft-ic" aria-hidden="true">${POP_ICON}</span>
    <b class="ft-num">${fmtNum(pop)}</b><small class="ft-cap">/${fmtNum(cap)}</small>
    ${room > 0 ? `<i class="ft-rate off">+${fmtNum(room)}</i>` : '<i class="ft-rate dn">полно</i>'}
  </span>`;
}

// ===== DOM-ЧАСТЬ (браузер; в node не исполняется) =====

function ensureCss() {
  if (document.getElementById('ft-topbar-css')) return;
  const st = document.createElement('style');
  st.id = 'ft-topbar-css';
  st.textContent = `
#ftResBar {
  position: fixed; top: calc(44px + var(--safe-top, 0px)); left: 50%;
  transform: translateX(-50%); z-index: 18;
  display: flex; align-items: center; gap: 4px; max-width: min(94vw, 640px);
  padding: 4px 6px;
  background: rgba(20, 18, 16, 0.72);
  -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
  border: 1px solid var(--gold-line, var(--panel-border));
  border-radius: 14px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
@supports not ((backdrop-filter: blur(10px)) or (-webkit-backdrop-filter: blur(10px))) {
  #ftResBar { background: rgba(20, 18, 16, 0.95); }
}
/* Центр верхней кромки свободен у всех оверлеев игры (alerts слева, timeBox
   справа, тосты ниже), но перекрытие всё равно мягкое: pointer-events оставляем,
   z-index держим НИЖЕ родных полос (19/20), чтобы они всегда были доступны. */
.ft-res {
  display: inline-flex; align-items: baseline; gap: 3px;
  padding: 2px 8px; border-radius: 999px;
  background: rgba(236, 229, 211, 0.05);
  border: 1px solid rgba(201, 162, 39, 0.16);
  white-space: nowrap;
}
.ft-res .ft-ic { font-size: 13px; align-self: center; }
.ft-res .ft-num { font-family: var(--mono, monospace); font-size: 15px; font-weight: 700; color: var(--text, #ece5d3); }
.ft-res .ft-cap { font-family: var(--mono, monospace); font-size: 10px; color: var(--dim, #a89f8e); }
.ft-res .ft-rate { font-style: normal; font-size: 9px; font-weight: 700; margin-left: 1px; letter-spacing: -0.2px; }
.ft-res .ft-rate.up { color: var(--good, #93de93); }
.ft-res .ft-rate.dn { color: var(--bad, #ef9a9a); }
.ft-res .ft-rate.zero { color: var(--dim, #a89f8e); }
.ft-res .ft-rate.off { color: var(--dim, #a89f8e); opacity: 0.7; }
.ft-res.ft-full { border-color: rgba(232, 200, 134, 0.55); background: rgba(232, 200, 134, 0.12); }
.ft-res.ft-full .ft-num { color: var(--warn, #e8c886); }
#ftResToggle {
  flex-shrink: 0; width: 26px; height: 26px; margin-left: 2px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; color: var(--accent, #c9a227);
  border: 1px solid rgba(201, 162, 39, 0.3); border-radius: 50%;
  cursor: pointer; font-size: 11px; line-height: 1;
}
#ftResToggle:hover { background: rgba(201, 162, 39, 0.16); }
/* Свёрнутый режим: остаются чип-кнопка и две главные цифры — золото и еда:
   это валюта решений «могу ли строить/пережду ли зиму». */
#ftResBar.collapsed .ft-res { display: none; }
#ftResBar.collapsed .ft-res.ft-gold, #ftResBar.collapsed .ft-res.ft-food { display: inline-flex; }
#ftResBar.collapsed .ft-res .ft-cap, #ftResBar.collapsed .ft-res .ft-rate { display: none; }
@media (max-width: 820px) {
  #ftResBar { gap: 3px; padding: 3px 5px; top: calc(40px + var(--safe-top, 0px)); }
  .ft-res .ft-num { font-size: 13px; }
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
    parts.push(pillHtml({ ...r, cls }, sim.res[r.id] || 0, caps[r.id], b));
  }
  parts.push(popPillHtml(sim.villagers.length, typeof sim.housingCap === 'function' ? sim.housingCap() : 0));
  const html = parts.join('');
  // innerHTML трогаем только по изменению: полоса обновляется 4 раза в секунду,
  // а числа меняются гораздо реже — экономим layout браузера.
  if (html !== render._last) { render._last = html; applySlots(root, parts); }
  return t0;
}

// Слоты держат постоянными узлами: классы ft-gold/ft-food из pillHtml нужны
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
  window.__frontierTopbar = { version: 1 };
  start();
}

/* ПОДКЛЮЧЕНИЕ — app/src/main.js (index.html правок НЕ требует)

   ЯКОРЬ (строка 11 main.js; проверено Grep: совпадений в файле = 1):

import { tileAt } from './core/world.js';

   ВСТАВИТЬ СРАЗУ ПОСЛЕ:

// Командный док и верхняя полоса ресурсов W3: сами ставят свой DOM и CSS.
import './ui/dock.js';
import './ui/topbar.js';

   Модуль ничего не требует от порядка инициализации: до первого тика, где есть
   window.__frontier.sim, он молчит. В index.html вставок нет — скрипт один
   (<script type="module" src="src/main.js"></script>, строка 366; Grep:
   совпадений = 1), и dev-режим, и frontier.html получают модуль через bundle.
*/
