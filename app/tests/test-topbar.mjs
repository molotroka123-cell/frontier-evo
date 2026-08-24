// Тесты «приборной» полосы ресурсов (app/src/ui/topbar.js) — стиль C&C: Generals.
// Запуск: node app/tests/test-topbar.mjs
//
// Проверяется чистая часть модуля: формат чисел, бейдж суточного прироста,
// трекер дельты по суткам и разметка сегментов-ячеек. Импорт модуля без DOM —
// часть проверки: рантайм обязан быть спрятан за typeof document. Детерминизм:
// одинаковые входы всегда дают одинаковый выход (никакого Math.random/Date).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const {
  BAR_RES, UNLIMITED_CAP,
  fmtNum, rateBadge, snapshotOf, advanceRates, segHtml, popSegHtml,
  pillHtml, popPillHtml,
} = await import('../src/ui/topbar.js');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('OK', name); } catch (e) { fail++; console.log('FAIL', name, '—', e.message); } };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || ''} ждали ${b}, получили ${a}`); };
const ok = (v, m) => { if (!v) throw new Error(m || 'ложь'); };
const near = (a, b, eps, m) => { if (!(Math.abs(a - b) <= eps)) throw new Error(`${m || ''} ждали ≈${b}, получили ${a}`); };

const HERE = join(dirname(fileURLToPath(import.meta.url)));
const CODE = readFileSync(join(HERE, '..', 'src', 'ui', 'topbar.js'), 'utf8');

t('состав полосы: золото, дерево, камень, сталь, еда — и только они', () => {
  eq(BAR_RES.map(r => r.id).join('|'), ['gold', 'wood', 'stone', 'steel', 'food'].join('|'));
  for (const r of BAR_RES) {
    ok(r.icon && r.ru, `${r.id}: подписан иконкой и именем`);
  }
});

t('fmtNum: целое, без минуса, тысячи с узким пробелом', () => {
  eq(fmtNum(14), '14');
  eq(fmtNum(0), '0');
  eq(fmtNum(12.9), '12');                 // дробный хвост производства игроку не показываем
  eq(fmtNum(-5), '0');                    // отрицательное — ошибка данных, а не «долг»
  eq(fmtNum(12345), `12\u202F345`);
  eq(fmtNum('abc'), '0');
});

t('бейдж прироста: +14/д зелёным, −3/д красным', () => {
  const up = rateBadge(14);
  eq(up.text, '+14/д'); eq(up.cls, 'up');
  const dn = rateBadge(-3);
  eq(dn.text, '\u22123/д');               // типографский минус U+2212, не дефис
  eq(dn.cls, 'dn');
  const z = rateBadge(0);
  eq(z.cls, 'zero'); eq(z.text, '0/д');
  const tiny = rateBadge(0.03);           // меньше порога шума — это ноль
  eq(tiny.cls, 'zero');
  const frac = rateBadge(1.25);
  eq(frac.text, '+1.3/д');                // до десятой у малых чисел
  const big = rateBadge(123.4);
  eq(big.text, '+123/д');                 // у больших дробь не нужна
  const unk = rateBadge(null);
  eq(unk.cls, 'off');                     // замер ещё не набран — точка, не ложный ноль
});

t('snapshotOf: читает только нужное и терпит пустые поля', () => {
  const s = snapshotOf({ day: 41.7, res: { gold: 10, wood: 20.6, stone: 0, steel: 5, food: 99 } });
  eq(s.day, 41);
  eq(s.res.gold, 10);
  eq(s.res.wood, 20.6);
  eq(s.res.food, 99);
  const empty = snapshotOf({});
  eq(empty.day, 0);
  eq(empty.res.steel, 0);
});

t('трекер: первый вызов даёт null, сутки прошли — дельта за день', () => {
  let tr = advanceRates({ day: null, res: null }, snapshotOf({ day: 10, res: { gold: 100, wood: 50, stone: 8, steel: 2, food: 200 } }));
  eq(tr.rates, null, 'нет данных — нет бейджа');
  tr = advanceRates(tr, snapshotOf({ day: 11, res: { gold: 114, wood: 47, stone: 8, steel: 2, food: 214 } }));
  near(tr.rates.gold, 14, 1e-9);
  near(tr.rates.wood, -3, 1e-9);
  near(tr.rates.food, 14, 1e-9);
  near(tr.rates.stone, 0, 1e-9);
});

t('трекер: тот же день возвращает прошлый замер без пересчёта', () => {
  let tr = advanceRates({ day: null, res: null }, snapshotOf({ day: 5, res: { gold: 0, wood: 0, stone: 0, steel: 0, food: 0 } }));
  const mid = advanceRates(tr, snapshotOf({ day: 5.4, res: { gold: 999, wood: 999, stone: 999, steel: 999, food: 999 } }));
  eq(mid.rates, null, 'внутри суток число не мигает');
  eq(mid.res.gold, 0, 'снимок середины дня не портит опорную точку');
});

t('трекер: несколько суток сразу — средние сутки, а не весь скачок', () => {
  let tr = advanceRates({ day: null, res: null }, snapshotOf({ day: 1, res: { gold: 0, wood: 30, stone: 0, steel: 0, food: 0 } }));
  tr = advanceRates(tr, snapshotOf({ day: 3, res: { gold: 40, wood: 60, stone: 0, steel: 0, food: 0 } }));
  // +40🪙 и +30🪵 за два дня — честные сутки: +20 и +15.
  near(tr.rates.gold, 20, 1e-9);
  near(tr.rates.wood, 15, 1e-9);
});

t('трекер: откат дня назад (загрузка сейва) перезапускает замер', () => {
  let tr = advanceRates({ day: null, res: null }, snapshotOf({ day: 50, res: { gold: 500, wood: 500, stone: 500, steel: 500, food: 500 } }));
  tr = advanceRates(tr, snapshotOf({ day: 51, res: { gold: 520, wood: 520, stone: 520, steel: 520, food: 520 } }));
  tr = advanceRates(tr, snapshotOf({ day: 7, res: { gold: 1, wood: 1, stone: 1, stone2: 1, steel: 1, food: 1 } }));
  eq(tr.rates, null, 'после отката старая дельта врёт — сбрасываем');
});

t('трекер детерминирован: одна последовательность — один ответ', () => {
  const run = () => {
    let tr = advanceRates({ day: null, res: null }, snapshotOf({ day: 2, res: { gold: 4, wood: 4, stone: 4, steel: 4, food: 4 } }));
    tr = advanceRates(tr, snapshotOf({ day: 4, res: { gold: 44, wood: 34, stone: 4, steel: 14, food: 64 } }));
    return [tr.day, ...BAR_RES.map(r => tr.rates[r.id])].join(',');
  };
  eq(run(), run());
});

t('UNLIMITED_CAP совпадает с потолком ядра для золота', () => {
  eq(UNLIMITED_CAP, 99999);
});

t('сегмент: грань+плита, крупное число, ёмкость склада, бейдж; полный склад подсвечен', () => {
  const h = segHtml({ id: 'wood', icon: '🪵', ru: 'Дерево' }, 120, 400, rateBadge(14));
  ok(h.includes('ft-res-in'), 'внутренняя плита сегмента (фрезерованная пластина)');
  ok(h.includes('ft-num'), 'число своим классом');
  ok(h.includes('>120<') || h.includes('120'), 'значение на месте');
  ok(h.includes('/400'), 'ёмкость рядом');
  ok(h.includes('+14/д') && h.includes('ft-rate up'), '+14/д зелёным');
  const noCap = segHtml(BAR_RES[0], 55, UNLIMITED_CAP, rateBadge(null));
  ok(!noCap.includes('ft-cap'), 'у бесконечного склада знаменателя нет');
  const full = segHtml({ id: 'food', icon: '🍞', ru: 'Еда' }, 199.8, 200, rateBadge(0));
  ok(full.includes('ft-full'), 'склад почти полон — чип подсвечен');
  // Исторические имена экспортов живут: пилюли стали сегментами без смены API.
  eq(pillHtml(BAR_RES[0], 1, UNLIMITED_CAP, rateBadge(null)), segHtml(BAR_RES[0], 1, UNLIMITED_CAP, rateBadge(null)));
});

t('сегмент населения: свободные места или «полно», без суточного бейджа', () => {
  const room = popSegHtml(12, 20);
  ok(room.includes('/20') && room.includes('+8'), 'свободные места видны');
  const tight = popSegHtml(20, 20);
  ok(tight.includes('полно'), 'жильё занято — сказано словами');
  ok(!tight.includes('ft-rate up'), 'населению не рисуется зелёный +X/д');
  eq(popSegHtml(1, 2), popPillHtml(1, 2), 'старое имя popPillHtml живо');
});

t('разметка детерминирована', () => {
  const a = segHtml(BAR_RES[0], 10, UNLIMITED_CAP, rateBadge(1));
  const b = segHtml(BAR_RES[0], 10, UNLIMITED_CAP, rateBadge(1));
  eq(a, b);
});

t('стиль полосы — военный металл Generals: палитра, скосы, табличные цифры', () => {
  // Палитра задания закреплена тестом, чтобы рестайл не поплыл незаметно.
  ok(CODE.includes('#1a1d18'), 'тёмный металл #1a1d18');
  ok(CODE.includes('#c8a24a'), 'янтарь #c8a24a');
  ok(CODE.includes('#b0413e'), 'красный тревоги #b0413e');
  ok(CODE.includes('--ft-cut'), 'скошенные углы сегментов через clip-path');
  ok(CODE.includes('clip-path: var(--ft-cut)'), 'скос применён к ячейкам');
  ok(CODE.includes('tabular-nums'), 'цифры табличные — разряды не прыгают');
  ok(CODE.includes('min-width:') && /min-width:\s*[\d.]+ch/.test(CODE), 'ширина числа зафиксирована в ch');
  ok(!/border-radius:\s*9{2,}px|border-radius:\s*999px/.test(CODE), 'пилюльных радиусов больше нет');
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
