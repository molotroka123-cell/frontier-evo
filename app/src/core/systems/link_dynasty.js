// core/systems/link_dynasty.js — СВЯЗЬ: «род при троне». Династия, законность,
// законы преемственности, претенденты и придворные интриги.
//
// ЗАЧЕМ ЭТОТ ФАЙЛ. У державы уже есть стабильность, сословия и строй, но нет
// того, ради чего всё это держать: семьи, которая правит и которую можно
// потерять за одну ночь. Здесь появляется королевский род — живые люди с
// именами, возрастом и чертами. Пока род крепок (высока законность), порядок
// прочен; когда род слаб, вокруг трона собираются претенденты, в стенах зреют
// заговоры, а смерть правителя без наследника означает междуцарствие.
//
// ЧТО ИМЕННО СВЯЗАНО:
//   голод (sim.linkSurvival)       ──▶ законность падает каждый день голода
//   траур по земле (linkTerritory) ──▶ законность падает, пока свежа потеря
//   довольство народа (sim._happy) ──▶ законность крепнет или тает
//   содержание двора (казна)       ──▶ законность растёт, пока деньги платятся
//   смерть правителя               ──▶ наследник по закону строя ИЛИ междуцарствие
//   ОБРАТНО: шаткий трон и междуцарствие ──▶ стабильность и счастье державы
//
// ТРИ ЖЕЛЕЗНЫХ ПРАВИЛА (за ними следит тест):
//   1. ЧИСТОТА. dynastyNewDay НИКОГДА не пишет в sim: она читает сложившийся
//      день и возвращает отчёт {mods, reasons, events, flags.state}, где
//      flags.state — НОВЫЙ клон состояния рода. Применяет отчёт integrate.js.
//      Одни сутки считаются один раз: повторный вызов тем же днём возвращает
//      нулевой отчёт и ТОТ ЖЕ объект состояния.
//   2. СВОЙ ПОТОК СЛУЧАЯ. Глобальный генератор случайных чисел и броски
//      sim.rng здесь не живут: имя наследника обязано совпасть до и после
//      загрузки сейва. Поток заведён от сида мира (seed ^ 0xD19A5711) и
//      хранится в самом состоянии (rngState), поэтому восстановление не тратит
//      ни одного броска главного потока — партии после загрузки не расходятся.
//   3. У КАЖДОЙ ПЕТЛИ — ПОТОЛОК. Претендентов не больше пяти, заговоров не
//      больше трёх, живых членов рода не больше двенадцати, детей у пары не
//      больше четырёх, поддержка претендента ограничена. Без потолков любая
//      из этих петель съедала бы партию сама по себе.
import { createRng } from '../rng.js';

// ---------- Константы законности ----------

// Стартовая и «дефолтная» законность: столько стоит дом, который никем не
// любим и никем не ненавидим. Значение совпадает с дефолтом состояния —
// мусорный сейв восстанавливается к нему же.
export const LEGIT_START = 55;
// Ежедневное затухание: забытый род тает сам собой, без всяких бед.
export const LEGIT_DECAY = 0.04;
// Счастье народа: каждый пункт выше/ниже пятидесяти даёт/отнимает долю.
export const LEGIT_THRONE_RATE = 0.01;
// Содержание двора: уровень двора умножается на эту ставку.
export const LEGIT_COURT_RATE = 0.2;
// Потолки вкладов. Выше LEGIT_COURT_CAP двор уже не покупает любви, выше
// LEGIT_THRONE_CAP и народное довольство не прибавляет: утвердившийся дом
// должен расти делами, а не пирамидой.
export const LEGIT_COURT_CAP = 66;
export const LEGIT_THRONE_CAP = 81;
// Голод: каждая голодная сутки стоит дому столько законности.
export const LEGIT_HUNGER_RATE = 0.05;
// Траур по земле: столько в день стоит свежий шок потери города.
export const LEGIT_SHOCK_RATE = 0.1;

// ---------- Двор ----------
export const COURT_MAX = 3;
// Содержание уровня за день. Платит казна (integrate списывает courtGold).
export const COURT_UPKEEP = [0, 5, 12, 25];

// ---------- Люди рода ----------
export const YEAR_DAYS = 100;        // год = 100 дней, как везде в игре
export const ADULT_DAYS = 1200;      // совершеннолетие: 12 лет
export const FERTILE_END = 4800;     // после 48 лет дети не рождаются
export const OLD_AGE = 8000;         // с этого возраста смертность растёт
export const DEATH_HARD_AGE = 13200; // гарантированный предел лет
export const MEMBER_CAP = 12;        // живых членов рода не больше
export const KIDS_PER_PAIR = 4;      // детей у одной пары не больше
export const BIRTH_CHANCE = 0.02;    // шанс рождения у плодной пары за день

// ---------- Претенденты ----------
export const PRETENDER_LEGIT = 20;   // ниже этой законности появляются
export const PRETENDER_CAP = 5;      // и никогда не больше пяти
export const PRETENDER_CHANCE = 0.06;
export const SUPPORT_MAX = 100;      // потолок поддержки претендента
export const REVOLT_SUPPORT = 85;    // с такой поддержкой претендент бунтует
export const REVOLT_CHANCE = 0.03;
export const REVOLT_STAB_SHOCK = -6; // разовый удар по порядку при мятеже
export const REVOLT_LEGIT_COST = 5;

// ---------- Заговоры ----------
export const PLOT_CAP = 3;           // одновременно не больше трёх
export const PLOT_KINDS = ['scandal', 'claim', 'poison'];
export const PLOT_CHANCE = 0.02;
export const PLOT_LEGIT_MAX = 50;    // зреют при слабой законности…
export const PLOT_HAPPY_MAX = 40;    // …или при недовольном народе
export const SCANDAL_LEGIT_HIT = -2;
export const CLAIM_SUPPORT_GAIN = 20;

// ---------- Междуцарствие ----------
// Разовый удар по порядку в день пресечения рода. Хронические штрафы много
// меньше: день смерти должен быть слышен именно как удар.
export const INTERREGNUM_STAB = -12;
export const INTERREG_AUTO_DAYS = 60;      // через столько дней знать решит сама
export const INTERREG_AUTO_LEGIT = 35;     // новый дом встаёт на эту законность
export const INTERREG_CHRONIC_STAB = -0.6; // каждый день пустого трона
// Кулдаун смуты: пресечение рода объявляется междуцарствием не чаще раза в
// M дней. Без порога яд и быстрые смерти гнали цепочки «дом пал — 60 дней —
// новый дом — дом пал», давая по 34 междуцарствия за 12000 дней (сид 4242);
// теперь слишком свежая усобица держится регентским советом до срока M.
export const INTERREG_COOLDOWN = 600;
// Регентство тише междуцарствия: династия жива, трон пуст лишь формально,
// поэтому хронический пресс на порядок вдвое слабее пресса пустого трона.
export const REGENCY_STAB = -0.3;
export const LOW_LEGIT_STAB_AT = 25;       // ниже — держава нервничает
export const LOW_LEGIT_STAB = -0.5;

// ---------- Решения игрока ----------
export const DESIGNATE_COST = 8;        // воля правителя стоит законности
export const DESIGNATE_NOBLE_HIT = 4;   // и злит знать
export const MARRIAGE_GOLD = 60;
export const MARRIAGE_REL = 15;
export const MARRIAGE_LEGIT = 3;
export const USURP_LEGIT = 25;          // узурпатор встаёт на низкую законность
export const USURP_STAB_COST = 20;      // и платит порядком
export const USURP_MIN_AVG = 45;        // без поддержки сословий — отказ
export const USURP_MIN_NOBLES = 50;
export const EXPOSE_GOLD = 25;
export const EXPOSE_LEGIT_GAIN = 4;
export const PARDON_LEGIT_COST = 3;
export const EXECUTE_LEGIT_GAIN = 5;
export const EXECUTE_NOBLE_GAIN = 2;
export const EXECUTE_COMMON_HIT = 3;
export const ADOPT_GOLD = 120;          // выкуп междоусобицы казной
export const ADOPT_LEGIT = 45;
export const CONFIRM_DAYS = 2;          // окно подтверждения переворота

const DYN_SEED = 0xD19A5711 >>> 0;      // соль собственного потока случая

// Имена. Обычные пулы без претензий: важна воспроизводимость, а не редкость.
const MALE_NAMES = ['Ярослав', 'Всеволод', 'Мстислав', 'Ростислав',
  'Святополк', 'Борис', 'Глеб', 'Игорь', 'Олег', 'Владимир', 'Дмитрий',
  'Фёдор'];
const FEMALE_NAMES = ['Ефросинья', 'Ольга', 'Анна', 'Мария', 'Любава',
  'Мирослава', 'Вера', 'Аглая'];
const HOUSE_NAMES = ['Рюриковичи', 'Соколовы', 'Медведевы', 'Заречные',
  'Вельские', 'Чернышовы', 'Яровые', 'Холмогоровы', 'Белогоровы', 'Стожары',
  'Лунёвы', 'Вышаты'];
const TRAIT_POOL = ['valiant', 'cunning', 'pious', 'beloved'];
const STATUS_OK = ['ruler', 'spouse', 'member'];

// ════════════════════════ мелкая утварь ════════════════════════

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function numOf(v, def) { return Number.isFinite(v) ? v : def; }
function intOf(v, def) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : def;
}
function idOrNull(v) {
  const n = intOf(v, NaN);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function yearsOf(age) { return Math.floor(Math.max(0, numOf(age, 0)) / YEAR_DAYS); }
function traitCount(m) { return m && Array.isArray(m.traits) ? m.traits.length : 0; }

// Клон состояния для дневного хода. Объект потока случая сюда не входит:
// он восстанавливается отдельно, из сохранённой позиции rngState.
function cloneState(st) {
  const c = JSON.parse(JSON.stringify(st));
  delete c._rng;
  return c;
}

// Свой поток случая модуля. Заводится лениво от сида мира; если в состоянии
// есть сохранённая позиция — продолжает ровно с неё, не трогая sim.rng.
function dynRng(st, worldSeed) {
  if (st._rng) return st._rng;
  const r = createRng(((numOf(worldSeed, 0) >>> 0) ^ DYN_SEED) >>> 0);
  if (Number.isFinite(st.rngState)) r.setState(numOf(st.rngState, 0) >>> 0);
  st._rng = r;
  return r;
}
function keepRng(st) { if (st._rng) st.rngState = st._rng.getState(); }

function makeMember(st, o) {
  const m = {
    id: st.nextId++,
    name: String(o.name || 'Безымянный'),
    age: Math.max(0, intOf(o.age, 0)),
    sex: o.sex === 'ж' ? 'ж' : 'м',
    traits: Array.isArray(o.traits) ? o.traits.map(String) : [],
    status: STATUS_OK.includes(o.status) ? o.status : 'member',
    alive: true,
    deathDay: -1,
    cause: '',
    pairWith: o.pairWith != null ? o.pairWith : null,
    kids: 0,
  };
  st.members.push(m);
  return m;
}

// Фамилия нового дома обязана отличаться от старой, иначе игрок не увидит
// смены династии ни в летописи, ни на вкладке «Род».
function pickHouse(rng, exclude) {
  let name = rng.pick(HOUSE_NAMES);
  for (let i = 0; i < 10 && name === exclude; i++) name = rng.pick(HOUSE_NAMES);
  if (name === exclude) name = `${exclude} Младшие`;
  return name;
}

// ════════════════════════ состояние ════════════════════════

export function createDynastyState() {
  return {
    v: 1,
    day: -1,                     // сутки последнего расчёта (-1 — ещё не было)
    house: { name: '', founder: '', generations: 1, throneDays: 0 },
    members: [],
    legitimacy: LEGIT_START,
    court: 0,
    designated: null,
    heir: null,
    pretenders: [],
    plots: [],
    marriages: [],
    interregnum: false,
    interregnumDays: 0,
    // Регентство бывает двух видов: при малолетнем правителе (regentId —
    // взрослый родич) и за пресёкшийся дом внутри кулдауна смуты
    // (regentId = null — безликий регентский совет).
    regency: false,
    regentId: null,
    // День последнего ОБЪЯВЛЕННОГО междуцарствия: память державы о смуте,
    // а не дома — переживает смену фамилии на троне.
    lastInterregnumDay: -1,
    nextId: 1,
    plotSeq: 1,
    lastDelta: 0,
    lastReasons: [],
    lastCourtPaid: true,
    rngState: null,              // позиция собственного потока случая
  };
}

// Установка. ЗОВЁТСЯ ЛЕНИВО (первым applyDynastyLinks) и НАРОЧНО не тратит
// ни одного броска sim.rng: состав первой семьи решает собственный поток
// модуля. Иначе установка сдвигала бы общий поток случайностей мира, и
// партии после загрузки сейва расходились бы (реальный баг прошлого).
export function dynastyInstall(sim) {
  const st = createDynastyState();
  const rng = dynRng(st, sim ? sim.seed : 0);
  const pol = sim && sim.politics && sim.politics.state ? sim.politics.state : null;
  const polName = pol && pol.ruler && typeof pol.ruler.name === 'string' && pol.ruler.name
    ? pol.ruler.name : null;
  const gov = pol && typeof pol.gov === 'string' ? pol.gov : 'chiefdom';

  // Дом зовётся именем правителя, которого политика уже знает: панель
  // «Держава» и вкладка «Род» обязаны показать одного и того же человека.
  const founderName = polName || rng.pick(MALE_NAMES);
  st.house = { name: rng.pick(HOUSE_NAMES), founder: founderName, generations: 1, throneDays: 0 };

  const rAge = rng.int(2800, 5200);
  const ruler = makeMember(st, { name: founderName, age: rAge, sex: 'м', status: 'ruler', traits: [] });
  if (rng.chance(0.75)) {
    const wAge = Math.max(ADULT_DAYS, rAge - rng.int(0, 600));
    const wife = makeMember(st, {
      name: rng.pick(FEMALE_NAMES), age: Math.min(wAge, FERTILE_END - 200),
      sex: 'ж', status: 'spouse', traits: [], pairWith: ruler.id,
    });
    ruler.pairWith = wife.id;
    if (rng.chance(0.6)) {
      const boy = rng.chance(0.5);
      const kidAgeCap = Math.max(160, rAge - ADULT_DAYS);
      makeMember(st, {
        name: boy ? rng.pick(MALE_NAMES) : rng.pick(FEMALE_NAMES),
        age: rng.int(150, kidAgeCap),
        sex: boy ? 'м' : 'ж', status: 'member',
        traits: rng.chance(0.5) ? [rng.pick(TRAIT_POOL)] : [],
      });
    }
  }
  st.heir = idOrNull((heirOf(st, gov) || {}).id);
  keepRng(st);
  return st;
}

// ════════════════════════ законы преемственности ════════════════════════

// Кто сядет на трон по закону строя. Возвращает члена рода или null.
//   designated            — воля правителя сильнее любого обычая (но не мёртвым)
//   chiefdom              — взрослый с максимумом черт, при равенстве старший
//   monarchy/empire/federation — старший совершеннолетний сын; без сыновей —
//                           старший взрослый родич
//   republic              — трона нет, наследника нет
export function heirOf(st, gov) {
  const ms = st && Array.isArray(st.members) ? st.members : [];
  const free = (m) => m && m.alive !== false && m.status !== 'ruler';

  if (st && st.designated != null) {
    const d = ms.find((m) => free(m) && m.id === st.designated);
    if (d) return d;
  }
  if (gov === 'republic') return null;

  const byAge = (a, b) => numOf(b.age, 0) - numOf(a.age, 0) || (a.id - b.id);
  if (gov === 'chiefdom') {
    // Сила рода — в людях: у вождества наследует не старший, а способнейший.
    let best = null;
    for (const m of ms) {
      if (!free(m) || numOf(m.age, 0) < ADULT_DAYS) continue;
      if (!best) { best = m; continue; }
      const kt = traitCount(m), kb = traitCount(best);
      if (kt > kb || (kt === kb && numOf(m.age, 0) > numOf(best.age, 0))) best = m;
    }
    return best;
  }
  const sons = ms.filter((m) => free(m) && m.sex !== 'ж' && numOf(m.age, 0) >= ADULT_DAYS).sort(byAge);
  if (sons.length) return sons[0];
  const any = ms.filter((m) => free(m) && numOf(m.age, 0) >= ADULT_DAYS).sort(byAge);
  return any.length ? any[0] : null;
}

// Регент малолетнего правителя: старший совершеннолетний родич, не сам
// правитель. При равенстве возрастов старше тот, кто раньше записан в род.
// Нет взрослого — вернётся null: трон держит безликий регентский совет.
function pickRegent(N, ruler) {
  let best = null;
  for (const m of N.members) {
    if (m.alive === false || m.id === ruler.id) continue;
    if (numOf(m.age, 0) < ADULT_DAYS) continue;
    if (!best || numOf(m.age, 0) > numOf(best.age, 0)) best = m;
  }
  return best;
}

// Кривая смерти. До зрелых лет человек не умирает вовсе, потом понемногу,
// после глубокой старости — быстро. Предельный возраст никто не переступает:
// это гарантия, что междуцарствие от старости наступит всегда, а не «почти
// всегда» — партия обязана видеть конец каждой династии.
function deathChance(m) {
  const age = numOf(m.age, 0);
  let p;
  if (age < FERTILE_END) p = 0;
  else if (age < OLD_AGE) p = 0.0002;
  else p = 0.001 + Math.pow((age - OLD_AGE) / 2000, 2) * 0.01;
  if (p > 0 && Array.isArray(m.traits) && m.traits.includes('sickly')) p *= 1.5;
  if (age >= DEATH_HARD_AGE) p = 1;
  return Math.min(1, p);
}

// ════════════════════════ новый дом ════════════════════════

// Основывает новый дом: свежая фамилия, правитель с супругой и сыном.
// Законность ставится РОВНО на переданное значение: узурпатор, adopt и конец
// междуцарствия встают на свои числа без дневных слагаемых поверх.
function foundNewHouse(N, rng, legitValue) {
  const oldName = N.house ? N.house.name : '';
  N.house = { name: pickHouse(rng, oldName), founder: '', generations: 1, throneDays: 0 };
  N.members = [];
  N.nextId = 1;
  N.plotSeq = 1;
  N.pretenders = [];
  N.plots = [];
  N.marriages = [];
  N.designated = null;
  N.heir = null;
  N.interregnum = false;
  N.interregnumDays = 0;
  // Новый дом встаёт на чистый трон: никакого регентства от прежнего рода.
  // lastInterregnumDay СОЗНАТЕЛЬНО не трогаем — кулдаун смуты держит держава,
  // иначе цепочка «дом пал — совет — новый дом — дом пал» замкнулась бы вновь.
  N.regency = false;
  N.regentId = null;
  const fAge = rng.int(2600, 4400);
  const f = makeMember(N, { name: rng.pick(MALE_NAMES), age: fAge, sex: 'м', status: 'ruler', traits: [] });
  const w = makeMember(N, {
    name: rng.pick(FEMALE_NAMES),
    age: rng.int(2000, Math.max(2100, Math.min(fAge, FERTILE_END - 100))),
    sex: 'ж', status: 'spouse', traits: [], pairWith: f.id,
  });
  f.pairWith = w.id;
  makeMember(N, {
    name: rng.chance(0.5) ? rng.pick(MALE_NAMES) : rng.pick(FEMALE_NAMES),
    age: rng.int(120, 1000), sex: 'м', status: 'member', traits: [],
  });
  N.house.founder = f.name;
  if (legitValue != null) N.legitimacy = legitValue;
  return f;
}

// ════════════════════════ претенденты и заговоры ════════════════════════

function makePretender(N, rng, sim) {
  const fids = sim && Array.isArray(sim.factions)
    ? sim.factions.filter((f) => f && f.id && f.alive !== false).map((f) => f.id) : [];
  const female = rng.chance(0.3);
  return {
    id: N.nextId++,
    name: rng.pick(female ? FEMALE_NAMES : MALE_NAMES),
    house: rng.pick(HOUSE_NAMES),
    fid: (fids.length && rng.chance(0.6)) ? rng.pick(fids) : null,
    support: rng.int(8, 30),
  };
}

function fillPretenders(N, rng, want, sim) {
  if (!Array.isArray(N.pretenders)) N.pretenders = [];
  while (N.pretenders.length < want) N.pretenders.push(makePretender(N, rng, sim));
}

function spawnPlot(N, rng) {
  const kinds = ['scandal'];
  if (N.pretenders.length) kinds.push('claim');
  const ruler = N.members.find((m) => m.alive !== false && m.status === 'ruler');
  const target = (N.heir != null && N.members.find((m) => m.id === N.heir && m.alive !== false)) || ruler;
  if (target) kinds.push('poison');
  const kind = rng.pick(kinds);
  const by = (N.pretenders.length && rng.chance(0.5))
    ? rng.pick(N.pretenders).name
    : rng.pick(rng.chance(0.5) ? MALE_NAMES : FEMALE_NAMES);
  N.plots.push({
    id: N.plotSeq++, kind, days: 0, need: rng.int(6, 14), by,
    targetId: kind === 'poison' && target ? target.id : null,
  });
}

// Созревание заговоров. Яд может убить цель — поэтому шаг зовётся ДО проверки
// преемственности: смерть от яда разбирается тем же днём, а не завтра.
function progressPlots(N, rng, events, day) {
  if (!Array.isArray(N.plots)) N.plots = [];
  const stay = [];
  for (const pl of N.plots) {
    if (!pl || !PLOT_KINDS.includes(pl.kind)) continue;
    pl.days = Math.max(0, numOf(pl.days, 0)) + 1;
    if (pl.days < Math.max(1, numOf(pl.need, 10))) { stay.push(pl); continue; }
    if (pl.kind === 'scandal') {
      N.legitimacy = clamp(numOf(N.legitimacy, LEGIT_START) + SCANDAL_LEGIT_HIT, 0, 100);
      events.push({ text: `🗣 Заговор ${pl.by}: скандал при дворе дошёл до народа.`, type: 'bad' });
    } else if (pl.kind === 'claim') {
      const p = N.pretenders.slice().sort((a, b) => numOf(b.support, 0) - numOf(a.support, 0))[0];
      if (p) p.support = clamp(numOf(p.support, 0) + CLAIM_SUPPORT_GAIN, 0, SUPPORT_MAX);
      events.push({ text: `📜 ${pl.by}: чужие грамоты о праве на трон ходят по рукам.`, type: 'warn' });
    } else {
      const t = N.members.find((m) => m.id === pl.targetId && m.alive !== false);
      if (t) {
        t.alive = false;
        t.deathDay = day;
        t.cause = 'яд';
        events.push({
          text: `☠ Яд в кубке: ${t.name} умер не своей смертью.`,
          type: 'bad',
          chronicle: t.status === 'ruler',
        });
      } else {
        events.push({ text: `☠ Покушение ${pl.by} сорвалось: яд не дошёл до цели.`, type: 'info' });
      }
    }
    // Созревший заговор исчезает из списка — сработал он или провалился.
  }
  N.plots = stay;
}

// Нулевой отчёт повторного вызова: сутки уже посчитаны. Состояние возвращается
// КАК ЕСТЬ — тот же объект, без клонирования, бросков и событий.
function silenceRep(st) {
  return { mods: { happy: 0, stab: 0 }, reasons: [], events: [], flags: { state: st, courtGold: 0 } };
}

// ════════════════════════ дневной ход ════════════════════════

export function dynastyNewDay(sim) {
  const day = numOf(sim && sim.day, 0);
  const st = sim && sim.linkDynasty && typeof sim.linkDynasty === 'object'
    ? sim.linkDynasty : createDynastyState();
  if (st.day === day) return silenceRep(st);

  const pol = sim && sim.politics && sim.politics.state ? sim.politics.state : null;
  const gov = pol && typeof pol.gov === 'string' ? pol.gov : 'chiefdom';
  const happyNow = numOf(sim && sim._happy, 50);

  // --- Республика: трона нет, роду нечего сказать --------------------------
  // Нулевые отчёты, законность заморожена. Семья при этом живёт: люди стареют
  // и вне политики.
  if (gov === 'republic') {
    const N = cloneState(st);
    N.day = day;
    for (const m of N.members) if (m.alive !== false) m.age = numOf(m.age, 0) + 1;
    return silenceRep(N);
  }

  const N = cloneState(st);
  const rng = dynRng(N, sim ? sim.seed : 0);
  const reasons = [];
  const events = [];
  let stabToday = null;      // разовый удар дня (пресечение рода, мятеж)
  let happyMod = 0;
  let interregStartedHere = false;   // междуцарствие открылось ЭТИМ днём
  N.day = day;

  // --- 1. Год за годом ------------------------------------------------------
  if (N.house) N.house.throneDays = numOf(N.house.throneDays, 0) + 1;
  for (const m of N.members) {
    if (m.alive === false) continue;
    m.age = numOf(m.age, 0) + 1;
    if (rng.next() < deathChance(m)) {
      m.alive = false;
      m.deathDay = day;
      m.cause = Array.isArray(m.traits) && m.traits.includes('sickly') ? 'хворь' : 'старость';
      if (m.status === 'ruler') {
        events.push({ text: `✝ ${m.name} умер на ${yearsOf(m.age)}-м году жизни.`, type: 'warn', chronicle: true });
      } else if (m.status === 'spouse') {
        events.push({ text: `✝ ${m.name}, супруга дома ${N.house.name}, отошла ко сну.`, type: 'info' });
      }
    }
  }

  // --- 2. Заговоры зреют (яд может убить — потому раньше преемственности) ---
  progressPlots(N, rng, events, day);

  // --- 3. Престол: наследник по закону или междуцарствие ---------------------
  let ruler = N.members.find((m) => m.alive !== false && m.status === 'ruler');
  let throneEvent = false;   // реальная смена на троне этим днём (для летописи)
  // Регентский совет досиживает свой срок ДО КОНЦА: на последний день его
  // разбирает шаг 9.5 (возвышение нового дома). Без этой оговорки шаг 3 успел
  // бы объявить второе междуцарствие прямо в день исхода кулдауна.
  const councilTermOver = N.regency === true && N.regentId == null
    && numOf(N.lastInterregnumDay, -1) >= 0
    && day - numOf(N.lastInterregnumDay, -1) >= INTERREG_COOLDOWN;
  if (!ruler && !N.interregnum && !councilTermOver) {
    // Наследник пересчитывается КАЖДЫЙ день заново: строй могли поменять,
    // назначение могло устареть — вчерашний список сегодня не закон.
    const heirM = heirOf(N, gov);
    if (heirM) {
      heirM.status = 'ruler';
      N.house.generations = numOf(N.house.generations, 1) + 1;
      N.designated = null;   // воля умершего исполнена
      // Если пустой трон формально держал регентский совет пресёкшегося
      // дома — воцарение снимает регентство тем же днём.
      N.regency = false;
      N.regentId = null;
      throneEvent = true;
      events.push({
        text: `⚔ Трон занял ${heirM.name} — дом ${N.house.name} продолжается.`,
        type: 'warn', chronicle: true,
      });
    } else {
      // Кулдаун смуты (INTERREG_COOLDOWN): междуцарствие объявляется не чаще
      // раза в срок. Свежая усобица держится регентским советом — трон пуст
      // лишь формально, а по исходе срока знать возводит новый дом без
      // повторного удара по порядку.
      const sinceLast = numOf(N.lastInterregnumDay, -1) >= 0 ? day - numOf(N.lastInterregnumDay, -1) : -1;
      if (sinceLast >= 0 && sinceLast < INTERREG_COOLDOWN) {
        const declared = N.regency === true;
        N.regency = true;
        N.regentId = null;   // правит совет, а не человек
        N.designated = null;
        N.heir = null;
        if (!declared) {
          events.push({
            text: `⚜ Род ${N.house.name} пресёкся, но прошлая смута ещё свежа: власть берёт регентский совет.`,
            type: 'warn', chronicle: true,
          });
        }
      } else {
        N.interregnum = true;
        N.interregnumDays = 1;
        N.lastInterregnumDay = day;
        N.designated = null;
        N.heir = null;
        N.regency = false;
        N.regentId = null;
        interregStartedHere = true;
        stabToday = INTERREGNUM_STAB;
        fillPretenders(N, rng, 3, sim);
        events.push({
          text: `⚔ Род ${N.house.name} пресёкся: правителя не стало, наследника нет. Междуцарствие!`,
          type: 'bad', chronicle: true,
        });
      }
    }
  }

  // --- 3.5 Малолетний на троне: дом держит регента до совершеннолетия --------
  // Ребёнок остаётся ПРАВИТЕЛЕМ рода и растёт честно — никто не переписывает
  // его годы. Но государством до ADULT_DAYS правит взрослый родич-регент:
  // политике предъявляется он, а не возраст ребёнка, иначе кламп в
  // deserializePolitics переписывал бы юные годы при каждом загрузке сейва.
  ruler = N.members.find((m) => m.alive !== false && m.status === 'ruler');
  if (ruler && numOf(ruler.age, 0) < ADULT_DAYS) {
    let rg = N.members.find((m) => m.alive !== false && m.id === N.regentId);
    if (!N.regency || !rg || rg.id === ruler.id) {
      const wasDeclared = N.regency === true;
      N.regency = true;
      N.regentId = idOrNull((pickRegent(N, ruler) || {}).id);
      rg = N.members.find((m) => m.alive !== false && m.id === N.regentId) || null;
      if (!wasDeclared) {
        events.push({
          text: rg
            ? `⚜ ${ruler.name} ещё дитя (${yearsOf(ruler.age)} лет): до совершеннолетия правит регент ${rg.name}.`
            : `⚜ ${ruler.name} ещё дитя (${yearsOf(ruler.age)} лет): при нём правит регентский совет дома.`,
          type: 'warn', chronicle: true,
        });
      }
    }
  } else if (N.regency && ruler) {
    // Совершеннолетие: правитель вступил в права сам — реальное событие трона.
    N.regency = false;
    N.regentId = null;
    throneEvent = true;
    events.push({
      text: `⚜ ${ruler.name} вступил в права: регентство кончилось.`,
      type: 'good', chronicle: true,
    });
  }

  // --- 4. Междуцарствие тянется ----------------------------------------------
  // Счётчик идёт со дня, следующего за днём пресечения: тот день уже отметил
  // единицу в шаге 3, и двойного счёта быть не должно.
  if (N.interregnum && !interregStartedHere) {
    N.interregnumDays = Math.max(0, numOf(N.interregnumDays, 0)) + 1;
  }
  if (N.interregnum) {
    for (const p of N.pretenders) {
      p.support = clamp(numOf(p.support, 0) + rng.int(-1, 2), 0, SUPPORT_MAX);
    }
    reasons.push(`Междуцарствие: ${N.interregnumDays}-й день без законной власти`);
  }
  // Регентский совет при пресёкшемся доме: игрок видит срок, а не молчание.
  if (N.regency && !ruler && numOf(N.lastInterregnumDay, -1) >= 0) {
    const left = Math.max(0, INTERREG_COOLDOWN - (day - numOf(N.lastInterregnumDay, -1)));
    reasons.push(`Регентский совет правит за пресёкшийся дом: знать соберётся через ~${left} дн.`);
  }

  // --- 5. Слабый род приманивает самозванцев ----------------------------------
  ruler = N.members.find((m) => m.alive !== false && m.status === 'ruler');
  if (!N.interregnum && ruler && N.legitimacy <= PRETENDER_LEGIT
    && N.pretenders.length < PRETENDER_CAP && rng.chance(PRETENDER_CHANCE)) {
    if (!Array.isArray(N.pretenders)) N.pretenders = [];
    const p = makePretender(N, rng, sim);
    N.pretenders.push(p);
    events.push({
      text: `🗡 Явился претендент ${p.name} из дома ${p.house}: говорит, что кровь права его.`,
      type: 'warn',
    });
  }

  // --- 6. Мятеж подопревшего претендента ---------------------------------------
  if (!N.interregnum && ruler) {
    for (let i = 0; i < N.pretenders.length; i++) {
      const p = N.pretenders[i];
      if (numOf(p.support, 0) >= REVOLT_SUPPORT && rng.chance(REVOLT_CHANCE)) {
        N.pretenders.splice(i, 1);
        stabToday = (stabToday == null ? 0 : stabToday) + REVOLT_STAB_SHOCK;
        N.legitimacy = clamp(numOf(N.legitimacy, LEGIT_START) - REVOLT_LEGIT_COST, 0, 100);
        events.push({
          text: `🗡 МЯТЕЖ: ${p.name} поднял оружие, заявляя право на трон!`,
          type: 'bad', chronicle: true,
        });
        break; // один мятеж за сутки — два разом не бывает
      }
    }
  }

  // --- 7. Новые заговори в неблагополучном доме --------------------------------
  if (!N.interregnum && ruler && N.plots.length < PLOT_CAP
    && (N.legitimacy < PLOT_LEGIT_MAX || happyNow < PLOT_HAPPY_MAX)
    && rng.chance(PLOT_CHANCE)) {
    spawnPlot(N, rng);
  }

  // --- 8. Рождения ---------------------------------------------------------------
  let aliveCount = N.members.reduce((a, m) => a + (m.alive !== false ? 1 : 0), 0);
  if (aliveCount < MEMBER_CAP) {
    for (const mo of N.members) {
      if (aliveCount >= MEMBER_CAP) break;   // потолок живых членов рода
      if (mo.alive === false || mo.sex !== 'ж' || mo.pairWith == null) continue;
      if (mo.kids >= KIDS_PER_PAIR) continue; // потолок детей у пары
      const age = numOf(mo.age, 0);
      if (age < ADULT_DAYS || age >= FERTILE_END) continue;
      const fa = N.members.find((x) => x.id === mo.pairWith && x.alive !== false);
      if (!fa || fa.kids >= KIDS_PER_PAIR || numOf(fa.age, 0) < ADULT_DAYS) continue;
      if (!rng.chance(BIRTH_CHANCE)) continue;
      const boy = rng.chance(0.5);
      const baby = makeMember(N, {
        name: boy ? rng.pick(MALE_NAMES) : rng.pick(FEMALE_NAMES),
        age: 0, sex: boy ? 'м' : 'ж', status: 'member', traits: [],
      });
      mo.kids++;
      fa.kids++;
      aliveCount++;
      events.push({ text: `👶 В доме ${N.house.name} родился ребёнок — ${baby.name}.`, type: 'good' });
    }
  }

  // --- 9. Законность: дневное слагаемое ----------------------------------------
  const courtLv = clamp(intOf(N.court, 0), 0, COURT_MAX);
  const upkeep = COURT_UPKEEP[courtLv] || 0;
  const paid = numOf(sim && sim.res && sim.res.gold, 0) >= upkeep;
  N.lastCourtPaid = paid;
  const L0 = clamp(numOf(N.legitimacy, LEGIT_START), 0, 100);
  let d = -LEGIT_DECAY;
  // Двор кормит законность, пока платится содержание и пока дом ещё не так
  // утвердился, что покупать любовь поздно (гейт LEGIT_COURT_CAP).
  if (paid && L0 < LEGIT_COURT_CAP) d += courtLv * LEGIT_COURT_RATE;
  // Довольный народ укрепляет трон — тоже до своего потолка. За гейтом
  // слагаемое исчезает ЦЕЛИКОМ: и минус несчастья там уже не действует.
  if (L0 < LEGIT_THRONE_CAP) d += (happyNow - 50) * LEGIT_THRONE_RATE;
  const hungerDays = Math.max(0, numOf(sim && sim.linkSurvival && sim.linkSurvival.hungerDays, 0));
  if (hungerDays > 0) {
    const pen = hungerDays * LEGIT_HUNGER_RATE;
    d -= pen;
    reasons.push(`Голод в державе: ${hungerDays}-е сутки впроголодь (−${pen.toFixed(2)} законности)`);
  }
  const shockDays = Math.max(0, numOf(sim && sim.linkTerritory && sim.linkTerritory.shock, 0));
  if (shockDays > 0) {
    const pen = shockDays * LEGIT_SHOCK_RATE;
    d -= pen;
    reasons.push(`Траур по потерянным землям: род проглядел город (−${pen.toFixed(2)})`);
  }
  if (!paid && courtLv > 0) reasons.push('Казна пуста: двор содержать нечем, слуги разбегаются');
  N.lastDelta = d;
  N.legitimacy = clamp(L0 + d, 0, 100);

  // --- 9.5 Конец междуцарствия: знать возводит новый дом -----------------------
  // После слагаемого законности — новый дом встаёт на РОВНО свою цифру.
  if (N.interregnum && N.interregnumDays > INTERREG_AUTO_DAYS) {
    const f = foundNewHouse(N, rng, INTERREG_AUTO_LEGIT);
    throneEvent = true;
    events.push({
      text: `👑 Смуте конец: знать возвела на трон дом ${N.house.name} — правитель ${f.name}.`,
      type: 'good', chronicle: true,
    });
  }
  // Регентский совет досидел до срока кулдауна смуты — знать возводит новый
  // дом БЕЗ повторного объявленного междуцарствия и его удара по порядку:
  // смута уже была объявлена один раз, летопись не лжёт о второй.
  if (!N.interregnum && N.regency && !ruler
    && numOf(N.lastInterregnumDay, -1) >= 0
    && day - numOf(N.lastInterregnumDay, -1) >= INTERREG_COOLDOWN) {
    const f = foundNewHouse(N, rng, INTERREG_AUTO_LEGIT);
    throneEvent = true;
    events.push({
      text: `⚜ Срок смуты вышел: регентский совет возвёл на трон дом ${N.house.name} — правитель ${f.name}.`,
      type: 'good', chronicle: true,
    });
  }

  // --- 10. Наследник пересчитан заново этим же днём -----------------------------
  if (!N.interregnum) N.heir = idOrNull((heirOf(N, gov) || {}).id);
  else N.heir = null;

  // --- 11. Род и политика зовут правителя одним именем --------------------------
  const flags = { state: N, courtGold: paid ? upkeep : 0 };
  const lr = N.members.find((m) => m.alive !== false && m.status === 'ruler');
  const polName = pol && pol.ruler ? pol.ruler.name : null;
  if (lr && N.regency) {
    // Малолетний правитель: политике показывается РЕГЕНТ — взрослый человек.
    // Возраст ребёнка в политику не идёт: там его годы переписал бы кламп,
    // и круг сейва перестал бы быть бит-в-бит.
    const rg = N.members.find((m) => m.alive !== false && m.id === N.regentId);
    if (rg && rg.name !== polName) {
      flags.regent = {
        name: rg.name,
        ageYears: yearsOf(rg.age),
        traits: Array.isArray(rg.traits) ? rg.traits.slice() : [],
      };
    }
  } else if (lr && lr.name !== polName) {
    flags.newRuler = {
      name: lr.name,
      ageYears: yearsOf(lr.age),
      traits: Array.isArray(lr.traits) ? lr.traits.slice() : [],
      // chronicle=true только на реальное событие трона этого дня
      // (коронация наследника, новый дом, вступление в права). Раньше строка
      // «Власть у рода…» писалась при каждом расхождении имён — в том числе
      // после случайного преемника в самой политике: сид 11 за 12000 дней
      // давал 24 записи при 4 реальных сменах.
      chronicle: throneEvent === true,
    };
  }

  // --- 12. Чем род давит на державу ---------------------------------------------
  let stab;
  if (stabToday != null) {
    stab = stabToday;                 // день удара звучит именно как удар
  } else {
    stab = 0;
    if (N.interregnum) stab += INTERREG_CHRONIC_STAB;
    // Регентский совет за пресёкшийся дом: трон пуст лишь формально, пресс
    // вдвое слабее междуцарствия (REGENCY_STAB против INTERREG_CHRONIC_STAB).
    else if (N.regency && !lr) stab += REGENCY_STAB;
    if (N.legitimacy < LOW_LEGIT_STAB_AT) stab += LOW_LEGIT_STAB;
  }
  if (!N.interregnum && N.pretenders.length) happyMod -= 2;
  if (!N.interregnum && N.legitimacy < PRETENDER_LEGIT) happyMod -= 3;

  N.lastReasons = reasons.slice();
  keepRng(N);

  return { mods: { happy: Math.round(happyMod), stab }, reasons, events, flags };
}

// Плоская добавка к счастью державы. Читает ГОТОВЫЙ отчёт дня из sys.dynLinks:
// happiness() зовётся десятки раз за кадр — считать заново нельзя.
export function dynastyHappyMod(sim) {
  const rep = sim && sim.sys ? sim.sys.dynLinks : null;
  const h = rep && rep.mods ? rep.mods.happy : null;
  return Number.isFinite(h) ? h : 0;
}

// ════════════════════════ решения игрока ════════════════════════
// В отличие от дневного хода, решения меняют мир сразу: их делает игрок своим
// нажатием, а не течение суток. Стоимость и эффект применяются здесь же, на
// ТЕКУЩЕМ состоянии (без клонирования) — панель после действия обновляется.

const ok = (text) => ({ ok: true, text });
const no = (reason) => ({ ok: false, reason });

export function handleDynastyAction(sim, spec) {
  const parts = String(spec || '').split(':');
  const kind = parts[0];
  const st = sim && sim.linkDynasty && typeof sim.linkDynasty === 'object' ? sim.linkDynasty : null;
  const pst = sim && sim.politics && sim.politics.state ? sim.politics.state : null;

  // --- Содержание двора -------------------------------------------------------
  if (kind === 'court') {
    if (!st) return no('Род ещё не основан');
    const lvl = intOf(parts[1], -1);
    if (!(lvl >= 0 && lvl <= COURT_MAX)) return no('Такого уровня содержания нет');
    st.court = lvl;
    return ok(lvl > 0
      ? `Двор содержится щедрее: уровень ${lvl} (${COURT_UPKEEP[lvl]}🪙 в день)`
      : 'Двор урезан до необходимого');
  }

  // --- Назначить наследника ------------------------------------------------------
  if (kind === 'heir') {
    if (!st) return no('Род ещё не основан');
    const id = intOf(parts[1], NaN);
    const m = st.members.find((x) => x.id === id);
    if (!m || m.alive === false) return no('Такого человека в роду нет');
    if (m.status === 'ruler') return no('Правитель сам себе наследником не бывает');
    if (st.heir === id) return no(`${m.name} и так наследник — воля не меняется`);
    st.legitimacy = Math.max(0, numOf(st.legitimacy, LEGIT_START) - DESIGNATE_COST);
    if (pst && pst.factions && Number.isFinite(pst.factions.nobles)) {
      pst.factions.nobles = clamp(pst.factions.nobles - DESIGNATE_NOBLE_HIT, 0, 100);
    }
    st.designated = id;
    st.heir = id;   // воля правителя действует немедленно, без ожидания утра
    return ok(`Воля правителя объявлена: наследник — ${m.name} (−${DESIGNATE_COST} законности, знать ропщет)`);
  }

  // --- Сослать брак ------------------------------------------------------------------
  if (kind === 'marry') {
    if (!st) return no('Род ещё не основан');
    const fid = String(parts[1] || '').trim();
    if (!fid) return no('Не назван дом, с которым свататься');
    const heirM = st.members.find((m) => m.id === st.heir && m.alive !== false);
    if (!heirM) return no('Наследника нет — сватать некому');
    if (heirM.pairWith != null) return no(`${heirM.name} уже обручён`);
    if (numOf(heirM.age, 0) < ADULT_DAYS) return no('Наследник ещё дитя — брак погодим');
    if (numOf(sim && sim.res && sim.res.gold, 0) < MARRIAGE_GOLD) {
      return no(`Сватовство стоит ${MARRIAGE_GOLD}🪙 — казна не даст`);
    }
    sim.res.gold -= MARRIAGE_GOLD;
    // Невеста входит в род: имя выбирает собственный поток случая модуля.
    const rng = dynRng(st, sim.seed);
    if (typeof sim.adjustRel === 'function') sim.adjustRel(fid, MARRIAGE_REL, 'Брачный союз');
    else if (sim.relations) sim.relations[fid] = numOf(sim.relations[fid], 0) + MARRIAGE_REL;
    const bride = makeMember(st, {
      name: rng.pick(FEMALE_NAMES),
      age: rng.int(ADULT_DAYS + 200, FERTILE_END - 400),
      sex: 'ж', status: 'spouse', traits: [],
    });
    bride.pairWith = heirM.id;
    heirM.pairWith = bride.id;
    if (!Array.isArray(st.marriages)) st.marriages = [];
    st.marriages.push({ fid, memberId: heirM.id, day: numOf(sim && sim.day, 0) });
    st.legitimacy = clamp(numOf(st.legitimacy, LEGIT_START) + MARRIAGE_LEGIT, 0, 100);
    keepRng(st);
    return ok(`${heirM.name} берёт в жёны девицу из дома ${fid}: +${MARRIAGE_REL} отношений, +${MARRIAGE_LEGIT} законности`);
  }

  // --- Переворот -----------------------------------------------------------------------
  if (kind === 'usurp') {
    if (!st) return no('Род ещё не основан');
    if (!pst) return no('Политика не подключена: перевороту не на что опереться');
    if (st.interregnum === true) return no('Трон и так пуст — воцаряйте новый дом, а не свергайте старый');
    // Слабые сословия не поднимутся: отказ ДО всяких изменений состояния.
    const F = pst.factions || {};
    const vals = Object.keys(F).map((k) => numOf(F[k], 0));
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    const nobles = numOf(F.nobles, 0);
    if (avg < USURP_MIN_AVG || nobles < USURP_MIN_NOBLES) {
      return no(`Сословия не поднимутся с вами: средняя поддержка ${Math.round(avg)}, знать ${Math.round(nobles)}. Сперва заслужите доверие`);
    }
    // Двухшаговое подтверждение: первое нажатие только предупреждает.
    const today = numOf(sim && sim.day, 0);
    const awaiting = Number.isFinite(st.usurpConfirmDay)
      && Math.abs(today - st.usurpConfirmDay) <= CONFIRM_DAYS;
    if (!awaiting) {
      st.usurpConfirmDay = today;
      return {
        ok: true, confirm: true,
        text: 'Переворот необратим: дом будет сменён, порядок пошатнётся. Нажмите ещё раз.',
      };
    }
    st.usurpConfirmDay = null;
    const rng = dynRng(st, sim.seed);
    const oldName = st.house ? st.house.name : '';
    const f = foundNewHouse(st, rng, USURP_LEGIT);
    pst.stability = clamp(numOf(pst.stability, 60) - USURP_STAB_COST, 0, 100);
    // Политике немедленно предъявляют нового правителя, иначе панель «Держава»
    // и вкладка «Род» показали бы двух разных людей до следующего утра.
    pst.ruler = {
      name: f.name, age: yearsOf(f.age), since: today,
      traits: Array.isArray(f.traits) ? f.traits.slice() : [],
    };
    pst.rulersCount = Math.max(1, numOf(pst.rulersCount, 1) || 1) + 1;
    if (typeof sim.addChronicle === 'function') {
      sim.addChronicle(`Переворот: дом ${st.house.name} сменил ${oldName || 'старый род'} на троне (день ${today}).`);
    }
    keepRng(st);
    return ok(`Переворот свершился: правит ${f.name} из дома ${st.house.name}. Стабильность −${USURP_STAB_COST}`);
  }

  // --- Раскрыть / простить / казнить ------------------------------------------------------
  if (kind === 'expose' || kind === 'pardon' || kind === 'execute') {
    if (!st) return no('Род ещё не основан');
    const id = intOf(parts[1], NaN);
    const idx = (st.plots || []).findIndex((p) => p && p.id === id);
    if (idx < 0) return no('Такого заговора нет — либо он уже разобран');
    const plot = st.plots[idx];
    if (kind === 'expose') {
      if (numOf(sim && sim.res && sim.res.gold, 0) < EXPOSE_GOLD) {
        return no(`Шептунам платят: раскрытие стоит ${EXPOSE_GOLD}🪙`);
      }
      sim.res.gold -= EXPOSE_GOLD;
      st.legitimacy = clamp(numOf(st.legitimacy, LEGIT_START) + EXPOSE_LEGIT_GAIN, 0, 100);
      st.plots.splice(idx, 1);
      return ok(`Заговор ${plot.by} раскрыт вовремя: +${EXPOSE_LEGIT_GAIN} законности`);
    }
    if (kind === 'pardon') {
      st.legitimacy = Math.max(0, numOf(st.legitimacy, LEGIT_START) - PARDON_LEGIT_COST);
      st.plots.splice(idx, 1);
      return ok(`${plot.by} помилован: милосердие обошлось в ${PARDON_LEGIT_COST} законности`);
    }
    st.legitimacy = clamp(numOf(st.legitimacy, LEGIT_START) + EXECUTE_LEGIT_GAIN, 0, 100);
    if (pst && pst.factions) {
      if (Number.isFinite(pst.factions.nobles)) {
        pst.factions.nobles = clamp(pst.factions.nobles + EXECUTE_NOBLE_GAIN, 0, 100);
      }
      if (Number.isFinite(pst.factions.commons)) {
        pst.factions.commons = clamp(pst.factions.commons - EXECUTE_COMMON_HIT, 0, 100);
      }
    }
    st.plots.splice(idx, 1);
    return ok(`${plot.by} казнён: страх держит двор крепче (+${EXECUTE_LEGIT_GAIN} законности, народ скорбит)`);
  }

  // --- Воцарение в междуцарствие ------------------------------------------------------------
  if (kind === 'adopt') {
    if (!st) return no('Род ещё не основан');
    if (st.interregnum !== true) return no('Престол занят: воцарять можно только в междуцарствие');
    if (numOf(sim && sim.res && sim.res.gold, 0) < ADOPT_GOLD) {
      return no(`Знать соблюдает приличия: воцарение стоит ${ADOPT_GOLD}🪙`);
    }
    sim.res.gold -= ADOPT_GOLD;
    const rng = dynRng(st, sim.seed);
    const f = foundNewHouse(st, rng, ADOPT_LEGIT);
    if (pst) {
      pst.ruler = {
        name: f.name, age: yearsOf(f.age), since: numOf(sim && sim.day, 0),
        traits: Array.isArray(f.traits) ? f.traits.slice() : [],
      };
      pst.rulersCount = Math.max(1, numOf(pst.rulersCount, 1) || 1) + 1;
    }
    if (typeof sim.addChronicle === 'function') {
      sim.addChronicle(`Междуцарствие кончено: воцарён дом ${st.house.name}, правитель ${f.name}.`);
    }
    keepRng(st);
    return ok(`Новый дом воцарён: ${st.house.name}, правитель ${f.name}`);
  }

  return no('Неизвестное действие двора');
}

// ════════════════════════ сохранение ════════════════════════
// Белый список полей: в сейв идёт только то, что модуль понимает. Круг
// serialize → restore → serialize обязан быть бит-в-бит, поэтому каждая
// функция ниже и пишет, и читает значения одними и теми же правилами.

function houseOut(h) {
  const src = h && typeof h === 'object' ? h : {};
  return {
    name: typeof src.name === 'string' ? src.name : '',
    founder: typeof src.founder === 'string' ? src.founder : '',
    generations: Math.max(1, intOf(src.generations, 1)),
    throneDays: Math.max(0, intOf(src.throneDays, 0)),
  };
}

function memberOut(m) {
  return {
    id: Math.max(1, intOf(m && m.id, 1)),
    name: m && typeof m.name === 'string' ? m.name : 'Безымянный',
    age: Math.max(0, intOf(m && m.age, 0)),
    sex: m && m.sex === 'ж' ? 'ж' : 'м',
    status: STATUS_OK.includes(m && m.status) ? m.status : 'member',
    traits: m && Array.isArray(m.traits) ? m.traits.map(String) : [],
    alive: !(m && m.alive === false),
    deathDay: intOf(m && m.deathDay, -1),
    cause: m && typeof m.cause === 'string' ? m.cause : '',
    pairWith: idOrNull(m && m.pairWith),
    kids: Math.max(0, intOf(m && m.kids, 0)),
  };
}

function pretenderOut(p) {
  return {
    id: Math.max(1, intOf(p && p.id, 1)),
    name: p && typeof p.name === 'string' ? p.name : 'Самозванец',
    house: p && typeof p.house === 'string' ? p.house : 'Чужие',
    fid: p && typeof p.fid === 'string' ? p.fid : null,
    support: clamp(intOf(p && p.support, 0), 0, SUPPORT_MAX),
  };
}

function plotOut(p) {
  const kind = p && PLOT_KINDS.includes(p.kind) ? p.kind : 'scandal';
  return {
    id: Math.max(1, intOf(p && p.id, 1)),
    kind,
    days: Math.max(0, intOf(p && p.days, 0)),
    need: clamp(intOf(p && p.need, 10), 1, 9999),
    by: p && typeof p.by === 'string' ? p.by : 'Кто-то',
    targetId: idOrNull(p && p.targetId),
  };
}

function marriageOut(mr) {
  return {
    fid: mr && typeof mr.fid === 'string' ? mr.fid : '',
    memberId: Math.max(1, intOf(mr && mr.memberId, 1)),
    day: Math.max(0, intOf(mr && mr.day, 0)),
  };
}

export function serializeDynasty(sim) {
  const st = sim && sim.linkDynasty && typeof sim.linkDynasty === 'object' ? sim.linkDynasty : null;
  if (!st) return null;
  return {
    v: 1,
    day: intOf(st.day, -1),
    house: houseOut(st.house),
    members: (Array.isArray(st.members) ? st.members : []).map(memberOut),
    legitimacy: numOf(st.legitimacy, LEGIT_START),
    court: clamp(intOf(st.court, 0), 0, COURT_MAX),
    designated: idOrNull(st.designated),
    heir: idOrNull(st.heir),
    pretenders: (Array.isArray(st.pretenders) ? st.pretenders : []).map(pretenderOut),
    plots: (Array.isArray(st.plots) ? st.plots : []).map(plotOut),
    marriages: (Array.isArray(st.marriages) ? st.marriages : []).map(marriageOut),
    interregnum: st.interregnum === true,
    interregnumDays: Math.max(0, intOf(st.interregnumDays, 0)),
    // Регентство и память о смуте обязаны переживать сейв: иначе после
    // загрузки малолетний объявлял бы регентство заново, а кулдаун смуты
    // забывался. Пишутся и читаются одними правилами — круг бит-в-бит.
    regency: st.regency === true,
    regentId: idOrNull(st.regentId),
    lastInterregnumDay: Math.max(-1, intOf(st.lastInterregnumDay, -1)),
    nextId: Math.max(1, intOf(st.nextId, 1)),
    plotSeq: Math.max(1, intOf(st.plotSeq, 1)),
    lastDelta: numOf(st.lastDelta, 0),
    lastReasons: (Array.isArray(st.lastReasons) ? st.lastReasons : []).map(String),
    lastCourtPaid: st.lastCourtPaid !== false,
    rngState: Number.isFinite(st.rngState)
      ? (st.rngState >>> 0)
      : (((numOf(sim && sim.seed, 0) >>> 0) ^ DYN_SEED) >>> 0),
  };
}

// Восстановление. Мусор не проходит насквозь: числа зажимаются, списки
// фильтруются, неизвестные виды заговоров выбрасываются. holder — любой
// объект с полем linkDynasty (sim или подделка теста); restore(null) даёт
// валидное пустое состояние. Ни одного броска sim.rng: поток случая
// продолжается с сохранённой позиции собственного rng.
export function restoreDynasty(holder, data) {
  const st = createDynastyState();
  const d = data && typeof data === 'object' && !Array.isArray(data) ? data : {};

  st.day = intOf(d.day, -1);
  if (st.house) {
    const h = houseOut(d.house);
    st.house = h;
  }
  st.members = (Array.isArray(d.members) ? d.members : [])
    .filter((m) => m && typeof m === 'object')
    .map(memberOut);
  // Мусорная законность («сто», NaN) возвращается к стартовой.
  st.legitimacy = Number.isFinite(Number(d.legitimacy))
    ? clamp(Number(d.legitimacy), 0, 100)
    : LEGIT_START;
  st.court = clamp(intOf(d.court, 0), 0, COURT_MAX);
  st.designated = idOrNull(d.designated);
  st.heir = idOrNull(d.heir);
  st.pretenders = (Array.isArray(d.pretenders) ? d.pretenders : [])
    .filter((p) => p && typeof p === 'object' && !Array.isArray(p))
    .map(pretenderOut);
  // Заговоры неизвестного вида не выживают загрузку: панель обязана уметь
  // показать каждый оставшийся и дать по нему решение.
  st.plots = (Array.isArray(d.plots) ? d.plots : [])
    .filter((p) => p && typeof p === 'object' && PLOT_KINDS.includes(p.kind))
    .map(plotOut);
  st.marriages = (Array.isArray(d.marriages) ? d.marriages : [])
    .filter((m) => m && typeof m === 'object')
    .map(marriageOut);
  st.interregnum = d.interregnum === true;   // строки вроде «да» — ложь
  st.interregnumDays = Math.max(0, intOf(d.interregnumDays, 0));
  st.regency = d.regency === true;
  st.regentId = idOrNull(d.regentId);
  st.lastInterregnumDay = Math.max(-1, intOf(d.lastInterregnumDay, -1));
  const maxMemberId = st.members.reduce((a, m) => Math.max(a, m.id), 0);
  st.nextId = Math.max(1, intOf(d.nextId, 1), maxMemberId + 1);
  st.plotSeq = Math.max(1, intOf(d.plotSeq, 1));
  st.lastDelta = numOf(d.lastDelta, 0);
  st.lastReasons = (Array.isArray(d.lastReasons) ? d.lastReasons : []).map(String);
  st.lastCourtPaid = d.lastCourtPaid !== false;
  st.rngState = Number.isFinite(d.rngState) ? (d.rngState >>> 0) : null;
  st.usurpConfirmDay = null;

  if (holder && typeof holder === 'object') holder.linkDynasty = st;
  return st;
}

// ════════════════════════ экран ════════════════════════
// DOM здесь не строится: панель — это СТРОКА HTML. Весь случай уже посчитан
// дневным ходом, поэтому рендер можно звать хоть каждый кадр.

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function sign(v) {
  const n = Number(v) || 0;
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)}`;
}

function memberRow(m, mark) {
  const years = yearsOf(m.age);
  const role = m.status === 'ruler' ? 'правитель' : m.status === 'spouse' ? 'супруг(а)' : 'родич';
  return `<div class="kv"><span>${mark || ''}${esc(m.name)}</span>`
    + `<span>${years} лет · ${role}${m.alive ? '' : ` · ${esc(m.cause || 'умер')}`}</span></div>`;
}

export function renderDynastyPanel(sim) {
  const st = sim && sim.linkDynasty && typeof sim.linkDynasty === 'object' ? sim.linkDynasty : null;
  if (!st) {
    return '<div class="card"><div class="ttl"><span>Род</span></div>'
      + '<div class="desc">Королевский род ещё не основан: держава держится на '
      + 'правителе без дома и без знамени.</div></div>';
  }
  const pol = sim && sim.politics && sim.politics.state ? sim.politics.state : null;
  const gov = pol && typeof pol.gov === 'string' ? pol.gov : 'chiefdom';
  const L = clamp(numOf(st.legitimacy, LEGIT_START), 0, 100);
  const col = L >= 50 ? 'var(--good)' : L >= PRETENDER_LEGIT ? 'var(--warn)' : 'var(--bad)';
  const ruler = st.members.find((m) => m.alive !== false && m.status === 'ruler');
  const heirM = st.members.find((m) => m.id === st.heir && m.alive !== false);

  let html = `<h4 class="group">Род при троне</h4>`;
  html += `<div class="card"><div class="ttl"><span>Дом ${esc(st.house.name)}</span>`
    + `<span class="cost">${st.house.generations}-е поколение</span></div>`
    + `<div class="desc">Основатель: ${esc(st.house.founder)}. Дом при власти `
    + `${Math.round(numOf(st.house.throneDays, 0) / YEAR_DAYS)} лет.</div>`
    + `<div class="kv"><span>Законность</span><span style="color:${col}">${Math.round(L)} из 100</span></div>`
    + `<div class="relbar"><div style="width:${Math.round(L)}%;background:${col}"></div></div>`
    + `<div class="kv"><span>Ход дня</span><span>${sign(st.lastDelta)} законности</span></div>`;
  for (const r of (st.lastReasons || [])) html += `<div class="reason">${esc(r)}</div>`;
  if (st.interregnum) {
    const left = Math.max(0, INTERREG_AUTO_DAYS - st.interregnumDays);
    html += `<div class="reason">⚔ МЕЖДУЦАРСТВИЕ: ${st.interregnumDays}-й день пустого трона. `
      + `Без решения знать воцарит новый дом через ~${left} дн.`
      + ` <button class="btn" data-dyn="adopt">Воцарить новый дом (${ADOPT_GOLD}🪙)</button></div>`;
  }
  // Регентство видно игроку: кто и за кого держит трон.
  if (st.regency) {
    const rg = st.members.find((m) => m.alive !== false && m.id === st.regentId);
    html += `<div class="reason">⚜ РЕГЕНТСТВО: `
      + (rg
        ? `${ruler && numOf(ruler.age, 0) < ADULT_DAYS ? `при юном правителе ${esc(ruler.name)} правит регент ${esc(rg.name)}` : `трон держит регент ${esc(rg.name)}`}`
        : 'трон держит регентский совет дома')
      + '.</div>';
  }
  html += '</div>';

  // --- Двор -----------------------------------------------------------------
  html += '<h4 class="group">Двор</h4><div class="card">';
  for (let i = 0; i <= COURT_MAX; i++) {
    const act = st.court === i;
    html += `<button class="btn ${act ? 'primary' : ''}" style="width:100%;margin-top:6px"`
      + ` data-dyn="court:${i}">${act ? '● ' : ''}Содержание двора ${i}`
      + `${i ? ` — ${COURT_UPKEEP[i]}🪙/день` : ' (ничего)'}</button>`;
  }
  html += '</div>';

  // --- Наследник и преемственность -------------------------------------------
  html += `<h4 class="group">Преемственность (${gov})</h4><div class="card">`;
  html += heirM
    ? memberRow({ ...heirM, status: 'ruler' }, '▶ Наследник: ')
    : '<div class="reason">Наследника по закону нет.</div>';
  const cands = st.members
    .filter((m) => m.alive !== false && m.status !== 'ruler' && numOf(m.age, 0) >= ADULT_DAYS)
    .slice(0, 5);
  for (const m of cands) {
    html += `<button class="btn" style="width:100%;margin-top:6px" data-dyn="heir:${m.id}"`
      + `${st.designated === m.id ? ' disabled' : ''}>Назначить наследником: ${esc(m.name)}`
      + ` (−${DESIGNATE_COST} законности)</button>`;
  }
  // Брак наследника: союз с живым соседним домом.
  if (heirM && heirM.pairWith == null && numOf(heirM.age, 0) >= ADULT_DAYS && !st.interregnum) {
    const fids = (sim.factions || []).filter((f) => f && f.alive !== false).slice(0, 4);
    for (const f of fids) {
      const nm = f.def ? f.def.name : f.id;
      html += `<button class="btn" style="width:100%;margin-top:6px" data-dyn="marry:${esc(f.id)}">`
        + `Сослать брак с домом ${esc(nm)} (${MARRIAGE_GOLD}🪙, +${MARRIAGE_REL} отношений)</button>`;
    }
  }
  html += '</div>';

  // --- Люди рода -----------------------------------------------------------------
  html += `<h4 class="group">Род: ${st.members.filter((m) => m.alive !== false).length} живых`
    + ` (потолок ${MEMBER_CAP})</h4><div class="card">`;
  for (const m of st.members.slice(-12)) html += memberRow(m, '');
  html += '</div>';

  // --- Претенденты и заговори ---------------------------------------------------
  if (st.pretenders.length) {
    html += '<h4 class="group">Претенденты на трон</h4>';
    for (const p of st.pretenders) {
      const sup = clamp(numOf(p.support, 0), 0, SUPPORT_MAX);
      html += `<div class="card"><div class="ttl"><span>${esc(p.name)} из дома ${esc(p.house)}</span>`
        + `<span class="cost">поддержка ${Math.round(sup)}</span></div>`
        + `<div class="relbar"><div style="width:${Math.round(sup)}%;background:var(--bad)"></div></div></div>`;
    }
  }
  if (st.plots.length) {
    html += '<h4 class="group">Заговоры при дворе</h4>';
    for (const p of st.plots) {
      const kindRu = { scandal: 'скандал', claim: 'чужое право', poison: 'яд' }[p.kind] || p.kind;
      html += `<div class="card"><div class="ttl"><span>${esc(p.by)}: ${kindRu}</span>`
        + `<span class="cost">${p.days}/${Math.max(1, p.need)} дн.</span></div>`
        + `<button class="btn" data-dyn="expose:${p.id}">Раскрыть (${EXPOSE_GOLD}🪙, +${EXPOSE_LEGIT_GAIN})</button> `
        + `<button class="btn" data-dyn="pardon:${p.id}">Простить (−${PARDON_LEGIT_COST})</button> `
        + `<button class="btn danger" data-dyn="execute:${p.id}">Казнить (+${EXECUTE_LEGIT_GAIN})</button></div>`;
    }
  }

  // --- Переворот --------------------------------------------------------------------
  const F = pol && pol.factions ? pol.factions : {};
  const vals = Object.keys(F).map((k) => numOf(F[k], 0));
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  const canUsurp = avg >= USURP_MIN_AVG && numOf(F.nobles, 0) >= USURP_MIN_NOBLES;
  const waiting = Number.isFinite(st.usurpConfirmDay)
    && Math.abs(numOf(sim && sim.day, 0) - st.usurpConfirmDay) <= CONFIRM_DAYS;
  html += `<h4 class="group">Свергнуть дом</h4><div class="card">`
    + `<div class="desc">Поддержка сословий: средняя ${Math.round(avg)}, знать ${Math.round(numOf(F.nobles, 0))}. `
    + `Нужно хотя бы ${USURP_MIN_AVG} и ${USURP_MIN_NOBLES} у знати — иначе мятеж никто не поднимет.</div>`
    + (canUsurp
      ? `<button class="btn ${waiting ? 'danger' : ''}" style="width:100%" data-dyn="usurp">`
        + `${waiting ? 'ПОДТВЕРДИТЬ переворот: назад пути нет' : 'Совершить переворот'}`
        + ` (законность ${USURP_LEGIT}, порядок −${USURP_STAB_COST})</button>`
      : '<div class="reason">Переворот невозможен: сословия слабы.</div>')
    + '</div>';

  return html;
}

// Привязка обработчиков: свои data-атрибуты в переданном корне, никаких
// обращений к document. Отказ доходит до игрока тостом, успех обновляет панель.
// opts: { toast(text, type), refresh() }
export function bindDynastyPanel(root, sim, opts = {}) {
  if (!root || typeof root.querySelectorAll !== 'function' || !sim) return 0;
  let bound = 0;
  for (const el of Array.from(root.querySelectorAll('[data-dyn]'))) {
    const spec = (el.dataset && el.dataset.dyn)
      || (typeof el.getAttribute === 'function' ? el.getAttribute('data-dyn') : '');
    el.onclick = () => {
      const r = handleDynastyAction(sim, spec);
      if (!r.ok) {
        if (opts.toast) opts.toast(r.reason || 'Отказано', 'warn');
      } else {
        if (opts.toast && r.text) opts.toast(r.text, r.confirm ? 'warn' : 'good');
        if (opts.refresh) opts.refresh();
      }
      return r;
    };
    bound++;
  }
  return bound;
}

/* ПОДКЛЮЧЕНИЕ ─────────────────────────────────────────────────────────────────

integrate.js: импорт * as DYN; applyDynastyLinks(sim) зовёт dynastyInstall
лениво и dynastyNewDay каждый день; отчёт применяется там же (mods.stab →
стабильность, flags.courtGold → казна, flags.newRuler → политика + летопись,
reasons/events → журнал). Сейв: systemsSerialize/systemsRestore через поля
dyn. HUD: вкладка «Род» рендерит renderDynastyPanel(this.sim), кнопки
панели связаны через bindDynastyPanel(root, sim, {toast, refresh}).

Модуль ничего не мутирует сам: мир двигает только integrate.js (дневной ход)
и собственные решения игрока из handleDynastyAction.

────────────────────────────────────────────────────────────────────────────── */
