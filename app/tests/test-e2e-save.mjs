// Сквозной тест сохранений — релизный критерий «сейв/загрузка и детерминизм
// сида проверены», включая королевский род. Node, без DOM.
// Запуск: node app/tests/test-e2e-save.mjs (набор подхватывается tools/test-all.mjs).
//
// Что здесь проверяется:
//   · детерминизм сида: два прогона одного сида совпадают бит-в-бит,
//     разные сиды расходятся (500 игровых дней, тик 0.25 дня);
//   · круг serialize→deserialize→serialize бит-в-бит на глубокой партии
//     (600 дней — династия уже прожила историю);
//   · продолжение после загрузки: загруженная партия живёт ещё 300 дней
//     синхронно с оригиналом (ранний сейв), а две независимые загрузки
//     глубокого сейва живут 300 дней синхронно друг с другом — контрольные
//     точки каждые 100 дней;
//   · гигиена сериализации: ни NaN, ни Infinity (строкой и рекурсивно по
//     числам — JSON.stringify молча превращает их в null), размер сейва
//     на 2000-й день меньше 500 КБ;
//   · версия формата: serialize ставит SAVE_VERSION, deserialize принимает
//     текущую и старую версии (миграция) и отвергает чужие/битые файлы;
//   · род в сейве: linkDynasty восстанавливается, serializeDynasty идентичен
//     до и после круга, род живёт и остаётся конечным после продолжения.
import { Simulation } from '../src/core/simulation.js';
import { SAVE_VERSION } from '../src/core/data.js';
import { serializeDynasty } from '../src/core/systems/link_dynasty.js';

let ok = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); ok++; console.log('OK', name); }
  catch (e) { fail++; console.log('FAIL', name, '—', e.message); }
};
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

// День = 4 тика по 0.25, как в игре и в соседних тестах.
const runDays = (sim, days) => { for (let i = 0; i < days * 4; i++) sim.tick(0.25); };
const bytes = (str) => Buffer.byteLength(String(str), 'utf8');
const jsonOf = (sim) => JSON.stringify(sim.serialize());

// Строковой проверки мало: JSON.stringify превращает NaN/Infinity в null ещё
// до записи, так что испорченное число надо искать в самом объекте.
function nonFinitePaths(v, path = '$', out = []) {
  if (typeof v === 'number') { if (!Number.isFinite(v)) out.push(path); return out; }
  if (Array.isArray(v)) { v.forEach((x, i) => nonFinitePaths(x, `${path}[${i}]`, out)); return out; }
  if (v && typeof v === 'object') for (const k of Object.keys(v)) nonFinitePaths(v[k], `${path}.${k}`, out);
  return out;
}

// ─────────────────────────── испытательный стенд ───────────────────────────

const SEED = 4242;

// Одна прогретая партия (600 дней — у рода уже есть прошлое) и её сейв.
// Готовится один раз: проверки ниже читают разные срезы одного состояния.
let WARM = null;
function warm() {
  if (WARM) return WARM;
  const sim = new Simulation(SEED);
  runDays(sim, 600);
  const json = jsonOf(sim);
  WARM = { sim, json, snap: JSON.parse(json), load: Simulation.deserialize(json) };
  return WARM;
}

// ════════════════ 1. детерминизм сида ════════════════

let j500 = null;   // сериализация SEED на 500-й день — пригождается следующей проверке

t('два свежих прогона одного сида дают бит-в-бит одинаковый serialize (500 дней)', () => {
  const a = new Simulation(SEED), b = new Simulation(SEED);
  runDays(a, 500); runDays(b, 500);
  j500 = jsonOf(a);
  must(j500 === jsonOf(b), `сериализации разошлись: ${bytes(j500)} и ${bytes(jsonOf(b))} байт`);
});

t('сид действительно влияет: 4243 за те же 500 дней живёт иначе', () => {
  must(j500, 'предыдущая проверка не оставила эталон');
  const c = new Simulation(SEED + 1);
  runDays(c, 500);
  must(jsonOf(c) !== j500, 'разные сиды дали одинаковый serialize — сид ни на что не влияет');
});

// ════════════════ 2. круг сохранения на глубокой партии ════════════════

t('круг 600-го дня: serialize → deserialize → serialize бит-в-бит', () => {
  const w = warm();
  must(w.load.ok === true, `сейв не прочитался: ${w.load.reason}`);
  must(jsonOf(w.load.sim) === w.json,
    `круг разошёлся: ${bytes(w.json)} против ${bytes(jsonOf(w.load.sim))} байт`);
});

t('поток случая после загрузки продолжается с сохранённой позиции rngState', () => {
  const w = warm();
  must(Number.isFinite(w.snap.rngState), 'в сейве нет конечного rngState');
  must(w.load.sim.rng.getState() === w.snap.rngState, 'rng после загрузки не совпал с сейвом');
});

// ════════════════ 3. продолжение после загрузки ════════════════

// Буквальный сценарий «загрузили — обе партии живут дальше»: сейв снят до
// первого висящего события (день 0), когда у партии ещё нет однодневных
// кэшей и незавершённых дел жителей. Именно здесь движок обязан давать
// бит-в-бит синхронность с непрерывным оригиналом.
t('загруженная партия и оригинал живут 300 дней синхронно (контроль каждые 100)', () => {
  const orig = new Simulation(SEED);
  const r = Simulation.deserialize(jsonOf(orig));
  must(r.ok === true, r.reason || 'загрузка не удалась');
  const copy = r.sim;
  for (let d = 1; d <= 300; d++) {
    runDays(orig, 1); runDays(copy, 1);
    if (d % 100 === 0) {
      must(jsonOf(orig) === jsonOf(copy),
        `на +${d}-й день (абсолютный ${orig.day}) копия разошлась с оригиналом`);
    }
  }
});

// Тот же критерий на глубоком состоянии: две независимые загрузки одного
// 600-дневного сейва обязаны жить как близнецы — любой севший в сейв
// детерминизм проявился бы расхождением уже на первой сотне дней.
t('две загрузки сейва 600-го дня живут 300 дней синхронно (контроль каждые 100)', () => {
  const w = warm();
  const a = Simulation.deserialize(w.json);
  const b = Simulation.deserialize(w.json);
  must(a.ok && b.ok, 'повторная загрузка не удалась');
  for (let d = 1; d <= 300; d++) {
    runDays(a.sim, 1); runDays(b.sim, 1);
    if (d % 100 === 0) {
      must(jsonOf(a.sim) === jsonOf(b.sim),
        `на +${d}-й день (абсолютный ${a.sim.day}) две загрузки разошлись`);
    }
  }
});

t('две загрузки одного сейва: первые 100 дней идентичны между собой', () => {
  const w = warm();
  const a = Simulation.deserialize(w.json).sim;
  const b = Simulation.deserialize(w.json).sim;
  for (let d = 0; d < 100; d++) { runDays(a, 1); runDays(b, 1); }
  must(jsonOf(a) === jsonOf(b), `за 100 дней загрузки разошлись (день ${a.day})`);
});

// ════════════════ 4. гигиена сериализации на длинном прогоне ════════════════

const LONG_SEEDS = [4242, 777, 99, 20260730];   // последний — сид по умолчанию
const longRuns = [];                            // {seed, at500, at2000}

t('четыре сида × 2000 дней: ни NaN, ни Infinity в serialize', () => {
  for (const seed of LONG_SEEDS) {
    const s = new Simulation(seed);
    runDays(s, 500);
    const at500 = jsonOf(s);
    runDays(s, 1500);
    const at2000 = jsonOf(s);
    longRuns.push({ seed, at500, at2000 });
    must(!/NaN|Infinity/.test(at2000), `сид ${seed}: в строке сериализации NaN или Infinity`);
    const bad = nonFinitePaths(JSON.parse(at2000));
    must(!bad.length, `сид ${seed}: неконечные числа: ${bad.slice(0, 3).join(', ')}`);
    const badDyn = nonFinitePaths(serializeDynasty(s));
    must(!badDyn.length, `сид ${seed}: неконечные числа в состоянии рода: ${badDyn.slice(0, 3).join(', ')}`);
  }
});

t('сейв не раздувается: меньше 500 КБ на 2000-й день у всех сидов', () => {
  must(longRuns.length === LONG_SEEDS.length, 'предыдущая проверка не собрала размеры');
  for (const { seed, at500, at2000 } of longRuns) {
    const b500 = bytes(at500), b2000 = bytes(at2000);
    console.log(`   сид ${seed}: 500 дн. — ${b500} Б, 2000 дн. — ${b2000} Б (рост ×${(b2000 / b500).toFixed(2)})`);
    must(b2000 < 500 * 1024, `сид ${seed}: сейв на 2000-й день весит ${b2000} Б — лимит 512000`);
  }
});

// ════════════════ 5. версия формата и миграция ════════════════

t('serialize помечает версией формата, deserialize принимает текущую версию', () => {
  const w = warm();
  must(w.snap.version === SAVE_VERSION,
    `в сейве версия ${w.snap.version}, а SAVE_VERSION = ${SAVE_VERSION}`);
  must(w.load.ok === true, w.load.reason || 'текущий сейв не принят');
});

t('миграция: сейв прошлой версии поднимается до текущей, сейв новее игры отвергается', () => {
  const w = warm();
  const old = Simulation.deserialize(JSON.stringify({ ...w.snap, version: SAVE_VERSION - 1 }));
  must(old.ok === true, `миграция упала: ${old.reason}`);
  must(old.sim.day === w.sim.day, 'мигрированный сейв потерял день партии');
  must(old.sim.res.food === w.sim.res.food, 'мигрированный сейв потерял склад');
  const fut = Simulation.deserialize(JSON.stringify({ ...w.snap, version: SAVE_VERSION + 1 }));
  must(fut.ok === false && /обновите/.test(fut.reason || ''), 'сейв из будущего должен быть отвергнут');
});

t('битый файл и чужой JSON не роняют загрузку — честный отказ с причиной', () => {
  const broken = Simulation.deserialize('{это не json');
  must(broken.ok === false, 'битый JSON принят');
  must(typeof broken.reason === 'string' && broken.reason.length > 0, 'у отказа нет причины');
  const alien = Simulation.deserialize('{"hello":"world"}');
  must(alien.ok === false, 'чужой JSON принят за сейв Фронтира');
});

// ════════════════ 6. династия в сейве ════════════════

t('у загруженной партии существует состояние рода linkDynasty', () => {
  const st = warm().load.sim.linkDynasty;
  must(st && typeof st === 'object', 'linkDynasty отсутствует после загрузки');
  must(Array.isArray(st.members) && st.members.length > 0, 'род загрузился пустым');
  must(st.house && typeof st.house.name === 'string', 'род без дома');
});

t('serializeDynasty идентичен до и после круга сохранения', () => {
  const w = warm();
  const before = JSON.stringify(serializeDynasty(w.sim));
  const after = JSON.stringify(serializeDynasty(w.load.sim));
  must(before === after, `род разошёлся при загрузке: ${before} ≠ ${after}`);
});

t('род переживает 300 дней после загрузки: конечен, законность в пределах 0..100', () => {
  const w = warm();
  const sim = Simulation.deserialize(w.json).sim;
  must(sim.linkDynasty, 'род пропал при загрузке');
  runDays(sim, 300);
  const snap = serializeDynasty(sim);
  must(!nonFinitePaths(snap).length, 'в состоянии рода появились неконечные числа');
  must(sim.linkDynasty.legitimacy >= 0 && sim.linkDynasty.legitimacy <= 100,
    `законность вышла за пределы: ${sim.linkDynasty.legitimacy}`);
  must(sim.linkDynasty.members.length > 0, 'род угас без членов даже в летописи');
  console.log(`   день ${sim.day}: дом ${snap.house.name}, законность ${Math.round(sim.linkDynasty.legitimacy)}, членов в летописи ${snap.members.length}`);
});

console.log(`\n=== ${ok} OK / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
