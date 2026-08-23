// ui/menuskin.js — рантайм-скин правой меню-панели «ФРОНТИР».
// Ничего не переписывает и не удаляет из существующего DOM: только
// 1) подключает свой CSS (если <link> ещё не стоит в index.html),
// 2) добавляет во вкладки inline-SVG-иконки,
// 3) группирует вкладки ПК разделителями-подписями (кнопки остаются
//    ПРЯМЫМИ детьми #sideTabs — от этого зависит setTab(), который
//    перебирает .children, а также coach.js с его селекторами потомков),
// 4) превращает цены вида «🪵20 🪨10» в чипы с цветными точками через
//    MutationObserver (панели перерисовываются 4 раза в секунду целиком).
//
// Идемпотентность: все шаги помечают узлы data-msk*-атрибутами и
// повторный вызов ничего не дублирует. Чистка при новой партии не нужна
// (панели сами пересобирают содержимое), но модуль следит за реально
// существующим флагом window.__frontier.sim (main.js меняет объект
// симуляции при newGame/load) и на всякий случай перевешивает разметку.
// Офлайн: только инлайновые SVG и системные шрифты.

const ICONS = {
  build: '<path d="M14.6 3.8l5.6 5.6-3 3-5.6-5.6z"/><path d="M12 7L3.5 15.5V21h5.5L17 12.5"/>',
  research: '<path d="M9 3h6"/><path d="M10 3v5l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3"/><path d="M7.6 14h8.8"/>',
  army: '<path d="M3.5 3.5l16.5 16.5"/><path d="M20.5 3.5L4 20"/><path d="M7 3H3.5v3.5"/><path d="M17 3h3.5v3.5"/>',
  diplo: '<path d="M6 21V4"/><path d="M6 4h11.5l-2.4 3.5 2.4 3.5H6"/>',
  market: '<path d="M12 4v16"/><path d="M7 20h10"/><path d="M5 7h14"/><path d="M7.2 7l-3 6a3.1 3.1 0 0 0 6.2 0z"/><path d="M16.8 7l-3 6a3.1 3.1 0 0 0 6.2 0z"/>',
  people: '<circle cx="9" cy="8" r="3.2"/><path d="M3.4 19.5a5.6 5.6 0 0 1 11.2 0"/><path d="M15.6 5.2a3.2 3.2 0 0 1 0 5.6"/><path d="M17 14.4a5.6 5.6 0 0 1 3.6 5.1"/>',
  industry: '<path d="M3.5 20.5V9.5l5.5 3.5v-3.5l5.5 3.5v-3.5l6 3.7v7.3z"/><path d="M6.8 16.9h.01"/><path d="M10.8 16.9h.01"/>',
  war: '<path d="M12 3.5l7 2.7v5.4c0 4.6-2.9 7.6-7 9.4-4.1-1.8-7-4.8-7-9.4V6.2z"/>',
  politics: '<path d="M3.5 21h17"/><path d="M3.5 10.5L12 4l8.5 6.5z"/><path d="M5.5 10.5V18"/><path d="M9.8 10.5V18"/><path d="M14.2 10.5V18"/><path d="M18.5 10.5V18"/><path d="M3.5 18h17"/>',
  empire: '<path d="M5 21V6h2.4v2.4h2.2V6h4.8v2.4h2.2V6H19v15z"/><path d="M9.8 21v-3.8a2.2 2.2 0 0 1 4.4 0V21"/><path d="M5 10.5h14"/>',
  labor: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  goals: '<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="4.4"/><circle cx="12" cy="12" r="0.8"/>',
  memory: '<path d="M2.8 4.8h6.4A2.8 2.8 0 0 1 12 7.6v12.6a2.4 2.4 0 0 0-2.4-2H2.8z"/><path d="M21.2 4.8h-6.4A2.8 2.8 0 0 0 12 7.6v12.6a2.4 2.4 0 0 1 2.4-2h6.8z"/>',
  log: '<path d="M8.5 6h12"/><path d="M8.5 12h12"/><path d="M8.5 18h12"/><path d="M4 6h.01"/><path d="M4 12h.01"/><path d="M4 18h.01"/>',
  // вкладки, добавленные поверх этого списка другими ветками разработки
  dynasty: '<circle cx="12" cy="8" r="3.4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0z"/><path d="M12 3v2"/>',
};

function svg(id) {
  // явные размеры — чтобы даже без CSS иконка не вставала в дефолтные 300×150
  return `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"`
    + ` stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"`
    + ` aria-hidden="true">${ICONS[id] || ''}</svg>`;
}

// ---------- CSS ----------
function ensureCss() {
  // Сначала ищем уже стоящий CSS и выходим ДО всякой работы с import.meta.
  // Почему так: в собранном frontier.html (esbuild, формат iife) import.meta
  // пуст, new URL('menuskin.css', <пустая база>) бросает исключение — а инлайн
  // <style id="msk-inline"> туда ставит tools/build.mjs по образцу theme.css,
  // поэтому линк в собранном файле не нужен вовсе. Порядок «сначала проверка»
  // страхует и dev-режим: там до URL дело доходит только когда стиля нет.
  const already = [...document.querySelectorAll('link[rel="stylesheet"], style[id]')]
    .some(l => (l.href && l.href.indexOf('menuskin.css') !== -1) || l.id === 'msk-inline');
  if (already) return;
  let href = '';
  try {
    href = new URL('menuskin.css', import.meta.url).href;
  } catch { /* база недоступна — остаёмся без линка: CSS обязан прийти инлайном от сборки */ return; }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

// ---------- вкладки ----------
// Порядок групп на ПК. Кнопки пересортировываются appendChild'ем — это
// безопасно: setTab() перебирает детей безотносительно порядка, а обработчики
// onclick висят на самих кнопках. Разделители — неинтерактивные div между ними.
const DESKTOP_GROUPS = [
  { tabs: ['build', 'research', 'people'] },
  { cap: 'Экономика', tabs: ['market', 'industry', 'labor'] },
  { cap: 'Война',     tabs: ['army', 'war'] },
  { cap: 'Прочее',    tabs: ['diplo', 'politics', 'empire', 'goals', 'memory', 'log'] },
];

function iconize(button) {
  if (!button || button.dataset.mskIc) return;
  button.dataset.mskIc = '1';
  const id = button.dataset.tab;
  if (!id || !ICONS[id]) return;
  // у кнопок нижнего шита уже есть <span class="ic"> с эмодзи — заменяем его
  // содержимое; у кнопок ПК иконки нет вовсе — вставляем новый элемент.
  const ic = button.querySelector('.ic');
  if (ic) {
    ic.classList.add('msk-tic');
    ic.innerHTML = svg(id);
  } else {
    const s = document.createElement('span');
    s.className = 'msk-tic';
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = svg(id);
    button.insertBefore(s, button.firstChild);
  }
}

function decorateTabs() {
  // класс-хук для всей CSS скина (см. #sidePanel.msk-root в menuskin.css)
  const sp = document.getElementById('sidePanel');
  const sh = document.getElementById('sheet');
  if (sp) sp.classList.add('msk-root');
  if (sh) sh.classList.add('msk-root');
  const st = document.getElementById('sideTabs');
  const sht = document.getElementById('sheetTabs');
  if (st && !st.dataset.msk && st.children.length) {
    st.dataset.msk = '1';
    const byTab = {};
    for (const b of [...st.children]) if (b.dataset && b.dataset.tab) byTab[b.dataset.tab] = b;
    // вкладки, которых нет в DESKTOP_GROUPS (например, добавленные параллельной
    // разработкой), падают в последнюю группу — потерянных кнопок не бывает
    const grouped = new Set(DESKTOP_GROUPS.flatMap(g => g.tabs));
    const last = DESKTOP_GROUPS[DESKTOP_GROUPS.length - 1];
    for (const t of Object.keys(byTab)) if (!grouped.has(t) && !last.tabs.includes(t)) last.tabs.push(t);
    // пересборка в порядке групп: разделители вставляются МЕЖДУ кнопками,
    // поэтому кнопки остаются прямыми детьми контейнера
    const frag = document.createDocumentFragment();
    for (const g of DESKTOP_GROUPS) {
      if (g.cap) {
        const sep = document.createElement('div');
        sep.className = 'msk-sep';
        sep.setAttribute('aria-hidden', 'true');
        const span = document.createElement('span');
        span.textContent = g.cap;
        sep.appendChild(span);
        frag.appendChild(sep);
      }
      for (const t of g.tabs) if (byTab[t]) frag.appendChild(byTab[t]);
    }
    st.appendChild(frag);   // переносит существующие узлы в конец в новом порядке
  }
  if (sht && !sht.dataset.msk && sht.children.length) sht.dataset.msk = '1';
  for (const host of [st, sht]) {
    if (!host) continue;
    for (const b of host.children) iconize(b);
  }
}

// ---------- цены → чипы с цветными точками ----------
const RES_META = {
  '🍞': ['food', 'Еда'], '🪵': ['wood', 'Дерево'], '🪨': ['stone', 'Камень'],
  '⚙': ['steel', 'Сталь'], '🪙': ['gold', 'Золото'], '📜': ['knowledge', 'Знания'],
};
// и «иконка+число», и «число+иконка», опционально «иконка N/M» (шпиль).
// Флаг u ОБЯЗАТЕЛЕН: без него эмодзи вне BMP в символьном классе распадаются
// на суррогатные половины и матчатся в чужие строки.
const COST_RE = /([🍞🪵🪨⚙🪙📜])\s*(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+))?|(\d+(?:\.\d+)?)\s*([🍞🪵🪨⚙🪙📜])/gu;

function buildChip(resId, resName, num, denom) {
  const chip = document.createElement('span');
  chip.className = `msk-res msk-${resId}`;
  chip.title = resName;
  const dot = document.createElement('i');
  dot.setAttribute('aria-hidden', 'true');
  chip.appendChild(dot);
  chip.appendChild(document.createTextNode(num + (denom ? '/' + denom : '')));
  return chip;
}

function decorateCost(rootEl) {
  if (!rootEl || !rootEl.querySelectorAll) return;
  for (const el of rootEl.querySelectorAll('.cost:not([data-mskc])')) {
    try {
      el.dataset.mskc = '1';                 // маркер ставим ДО перестройки DOM:
      const raw = el.textContent.replace(/\uFE0F/g, '');  // свои мутации больше
      COST_RE.lastIndex = 0;                 // не создают «свежих» .cost
      const parts = [];
      let m, last = 0, found = false;
      while ((m = COST_RE.exec(raw)) !== null) {
        found = true;
        if (m.index > last) parts.push(document.createTextNode(raw.slice(last, m.index)));
        if (m[1]) {
          const [rid, rname] = RES_META[m[1]];
          parts.push(buildChip(rid, rname, m[2], m[3]));
        } else {
          const [rid, rname] = RES_META[m[5]];
          parts.push(buildChip(rid, rname, m[4], null));
        }
        last = COST_RE.lastIndex;
      }
      if (!found) continue;                  // «сила 12», «война», проценты — как было
      if (last < raw.length) parts.push(document.createTextNode(raw.slice(last)));
      el.textContent = '';
      for (const p of parts) el.appendChild(p);
    } catch { /* один странный элемент не должен хоронить всю пачку */ }
  }
}

// Декор запускаем ПРЯМО в колбэке MutationObserver (микротаска после замены
// innerHTML, но до отрисовки кадра): окно с недекорированными ценами исчезает.
// Повторные входы гасятся маркером data-mskc — цикла нет.
function decoratePanels(sc, shc) {
  try { decorateCost(sc); } catch { /* панель могла смениться */ }
  try { decorateCost(shc); } catch { /* noop */ }
}

// ---------- запуск ----------
function start() {
  ensureCss();
  const sc = document.getElementById('sideContent');
  const shc = document.getElementById('sheetContent');

  decorateTabs();
  decoratePanels(sc, shc);

  // панели перерисовываются целиком 4 раза в секунду — ловим каждую замену
  if (window.MutationObserver && sc && shc) {
    const mo = new MutationObserver(() => decoratePanels(sc, shc));
    mo.observe(sc, { childList: true, subtree: true });
    mo.observe(shc, { childList: true, subtree: true });
    // если hud.bind() когда-нибудь очистит вкладки — вернём оформление сразу
    for (const host of ['sideTabs', 'sheetTabs']) {
      const el = document.getElementById(host);
      if (el) {
        const tmo = new MutationObserver(() => {
          requestAnimationFrame(() => { try { decorateTabs(); } catch { /* noop */ } });
        });
        tmo.observe(el, { childList: true });
      }
    }
  }

  // Новая партия/загрузка сейва не шлют событий, но main.js подменяет объект
  // window.__frontier.sim — это реальный флаг, за ним и следим. Самим чистить
  // нечего (содержимое панелей пересобирается само), просто перевешиваем метки.
  let lastSim;
  setInterval(() => {
    try {
      const F = window.__frontier;
      if (F && F.sim !== lastSim) { lastSim = F.sim; decoratePanels(sc, shc); }
      decorateTabs();   // идемпотентно: всё размеченное пропускает
    } catch { /* noop */ }
  }, 2000);
}

// ждём, пока hud.bind() соберёт вкладки (модуль может исполниться раньше main.js)
function boot(attempt) {
  attempt = attempt || 0;
  const ok = document.getElementById('sideTabs') &&
    document.getElementById('sideTabs').querySelectorAll('button[data-tab]').length > 0;
  if (ok || attempt > 100) start();
  else setTimeout(() => boot(attempt + 1), 100);
}

if (!window.__frontierMenuSkin) {
  window.__frontierMenuSkin = { version: 1 };
  boot();
}
