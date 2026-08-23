// Тесты малолетнего правителя, регентства и кулдауна междуцарствий.
// Запуск: node app/tests/test-ruler-age.mjs
//
// ЗАЧЕМ. Три багрепорта одним узлом:
//   1. Ребёнок на троне: кламп deserializePolitics (14..120) переписывал возраст
//      юного правителя рода — политика лгала, круг сейва не был бит-в-бит.
//      Честное решение: род держит РЕГЕНТА до ADULT_DAYS, годы ребёнка растут,
//      политике показывается взрослый регент.
//   2. Дубли летописи: «Власть у рода…» писалась каждый день применения отчёта,
//      а не только на реальную смену трона (сид 11/12000 дней: 24 записи из 538
//      при 4 реальных сменах).
//   3. Междуцарствия без тормоза: пресечения шли цепочкой. Теперь объявление
//      не чаще раза в INTERREG_COOLDOWN дней — свежая усобица держится
//      регентским советом.
// Каждый блок падает на старом коде (проверено на копии модулей из HEAD во
// временной папке) — тесты привязаны к поведению, а не к реализации.
import { Simulation } from '../src/core/simulation.js';
import { createRng } from '../src/core/rng.js';
import * as DYN from '../src/core/systems/link_dynasty.js';
import { createPolitics, serializePolitics, deserializePolitics } from '../src/core/systems/politics.js';

let ok = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); ok++; console.log('OK', name); }
  catch (e) { fail++; console.log('FAIL', name, '—', e.message); }
};
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

// ─────────────────────────── испытательный стенд ───────────────────────────

// Подделка sim — ровно те поля, что читает связь (как в test-dynasty).
function makeSim(o = {}) {
  return {
    seed: o.seed ?? 1,
    day: o.day ?? 100,
    rng: createRng(o.rngSeed ?? 77),
    linkDynasty: null,
    politics: { state: {
      gov: o.gov || 'monarchy',
      stability: 60,
      factions: { nobles: 55, clergy: 55, merchants: 55, commons: 55, military: 55 },
      ruler: o.polRuler || null,
    } },
    res: { gold: o.gold ?? 500 },
    _happy: o.happy ?? 55,
    factions: [{ id: 'wolves', def: { name: 'Волчий Предел' }, alive: true }],
    wars: [],
    relations: {},
    linkSurvival: null,
    linkTerritory: null,
    logs: [],
    chronicle: [],
    addLog(x) { this.logs.push(x); },
    addChronicle(x) { this.chronicle.push(x); },
    adjustRel(fid, d) { this.relations[fid] = (this.relations[fid] || 0) + d; },
  };
}

function makeHouse(o = {}) {
  return {
    v: 1, day: -1,
    house: { name: o.name || 'Тестовы', founder: 'Тест', generations: 1, throneDays: 200 },
    members: [],
    legitimacy: o.legitimacy ?? 55,
    court: 0,
    designated: null,
    heir: null,
    pretenders: [], plots: [], marriages: [],
    interregnum: false, interregnumDays: 0,
    regency: false, regentId: null, lastInterregnumDay: -1,
    nextId: 1, plotSeq: 1,
    lastDelta: 0, lastReasons: [], lastCourtPaid: true,
  };
}

function addM(st, opts = {}) {
  const m = {
    id: st.nextId++,
    name: opts.name || `Член${st.nextId}`,
    age: opts.age ?? 3000,
    sex: opts.sex || 'м',
    traits: opts.traits || [],
    status: opts.status || 'member',
    alive: opts.alive !== false,
    deathDay: -1,
    cause: '',
    pairWith: opts.pairWith != null ? opts.pairWith : null,
    kids: opts.kids ?? 0,
  };
  st.members.push(m);
  return m;
}

// Сутки как в integrate.js: отчёт применён, новое состояние поставлено.
function runDay(sim) {
  sim.day++;
  const rep = DYN.dynastyNewDay(sim);
  if (rep.flags.state) sim.linkDynasty = rep.flags.state;
  return rep;
}

function runUntil(sim, pred, maxDays) {
  for (let i = 0; i < maxDays; i++) {
    const rep = runDay(sim);
    if (pred(rep)) return i;
  }
  return -1;
}

// ══════════════ 1. Малолетний на троне: регент до совершеннолетия ══════════════

console.log('--- Живой прогон ядра: ребёнок на троне ---');
{
  // Настоящая Simulation: проверяется вся цепочка, включая применение отчёта
  // интегратором и запись летописи. Род пересобирается руками под сценарий.
  const sim = new Simulation(77, { startEra: 3 });
  sim.tick(1);
  {
    const st = sim.linkDynasty;
    st.members.length = 0;
    st.nextId = 1;
    st.plotSeq = 1;
    const r = addM(st, { name: 'Старец', age: 13000, traits: ['sickly'], status: 'ruler' });
    const wife = addM(st, { name: 'Мать', age: 3000, sex: 'ж', status: 'spouse' });
    const son = addM(st, { name: 'Отрок', age: 500 });
    r.pairWith = wife.id; wife.pairWith = r.id;
    st.designated = son.id;
    st.pretenders = []; st.plots = [];
    st.interregnum = false; st.interregnumDays = 0;
    st.regency = false; st.regentId = null; st.lastInterregnumDay = -1;
    sim.politics.state.ruler = { name: 'Старец', age: 130, since: sim.day, traits: [] };
  }

  // Заговоры и самозванцы не должны сорвать сценарий: гасим их каждый вечер.
  const guard = () => {
    const st = sim.linkDynasty;
    st.plots.length = 0;
    st.pretenders.length = 0;
    st.legitimacy = Math.max(st.legitimacy, 80);
  };

  let crownRep = null;
  for (let i = 0; i < 900 && !crownRep; i++) {
    guard();
    sim.tick(1);
    const rep = sim.sys.dynLinks;
    if (rep && rep.events.some(e => /Трон занял Отрок/.test(e.text))) crownRep = rep;
  }

  t('малолетний назначенник взошёл на трон', () => {
    must(crownRep, 'за 900 дней Старец так и не умер / сын не взошёл');
    const st = sim.linkDynasty;
    const lr = st.members.find(m => m.alive !== false && m.status === 'ruler');
    must(lr && lr.name === 'Отрок', `на троне не Отрок: ${lr && lr.name}`);
  });

  t('регентство объявлено событием в летопись, регент — взрослый родич', () => {
    must(crownRep, 'сценарий не дошёл до коронации');
    const ev = crownRep.events.find(e => /регент/i.test(e.text));
    must(ev && ev.chronicle === true, 'регентство объявлено без записи в летопись');
    const st = sim.linkDynasty;
    must(st.regency === true, 'флаг регентства не поднят');
    const rg = st.members.find(m => m.alive !== false && m.id === st.regentId);
    must(rg && rg.name === 'Мать', `регент не Мать: ${rg && rg.name}`);
    must(rg.age >= DYN.ADULT_DAYS, 'регент сам несовершеннолетний');
  });

  t('политике предъявлен регент, а не возраст ребёнка (контракт интегратора)', () => {
    must(crownRep, 'сценарий не дошёл до коронации');
    must(!crownRep.flags.newRuler, 'при регентстве политика получила бы ребёнка как правителя');
    must(crownRep.flags.regent, 'флаг regent не выставлен');
    must(crownRep.flags.regent.name === 'Мать', `политике назван не регент: ${crownRep.flags.regent.name}`);
    must(crownRep.flags.regent.ageYears >= 12, 'возраст регента ушёл ниже границы политики');
    must(sim.politics.state.ruler.name === 'Мать',
      `панель «Держава» показывает не регента: ${sim.politics.state.ruler.name}`);
  });

  // Годы ребёнка растут честно: ни переписи, ни скачка к «взрослому» значению.
  const sonAtCrown = sim.linkDynasty.members.find(m => m.name === 'Отрок').age;

  let adultRep = null;
  let daysToAdult = 0;
  while (!adultRep && daysToAdult < DYN.ADULT_DAYS + 50) {
    guard();
    sim.tick(1);
    daysToAdult++;
    const rep = sim.sys.dynLinks;
    if (rep && rep.events.some(e => /вступил в права/.test(e.text))) adultRep = rep;
  }

  t('годы ребёнка растут по одному в день, без переписи возраста', () => {
    const son = sim.linkDynasty.members.find(m => m.name === 'Отрок');
    must(son.alive !== false, 'Отрок не дожил до совершеннолетия — сценарий сорван');
    must(son.age === sonAtCrown + daysToAdult,
      `возраст шёл неровно: было ${sonAtCrown}, прошло ${daysToAdult} дн., стало ${son.age}`);
    must(son.age >= DYN.ADULT_DAYS, 'совершеннолетие не достигнуто');
  });

  t('совершеннолетие: регентство кончилось, юный правитель у политики и в летописи', () => {
    must(adultRep, 'событие «вступил в права» не случилось');
    const st = sim.linkDynasty;
    must(st.regency === false && st.regentId === null, 'регентство не снято');
    const lr = st.members.find(m => m.alive !== false && m.status === 'ruler');
    must(adultRep.flags.newRuler && adultRep.flags.newRuler.name === 'Отрок'
      && adultRep.flags.newRuler.chronicle === true,
      'вступление в права не помечено как реальное событие трона');
    must(sim.politics.state.ruler.name === 'Отрок', 'политика не узнала выросшего правителя');
    must(sim.politics.state.ruler.age >= 12 && sim.politics.state.ruler.age < 14,
      `возраст у политики не честный: ${sim.politics.state.ruler.age}`);
    must(sim.chronicle.some(c => /^Власть у рода/.test(c.text) && /Отрок/.test(c.text)),
      'летопись не отметила вступление в права строкой «Власть у рода»');
  });

  // Круг сейва сразу после совершеннолетия: у политики сейчас честные 12 лет —
  // ровно та зона, которую старый кламп 14..120 переписывал при загрузке.
  t('сейв с юным правителем: круг бит-в-бит для рода и политики', () => {
    const dynBefore = JSON.stringify(DYN.serializeDynasty(sim));
    const polBefore = JSON.stringify(serializePolitics(sim.politics.state));
    const r = Simulation.deserialize(JSON.stringify(sim.serialize()));
    must(r.ok === true, r.reason || 'загрузка не удалась');
    must(JSON.stringify(DYN.serializeDynasty(r.sim)) === dynBefore,
      'состояние рода разошлось при загрузке (регентство/кулаун смуты забыты?)');
    must(JSON.stringify(serializePolitics(r.sim.politics.state)) === polBefore,
      `политика разошлась при загрузке: было ${polBefore}, стало ${JSON.stringify(serializePolitics(r.sim.politics.state))}`);
  });

  t('мусорный сейв не роняет новые поля рода', () => {
    const holder = {};
    const st = DYN.restoreDynasty(holder, { regency: 'да', regentId: -3, lastInterregnumDay: 'ерунда' });
    must(st.regency === false && st.regentId === null && st.lastInterregnumDay === -1,
      'мусор прошёл насквозь вместо молчаливых умолчаний');
    const snap1 = JSON.stringify(DYN.serializeDynasty(holder));
    DYN.restoreDynasty(holder, JSON.parse(snap1));
    must(JSON.stringify(DYN.serializeDynasty(holder)) === snap1, 'новые поля едут не симметрично');
  });
}

// ══════════════ 2. Летопись: только реальные смены трона ══════════════

console.log('\n--- Живой прогон ядра: сид 11, эпоха 3, 12000 дней ---');
{
  const SEED = 11, DAYS = 12000;
  const sim = new Simulation(SEED, { startEra: 3 });
  // Снимок личности на троне каждый день: сколько раз он РЕАЛЬНО менялся.
  // Строка «Власть у рода…» имеет право звучать не чаще этих смен.
  let prevKey = null, changes = 0;
  for (let d = 0; d < DAYS; d++) {
    sim.tick(1);
    const st = sim.linkDynasty;
    const lr = st.members.find(m => m.alive !== false && m.status === 'ruler');
    const key = `${st.house.name}|${lr ? lr.name : '—пусто—'}|${st.regency ? 'р' : ''}`;
    if (prevKey !== null && key !== prevKey) changes++;
    prevKey = key;
  }
  const power = sim.chronicle.filter(e => /^Власть у рода/.test(e.text)).length;
  console.log(`    замер: строк «Власть у рода»=${power}, реальных смен трона=${changes}, всего записей=${sim.chronicle.length}`);

  t(`сценарий состоялся: были смены трона и записи о них`, () => {
    must(changes >= 2, `смен трона слишком мало для вывода: ${changes}`);
    must(power >= 1, 'ни одной строки «Власть у рода» — сравнивать нечего');
  });
  t(`дубли вылечены: строк «Власть у рода» не больше реальных смен (было 24 при 4 сменах)`, () => {
    must(power <= changes, `строк ${power} больше, чем реальных смен ${changes} — летопись пишет состояния`);
  });
}

// ══════════════ 3. Междуцарствие не чаще раза в 600 дней ══════════════

console.log('\n--- Регентский совет внутри кулдауна смуты ---');
{
  // Смута была всего 100 дней назад: второе междуцарствие подряд запрещено.
  const sim = makeSim();
  const st = makeHouse();
  addM(st, { name: 'Старец', age: 13000, traits: ['sickly'], status: 'ruler' });
  st.lastInterregnumDay = sim.day - 100;      // свежая усобица в памяти державы
  sim.linkDynasty = st;

  let declRep = null;
  for (let i = 0; i < 900 && !declRep; i++) {
    const rep = runDay(sim);
    if (rep.flags.state.regency === true && rep.flags.state.interregnum === false) declRep = rep;
  }

  t('свежая усобица держится регентским советом, а не новым междуцарствием', () => {
    must(declRep, 'пресечение не объявлено регентством за 900 дней');
    const s = sim.linkDynasty;
    must(s.interregnum === false, 'объявлено повторное междуцарствие внутри кулдауна');
    must(s.regency === true && s.regentId === null, 'совет без лица не встал за троном');
    must(declRep.mods.stab > DYN.INTERREGNUM_STAB,
      `удар междуцарствия прилетел дважды за 100 дней: ${declRep.mods.stab}`);
    must(declRep.events.some(e => e.chronicle && /регентский совет/.test(e.text)),
      'взятие власти советом не отражено в летописи');
  });

  // Совет правит до срока: дом пресёкся (живых нет) — события случайности
  // невозможны, срок вышел, знать возводит новый дом ровно на INTERREG_AUTO_LEGIT.
  const interregLinesDuringCouncil = [];
  let founded = false;
  for (let i = 0; i < DYN.INTERREG_COOLDOWN + 10 && !founded; i++) {
    const rep = runDay(sim);
    for (const e of rep.events) if (/Междуцарствие!/.test(e.text)) interregLinesDuringCouncil.push(e.text);
    founded = rep.flags.state.regency === false
      && rep.flags.state.interregnum === false
      && rep.flags.state.members.some(m => m.alive !== false && m.status === 'ruler');
  }

  t('по исходе срока совет возводит новый дом — БЕЗ второго междуцарствия', () => {
    must(founded, `за ${DYN.INTERREG_COOLDOWN + 10} дней совет не возвёл новый дом`);
    const s = sim.linkDynasty;
    must(s.legitimacy === DYN.INTERREG_AUTO_LEGIT,
      `новый дом встал не на положенную законность: ${s.legitimacy}`);
    must(interregLinesDuringCouncil.length === 0,
      `за время совета лжетопись объявила междуцарствие ещё раз: ${interregLinesDuringCouncil.length}`);
  });
}

console.log('\n--- Второе пресечение подряд после полного междуцарствия ---');
{
  const sim = makeSim();
  const st = makeHouse();
  addM(st, { name: 'ОдинокийВладыка', age: 13000, traits: ['sickly'], status: 'ruler' });
  sim.linkDynasty = st;                        // памяти о смуте нет: будет полное междуцарствие

  const startAt = runUntil(sim, rep => rep.flags.state.interregnum === true, 900);
  must(startAt >= 0, 'первое междуцарствие не наступило — тест бессмыслен');
  const resolved = runUntil(sim, rep => rep.flags.state.interregnum === false,
    DYN.INTERREG_AUTO_DAYS + 10);
  must(resolved >= 0, 'первое междуцарствие не разрешилось');

  // Новый дом пал тут же: всех убираем, основателя старим до предела.
  const s2 = sim.linkDynasty;
  const founder = s2.members.find(m => m.alive !== false && m.status === 'ruler');
  for (const m of s2.members) if (m !== founder) m.alive = false;
  founder.age = 13100;
  founder.traits = ['sickly'];
  founder.pairWith = null;

  let secondDecl = null, secondInterreg = 0;
  for (let i = 0; i < 900 && !secondDecl; i++) {
    const rep = runDay(sim);
    for (const e of rep.events) if (/Междуцарствие!/.test(e.text)) secondInterreg++;
    if (rep.flags.state.regency === true) secondDecl = rep;
  }
  t('повторное пресечение внутри кулдауна — снова совет, не междуцарствие', () => {
    must(secondDecl, 'второе пресечение не объявлено регентством');
    must(secondInterreg === 0, `междуцарствие объявлено чаще раза в ${DYN.INTERREG_COOLDOWN} дней`);
  });
}

// ══════════════ 4. Политика не переписывает честные годы ══════════════

t('кламп политики пропускает юного правителя 12 лет и дробный возраст', () => {
  const base = createPolitics(createRng(5));
  base.ruler = { name: 'Отрок', age: 12, since: 0, traits: [] };
  const back = deserializePolitics(serializePolitics(base));
  must(back.ruler.age === 12, `было 14..120: честные 12 лет пережили загрузку как ${back.ruler.age}`);
  base.ruler.age = 13.07;                      // суточный ход идёт дробями
  const backF = deserializePolitics(JSON.parse(JSON.stringify(serializePolitics(base))));
  must(backF.ruler.age === 13.07, `дробный возраст исказился: ${backF.ruler.age}`);
});

t('границы клампа держат мусор: отрицательный и запредельный возраст зажаты', () => {
  const base = createPolitics(createRng(6));
  base.ruler = { name: 'Мусор', age: -50, since: 0, traits: [] };
  must(deserializePolitics(serializePolitics(base)).ruler.age === 12, 'нижняя граница пробита');
  base.ruler.age = 999;
  must(deserializePolitics(serializePolitics(base)).ruler.age === 120, 'верхняя граница пробита');
});

console.log(`\n=== ${ok} OK / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
