// Тесты слоя фотопаттернов (app/src/render/textures.js) и конвейера
// tools/textures.mjs. Запуск: node app/tests/test-textures.mjs
//
// Канваса в node нет — тот же приём, что в test-icons.mjs: подставной Image
// (декодирует «мгновенно») и подставной 2D-контекст, который только считает
// вызовы. Проверяется контракт слоя: экспорты, отсутствие дублей ролей,
// бюджет веса art/tex на диске, честный false без роли и детерминизм сдвигов.
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const TEX_DIR = join(ROOT, 'art', 'tex');

// Подставной Image: src присвоили — «декодировалось». Порядок как в браузере:
// onload назначается до src, поэтому срабатывает синхронно и детерминированно.
globalThis.Image = class {
  constructor() {
    this.naturalWidth = 384;
    this.naturalHeight = 384;
    this.complete = false;
    this.onload = null;
    this.onerror = null;
  }
  set src(v) { this._src = v; this.complete = true; if (this.onload) this.onload(); }
  get src() { return this._src; }
};

const {
  buildAtlas, texReady, texPattern, TEX_ROLES, TEX_MAX_ALPHA,
} = await import('../src/render/textures.js');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('OK', name); } catch (e) { fail++; console.log('FAIL', name, '—', e.message); } };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || ''} ждали ${b}, получили ${a}`); };
const ok = (v, m) => { if (!v) throw new Error(m || 'ложь'); };

// Подставной 2D-контекст: createPattern отдаёт маркер, translate/fillRect
// пишут аргументы — по ним проверяется детерминизм сдвигов паттерна.
function texCtx() {
  const calls = { translate: [], fillRect: [], save: 0, restore: 0 };
  return {
    globalAlpha: 1,
    fillStyle: null,
    calls,
    save() { calls.save++; },
    restore() { calls.restore++; },
    translate(x, y) { calls.translate.push([x, y]); },
    fillRect(x, y, w, h) { calls.fillRect.push([x, y, w, h]); },
    createPattern() { return { isPattern: true }; },
  };
}

// ---------------------------------------------------------------------------
// 1. Экспорты и таблица ролей
t('экспорты на месте: три функции и константы', () => {
  eq(typeof buildAtlas, 'function', 'buildAtlas');
  eq(typeof texReady, 'function', 'texReady');
  eq(typeof texPattern, 'function', 'texPattern');
  ok(Array.isArray(TEX_ROLES) && TEX_ROLES.length > 0, 'TEX_ROLES');
  eq(typeof TEX_MAX_ALPHA, 'number');
});
t('12 ролей без дублей, земля и постройки накрыты', () => {
  eq(TEX_ROLES.length, 12, 'число ролей');
  eq(new Set(TEX_ROLES).size, TEX_ROLES.length, 'дубли ролей');
  for (const must of ['grass', 'water', 'sand', 'snow', 'stone_wall', 'cloth']) {
    ok(TEX_ROLES.includes(must), 'нет роли ' + must);
  }
});
t('потолок альфы не выше договорных 0.35', () => {
  ok(TEX_MAX_ALPHA <= 0.35, 'TEX_MAX_ALPHA > 0.35');
});

// 2. Файлы на диске: конвейер обязан был уложить все роли и влезть в бюджет
t('art/tex: файл на каждую роль, вес в бюджете ≤ 1.6 МБ', () => {
  const BUDGET = 1.6 * 1024 * 1024;
  let total = 0;
  for (const role of TEX_ROLES) {
    const f = join(TEX_DIR, role + '.jpg');
    const s = statSync(f); // бросит, если файла нет — это и есть провал
    ok(s.size > 512, role + ': подозрительно пустой');
    total += s.size;
  }
  ok(total <= BUDGET, `сумма ${total} превышает бюджет ${BUDGET}`);
});
t('art/tex: нет лишних файлов вне ролей', () => {
  const extra = readdirSync(TEX_DIR).filter(f => f.endsWith('.jpg') && !TEX_ROLES.includes(f.replace(/\.jpg$/, '')));
  eq(extra.join(','), '', 'лишние jpg в art/tex');
});

// 3. Атлас
t('buildAtlas: принимает данные, считает роли, игнорирует мусор', () => {
  eq(buildAtlas(null), 0, 'null');
  eq(buildAtlas({}), 0, 'пусто');
  eq(buildAtlas({ grass: 'data:image/jpeg;base64,xx', bad: 42 }), 1, 'нестрока отфильтрована');
});
t('texReady: роль готова после декода, чужая — false', () => {
  ok(texReady('grass'), 'grass готов');
  ok(!texReady('нет-такой-роли'), 'чужая роль');
});
t('texReady/buildAtlas не падают в среде без window (Node)', () => {
  // Мы и есть среда без window: если дошли сюда — модуль импортировался
  // и отвечает без исключений.
  eq(typeof texReady('grass'), 'boolean');
});

// 4. texPattern: честный false и зажатая альфа.
// Полный атлас: дальше проверяются и постройочные роли, не только трава.
buildAtlas(Object.fromEntries(TEX_ROLES.map(r => [r, 'data:image/jpeg;base64,AA'])));
t('texPattern: без роли — false, игра не падает', () => {
  const ctx = texCtx();
  eq(texPattern(ctx, 'нет-такой-роли', 0, 0, 10, 10), false);
  eq(ctx.calls.fillRect.length, 0, 'ничего не нарисовано');
});
t('texPattern: без контекста и с нулевым размером — false', () => {
  eq(texPattern(null, 'grass', 0, 0, 10, 10), false);
  eq(texPattern(texCtx(), 'grass', 0, 0, 0, 10), false);
});
t('texPattern: рисует и зажимает альфу потолком 0.35', () => {
  const ctx = texCtx();
  ok(texPattern(ctx, 'grass', 0, 0, 100, 50, 5), 'вызов не удался');
  eq(ctx.calls.fillRect.length, 1);
  ok(ctx.globalAlpha <= 0.35, 'альфа выше потолка: ' + ctx.globalAlpha);
  ok(ctx.globalAlpha > 0, 'альфа должна была остаться положительной');
});
t('texPattern: отрицательная альфа уходит в ноль, а не в исключение', () => {
  const ctx = texCtx();
  ok(texPattern(ctx, 'grass', 0, 0, 10, 10, -1));
  eq(ctx.globalAlpha, 0);
});

// 5. Детерминизм: сдвиги только из hash(seed)
t('один seed — один сдвиг паттерна (кадр воспроизводим)', () => {
  const a = texCtx(), b = texCtx();
  texPattern(a, 'grass', 0, 0, 10, 10, 0.3, { seed: 20250808 });
  texPattern(b, 'grass', 0, 0, 10, 10, 0.3, { seed: 20250808 });
  eq(JSON.stringify(a.calls.translate), JSON.stringify(b.calls.translate));
});
t('другой seed — другой сдвиг (фактура не выстраивается в узор)', () => {
  const a = texCtx(), b = texCtx();
  texPattern(a, 'grass', 0, 0, 10, 10, 0.3, { seed: 1 });
  texPattern(b, 'grass', 0, 0, 10, 10, 0.3, { seed: 999 });
  ok(a.calls.translate[0][0] !== b.calls.translate[0][0] || a.calls.translate[0][1] !== b.calls.translate[0][1], 'сдвиги совпали');
});
t('разные роли при одном seed сдвигаются по-разному', () => {
  const a = texCtx(), b = texCtx();
  texPattern(a, 'grass', 0, 0, 10, 10, 0.3, { seed: 7 });
  texPattern(b, 'water', 0, 0, 10, 10, 0.3, { seed: 7 });
  ok(a.calls.translate[0][0] !== b.calls.translate[0][0] || a.calls.translate[0][1] !== b.calls.translate[0][1], 'роли сдвинуты одинаково');
});
t('якорь ax/ay привязывает сетку к миру (не плывёт при панораме)', () => {
  const a = texCtx(), b = texCtx();
  texPattern(a, 'grass', 0, 0, 10, 10, 0.3, { seed: 7, ax: 0, ay: 0 });
  texPattern(b, 'grass', 0, 0, 10, 10, 0.3, { seed: 7, ax: 100, ay: 40 });
  eq(b.calls.translate[0][0], a.calls.translate[0][0] - 100, 'сдвиг по x');
  eq(b.calls.translate[0][1], a.calls.translate[0][1] - 40, 'сдвиг по y');
});

// 6. Правила проекта: никакого Math.random ни в рантайме, ни в конвейере
const strip = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
t('в textures.js и tools/textures.mjs нет Math.random', () => {
  ok(!/Math\.random/.test(strip('app/src/render/textures.js')), 'рантайм');
  ok(!/Math\.random/.test(strip('tools/textures.mjs')), 'конвейер');
});
t('рантайм не трогает общий генератор sim.rng', () => {
  ok(!/\brng\b/.test(strip('app/src/render/textures.js')), 'sim.rng рендеру нельзя');
});

console.log(`\n=== ${pass} OK / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
