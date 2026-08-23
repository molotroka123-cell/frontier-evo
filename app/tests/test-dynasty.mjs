// Тесты системы «Королевский род» (link_dynasty.js). Node, без DOM.
// Запуск: node app/tests/test-dynasty.mjs
//
// Проверяются числа и направления связей, а не «функция не упала»: чистота
// дневного хода (снимок sim до/после), потолки всех петель, законы
// преемственности по строям, решения игрока, круг сохранения бит-в-бит,
// детерминизм после загрузки и молчание при спокойном ходе дел.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Simulation } from '../src/core/simulation.js';
import { createRng } from '../src/core/rng.js';
import * as DYN from '../src/core/systems/link_dynasty.js';

let ok = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); ok++; console.log('OK', name); }
  catch (e) { fail++; console.log('FAIL', name, '—', e.message); }
};
const must = (cond, msg) => { if (!cond) throw new Error(msg); };
const near = (a, b, eps, msg) => must(Math.abs(a - b) <= eps, `${msg}: ${a} ≠ ${b}`);

const MODULE_PATH = fileURLToPath(new URL('../src/core/systems/link_dynasty.js', import.meta.url));

// ─────────────────────────── испытательный стенд ───────────────────────────

// Подделка sim: связь читает только эти поля. Подделка позволяет ставить ровно
// то состояние, которое проверяется, без прогона тысячи игровых дней.
function makeSim(o = {}) {
  return {
    seed: o.seed ?? 1,
    day: o.day ?? 100,
    rng: createRng(o.rngSeed ?? 77),
    linkDynasty: null,
    politics: { state: {
      gov: o.gov || 'chiefdom',
      stability: 60,
      factions: o.factionValues || { nobles: 55, clergy: 55, merchants: 55, commons: 55, military: 55 },
      ruler: o.polRuler || null,
    } },
    res: { gold: o.gold ?? 500 },
    _happy: o.happy ?? 55,
    factions: [{ id: 'wolves', def: { name: 'Волчий Предел' }, alive: true }],
    wars: [],
    relations: {},
    linkSurvival: o.linkSurvival || null,
    linkTerritory: o.linkTerritory || null,
    logs: [],
    chronicle: [],
    addLog(x) { this.logs.push(x); },
    addChronicle(x) { this.chronicle.push(x); },
    adjustRel(fid, d) { this.relations[fid] = (this.relations[fid] || 0) + d; },
  };
}

function makeHouse(o = {}) {
  const st = {
    v: 1, day: -1,
    house: { name: o.name || 'Тестовы', founder: o.founder || 'Тест', generations: 1, throneDays: 200 },
    members: [],
    legitimacy: o.legitimacy ?? 55,
    court: 0,
    designated: null,
    heir: null,
    pretenders: [], plots: [], marriages: [],
    interregnum: false, interregnumDays: 0,
    nextId: 1, plotSeq: 1,
    lastDelta: 0, lastReasons: [], lastCourtPaid: true,
  };
  return st;
}

function addM(st, opts = {}) {
  const m = {
    id: st.nextId++,
    name: opts.name || `Член${st.nextId}`,
    age: opts.age ?? 3000,
    sex: opts.sex || 'м',
    traits: opts.traits || ['valiant'],
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

// Стандартный род для тестов действий: правитель + супруга + сын + дочь.
// Имя правителя обязано совпадать с politics.ruler, иначе сработает примирение.
// ВАЖНО: runDay каждый день подменяет sim.linkDynasty свежим клоном — держите
// ссылку `const st = sim.linkDynasty` ПОСЛЕ цикла дней, а не до него.
function familyHouse(sim) {
  const st = makeHouse();
  const r = addM(st, { name: 'Рюрик', age: 8000, status: 'ruler', traits: [] });
  const s = addM(st, { name: 'Ефросинья', age: 7600, sex: 'ж', status: 'spouse', traits: [] });
  r.pairWith = s.id; s.pairWith = r.id;
  const son = addM(st, { name: 'Игорь', age: 3000, traits: ['valiant'] });
  const dau = addM(st, { name: 'Ольга', age: 2500, sex: 'ж', traits: ['valiant', 'cunning', 'pious'] });
  sim.politics.state.ruler = { name: 'Рюрик', age: 80, since: 0, traits: [] };
  sim.linkDynasty = st;
  return { st, r, s, son, dau };
}

// Сутки как в integrate.js: отчёт применён, новое состояние поставлено.
function runDay(sim) {
  sim.day++;
  const rep = DYN.dynastyNewDay(sim);
  if (rep.flags.state) sim.linkDynasty = rep.flags.state;
  return rep;
}

// Прожить до события. Гарантии «обязательно за N дней» нет — есть почти
// достоверность: кривая смерти на старости даёт ~3% в день. Предикат смотрит
// в отчёт конкретного дня, а не в текущее состояние.
function runUntil(sim, pred, maxDays) {
  for (let i = 0; i < maxDays; i++) {
    const rep = runDay(sim);
    if (pred(rep)) return i;
  }
  return -1;
}

// Одинокий престарелый болезненный правитель — умирает быстро и детерминированно.
function agedLoneRuler(sim) {
  const st = makeHouse();
  st.house.founder = 'Старец';
  addM(st, { name: 'Старец', age: 13000, traits: ['sickly'], status: 'ruler' });
  sim.linkDynasty = st;
  return st;
}

// ════════════════════════ 1. гигиена исходника ════════════════════════

t('в модуле нет Math.random', () => {
  // комментарии отбрасываем: слово Math.random встречается в шапке модуля
  const src = readFileSync(MODULE_PATH, 'utf8').split('\n')
    .filter(l => !/^\s*\/\//.test(l)).join('\n');
  must(!/Math\.random/.test(src), 'найден Math.random — детерминизм сломан');
});

// ════════════════════════ 2. чистота и guard ════════════════════════

t('чистота: dynastyNewDay не меняет sim (снимок до/после)', () => {
  const sim = new Simulation(4242);
  for (let i = 0; i < 10; i++) { sim.day++; sim.onNewDay(); }
  const snap = () => JSON.stringify({
    dyn: sim.linkDynasty, pol: sim.politics.state, res: sim.res,
    rel: sim.relations, popN: sim.villagers.length,
    chronN: sim.chronicle.length, logN: sim.log.length,
  });
  sim.day++;                                   // прошлый день уже обработан ядром
  const before = snap();
  DYN.dynastyNewDay(sim);
  must(snap() === before, 'модуль мутирует мир — это дело integrate.js');
});

t('одни сутки считаются один раз', () => {
  const sim = makeSim();
  familyHouse(sim);
  runDay(sim);
  const again = DYN.dynastyNewDay(sim);        // тот же день
  must(again.mods.happy === 0 && again.mods.stab === 0, `повторный ход двинул mods: ${JSON.stringify(again.mods)}`);
  must(again.events.length === 0 && again.reasons.length === 0, 'повторный ход породил события');
  must(again.flags.state === sim.linkDynasty, 'повторный вызов подменил состояние рода');
});

// ════════════════════════ 3. законность: направления и потолки ════════════════════════

t('легитимность растёт от содержания двора', () => {
  const sim = makeSim({ gold: 9999 });
  familyHouse(sim);
  sim.linkDynasty.court = 3;
  const L0 = sim.linkDynasty.legitimacy;
  for (let i = 0; i < 40; i++) runDay(sim);
  const st = sim.linkDynasty;                  // свежая ссылка: ход подменяет состояние клоном
  must(st.legitimacy > L0 + 3, `двор не поднял законность: ${L0} → ${st.legitimacy}`);
});

t('вклад двора упирается в свой потолок', () => {
  const sim = makeSim({ happy: 30 });
  familyHouse(sim);
  sim.linkDynasty.court = 3;
  sim.linkDynasty.legitimacy = 85;             // выше LEGIT_COURT_CAP и LEGIT_THRONE_CAP
  runDay(sim);
  const st = sim.linkDynasty;
  // Все положительные слагаемые закрыты потолками — остаётся только затухание.
  near(st.lastDelta, -DYN.LEGIT_DECAY, 1e-9, 'при L=85 законность не должна расти от двора');
  must(st.legitimacy < 85, `потолок вклада двора пробит: ${st.legitimacy}`);
});

t('голод роняет легитимность и назван словами', () => {
  const fed = makeSim();
  familyHouse(fed);
  const starved = makeSim({ linkSurvival: { hungerDays: 10 } });
  familyHouse(starved);
  const a = runDay(fed), b = runDay(starved);
  must(b.reasons.some(r => /голода|голод/i.test(r)), `причина голода не названа: ${b.reasons.join(' | ')}`);
  must(b.flags.state.legitimacy < a.flags.state.legitimacy, 'голод не уронил легитимность относительно сытого дня');
  near(b.flags.state.lastDelta, -0.49, 0.02, 'дневное падение от голода не совпало с расчётным');
});

t('свежая потеря земли роняет легитимность', () => {
  const calm = makeSim();
  familyHouse(calm);
  const lost = makeSim({ linkTerritory: { shock: 3 } });
  familyHouse(lost);
  runDay(calm); runDay(lost);
  must(lost.linkDynasty.lastDelta < calm.linkDynasty.lastDelta - 0.15,
    `траур по земле не виден в дельте: ${lost.linkDynasty.lastDelta} против ${calm.linkDynasty.lastDelta}`);
});

t('законность зажата 0..100 даже на мусорных входах и экстремумах', () => {
  const hi = makeSim({ happy: 90 });
  familyHouse(hi);
  hi.linkDynasty.legitimacy = 150;
  runDay(hi);
  must(hi.linkDynasty.legitimacy <= 100, `верхний потолок пробит: ${hi.linkDynasty.legitimacy}`);
  const lo = makeSim({ linkSurvival: { hungerDays: 30 }, happy: 5 });
  familyHouse(lo);
  lo.linkDynasty.legitimacy = 0.01;
  lo.linkDynasty.heir = null;
  for (let i = 0; i < 60; i++) runDay(lo);
  must(lo.linkDynasty.legitimacy >= 0, `нижний потолок пробит: ${lo.linkDynasty.legitimacy}`);
  const top = makeSim({ happy: 95, gold: 9999 });
  familyHouse(top);
  top.linkDynasty.legitimacy = 99.9;
  top.linkDynasty.court = 3;
  let peak = 99.9;
  for (let i = 0; i < 50; i++) { runDay(top); peak = Math.max(peak, top.linkDynasty.legitimacy); }
  must(peak <= 100, `все слагаемые разом пробили сотню: ${peak}`);
});

// ════════════════════════ 4. законы преемственности по строям ════════════════════════

// Один состав, разные строи: правитель id1, сын id2 (3000 дн., 1 черта),
// дочь id3 (2500 дн., 3 черты), малолетний сын id4 (500 дн.).
function rosterHouse(sim) {
  const st = makeHouse();
  addM(st, { name: 'Правитель', age: 8000, status: 'ruler' });
  addM(st, { name: 'СтаршийСын', age: 3000, traits: ['valiant'] });
  addM(st, { name: 'Дочь', age: 2500, sex: 'ж', traits: ['valiant', 'cunning', 'pious'] });
  addM(st, { name: 'Младенец', age: 500, traits: ['pious'] });
  sim.linkDynasty = st;
  return st;
}

t('монархия берёт старшего сына', () => {
  const sim = makeSim({ gov: 'monarchy' });
  const st = rosterHouse(sim);
  must(DYN.heirOf(st, 'monarchy').id === 2, `закон монархии выбрал не того: ${DYN.heirOf(st, 'monarchy').name}`);
});

t('вождество берёт сильнейшего взрослого, а не старшего', () => {
  const sim = makeSim({ gov: 'chiefdom' });
  const st = rosterHouse(sim);
  must(DYN.heirOf(st, 'chiefdom').id === 3, `сильнейшим должен стать член с тремя чертами: ${DYN.heirOf(st, 'chiefdom').name}`);
});

t('империя и федерация берут старшего взрослого', () => {
  const sim = makeSim({ gov: 'empire' });
  const st = rosterHouse(sim);
  must(DYN.heirOf(st, 'empire').id === 2, `имперский закон выбрал не старшего: ${DYN.heirOf(st, 'empire').name}`);
  must(DYN.heirOf(st, 'federation').id === 2, 'совет федерации разошёлся с империей на том же составе');
});

t('назначенный наследник переопределяет закон строя', () => {
  const sim = makeSim({ gov: 'chiefdom' });
  const st = rosterHouse(sim);
  st.designated = 4;
  must(DYN.heirOf(st, 'chiefdom').id === 4, 'воля правителя не перебила обычай');
  st.designated = null;
  must(DYN.heirOf(st, 'chiefdom').id === 3, 'без назначения закон вернулся не к себе');
});

t('правитель сам себе наследником не бывает', () => {
  const sim = makeSim({ gov: 'empire' });
  const st = makeHouse();
  addM(st, { name: 'ОдинокийВладыка', age: 9000, status: 'ruler' });
  must(DYN.heirOf(st, 'empire') === null, 'правителя записали в собственные наследники');
  addM(st, { name: 'Племянник', age: 2200 });
  must(DYN.heirOf(st, 'empire').name === 'Племянник', 'после появления родича закон его не увидел');
});

t('дневной ход пересчитывает наследника при смене строя', () => {
  const sim = makeSim({ gov: 'chiefdom' });
  rosterHouse(sim);
  runDay(sim);
  must(sim.linkDynasty.heir === 3, `в вождестве наследник не сильнейший: ${sim.linkDynasty.heir}`);
  sim.politics.state.gov = 'monarchy';
  runDay(sim);
  must(sim.linkDynasty.heir === 2, `после реформы наследник не сменился по новому закону: ${sim.linkDynasty.heir}`);
});

// ════════════════════════ 5. республика и междуцарствие ════════════════════════

t('в республике модуль спит: нулевые отчёты, замороженная законность', () => {
  const sim = makeSim({ gov: 'republic' });
  familyHouse(sim);
  const L0 = sim.linkDynasty.legitimacy;
  const ageBefore = sim.linkDynasty.members[0].age;
  for (let i = 0; i < 20; i++) {
    const rep = runDay(sim);
    if (rep.mods.happy !== 0 || rep.mods.stab !== 0) throw new Error(`республика шевелит mods: ${JSON.stringify(rep.mods)}`);
    if (rep.events.length) throw new Error('республика говорит событиями рода');
  }
  const st = sim.linkDynasty;
  must(st.legitimacy === L0, `законность двигается вне трона: ${L0} → ${st.legitimacy}`);
  must(st.members[0].age > ageBefore, 'семья в республике перестала стареть');
});

t('пресечение рода — междуцарствие: удар по порядку, претенденты, летопись', () => {
  const sim = makeSim();
  agedLoneRuler(sim);
  const at = runUntil(sim, rep => rep.flags.state.interregnum === true, 900);
  must(at >= 0, 'за 900 дней престарелый правитель так и не умер');
  const st = sim.linkDynasty;
  must(st.pretenders.length === 3, `при междуцарствии должно быть трое претендентов: ${st.pretenders.length}`);
  must(st.interregnumDays >= 1, 'счётчик междуцарствия не пошёл');
  console.log(`   междуцарствие наступило на ${at + 1}-й день, претендентов: ${st.pretenders.length}`);
});

t('удар по стабильности и события приходят именно в день пресечения', () => {
  const sim = makeSim();
  agedLoneRuler(sim);
  let hit = null;
  for (let i = 0; i < 900 && !hit; i++) {
    const rep = runDay(sim);
    if (rep.mods.stab <= DYN.INTERREGNUM_STAB + 0.001) hit = rep;
  }
  must(hit, 'разовый удар INTERREGNUM_STAB не зафиксирован ни в один день');
  must(hit.events.length > 0, 'пресечение прошло молча — летопись пуста');
  must(hit.events.some(e => e.chronicle), 'пресечение рода не попало в летопись');
});

t('междуцарствие кончается само: знать возводит новый дом', () => {
  const sim = makeSim();
  agedLoneRuler(sim);
  const startAt = runUntil(sim, rep => rep.flags.state.interregnum === true, 900);
  must(startAt >= 0, 'междуцарствие не наступило — тест бессмыслен');
  const oldName = sim.linkDynasty.house.name;
  const at = runUntil(sim, rep => rep.flags.state.interregnum === false, DYN.INTERREG_AUTO_DAYS + 5);
  must(at >= 0, `за ${DYN.INTERREG_AUTO_DAYS} дней междуцарствие само не кончилось`);
  const st = sim.linkDynasty;
  must(st.house.name !== oldName, 'новый дом получил фамилию старого');
  must(st.legitimacy === DYN.INTERREG_AUTO_LEGIT, `новый дом встал не на положенную законность: ${st.legitimacy}`);
  must((st.members.filter(m => m.alive)).length >= 2, 'новый дом встал на трон без семьи');
});

// ════════════════════════ 6. действия игрока ════════════════════════

t('designate_heir стоит ровно DESIGNATE_COST и злит знать', () => {
  const sim = makeSim();
  familyHouse(sim);
  runDay(sim);                                  // heir пересчитан: дочь (сильнейшая)
  const st = sim.linkDynasty;
  must(st.heir === 4, `наследником по вождству должна быть дочь с тремя чертами: ${st.heir}`);
  const L0 = st.legitimacy;
  const nobles0 = sim.politics.state.factions.nobles;
  const r = DYN.handleDynastyAction(sim, 'heir:3');   // назначаем сына
  must(r.ok, `назначение отклонено: ${r.reason}`);
  near(sim.linkDynasty.legitimacy, L0 - DYN.DESIGNATE_COST, 1e-9, 'назначение стоило не ровно DESIGNATE_COST');
  must(sim.politics.state.factions.nobles === nobles0 - DYN.DESIGNATE_NOBLE_HIT, 'знать не отреагировала');
  must(sim.linkDynasty.designated === 3, 'назначение не запомнилось');
  const again = DYN.handleDynastyAction(sim, `heir:${sim.linkDynasty.heir}`);
  must(!again.ok && /и так наследник/.test(again.reason), 'повторное назначение действующего наследника прошло');
});

t('arrange_marriage: золото, отношения, запись и супруг в роде', () => {
  const sim = makeSim({ gov: 'monarchy' });     // по закону монархии наследник — старший сын
  familyHouse(sim);
  runDay(sim);
  let st = sim.linkDynasty;
  const heirId = st.heir;
  must(heirId === 3, `у монархии наследник не старший сын: ${st.heir}`);
  const L0 = st.legitimacy;
  const gold0 = sim.res.gold;
  const alive0 = st.members.filter(m => m.alive).length;
  const r = DYN.handleDynastyAction(sim, 'marry:wolves');
  must(r.ok, `брак отклонён: ${r.reason}`);
  st = sim.linkDynasty;                         // брак добавил члена рода — читаем свежее
  must(sim.res.gold === gold0 - DYN.MARRIAGE_GOLD, `казна заплатила не ${DYN.MARRIAGE_GOLD}: ${gold0 - sim.res.gold}`);
  must(sim.relations.wolves === DYN.MARRIAGE_REL, `отношения выросли не на ${DYN.MARRIAGE_REL}: ${sim.relations.wolves}`);
  must(st.marriages.length === 1 && st.marriages[0].fid === 'wolves' && st.marriages[0].memberId === heirId,
    'запись о браке (она же claim чужого дома) не появилась');
  near(st.legitimacy, L0 + DYN.MARRIAGE_LEGIT, 1e-9, 'брак дал не ровно MARRIAGE_LEGIT');
  must(st.members.filter(m => m.alive).length === alive0 + 1, 'дом невесты не вошёл в род');
  must(st.members.find(m => m.id === heirId).pairWith != null, 'наследник остался холост');
});

t('usurp без поддержки сословий отклоняется', () => {
  const sim = makeSim({ factionValues: { nobles: 20, clergy: 25, merchants: 25, commons: 25, military: 25 } });
  familyHouse(sim);
  const before = JSON.stringify(sim.linkDynasty.house);
  const r = DYN.handleDynastyAction(sim, 'usurp');
  must(!r.ok, 'переворот прошёл без поддержки сословий');
  must(JSON.stringify(sim.linkDynasty.house) === before, 'отклонённый переворот что-то поменял');
});

t('usurp: подтверждение, новый дом, законность 25, порядок −20, синк правителя', () => {
  const sim = makeSim({ factionValues: { nobles: 70, clergy: 65, merchants: 65, commons: 65, military: 65 } });
  familyHouse(sim);
  const st = sim.linkDynasty;
  // Заранее сорим: претендент, заговор и брак обязаны исчезнуть вместе со старым родом.
  st.pretenders.push({ id: 90, name: 'Самозванец', house: 'Лжев', fid: null, support: 50 });
  st.plots.push({ id: 7, kind: 'scandal', days: 3, need: 10, by: 'Хитрый', targetId: null });
  st.marriages.push({ fid: 'wolves', memberId: st.members[2].id, day: 1 });
  const first = DYN.handleDynastyAction(sim, 'usurp');
  must(first.ok && first.confirm, 'первое нажатие должно требовать подтверждения');
  must(st.house.name === 'Тестовы', 'неподтверждённый переворот уже сверг род');
  const second = DYN.handleDynastyAction(sim, 'usurp');
  must(second.ok && !second.confirm, `второе нажатие не свершило переворот: ${second.reason || ''}`);
  must(st.house.name !== 'Тестовы', 'фамилия дома не сменилась');
  must(st.legitimacy === DYN.USURP_LEGIT, `новый дом встал не на ${DYN.USURP_LEGIT}: ${st.legitimacy}`);
  must(sim.politics.state.stability === 40, `стабильность упала не на ${DYN.USURP_STAB_COST}: ${sim.politics.state.stability}`);
  must(st.pretenders.length === 0 && st.plots.length === 0 && st.marriages.length === 0, 'старые претензии пережили переворот');
  const founder = st.members.find(m => m.alive && m.status === 'ruler');
  must(founder && sim.politics.state.ruler.name === founder.name, 'политика не узнала нового правителя');
  must(sim.politics.state.rulersCount === 2, 'счётчик правителей не двинулся');
});

t('expose/pardon/execute снимают заговор каждая своей ценой', () => {
  // expose
  const sim = makeSim({ gold: 100 });
  familyHouse(sim);
  const st = sim.linkDynasty;
  st.plots.push({ id: 11, kind: 'scandal', days: 1, need: 10, by: 'Шептун', targetId: null });
  const L0 = st.legitimacy;
  let r = DYN.handleDynastyAction(sim, 'expose:11');
  must(r.ok, `раскрытие отклонено: ${r.reason}`);
  must(sim.res.gold === 100 - DYN.EXPOSE_GOLD && st.plots.length === 0, 'раскрытие не списало заговор или золото');
  near(st.legitimacy, L0 + DYN.EXPOSE_LEGIT_GAIN, 1e-9, 'раскрытие дало не ту законность');

  // pardon
  st.plots.push({ id: 12, kind: 'claim', days: 1, need: 10, by: 'Мстительный', targetId: null });
  const L1 = st.legitimacy;
  r = DYN.handleDynastyAction(sim, 'pardon:12');
  must(r.ok && st.plots.length === 0 && st.legitimacy === L1 - 3, 'пощада сработала не по правилам');

  // execute
  st.plots.push({ id: 13, kind: 'poison', days: 1, need: 10, by: 'Ядовар', targetId: st.members[2].id });
  const L2 = st.legitimacy;
  const nobles0 = sim.politics.state.factions.nobles;
  r = DYN.handleDynastyAction(sim, 'execute:13');
  must(r.ok && st.plots.length === 0 && st.legitimacy === L2 + 5, 'казнь сработала не по правилам');
  must(sim.politics.state.factions.nobles === nobles0 + 2 && sim.politics.state.factions.commons === 52,
    'казнь не сдвинула сословия');

  must(!DYN.handleDynastyAction(sim, 'expose:999').ok, 'несуществующий заговор «раскрылся»');
  must(!DYN.handleDynastyAction(sim, 'ерунда:1').ok, 'неизвестное действие принято');
});

t('adopt воцаряет новый дом в междуцарствие за золото', () => {
  const sim = makeSim({ gold: 200 });
  const st = makeHouse();
  st.interregnum = true;
  st.interregnumDays = 10;
  sim.linkDynasty = st;
  const poor = makeSim({ gold: 10 });
  poor.linkDynasty = makeHouse();
  poor.linkDynasty.interregnum = true;
  must(!DYN.handleDynastyAction(poor, 'adopt').ok, 'воцарение прошло без денег');
  must(!DYN.handleDynastyAction(makeSim(), 'adopt').ok, 'воцарение прошло при живом роде');
  const r = DYN.handleDynastyAction(sim, 'adopt');
  must(r.ok, `воцарение отклонено: ${r.reason}`);
  must(sim.res.gold === 80, `воцарение стоило не ${DYN.ADOPT_GOLD}: ${200 - sim.res.gold}`);
  must(!st.interregnum && st.legitimacy === DYN.ADOPT_LEGIT, 'новый дом встал не по правилам adopt');
  must(sim.politics.state.ruler.name === st.members.find(m => m.status === 'ruler').name,
    'политика не узнала воцарённый дом');
});

// ════════════════════════ 7. потолки петель ════════════════════════

t('претенденты появляются при низкой законности и не превышают пяти', () => {
  const sim = makeSim();
  familyHouse(sim);
  sim.linkDynasty.legitimacy = 20;              // ниже PRETENDER_LEGIT
  let seen = 0, appeared = false;
  for (let i = 0; i < 400; i++) {
    runDay(sim);
    const n = sim.linkDynasty.pretenders.length;
    seen = Math.max(seen, n);
    if (n > 0) appeared = true;
    if (n >= DYN.PRETENDER_CAP) break;
  }
  must(appeared, 'за 400 дней при законности 20 не объявился ни один претендент');
  must(seen <= DYN.PRETENDER_CAP, `потолок претендентов пробит: ${seen}`);
});

t('заговоров одновременно не больше трёх', () => {
  const sim = makeSim({ happy: 20 });
  familyHouse(sim);
  sim.linkDynasty.legitimacy = 35;               // условия для всех трёх видов сразу
  sim.linkDynasty.pretenders.push({ id: 91, name: 'Претендент', house: 'Чужие', fid: null, support: 30 });
  let seen = 0;
  for (let i = 0; i < 600; i++) {
    runDay(sim);
    seen = Math.max(seen, sim.linkDynasty.plots.length);   // свежая ссылка!
    if (seen >= DYN.PLOT_CAP) break;
  }
  must(seen >= 1, `за 600 дней в неблагополучном роде не созрел ни один заговор`);
  must(seen <= DYN.PLOT_CAP, `потолок заговоров пробит: ${seen}`);
});

t('живых членов рода не больше двенадцати', () => {
  const sim = makeSim();
  familyHouse(sim);
  // Молодая плодовитая пара + девять холостяков: рождения упрутся в потолок.
  const st0 = sim.linkDynasty;
  const mother = st0.members.find(m => m.sex === 'ж');
  mother.age = 2400; mother.kids = 0;
  const father = st0.members.find(m => m.id === mother.pairWith);
  father.age = 2600; father.kids = 0;
  while (st0.members.filter(m => m.alive).length < 11) addM(st0, { age: 2000 });
  let peak = 0;
  for (let i = 0; i < 700; i++) {
    runDay(sim);
    peak = Math.max(peak, sim.linkDynasty.members.filter(m => m.alive).length);
  }
  must(peak <= DYN.MEMBER_CAP, `потолок живых членов пробит: ${peak}`);
  must(peak >= DYN.MEMBER_CAP, `рождений не хватило даже до потолка: ${peak}`);
});

t('на пару не больше четырёх детей', () => {
  const sim = makeSim();
  const st = makeHouse();
  const f = addM(st, { name: 'Отец', age: 3000, status: 'member', traits: [] });
  const m = addM(st, { name: 'Мать', age: 2800, sex: 'ж', status: 'member', traits: [] });
  f.pairWith = m.id; m.pairWith = f.id;
  f.kids = DYN.KIDS_PER_PAIR; m.kids = DYN.KIDS_PER_PAIR;   // лимит пары исчерпан
  sim.linkDynasty = st;
  for (let i = 0; i < 400; i++) runDay(sim);
  must(sim.linkDynasty.members.length === 2, `пара превысила потолок детей: членов стало ${sim.linkDynasty.members.length}`);
});

// ════════════════════════ 8. сохранение ════════════════════════

t('serialize→restore→serialize бит-в-бит на богатом состоянии', () => {
  const sim = new Simulation(4242);
  for (let i = 0; i < 80; i++) { sim.day++; sim.onNewDay(); }
  const snap1 = JSON.stringify(DYN.serializeDynasty(sim));
  const holder = {};
  DYN.restoreDynasty(holder, JSON.parse(snap1));
  const snap2 = JSON.stringify(DYN.serializeDynasty(holder));
  must(snap1 === snap2, 'круг сохранения модуля не бит-в-бит');
});

t('мусорный сейв не роняет модуль', () => {
  const holder = {};
  const empty = DYN.restoreDynasty(holder, null);
  must(Array.isArray(empty.members) && Number.isFinite(empty.legitimacy), 'restore(null) дал невалидное состояние');
  const junk = DYN.restoreDynasty({}, {
    legitimacy: 'сто', court: 99, members: 'нет', pretenders: [null, 5, { support: 9999 }],
    plots: [{ kind: 'неизвестно' }, { kind: 'scandal', days: -4 }],
    house: { generations: -3 }, interregnum: 'да', day: NaN,
  });
  must(junk.court === 3 && junk.legitimacy === DYN.LEGIT_START, `мусорные числа прошли насквозь: court=${junk.court}, legit=${junk.legitimacy}`);
  must(junk.members.length === 0 && junk.plots.length === 1, 'мусорные списки не отфильтрованы');
  must(junk.plots[0].days === 0, 'отрицательный прогресс заговора прошёл');
  must(junk.pretenders.every(p => p.support <= DYN.SUPPORT_MAX), 'поддержка претендента выше потолка');
});

t('круг через настоящую Simulation.serialize/deserialize бит-в-бит', () => {
  const sim = new Simulation(777);
  for (let i = 0; i < 60; i++) { sim.day++; sim.onNewDay(); }
  const snap1 = JSON.stringify(DYN.serializeDynasty(sim));
  const r = Simulation.deserialize(JSON.stringify(sim.serialize()));
  must(r.ok, 'сейв не прочитался');
  const snap2 = JSON.stringify(DYN.serializeDynasty(r.sim));
  must(snap1 === snap2, 'полный круг сейва игры разошёлся по состоянию рода');
});

t('две партии из одного сейва и один поток rng живут одинаково', () => {
  // Богатое состояние берём из настоящего прогона: претенденты, дельта, счётчики.
  const src = new Simulation(4242);
  for (let i = 0; i < 80; i++) { src.day++; src.onNewDay(); }
  const snap = JSON.parse(JSON.stringify(DYN.serializeDynasty(src)));

  const mk = () => {
    const s = makeSim({ gold: 3000 });
    const posBefore = s.rng.getState();
    DYN.restoreDynasty(s, JSON.parse(JSON.stringify(snap)));
    if (s.rng.getState() !== posBefore) throw new Error('restore тратит броски rng — поток разъедется с непрерывной партией');
    return s;
  };
  const a = mk(), b = mk();
  for (let i = 0; i < 30; i++) { runDay(a); runDay(b); }
  const ja = JSON.stringify(DYN.serializeDynasty(a));
  const jb = JSON.stringify(DYN.serializeDynasty(b));
  must(ja === jb, 'два восстановления одного сейва разошлись за 30 дней');
});

// ════════════════════════ 9. настоящий прогон и молчание ════════════════════════

t('300 дней настоящей Simulation без NaN и исключений', () => {
  const sim = new Simulation(4242);
  for (let i = 0; i < 1200; i++) sim.tick(0.25);        // 300 дней, как в test-save-population
  const st = sim.linkDynasty;
  const finite = [
    st.legitimacy, st.house.throneDays, st.interregnumDays, ...st.pretenders.map(p => p.support),
  ].every(Number.isFinite);
  must(finite, 'в состоянии рода появились нечисловые значения');
  must(!JSON.stringify(st).includes('NaN'), 'в состоянии рода серийная NaN');
  const rulerAlive = st.members.find(m => m.alive && m.status === 'ruler');
  if (!st.interregnum && rulerAlive) {
    must(sim.politics.state.ruler.name === rulerAlive.name,
      `рассинхрон правителей: политика ${sim.politics.state.ruler.name}, род ${rulerAlive.name}`);
  }
  console.log(`   день ${sim.day}: дом ${st.house.name}, законность ${Math.round(st.legitimacy)}, живых ${st.members.filter(m => m.alive).length}`);
});

t('спокойный род молчит: событий реже одного в пять дней', () => {
  const sim = makeSim({ happy: 65, gold: 9999 });
  const st = makeHouse();
  const r = addM(st, { name: 'Мирный', age: 5000, status: 'ruler' });
  const s = addM(st, { name: 'Тихая', age: 4800, sex: 'ж', status: 'spouse' });
  r.pairWith = s.id; s.pairWith = r.id;
  addM(st, { name: 'Наследник', age: 2000, traits: ['valiant', 'cunning', 'beloved'] });
  st.legitimacy = 65;
  sim.politics.state.ruler = { name: 'Мирный', age: 50, since: 0, traits: [] };
  sim.linkDynasty = st;
  st.court = 1;
  let evs = 0, reasons = 0;
  for (let i = 0; i < 300; i++) {
    const rep = runDay(sim);
    evs += rep.events.length;
    reasons += rep.reasons.length;
  }
  must(evs <= 60, `спокойный род шумит: ${evs} событий за 300 дней (лимит 1 в 5 дней)`);
  must(reasons <= 60, `спокойный род пишет причины каждый день: ${reasons}`);
  must(sim.linkDynasty.legitimacy > 65, `довольный двор не укрепил род: ${sim.linkDynasty.legitimacy}`);
});

// ════════════════════════ 10. экран ════════════════════════

t('панель рода рендерится строкой HTML с кнопками', () => {
  const sim = new Simulation(4242);
  for (let i = 0; i < 12; i++) { sim.day++; sim.onNewDay(); }
  const html = DYN.renderDynastyPanel(sim);
  must(typeof html === 'string' && html.length > 200, 'панель пуста');
  must(html.includes('Законность'), 'в панели нет полосы законности');
  must(html.includes('data-dyn="court:'), 'в панели нет кнопок содержания двора');
  must(html.includes('data-dyn="usurp"'), 'в панели нет кнопки переворота');
  // Подделка без политики не должна ронять рендер.
  const bare = makeSim();
  familyHouse(bare);
  must(typeof DYN.renderDynastyPanel(bare) === 'string', 'рендер падает на подделке без полного ядра');
});

t('bind панели навешивает обработчики и выполняет действие', () => {
  const sim = makeSim();
  familyHouse(sim);
  const els = [];
  const root = { querySelectorAll: sel => sel === '[data-dyn]' ? els : [] };
  els.push({ dataset: { dyn: 'court:2' }, onclick: null });
  els.push({ dataset: { dyn: 'чепуха:9' }, onclick: null });
  const toasts = [];
  let refreshed = 0;
  const bound = DYN.bindDynastyPanel(root, sim, {
    toast: t => toasts.push(t),
    refresh: () => { refreshed++; },
  });
  must(bound === 2, `привязано кнопок: ${bound}`);
  els[0].onclick();
  must(sim.linkDynasty.court === 2, 'кнопка двора не изменила содержание');
  must(refreshed === 1, 'после действия панель не обновилась');
  els[1].onclick();
  must(toasts.length === 2, 'отказ действия не дошёл до игрока тостом');
});

t('dynastyHappyMod читает отчёт дня из sys.dynLinks', () => {
  const sim = makeSim();
  must(DYN.dynastyHappyMod(sim) === 0, 'без отчёта дня модификатор не ноль');
  sim.sys = { dynLinks: { mods: { happy: -3, stab: 0 } } };
  must(DYN.dynastyHappyMod(sim) === -3, 'модификатор не увидел готовый отчёт');
});

console.log(`\nИтого: ${ok} прошло, ${fail} упало`);
process.exit(fail ? 1 : 0);
