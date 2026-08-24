// ui/dock.js — нижний КОМАНДНЫЙ БАР «ФРОНТИР» в духе C&C: Generals.
//
// ЗАЧЕМ. Шесть крупных дверей в уже существующие панели HUD (см. TABS в
// ui/hud.js): док НЕ дублирует ни одной панели — единственное действие кнопки
// это hud.setTab(id) той вкладки, которая и так есть. Стиль — военный металл:
// полоса во всю ширину экрана с янтарной кромкой сверху, квадратные кнопки
// 48px с иконкой и хоткеем в углу, фаски-разделители, справа — мини-статус
// (день/сезон/погода) как приборная вставка.
//
// ХОТКЕИ. В углу подписываются ТОЛЬКО клавиши, которые уже слушает main.js для
// вкладок: B → Строительство, R → Наука (research), T → Войско (army).
// Клавиши 1..4 заняты скоростью игры (setSpeed), новые глобальные слушатели
// модуль сознательно не заводит — чтобы не спорить с console HUD и будущими
// агентами за свободные буквы. Кнопки без хоткея держат пустой угол: сетка
// углов не прыгает.
//
// ПРАВИЛА СЛОЯ. Ядро не трогается вовсе: модуль читает window.__frontier.hud /
// .sim (их заводит main.js) и зовёт только публичные методы HUD. Стейт sim не
// мутается ни одним байтом: статус читается каждый кадр, но только чтение.
// Файл самодостаточен: CSS инжектится <style> по образцу ensureCss из
// ui/menuskin.js, повторный запуск гасится флагом на window. Импорт модуля в
// node безопасен: вся DOM-часть спрятана за проверкой typeof document.
//
// ДОСТУПНОСТЬ/ПОВЕДЕНИЕ:
//   • активная кнопка подсвечивается синхронно с hud.tab;
//   • бар прячется, пока висит стартовый экран (#overlay без .hidden), идёт
//     постановка здания (sim.placing — внизу уже свои ✓/✗) или открыт экран
//     победы;
//   • клик играет 'click' через уже существующий AudioEngine (если он есть).

// ===== ЧИСТАЯ ЧАСТЬ (без DOM; ниже маркер DOM-части — тесты сканируют её) =====

// Шесть дверей дока. tab — id ВЛОЖКИ HUD (TABS в ui/hud.js), а не своя сущность:
// «Законы» живут во вкладке «Держава» (panel_politics → renderPoliticsPanel,
// разделы «§ Свод законов»), отдельной вкладки законов в игре нет.
// hk — хоткей, УЖЕ слушаемый main.js для этой вкладки ('' — клавиши нет):
// b→build, r→research, t→army (main.js, обработчик keydown). Цифры 1..4 заняты
// скоростью игры, поэтому нумеровать кнопки ими нельзя — будет ложь игроку.
export const DOCK_BUTTONS = [
  { key: 'build',   icon: '🔨', ru: 'Строительство',    tab: 'build',    hk: 'B' },
  { key: 'dynasty', icon: '👑', ru: 'Династия',         tab: 'dynasty',  hk: '' },
  { key: 'army',    icon: '⚔',  ru: 'Войско',           tab: 'army',     hk: 'T' },
  { key: 'science', icon: '📜', ru: 'Наука',            tab: 'research', hk: 'R' },
  { key: 'laws',    icon: '⚖',  ru: 'Законы',           tab: 'politics', hk: '' },
  { key: 'map',     icon: '🗺', ru: 'Карта/Дипломатия', tab: 'diplo',    hk: '' },
];

// Брейкпоинт телефона — тот же, что у интерфейса игры (index.html,
// @media max-width 820px): на этой ширине вкладки живут в нижнем шите.
export const MOBILE_MAX_PX = 820;

// Названия сезонов и погоды продублированы строками из core/data.js (SEASONS,
// WEATHER[].ru): слой UI не импортирует ядро напрямую, а расхождение поймает
// тест контракта. Значения сверены вручную с data.js — при смене там, здесь
// тоже надо править.
export const SEASONS_RU = ['Весна', 'Лето', 'Осень', 'Зима'];
export const WEATHER_RU = {
  sun: 'Ясно', cloud: 'Облачно', rain: 'Дождь', snow: 'Снег',
};

// Мини-статус правого края бара одной чистой функцией: на входе похожесть sim,
// на выходе готовые строки для ячеек. Всё неизвестное — прочерк, а не ноль:
// ноль дня выглядел бы как данные.
export function miniStatus(simLike) {
  const s = simLike || {};
  const d = Number(s.day);
  return {
    day: Number.isFinite(d) ? String(Math.floor(d)) : '—',
    season: SEASONS_RU[Number(s.seasonIdx)] || '—',
    weather: WEATHER_RU[s.weather] || '—',
  };
}

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
// Между кнопками — фаски-разделители: военный бар без них рассыпается в ряд
// одинаковых плиток. Хоткей рисуется в углу только если он реально работает.
export function dockHtml(buttons) {
  return buttons.map(b =>
    `<button class="ft-dock-btn" type="button" data-ft-key="${b.key}" data-ft-tab="${b.tab}"
      title="${b.ru}${b.hk ? ` [${b.hk}]` : ''}" aria-label="${b.ru}">
      ${b.hk ? `<span class="ft-dock-hk" aria-hidden="true">${b.hk}</span>` : ''}
      <span class="ft-dock-ic" aria-hidden="true">${b.icon}</span>
    </button>`).join('<i class="ft-dock-sep" aria-hidden="true"></i>');
}

// ===== DOM-ЧАСТЬ (браузер; в node не исполняется) =====

function ensureCss() {
  // Инжект по образцу menuskin.ensureCss, но без import.meta: стилю дока нечего
  // выносить в файл, а в собранном frontier.html import.meta пуст и только
  // бросил бы исключение. Идемпотентность — через id тега. Префиксы --ft-*,
  // чтобы не спорить о переменных с родным скином и параллельными агентами.
  if (document.getElementById('ft-dock-css')) return;
  const st = document.createElement('style');
  st.id = 'ft-dock-css';
  st.textContent = `
#ftDock {
  --ft-metal: #1a1d18;      /* базовый тёмный металл бара */
  --ft-metal-hi: #262b21;   /* верх фаски */
  --ft-metal-lo: #101309;   /* низ фаски */
  --ft-amber: #c8a24a;      /* янтарная кромка и подсветка */
  position: fixed; left: 0; right: 0;
  bottom: var(--safe-bottom, 0px); z-index: 30;
  height: 64px; padding: 0 14px;
  display: none; align-items: center; justify-content: space-between;
  background-color: var(--ft-metal);
  /* Металл: вертикальная фаска + едва заметная диагональная насечка, чтобы
     плита не читалась плоским чёрным прямоугольником. */
  background-image:
    repeating-linear-gradient(135deg, rgba(255,255,255,0.022) 0 2px, transparent 2px 7px),
    linear-gradient(180deg, #2a2f24 0%, var(--ft-metal) 42%, #0e1108 100%);
  border-top: 1px solid var(--ft-amber);
  /* Вторая, притушенная янтарная риска под кромкой — «приборный» шов. */
  box-shadow:
    inset 0 2px 0 rgba(200, 162, 74, 0.22),
    inset 0 3px 0 rgba(0, 0, 0, 0.55),
    inset 0 12px 18px rgba(0, 0, 0, 0.35),
    0 -8px 22px rgba(0, 0, 0, 0.45);
}
@supports not ((backdrop-filter: blur(10px)) or (-webkit-backdrop-filter: blur(10px))) {
  #ftDock { background-color: #14170f; }
}
#ftDock.show { display: flex; }

/* Левая группа: шесть квадратных кнопок с разделителями-фасками. */
.ft-dock-group { display: flex; align-items: center; }
.ft-dock-sep {
  width: 1px; height: 40px; margin: 0 8px; flex: 0 0 auto;
  background: linear-gradient(180deg,
    transparent 0%, rgba(0,0,0,0.95) 20%, rgba(150,158,126,0.55) 50%, rgba(0,0,0,0.95) 80%, transparent 100%);
}
.ft-dock-btn {
  position: relative; flex: 0 0 auto;
  width: 48px; height: 48px; padding: 0; margin: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: linear-gradient(180deg, #2a2f24 0%, #1a1d14 58%, #13160d 100%);
  color: var(--text, #ece5d3);
  border: 1px solid rgba(0, 0, 0, 0.9);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.09),
    inset 0 -1px 0 rgba(0, 0, 0, 0.65),
    inset 1px 0 0 rgba(255, 255, 255, 0.04);
  cursor: pointer;
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
}
.ft-dock-btn .ft-dock-ic { font-size: 21px; line-height: 1; }
.ft-dock-btn .ft-dock-hk {
  position: absolute; top: 2px; right: 4px;
  font-family: var(--mono, monospace); font-size: 9px; font-weight: 700;
  line-height: 1; letter-spacing: 0.5px;
  color: #8a7a4e;                       /* приглушённый янтарь покоя */
}
@media (hover: hover) and (pointer: fine) {
  .ft-dock-btn:hover {
    border-color: rgba(200, 162, 74, 0.65);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.09),
      inset 0 -1px 0 rgba(0, 0, 0, 0.6),
      inset 0 0 10px rgba(200, 162, 74, 0.12);
  }
}
.ft-dock-btn:active { transform: translateY(1px); }
/* Активная вкладка: янтарная рамка, тёплый свет изнутри и яркий хоткей —
   состояние видно боковым зрением, без чтения надписей. */
.ft-dock-btn.active {
  border-color: var(--ft-amber);
  background: linear-gradient(180deg, #33301f 0%, #241f11 60%, #1a160b 100%);
  box-shadow:
    inset 0 1px 0 rgba(232, 200, 134, 0.35),
    inset 0 0 12px rgba(200, 162, 74, 0.22),
    0 0 10px rgba(200, 162, 74, 0.28);
}
.ft-dock-btn.active .ft-dock-hk { color: #ffd98a; }

/* Правая группа: мини-статус день/сезон/погода — приборная вставка с теми же
   фасками, что и кнопки, чтобы читалась частью бара, а не ярлыком. */
.ft-dock-status { display: flex; align-items: center; }
.ft-dock-status .ft-st {
  display: inline-flex; flex-direction: column; justify-content: center;
  min-width: 52px; padding: 0 6px; gap: 2px;
}
.ft-dock-status .ft-st small {
  font-size: 8px; font-weight: 700; letter-spacing: 1.2px;
  text-transform: uppercase; color: #8a7a4e;
}
.ft-dock-status .ft-st b {
  font-family: var(--mono, monospace); font-size: 13px; font-weight: 700;
  color: var(--text, #ece5d3); white-space: nowrap;
}

/* Телефон: бар остаётся плитой на всю ширину, но приподнимается над свёрнутым
   нижним шитом (56 px + ручка) и ужимается: кнопки 44px, статусы без меток. */
@media (max-width: ${MOBILE_MAX_PX}px) {
  #ftDock { height: 56px; padding: 0 8px; bottom: calc(60px + var(--safe-bottom, 0px)); }
  .ft-dock-btn { width: 44px; height: 44px; margin: 0 1px; }
  .ft-dock-btn .ft-dock-ic { font-size: 19px; }
  .ft-dock-sep { margin: 0 3px; height: 32px; }
  .ft-dock-status .ft-st { min-width: 0; padding: 0 4px; }
  .ft-dock-status .ft-st small { display: none; }
}`;
  document.head.appendChild(st);
}

// Один слушатель на весь бар (делегирование): панели пересоздаются, а кнопки
// постоянны — вешать шесть обработчиков незачем.
function bindClicks(root) {
  root.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('[data-ft-tab]');
    if (!btn || btn.disabled) return;
    const F = window.__frontier;
    if (!F || !F.hud) return;                 // партия ещё не началась — бар и скрыт
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

// Бар должен молчать, пока игра не началась или карта занята своими оверлеями:
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

// Статичный каркас статусной группы: значения ячеек заполняет кадровый цикл.
const STATUS_CELLS = [
  ['day', 'День'],
  ['season', 'Сезон'],
  ['weather', 'Погода'],
];

function start() {
  ensureCss();
  let root = document.getElementById('ftDock');
  if (!root) {
    root = document.createElement('nav');
    root.id = 'ftDock';
    root.setAttribute('aria-label', 'Командный бар');
    root.innerHTML =
      `<div class="ft-dock-group">${dockHtml(DOCK_BUTTONS)}</div>` +
      `<div class="ft-dock-status" role="status" aria-label="День, сезон, погода">` +
      STATUS_CELLS.map(([k, ru]) =>
        `<span class="ft-st"><small>${ru}</small><b data-ft-st="${k}">—</b></span>`)
        .join('<i class="ft-dock-sep" aria-hidden="true"></i>') +
      `</div>`;
    document.body.appendChild(root);
    bindClicks(root);
  }
  // Кадровый цикл вместо интервалов: статус обязан обновляться раз в кадр по
  // требованию стиля «прибора», а подсветка активной вкладки и видимость бара
  // почти бесплатны — текст ячеек пишется только при реальной смене значения,
  // классы переключаются только при смене вкладки. Чтения sim — только чтение.
  const stEls = {
    day: root.querySelector('[data-ft-st="day"]'),
    season: root.querySelector('[data-ft-st="season"]'),
    weather: root.querySelector('[data-ft-st="weather"]'),
  };
  let lastTab = null, lastShown = null, lastSt = '';
  const frame = () => {
    try {
      const F = window.__frontier;
      const shown = !shouldHide(F);
      if (shown !== lastShown) { lastShown = shown; root.classList.toggle('show', shown); lastTab = null; }
      if (shown && F) {
        if (F.hud.tab !== lastTab) { lastTab = F.hud.tab; syncActive(root, lastTab); }
        const st = miniStatus(F.sim || {});
        const key = `${st.day}|${st.season}|${st.weather}`;
        if (key !== lastSt) {
          lastSt = key;
          for (const k of Object.keys(stEls)) {
            if (stEls[k] && stEls[k].textContent !== st[k]) stEls[k].textContent = st[k];
          }
        }
      }
    } catch { /* HUD мог пересоздаться между кадрами — переживём кадр */ }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

if (typeof document !== 'undefined' && typeof window !== 'undefined' && !window.__frontierDock) {
  window.__frontierDock = { version: 2 };
  start();
}

/* ПОДКЛЮЧЕНИЕ — app/src/main.js (index.html правок НЕ требует)

   Модуль самоинициируется при импорте; в main.js строки 13–14 уже стоят:

import './ui/dock.js';
import './ui/topbar.js';

   ПОРЯДОК НЕ ВАЖЕН: модуль ждёт window.__frontier кадровым циклом, поэтому его
   можно ставить до создания hud. app/index.html вставок не требует.
*/
