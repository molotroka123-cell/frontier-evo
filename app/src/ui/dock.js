// ui/dock.js — нижний плавающий Command Dock «ФРОНТИР» (W3).
//
// ЗАЧЕМ. Шестнадцать мелких вкладок в правой панели — рабочий инструмент, но не
// пульт: новичок не знает, где что лежит. Док — это шесть крупных дверей в уже
// существующие панели HUD. Он НЕ дублирует ни одной панели: единственное
// действие кнопки — hud.setTab(id) той вкладки, которая и так есть (см. TABS
// в ui/hud.js), плюс на телефоне — раскрыть нижний шит, как это делает родная
// кнопка шита (hud.bind: setTab + sheet.classList.add('open')).
//
// ПРАВИЛА СЛОЯ. Ядро не трогается вовсе: модуль читает window.__frontier.hud /
// .sim (их заводит main.js) и зовёт только публичные методы HUD. Стейт sim не
// мутается ни одним байтом. Файл самодостаточен: CSS инжектится <style> по
// образцу ensureCss из ui/menuskin.js, повторный запуск гасится флагом на
// window. Импорт модуля в node безопасен: вся DOM-часть спрятана за проверкой
// typeof document, поэтому чистые функции тестируются без подставного DOM.
//
// ДОСТУПНОСТЬ/ПОВЕДЕНИЕ:
//   • активная кнопка подсвечивается синхронно с hud.tab (опрос 300 мс);
//   • док прячется, пока висит стартовый экран (#overlay без .hidden),
//     идёт постановка здания (sim.placing — внизу уже свои ✓/✗) или открыт
//     экран победы;
//   • клик играет 'click' через уже существующий AudioEngine (если он есть).

// ===== ЧИСТАЯ ЧАСТЬ (без DOM; ниже маркер DOM-части — тесты сканируют её) =====

// Шесть дверей дока. tab — id ВЛОЖКИ HUD (TABS в ui/hud.js), а не своя сущность:
// «Законы» живут во вкладке «Держава» (panel_politics → renderPoliticsPanel,
// разделы «§ Свод законов»), отдельной вкладки законов в игре нет.
export const DOCK_BUTTONS = [
  { key: 'build',   icon: '🔨', ru: 'Строительство',    tab: 'build' },
  { key: 'dynasty', icon: '👑', ru: 'Династия',         tab: 'dynasty' },
  { key: 'army',    icon: '⚔',  ru: 'Войско',           tab: 'army' },
  { key: 'science', icon: '📜', ru: 'Наука',            tab: 'research' },
  { key: 'laws',    icon: '⚖',  ru: 'Законы',           tab: 'politics' },
  { key: 'map',     icon: '🗺', ru: 'Карта/Дипломатия', tab: 'diplo' },
];

// Брейкпоинт телефона — тот же, что у интерфейса игры (index.html,
// @media max-width 820px): на этой ширине вкладки живут в нижнем шите.
export const MOBILE_MAX_PX = 820;

// Кнопка дока, ведущая на вкладку, или null.
export function buttonByTab(tab) {
  return DOCK_BUTTONS.find(b => b.tab === tab) || null;
}

// key активной кнопки для текущей вкладки HUD ('' — вкладке дока нет).
export function activeKeyFor(tab) {
  const b = buttonByTab(tab);
  return b ? b.key : '';
}

// Разметка дока одной строкой — чистая функция ради тестов: порядок кнопок и
// data-атрибуты (единственный контракт с DOM-частью) видны без браузера.
export function dockHtml(buttons) {
  return buttons.map(b =>
    `<button class="ft-dock-btn" type="button" data-ft-key="${b.key}" data-ft-tab="${b.tab}"
      title="${b.ru}" aria-label="${b.ru}">
      <span class="ft-dock-ic" aria-hidden="true">${b.icon}</span>
      <span class="ft-dock-ru">${b.ru}</span>
    </button>`).join('');
}

// ===== DOM-ЧАСТЬ (браузер; в node не исполняется) =====

function ensureCss() {
  // Инжект по образцу menuskin.ensureCss, но без import.meta: стилю дока нечего
  // выносить в файл, а в собранном frontier.html import.meta пуст и только
  // бросил бы исключение. Идемпотентность — через id тега.
  if (document.getElementById('ft-dock-css')) return;
  const st = document.createElement('style');
  st.id = 'ft-dock-css';
  st.textContent = `
#ftDock {
  position: fixed; left: 50%; transform: translateX(-50%);
  bottom: calc(12px + var(--safe-bottom, 0px)); z-index: 30;
  display: none; gap: 6px; padding: 6px;
  background: rgba(20, 18, 16, 0.78);
  -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
  border: 1px solid var(--gold-line, var(--panel-border));
  border-radius: 16px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(201, 162, 39, 0.18);
}
@supports not ((backdrop-filter: blur(10px)) or (-webkit-backdrop-filter: blur(10px))) {
  #ftDock { background: rgba(20, 18, 16, 0.96); }
}
#ftDock.show { display: flex; }
.ft-dock-btn {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 2px; min-width: 74px; min-height: 54px; padding: 5px 10px;
  background: rgba(236, 229, 211, 0.04);
  color: var(--text, #ece5d3);
  border: 1px solid rgba(201, 162, 39, 0.22);
  border-radius: 12px; cursor: pointer;
  font-family: inherit; font-size: 10px; font-weight: 600;
  letter-spacing: 0.4px; text-transform: uppercase;
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}
.ft-dock-btn .ft-dock-ic { font-size: 19px; line-height: 1; }
@media (hover: hover) and (pointer: fine) {
  .ft-dock-btn:hover { background: rgba(201, 162, 39, 0.16); border-color: var(--accent, #c9a227); }
}
.ft-dock-btn:active { transform: translateY(1px); }
.ft-dock-btn.active {
  background: linear-gradient(180deg, #ddb645, #b78e1c);
  border-color: var(--accent, #c9a227);
  color: #1c1608;
}
/* Телефон: док растёт на всю ширину, кнопки тянутся поровну; поднимаем его
   над свёрнутым нижним шитом (56 px + ручка). */
@media (max-width: ${MOBILE_MAX_PX}px) {
  #ftDock { left: 8px; right: 8px; transform: none; bottom: calc(64px + var(--safe-bottom, 0px)); justify-content: space-between; }
  .ft-dock-btn { flex: 1 1 0; min-width: 0; padding: 5px 2px; }
  .ft-dock-btn .ft-dock-ru { font-size: 9px; letter-spacing: 0.2px; }
}`;
  document.head.appendChild(st);
}

// Один слушатель на весь док (делегирование): панели пересоздаются, а кнопки
// дока постоянны — вешать шесть обработчиков незачем.
function bindClicks(root) {
  root.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('[data-ft-tab]');
    if (!btn || btn.disabled) return;
    const F = window.__frontier;
    if (!F || !F.hud) return;                 // партия ещё не началась — док и скрыт
    try { if (F.audio) F.audio.play('click'); } catch { /* звук не критичен */ }
    // Единственная запись состояния — публичный метод HUD, тот же, что зовут
    // родные вкладки и горячие клавиши main.js.
    F.hud.setTab(btn.dataset.ftTab);
    if (typeof matchMedia === 'function' && matchMedia(`(max-width: ${MOBILE_MAX_PX}px)`).matches) {
      // На телефоне панель живёт в шите: без раскрытия игрок нажал бы кнопку
      // впустую — ровно так же поступают родные кнопки #sheetTabs.
      const sheet = document.getElementById('sheet');
      if (sheet) sheet.classList.add('open');
    }
  });
}

function syncActive(root, tab) {
  for (const b of root.querySelectorAll('[data-ft-key]')) {
    b.classList.toggle('active', b.dataset.ftKey === activeKeyFor(tab));
  }
}

// Док должен молчать, пока игра не началась или карта занята своими оверлеями:
// стартовый экран, постановка здания (внизу ✓/✗), экран победы.
function shouldHide(F) {
  if (!F || !F.hud) return true;
  if (F.sim && F.sim.placing) return true;
  const ov = document.getElementById('overlay');
  if (ov && !ov.classList.contains('hidden')) return true;
  const win = document.getElementById('victory');
  if (win && win.classList.contains('show')) return true;
  return false;
}

function start() {
  ensureCss();
  let root = document.getElementById('ftDock');
  if (!root) {
    root = document.createElement('nav');
    root.id = 'ftDock';
    root.setAttribute('aria-label', 'Командный док');
    root.innerHTML = dockHtml(DOCK_BUTTONS);
    document.body.appendChild(root);
    bindClicks(root);
  }
  // Опрос вместо подписок: hud.tab меняется ещё и клавиатурой (B/R/T в main.js),
  // события наружу HUD не шлёт, а 300 мс опрос двух полей ничего не стоит.
  setInterval(() => {
    try {
      const F = window.__frontier;
      const hide = shouldHide(F);
      root.classList.toggle('show', !hide);
      if (!hide) syncActive(root, F.hud.tab);
    } catch { /* HUD мог пересоздаться между чтениями — переживём кадр */ }
  }, 300);
}

if (typeof document !== 'undefined' && typeof window !== 'undefined' && !window.__frontierDock) {
  window.__frontierDock = { version: 1 };
  start();
}

/* ПОДКЛЮЧЕНИЕ — app/src/main.js (index.html правок НЕ требует)

   Модуль самоинициируется при импорте (как './menuskin.js' внутри hud.js):
   esbuild собирает bundle от main.js, поэтому одной строки импорта достаточно
   и для frontier.html, и для dev-режима.

   ЯКОРЬ (строка 11 main.js; проверено Grep: совпадений в файле = 1):

import { tileAt } from './core/world.js';

   ВСТАВИТЬ СРАЗУ ПОСЛЕ:

// Командный док и верхняя полоса ресурсов W3: сами ставят свой DOM и CSS.
import './ui/dock.js';
import './ui/topbar.js';

   ПОРЯДОК НЕ ВАЖЕН: оба модуля ждут window.__frontier / готовый DOM опросом
   (boot-паттерн menuskin.js), поэтому их можно ставить до создания hud.

   app/index.html — вставок нет. Скрипт один (<script type="module"
   src="src/main.js"></script>, строка 366; Grep: совпадений = 1), новые модули
   доезжают графой импортов main.js как в dev, так и в собранном frontier.html.
*/
