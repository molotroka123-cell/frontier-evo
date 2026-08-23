// Тесты моста ui/tutorial10.js → ui/coach.js. Запуск: node app/tests/test-tutorial-bridge.mjs
// Мост — это импорт + STEPS.push(...) + счётчик в renderCard (см. шапку
// tutorial10.js). Здесь проверяем ЧИСТУЮ часть: coach.js импортируется в node
// без DOM, уроки реально дописаны в сценарий коуча, без дублей id и в
// стабильном порядке, а done/ready замкнуты на чистые предикаты tutorial10.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Simulation } from '../src/core/simulation.js';
import { TUTORIAL10, tutorialProgress } from '../src/ui/tutorial10.js';
import { COACH_STEPS } from '../src/ui/coach.js';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('OK', name); } catch (e) { fail++; console.log('FAIL', name, '—', e.message); } };
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const eq = (a, b, msg) => ok(a === b, `${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

const MODULE_PATH = fileURLToPath(new URL('../src/ui/tutorial10.js', import.meta.url));
const BRIDGE_TEST_PATH = fileURLToPath(import.meta.url);

// Родные шаги коуча до моста: их порядок и состав менять нельзя.
const NATIVE_IDS = ['villager', 'gather', 'hut', 'store', 'labor', 'tech', 'event', 'scout'];

// ------------------------------------------------------------- регистрация
t('мост: coach.js импортируется в node без DOM и отдаёт сценарий', () => {
  ok(Array.isArray(COACH_STEPS), 'COACH_STEPS — не массив');
  ok(COACH_STEPS.length > TUTORIAL10.length, `шагов ${COACH_STEPS.length}, меньше ожидаемого минимума`);
});

t('мост: все уроки TUTORIAL10 дописаны в сценарий коуча', () => {
  const ids = new Set(COACH_STEPS.map(s => s.id));
  for (const st of TUTORIAL10) ok(ids.has(st.id), `урок ${st.id} не зарегистрирован в coach`);
  eq(COACH_STEPS.length, 8 + TUTORIAL10.length, 'в сценарии лишние или потерянные шаги');
});

t('мост: дублей id нет во всём сценарии', () => {
  const seen = new Set();
  for (const s of COACH_STEPS) {
    ok(typeof s.id === 'string' && s.id.length > 2, `плохой id: ${JSON.stringify(s && s.id)}`);
    ok(!seen.has(s.id), `id повторяется: ${s.id}`);
    seen.add(s.id);
  }
});

t('порядок стабилен: родные шаги впереди, уроки — в хвосте по порядку TUTORIAL10', () => {
  eq(COACH_STEPS.slice(0, 8).map(s => s.id).join('>'), NATIVE_IDS.join('>'), 'родная часть сценария уехала');
  eq(COACH_STEPS.slice(8).map(s => s.id).join('>'), TUTORIAL10.map(s => s.id).join('>'), 'хвост не совпадает с TUTORIAL10');
});

t('мост: поля урока перенесены как есть (title/hint), done/ready — функции', () => {
  for (const st of TUTORIAL10) {
    const s = COACH_STEPS.find(x => x.id === st.id);
    eq(s.title, st.title, `${st.id}: title искажён`);
    eq(s.text, st.hint, `${st.id}: text не равен hint`);
    ok(typeof s.done === 'function', `${st.id}: done — не функция`);
    if (st.skipIf) ok(typeof s.ready === 'function', `${st.id}: skipIf не отображён в ready`);
    else ok(s.ready === undefined && s.moot === undefined, `${st.id}: лишний gate без skipIf`);
  }
});

// ------------------------------------------------------------ замыкание на sim
t('done урока читает реальную партию: собиратели закрывают «Еда прежде всего»', () => {
  const s = new Simulation(20260730);
  const step = COACH_STEPS.find(x => x.id === 'food_first');
  eq(step.done({ sim: s }), false, 'на новой партии шаг уже закрыт');
  s.buildings.push({ id: 'forager', destroyed: false });
  eq(step.done({ sim: s }), true, 'факт постройки не закрыл шаг');
});

t('ready повторяет skipIf с отрицанием: амбар вне дела без Гончарства', () => {
  const s = new Simulation(777);
  const g = COACH_STEPS.find(x => x.id === 'winter_granary');
  eq(g.ready({ sim: s }), false, 'без Гончарства шаг должен быть отложен');
  s.techs.add('pottery');
  eq(g.ready({ sim: s }), true, 'Гончарство открыто, а шаг всё ещё спрятан');
  const mk = COACH_STEPS.find(x => x.id === 'first_market');
  eq(mk.ready({ sim: s }), false, 'рынок без Торговли не должен быть по делу');
  s.techs.add('trade');
  eq(mk.ready({ sim: s }), true, 'Торговля открыта, а рынок спрятан');
});

t('сломанный sim не роняет шаг: done/ready тихо возвращают safe-значение', () => {
  const step = COACH_STEPS.find(x => x.id === 'food_first');
  eq(step.done({ sim: {} }), false, 'done бросил вместо false');
  const g = COACH_STEPS.find(x => x.id === 'winter_granary');
  eq(g.ready({ sim: null }), false, 'ready при ошибке должен прятать шаг (false), а не показывать');
});

t('nextStep-семантика: неготовые уроки прозрачны, готовый урок становится текущим', () => {
  // Мини-копия nextStep из coach.js: тот же обход COACH_STEPS.
  const pick = (c) => {
    for (const s of COACH_STEPS) {
      if (c.doneIds.has(s.id)) continue;
      if (s.moot && s.moot(c)) { c.doneIds.add(s.id); continue; }
      if (s.ready && !s.ready(c)) continue;
      return s;
    }
    return null;
  };
  const c = { sim: new Simulation(5150), doneIds: new Set(['villager', 'gather']) };
  eq(pick(c).id, 'hut', 'текущий шаг — не родная хижина');
  // Закрываем родные шаги до хвоста: хижина, склад (отложен без теха), труд, тех, событие, разведка.
  for (const id of ['hut', 'store', 'labor', 'tech', 'event', 'scout']) c.doneIds.add(id);
  eq(pick(c).id, 'food_first', 'хвост лестницы должен начинаться с первого урока');
  c.sim.techs.add('tools');
  for (const id of ['food_first', 'wood_line', 'home_hut', 'goals_track', 'first_tech', 'stone_quarry']) c.doneIds.add(id);
  // Амбар и частокол без технологий «не по делу» — прозрачны и не перехватывают
  // текущий шаг; из хвоста остаётся только зима.
  eq(pick(c).id, 'winter_survived', 'неготовые уроки должны быть прозрачны');
  c.sim.techs.add('trade');
  eq(pick(c).id, 'first_market', 'Торговля открыта — рынок всплыл и стал текущим');
});

t('счётчик карточки и тесты согласованы: tutorialProgress по той же партии', () => {
  const s = new Simulation(9090);
  s.buildings.push({ id: 'forager', destroyed: false }, { id: 'lumber', destroyed: false });
  const p = tutorialProgress(s);
  eq(p.total, TUTORIAL10.length, 'total разошёлся со сценарием');
  eq(p.done, 2, 'forager+lumber должны закрыть два первых урока');
  eq(p.current, 'home_hut', 'current указывает не на хижину');
  // В coach.js счётчик берётся именно отсюда — проверяем, что вызов на месте.
  const coachSrc = readFileSync(fileURLToPath(new URL('../src/ui/coach.js', import.meta.url)), 'utf8');
  ok(/import \{ TUTORIAL10, tutorialProgress \} from '\.\/tutorial10\.js';/.test(coachSrc),
    'в coach.js нет импорта моста из шапки tutorial10.js');
  ok(/tutorialProgress\(this\.sim\)/.test(coachSrc), 'renderCard не использует tutorialProgress для счётчика');
});

// ------------------------------------------------------------------ кодировка
t('UTF-8 без BOM, переводы строк только LF (coach.js и этот тест)', () => {
  for (const [tag, path] of [
    ['coach.js', fileURLToPath(new URL('../src/ui/coach.js', import.meta.url))],
    ['test-tutorial-bridge.mjs', BRIDGE_TEST_PATH],
    ['tutorial10.js', MODULE_PATH],
  ]) {
    const buf = readFileSync(path);
    ok(!(buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF), `${tag}: начинается с BOM`);
    ok(!buf.includes(13), `${tag}: найден CR — в файле CRLF вместо LF`);
    const txt = buf.toString('utf8');
    ok(!/\?{2,}/.test(txt.slice(0, 400)), `${tag}: похоже на битую кодировку в шапке`);
  }
});

console.log(`\n=== ${pass} OK / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
