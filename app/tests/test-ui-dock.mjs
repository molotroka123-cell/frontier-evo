// Тесты Command Dock (app/src/ui/dock.js) — W3.
// Запуск: node app/tests/test-ui-dock.mjs
//
// DOM в node нет, и он здесь не нужен: у dock.js чистая часть (список кнопок,
// порядок, разметка, маппинг вкладок) отделена от рендера маркером «DOM-ЧАСТЬ».
// Сам импорт модуля — уже проверка: он обязан проходить без document/window
// (рантайм спрятан за typeof document), иначе док нельзя бы было тестировать.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const {
  DOCK_BUTTONS, MOBILE_MAX_PX,
  buttonByTab, activeKeyFor, dockHtml,
} = await import('../src/ui/dock.js');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('OK', name); } catch (e) { fail++; console.log('FAIL', name, '—', e.message); } };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || ''} ждали ${b}, получили ${a}`); };
const ok = (v, m) => { if (!v) throw new Error(m || 'ложь'); };

const HERE = join(dirname(fileURLToPath(import.meta.url)));
const CODE = readFileSync(join(HERE, '..', 'src', 'ui', 'dock.js'), 'utf8');

// Контракт с TABS ui/hud.js (id вкладок). Список зафиксирован вручную и не
// импортирует hud.js: тот при загрузке тянет menuskin.js, а он в node падает
// на window. Если TABS поменяются — тест честно зазвенит.
const HUD_TAB_IDS = [
  'build', 'research', 'army', 'diplo', 'market',
  'people', 'industry', 'war', 'politics', 'empire',
  'dynasty', 'labor', 'goals', 'memory', 'log',
];

t('ровно шесть крупных кнопок', () => {
  eq(DOCK_BUTTONS.length, 6);
});

t('порядок и подписи как в задании', () => {
  const ru = DOCK_BUTTONS.map(b => b.ru);
  eq(ru.join('|'), ['Строительство', 'Династия', 'Войско', 'Наука', 'Законы', 'Карта/Дипломатия'].join('|'));
  const icons = DOCK_BUTTONS.map(b => b.icon).join('');
  ok(/🔨/.test(icons) && /👑/.test(icons) && /⚔/.test(icons), 'иконки 🔨👑⚔ на месте');
  ok(/📜/.test(icons) && /⚖/.test(icons) && /🗺/.test(icons), 'иконки 📜⚖🗺 на месте');
});

t('ключи кнопок уникальны, вкладки уникальны', () => {
  eq(new Set(DOCK_BUTTONS.map(b => b.key)).size, 6);
  eq(new Set(DOCK_BUTTONS.map(b => b.tab)).size, 6);
});

t('каждая кнопка ведёт на СУЩЕСТВУЮЩУЮ вкладку HUD', () => {
  for (const b of DOCK_BUTTONS) {
    ok(HUD_TAB_IDS.includes(b.tab), `вкладка ${b.tab} есть в TABS hud.js`);
    ok(typeof b.ru === 'string' && b.ru.length > 0 && typeof b.icon === 'string', `${b.key}: подписан`);
  }
});

t('«Законы» открывают вкладку Держава (там живёт Свод законов)', () => {
  const laws = DOCK_BUTTONS.find(b => b.ru === 'Законы');
  ok(laws, 'кнопка Законы есть');
  eq(laws.tab, 'politics');
});

t('брейкпоинт телефона совпадает с брейкпоинтом игры', () => {
  eq(MOBILE_MAX_PX, 820);
});

t('buttonByTab/activeKeyFor детерминированы', () => {
  for (let i = 0; i < 3; i++) {
    eq(activeKeyFor('dynasty'), 'dynasty');
    eq(activeKeyFor('research'), 'science');
    eq(activeKeyFor('build'), 'build');
    eq(buttonByTab('diplo').key, 'map');
    // Вкладки без своей кнопки (рынок, журнал…) не подсвечивают ничего.
    eq(buttonByTab('market'), null);
    eq(activeKeyFor('log'), '');
    eq(activeKeyFor(undefined), '');
  }
});

t('разметка: порядок кнопок в HTML совпадает с порядком массива', () => {
  const html = dockHtml(DOCK_BUTTONS);
  const keys = [...html.matchAll(/data-ft-key="([^"]+)"/g)].map(m => m[1]);
  eq(keys.join('|'), DOCK_BUTTONS.map(b => b.key).join('|'));
  const tabs = [...html.matchAll(/data-ft-tab="([^"]+)"/g)].map(m => m[1]);
  eq(tabs.join('|'), DOCK_BUTTONS.map(b => b.tab).join('|'));
  ok((html.match(/ft-dock-btn/g) || []).length === 6, 'шесть кнопок в разметке');
});

t('разметка детерминирована и несёт подписи для aria', () => {
  const a = dockHtml(DOCK_BUTTONS), b = dockHtml(DOCK_BUTTONS);
  eq(a, b, 'два вызова — одна строка');
  ok(a.includes('aria-label="Строительство"'), 'aria-подпись есть');
  ok(a.includes('aria-hidden="true"'), 'иконка скрыта от скринридера');
});

t('pure/render части разделены маркером, в чистой нет document', () => {
  // Сканируем КОД без комментариев: слово «document» в поясняющем тексте не
  // обращение к DOM, а ложный срабатывание наивного поиска.
  const noComments = CODE
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');
  // Граница чистой части — первый DOM-функционал модуля (ensureCss идёт сразу
  // за маркерным комментарием «===== DOM-ЧАСТЬ =====»).
  const cut = noComments.indexOf('function ensureCss');
  ok(cut > 0, 'DOM-часть начинается с ensureCss');
  ok(CODE.includes('===== DOM-ЧАСТЬ'), 'маркер раздела на месте');
  const pure = noComments.slice(0, cut);
  ok(!/\bdocument\b/.test(pure), 'в чистой части нет document');
  ok(!/\bwindow\b/.test(pure), 'в чистой части нет window');
  ok(!/querySelector|createElement|innerHTML/.test(pure), 'чистая часть не строит DOM сама');
});

console.log(`\n=== ${pass} OK / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
