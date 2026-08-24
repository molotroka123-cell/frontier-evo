// Тесты командного бара (app/src/ui/dock.js) — стиль C&C: Generals.
// Запуск: node app/tests/test-ui-dock.mjs
//
// DOM в node нет, и он здесь не нужен: у dock.js чистая часть (список кнопок,
// порядок, разметка, маппинг вкладок, хоткеи, мини-статус) отделена от рендера
// маркером «DOM-ЧАСТЬ». Сам импорт модуля — уже проверка: он обязан проходить
// без document/window (рантайм спрятан за typeof document).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const {
  DOCK_BUTTONS, MOBILE_MAX_PX,
  SEASONS_RU, WEATHER_RU,
  buttonByTab, activeKeyFor, dockHtml, miniStatus,
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

t('хоткеи — только те клавиши, что УЖЕ слушает main.js для вкладок', () => {
  // main.js (keydown): b→build, r→research, t→army. Цифры 1..4 заняты
  // setSpeed — нумеровать ими кнопки нельзя. Остальным углы пусты.
  const hk = Object.fromEntries(DOCK_BUTTONS.map(b => [b.key, b.hk]));
  eq(hk.build, 'B');
  eq(hk.science, 'R');
  eq(hk.army, 'T');
  eq(hk.dynasty, '');
  eq(hk.laws, '');
  eq(hk.map, '');
  // Кнопки с цифрами вместо букв были бы ложью игроку — запрещаем явно.
  for (const b of DOCK_BUTTONS) ok(!/^[1-6]$/.test(b.hk), `${b.key}: хоткей не цифра`);
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

t('разметка: порядок кнопок совпадает с массивом, между ними фаски', () => {
  const html = dockHtml(DOCK_BUTTONS);
  const keys = [...html.matchAll(/data-ft-key="([^"]+)"/g)].map(m => m[1]);
  eq(keys.join('|'), DOCK_BUTTONS.map(b => b.key).join('|'));
  const tabs = [...html.matchAll(/data-ft-tab="([^"]+)"/g)].map(m => m[1]);
  eq(tabs.join('|'), DOCK_BUTTONS.map(b => b.tab).join('|'));
  ok((html.match(/ft-dock-btn/g) || []).length === 6, 'шесть кнопок в разметке');
  eq((html.match(/ft-dock-sep/g) || []).length, 5, 'пять разделителей-фасок');
});

t('разметка несёт угловые хоткеи только там, где они работают', () => {
  const html = dockHtml(DOCK_BUTTONS);
  eq((html.match(/ft-dock-hk/g) || []).length, 3, 'три угловых бейджа B/R/T');
  ok(html.includes('>B</span>') && html.includes('>R</span>') && html.includes('>T</span>'), 'буквы B R T на месте');
  ok(html.includes('[B]'), 'хоткей продублирован в title для мыши');
});

t('разметка детерминирована и несёт подписи для aria', () => {
  const a = dockHtml(DOCK_BUTTONS), b = dockHtml(DOCK_BUTTONS);
  eq(a, b, 'два вызова — одна строка');
  ok(a.includes('aria-label="Строительство"'), 'aria-подпись есть');
  ok(a.includes('aria-hidden="true"'), 'иконки и фаски скрыты от скринридера');
});

t('мини-статус: день/сезон/погода строками, неизвестное — прочерк', () => {
  const s = miniStatus({ day: 41.7, seasonIdx: 1, weather: 'sun' });
  eq(s.day, '41');                       // дробный хвост дня игроку не нужен
  eq(s.season, 'Лето');
  eq(s.weather, 'Ясно');
  const w = miniStatus({ day: 90, seasonIdx: 3, weather: 'snow' });
  eq(w.season, 'Зима'); eq(w.weather, 'Снег');
  const bad = miniStatus({ day: NaN, seasonIdx: 9, weather: 'storm' });
  eq(bad.day, '—');                      // ноль выглядел бы как данные
  eq(bad.season, '—');
  eq(bad.weather, '—');
  const empty = miniStatus(undefined);
  eq(empty.day, '—'); eq(empty.weather, '—');
  eq(JSON.stringify(miniStatus({ day: 5 })), JSON.stringify(miniStatus({ day: 5 })), 'детерминирован');
});

t('названия сезонов/погод совпадают со словами ядра (core/data.js)', () => {
  // Значения сверены вручную с SEASONS и WEATHER[].ru в core/data.js: слой UI
  // ядро не импортирует, поэтому контракт держит этот тест.
  eq(SEASONS_RU.join('|'), ['Весна', 'Лето', 'Осень', 'Зима'].join('|'));
  eq(WEATHER_RU.sun, 'Ясно');
  eq(WEATHER_RU.cloud, 'Облачно');
  eq(WEATHER_RU.rain, 'Дождь');
  eq(WEATHER_RU.snow, 'Снег');
});

t('стиль бара — военный металл Generals: палитра и кромка в CSS', () => {
  // Палитра задания закреплена тестом, чтобы рестайл не поплыл незаметно.
  ok(CODE.includes('#1a1d18'), 'тёмный металл #1a1d18');
  ok(CODE.includes('#c8a24a'), 'янтарь #c8a24a');
  ok(/border-top:\s*1px solid var\(--ft-amber\)/.test(CODE), 'янтарная кромка сверху');
  ok(CODE.includes('--ft-metal'), 'локальные переменные металла с префиксом');
  ok(!CODE.includes('border-radius'), 'плита бара без пилюльных радиусов');
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
