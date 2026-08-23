// Тесты чудес мира (wonders.js).
// Запуск: node app/tests/test-wonders.mjs
//
// Чудо — выбор судьбы на всю партию, поэтому проверяем именно контракт судьбы:
// одно чудо на партию, цена списывается честно, у каждого эффекта потолок,
// разрушение случается РОВНО ОДИН раз, сейв ходит кругом бит-в-бит, а модуль
// не тратит ни одного случайного числа — иначе ломалась бы воспроизводимость.
import { readFileSync } from 'node:fs';
import { ERAS, RES, TILE } from '../src/core/data.js';
import { createRng } from '../src/core/rng.js';
import { tileAt } from '../src/core/world.js';
import { Simulation } from '../src/core/simulation.js';
import { systemsNewDay } from '../src/core/systems/integrate.js';
import {
  WONDERS, WONDERS_PER_RUN, DESTROY_MAX,
  STOYAN_FOOD_DAY, STOYAN_FOOD_CAP,
  KURGAN_LEGIT_RATE, KURGAN_LEGIT_CAP,
  WALL_DEF_BONUS, WALL_DEF_CAP,
  TRACT_GOLD_MULT, TRACT_MULT_CAP,
  ACADEMY_KNOW_MULT, ACADEMY_MULT_CAP,
  HARBOR_GOLD_PER_TILE, HARBOR_GOLD_CAP, HARBOR_RADIUS,
  createWonders, canStartWonder, startWonder,
  wondersNewDay, wonderReport, wonderGlobalMult, wonderDefense,
  serializeWonders, restoreWonders, effectText,
} from '../src/core/systems/wonders.js';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('OK  ', name); } catch (e) { fail++; console.log('FAIL', name, '—', e.message); } };
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const near = (a, b, eps, msg) => ok(Math.abs(a - b) <= eps, `${msg}: ${a} ≠ ${b}`);
const snap = (o) => JSON.stringify(o);

// ─── Подделка sim: ровно те поля, которые модуль имеет право читать ───
// Мира нет (world:null) — гавань обязана честно не приносить ничего, а не падать.
function makeSim(o = {}) {
  const res = { food: 500, wood: 500, stone: 500, steel: 500, gold: 500, knowledge: 5000, ...(o.res || {}) };
  return {
    day: o.day ?? 0,
    eraIndex: o.eraIndex ?? 0,
    seed: o.seed ?? 777,
    rng: createRng(o.seed ?? 777),
    res,
    resCap: o.resCap || { food: 1000, wood: 1000, stone: 1000, steel: 1000, gold: 1000, knowledge: 99999 },
    linkDynasty: { legitimacy: o.legit ?? 55 },
    empire: { state: { lost: (o.lost || []).slice() } },
    world: o.world || null,
    buildings: o.buildings || [],
    payLog: [],
    lackCost(cost) {
      const lack = [];
      for (const [r, v] of Object.entries(cost)) if ((this.res[r] || 0) < v) lack.push(`${r}`);
      return lack.length ? lack.join(',') : null;
    },
    payCost(cost) { for (const [r, v] of Object.entries(cost)) { this.res[r] -= v; this.payLog.push([r, v]); } },
    addLog() {},
    addChronicle() {},
    wonders: createWonders(),
  };
}

// Быстро довести стройку до конца: по дню за вызов, дни идут подряд.
function finishBuild(sim, rng, maxDays = 60) {
  let rep = null;
  for (let d = 1; d <= maxDays; d++) {
    sim.day += 1;
    rep = wondersNewDay(sim, rng);
    if (sim.wonders.done) break;
  }
  return rep;
}

console.log('--- Данные: шесть чудес, одно на эпоху ---');
{
  const list = Object.values(WONDERS);
  t('чудес ровно шесть — по числу выбранных эпох', () => ok(list.length === 6, `сейчас ${list.length}`));
  t('идентификаторы уникальны', () => ok(new Set(list.map(w => w.id)).size === 6, snap(list.map(w => w.id))));
  t('русские имена уникальны и непусты', () => {
    ok(new Set(list.map(w => w.ru)).size === 6, 'имена повторяются');
    ok(list.every(w => typeof w.ru === 'string' && w.ru.length > 2), 'пустое имя');
  });
  t('эпохи не повторяются и лежат внутри ERAS — ровно одна карта «эпоха → чудо»', () => {
    const eras = list.map(w => w.era);
    ok(new Set(eras).size === 6, `эпохи повторяются: ${eras.join(',')}`);
    ok(eras.every(e => Number.isInteger(e) && e >= 0 && e < ERAS.length), `эпоха вне ERAS: ${eras.join(',')}`);
  });
  t('иконка, описание и цена заполнены у каждого', () => {
    for (const w of list) {
      ok(typeof w.icon === 'string' && w.icon.length > 0, `${w.id}: нет иконки`);
      ok(typeof w.text === 'string' && w.text.length > 20, `${w.id}: пустой текст`);
      ok(w.cost && Object.keys(w.cost).length > 0, `${w.id}: чудо без цены`);
      ok(Number.isInteger(w.days) && w.days > 0, `${w.id}: срок стройки ${w.days}`);
    }
  });
  t('цена названа только известными ресурсами и положительна', () => {
    const ids = new Set(RES.map(r => r.id));
    for (const w of list) {
      for (const [rid, v] of Object.entries(w.cost)) {
        ok(ids.has(rid), `${w.id}: неизвестный ресурс ${rid}`);
        ok(v > 0, `${w.id}: цена ${rid} = ${v}`);
      }
    }
  });
  t('у каждого эффекта есть потолок, и потолок не меньше ставки', () => {
    for (const w of list) {
      const e = w.effect;
      ok(e && Number.isFinite(e.cap) && e.cap > 0, `${w.id}: нет потолка`);
      const rate = e.perDay ?? e.rate ?? e.bonus ?? e.mult ?? e.perTile;
      ok(rate > 0, `${w.id}: нет ставки эффекта`);
      ok(e.cap >= rate, `${w.id}: потолок ${e.cap} ниже ставки ${rate}`);
    }
  });
  t('эффект словами называет предел: игрок обязан видеть потолок', () => {
    for (const w of list) {
      const s = effectText(w);
      ok(/потолок|до /.test(s), `${w.id}: ${s}`);
    }
  });
}

console.log('\n--- Цена: старт списывает ровно цену и только раз ---');
{
  const sim = makeSim({ eraIndex: 0 });
  t('неизвестное чудо объясняется словами', () => {
    const c = canStartWonder(sim, 'вавилонская_башня');
    ok(c.ok === false && c.reason.length > 5, snap(c));
  });
  t('чужая эпоха закрыта, и названа по имени', () => {
    const c = canStartWonder(makeSim({ eraIndex: 0 }), 'star_academy');
    ok(c.ok === false && /Средневековье/.test(c.reason), snap(c.reason));
  });
  t('без денег отказа не миновать', () => {
    const poor = makeSim({ eraIndex: 0, res: { wood: 10 } });
    const c = canStartWonder(poor, 'great_camp');
    ok(c.ok === false && /Не хватает/.test(c.reason), snap(c.reason));
  });
  t('удачный старт списывает ровно цену', () => {
    const s = makeSim({ eraIndex: 0 });
    const r = startWonder(s, 'great_camp');
    ok(r.ok === true && r.days === WONDERS.great_camp.days, snap(r));
    const paid = {};
    for (const [rid, v] of s.payLog) paid[rid] = (paid[rid] || 0) + v;
    ok(snap(paid) === snap(WONDERS.great_camp.cost), `${snap(paid)} vs ${snap(WONDERS.great_camp.cost)}`);
  });
  t('второго чуда в партии не будет — ни того же, ни другого', () => {
    const s = makeSim({ eraIndex: 0 });
    ok(startWonder(s, 'great_camp').ok === true, 'первый старт сорвался');
    const again = startWonder(s, 'great_camp');
    const other = startWonder(s, 'kurgan');
    ok(again.ok === false && /уже строится/.test(again.reason), snap(again));
    ok(other.ok === false && /уже было/.test(other.reason), snap(other));
    ok(s.payLog.length === 1, 'за отказы платили дважды');
  });
  t('константа партии: одно чудо, одно разрушение', () =>
    ok(WONDERS_PER_RUN === 1 && DESTROY_MAX === 1, `${WONDERS_PER_RUN}/${DESTROY_MAX}`));
}

console.log('\n--- Потолок эффекта: Большой Стоян (еда) ---');
{
  const rng = createRng(101);
  t('в день даёт ставку, но не больше ставки и не больше потолка', () => {
    const s = makeSim({ eraIndex: 0, resCap: { food: 99999 } });
    startWonder(s, 'great_camp');
    finishBuild(s, rng);
    const rep = (() => { s.day += 1; return wondersNewDay(s, rng); })();
    const g = rep.mods.res.food || 0;
    ok(g <= STOYAN_FOOD_DAY + 1e-9 && g <= STOYAN_FOOD_CAP, `дача ${g}`);
  });
  t('полный амбар глушит дачу, и причина сказана словами', () => {
    const s = makeSim({ eraIndex: 0, res: { food: 900 }, resCap: { food: 900 } });
    startWonder(s, 'great_camp');
    finishBuild(s, rng);
    s.day += 1;
    const rep = wondersNewDay(s, rng);
    ok(!(rep.mods.res.food > 0), `из полного амбара натекло ${rep.mods.res.food}`);
    ok(rep.reasons.some(r => /полон/.test(r)), snap(rep.reasons));
  });
  t('тесный амбар режет дачу до свободного места', () => {
    const s = makeSim({ eraIndex: 0, res: { food: 998 }, resCap: { food: 999 } });
    startWonder(s, 'great_camp');
    finishBuild(s, rng);
    s.day += 1;
    const rep = wondersNewDay(s, rng);
    near(rep.mods.res.food || 0, 1, 1e-9, 'дача при амбаре на 1');
  });
  t('долгая игра не пробивает суточный потолок', () => {
    const s = makeSim({ eraIndex: 0, resCap: { food: 99999 } });
    startWonder(s, 'great_camp');
    for (let d = 1; d <= 90; d++) {
      s.day += 1;
      const rep = wondersNewDay(s, rng);
      ok((rep.mods.res.food || 0) <= STOYAN_FOOD_CAP + 1e-9, `день ${d}: ${(rep.mods.res.food) || 0}`);
      s.res.food += rep.mods.res.food || 0;
    }
  });
}

console.log('\n--- Потолок эффекта: Курган Предков (законность) ---');
{
  const rng = createRng(102);
  t('суточная прибавка не выше ставки и ведёт к отметке ниже тронного капа', () => {
    const s = makeSim({ eraIndex: 1, legit: 55 });
    startWonder(s, 'kurgan');
    finishBuild(s, rng);
    s.day += 1;
    const rep = wondersNewDay(s, rng);
    ok(rep.mods.legit > 0 && rep.mods.legit <= KURGAN_LEGIT_RATE + 1e-9, `прибавка ${rep.mods.legit}`);
    ok(KURGAN_LEGIT_CAP < 81, 'курган обязан остаться ниже LEGIT_THRONE_CAP ядра');
  });
  t('род утвердился — курган молчит и объясняется', () => {
    const s = makeSim({ eraIndex: 1, legit: KURGAN_LEGIT_CAP });
    startWonder(s, 'kurgan');
    finishBuild(s, rng);
    s.day += 1;
    const rep = wondersNewDay(s, rng);
    ok((rep.mods.legit || 0) === 0, `натекло ${rep.mods.legit}`);
    ok(rep.reasons.some(r => /утвердился/.test(r)), snap(rep.reasons));
  });
  t('400 дней кургана не поднимают законность выше потолка', () => {
    const s = makeSim({ eraIndex: 1, legit: 55 });
    startWonder(s, 'kurgan');
    finishBuild(s, rng);
    for (let d = 0; d < 400; d++) {
      s.day += 1;
      const rep = wondersNewDay(s, rng);
      s.linkDynasty.legitimacy = Math.min(100, s.linkDynasty.legitimacy + (rep.mods.legit || 0));
      ok(s.linkDynasty.legitimacy <= KURGAN_LEGIT_CAP + 1e-9, `день ${s.day}: ${s.linkDynasty.legitimacy}`);
    }
  });
}

console.log('\n--- Потолок эффекта: Стена Столетий (оборона) ---');
{
  const rng = createRng(103);
  t('чудо стоит — оборона получает прибавку, но не выше потолка', () => {
    const s = makeSim({ eraIndex: 2 });
    startWonder(s, 'wall_centuries');
    finishBuild(s, rng);
    const d = wonderDefense(s);
    ok(d === Math.min(WALL_DEF_BONUS, WALL_DEF_CAP), `оборона ${d}`);
    ok(d <= WALL_DEF_CAP, `${d} > ${WALL_DEF_CAP}`);
  });
  t('без чуда множители и оборона нейтральны', () => {
    const s = makeSim({ eraIndex: 2 });
    ok(wonderDefense(s) === 0, 'оборона из ниоткуда');
    ok(wonderGlobalMult(s, 'gold') === 1 && wonderGlobalMult(s, 'knowledge') === 1, 'множитель из ниоткуда');
  });
}

console.log('\n--- Потолок эффекта: Тракт и Академия (множители) ---');
{
  const rng = createRng(104);
  t('Тракт усиливает только золото и в рамках потолка', () => {
    const s = makeSim({ eraIndex: 3 });
    startWonder(s, 'great_tract');
    finishBuild(s, rng);
    ok(wonderGlobalMult(s, 'gold') === Math.min(TRACT_GOLD_MULT, TRACT_MULT_CAP), `${wonderGlobalMult(s, 'gold')}`);
    ok(wonderGlobalMult(s, 'wood') === 1 && wonderGlobalMult(s, 'knowledge') === 1, 'множитель полез на чужие ресурсы');
  });
  t('Академия усиливает только науку', () => {
    const s = makeSim({ eraIndex: 4 });
    startWonder(s, 'star_academy');
    finishBuild(s, rng);
    ok(wonderGlobalMult(s, 'knowledge') === Math.min(ACADEMY_KNOW_MULT, ACADEMY_MULT_CAP), `${wonderGlobalMult(s, 'knowledge')}`);
    ok(wonderGlobalMult(s, 'gold') === 1, 'золото от Академии');
  });
  t('кламп последней линии: данные жирнее потолка обрезаются', () => {
    const s = makeSim({ eraIndex: 3 });
    const keep = WONDERS.great_tract.effect.mult;
    WONDERS.great_tract.effect.mult = 99;   // правим данные, чтобы дотянуться до клампа в коде
    try {
      Object.assign(s.wonders, { builtId: 'great_tract', progress: 9, buildDays: 9, done: true });
      ok(wonderGlobalMult(s, 'gold') === TRACT_MULT_CAP, `${wonderGlobalMult(s, 'gold')}`);
    } finally { WONDERS.great_tract.effect.mult = keep; }
  });
  t('разрушенное чудо множитель теряет', () => {
    const s = makeSim({ eraIndex: 3 });
    startWonder(s, 'great_tract');
    finishBuild(s, rng);
    s.wonders.destroyed = true;
    ok(wonderGlobalMult(s, 'gold') === 1, 'руины продолжают торговать');
  });
}

console.log('\n--- Потолок эффекта: Чудо-Гавань (золото с воды) ---');
{
  const rng = createRng(105);
  const seaWorld = (tilesFn, w = 64, h = 64) => ({
    w, h, startX: 32, startY: 32,
    tiles: Array.from({ length: w * h }, (_, i) => tilesFn(i % w, Math.floor(i / w))),
  });
  t('без мира гавань не падает и не платит', () => {
    const s = makeSim({ eraIndex: 5 });
    startWonder(s, 'miracle_harbor');
    finishBuild(s, rng);
    s.day += 1;
    const rep = wondersNewDay(s, rng);
    ok((rep.mods.res.gold || 0) === 0, `из ничего натекло ${rep.mods.res.gold}`);
  });
  t('океан вокруг: платёж упирается ровно в потолок моря', () => {
    const w = seaWorld(() => TILE.WATER);
    const s = makeSim({ eraIndex: 5, world: w, buildings: [{ id: 'campfire', x: 32, y: 32 }] });
    startWonder(s, 'miracle_harbor');
    finishBuild(s, rng);
    s.day += 1;
    const rep = wondersNewDay(s, rng);
    near(rep.mods.res.gold || 0, HARBOR_GOLD_CAP, 1e-9, 'дача океана');
    ok(rep.reasons.some(r => /предел/.test(r)), snap(rep.reasons));
  });
  t('три водные клетки платят ровно по тарифу, пока не достали до потолка', () => {
    // Вода только восточнее дома (dx 1..3): ровно три клетки внутри круга радиуса.
    const w = seaWorld((x, y) => ((x - 32 >= 1 && x - 32 <= 3 && y === 32) ? TILE.WATER : TILE.GRASS));
    const s = makeSim({ eraIndex: 5, world: w, buildings: [{ id: 'campfire', x: 32, y: 32 }] });
    startWonder(s, 'miracle_harbor');
    finishBuild(s, rng);
    s.day += 1;
    const rep = wondersNewDay(s, rng);
    near(rep.mods.res.gold || 0, Math.min(HARBOR_GOLD_CAP, 3 * HARBOR_GOLD_PER_TILE), 1e-9, 'тариф с трёх клеток');
  });
  t('радиус обхода конечен: даже у океана счёт клеток не выходит за радиус чуда', () => {
    // Косвенная проверка: если бы радиус рос без bound, тариф бы превысил потолок —
    // а он уже прижат. Здесь ловим обратное: маленький радиус данных уважается.
    ok(HARBOR_RADIUS > 0 && HARBOR_RADIUS <= 8, `радиус ${HARBOR_RADIUS}`);
  });
}

console.log('\n--- Разрушение: ровно один раз за партию ---');
{
  const rng = createRng(106);
  const s = makeSim({ eraIndex: 2 });
  startWonder(s, 'wall_centuries');
  const doneRep = finishBuild(s, rng);
  t('завершение стройки — событие для летописи, а не тихая галочка', () => {
    ok(s.wonders.done === true, 'стройка не завершилась за срок');
    ok(doneRep.flags.completed === true, 'нет флага завершения');
    ok(doneRep.events.some(e => e.chronicle === true && /возведено/.test(e.text)), snap(doneRep.events));
    ok(Number.isFinite(s.wonders.builtDay), 'день завершения не записан');
  });

  s.day += 1;
  s.empire.state.lost.push({ name: 'Пригород', day: s.day, pop: 12 });
  const kill = wondersNewDay(s, rng);
  t('взятие поселения разрушает стоящее чудо', () => {
    ok(kill.flags.destroyedNow === true, 'флага гибели нет');
    ok(s.wonders.destroyed === true && s.wonders.destroyedCount === 1, snap({ d: s.wonders.destroyed, n: s.wonders.destroyedCount }));
    ok(kill.events.some(e => e.chronicle === true && /разрушено/.test(e.text)), snap(kill.events));
    ok(Number.isFinite(s.wonders.destroyedDay), 'день гибели не записан');
  });
  t('в день гибели эффект теряется сразу', () => {
    ok(kill.flags.active === false, 'руины работают');
    ok(wonderDefense(s) === 0, 'стены руин держат оборону');
  });

  let extraEvents = 0, extraFlags = 0;
  for (let k = 0; k < 3; k++) {
    s.day += 1;
    s.empire.state.lost.push({ name: 'Пригород', day: s.day, pop: 5 });
    const rep = wondersNewDay(s, rng);
    extraFlags += rep.flags.destroyedNow ? 1 : 0;
    extraEvents += rep.events.filter(e => /разрушено/.test(e.text)).length;
  }
  t('повторные взятия больше ничего не разрушают — счётчик прижат к DESTROY_MAX', () => {
    ok(s.wonders.destroyedCount === DESTROY_MAX, `счётчик ${s.wonders.destroyedCount}`);
    ok(extraFlags === 0 && extraEvents === 0, `лишних вестей: ${extraFlags}/${extraEvents}`);
  });
  t('летописных событий о чуде ровно два: возведение и гибель', () => {
    // Собираем все события всех тиков заново на чистом прогоне — так видно всю жизнь чуда.
    const s2 = makeSim({ eraIndex: 2 });
    startWonder(s2, 'wall_centuries');
    const rng2 = createRng(106);
    const seen = [];
    for (let d = 1; d <= 25; d++) {
      s2.day += 1;
      if (d === 20) s2.empire.state.lost.push({ name: 'Град', day: s2.day, pop: 9 });
      seen.push(...wondersNewDay(s2, rng2).events.filter(e => e.chronicle === true));
    }
    ok(seen.length === 2, `событий ${seen.length}: ${snap(seen.map(e => e.text))}`);
  });
}

console.log('\n--- Один день считается один раз ---');
{
  const rng = createRng(107);
  const s = makeSim({ eraIndex: 0 });
  startWonder(s, 'great_camp');
  s.day += 1;
  const first = wondersNewDay(s, rng);
  const before = snap(serializeWonders(s.wonders));
  const second = wondersNewDay(s, rng);
  t('второй тик тех же суток молчит', () => {
    ok(second.events.length === 0 && second.reasons.length === 0, snap(second));
  });
  t('и состояние не двигает', () => ok(snap(serializeWonders(s.wonders)) === before, 'состояние уехало'));
  t('следующие сутки считаются нормально', () => {
    s.day += 1;
    wondersNewDay(s, rng);
    ok(s.wonders.progress === 2, snap(s.wonders.progress));
  });
}

console.log('\n--- Отчёт для HUD ---');
{
  t('без выбора: каталог полн, статус честный', () => {
    const p = wonderReport(makeSim({ eraIndex: 0 }));
    ok(p.statusWord === 'Не выбрано', p.statusWord);
    ok(p.catalog.length === 6, `карточек ${p.catalog.length}`);
    ok(p.has === false, 'has должен быть ложью');
  });
  t('доступность карточек определяется эпохой партии', () => {
    const p = wonderReport(makeSim({ eraIndex: 3 }));
    const avail = p.catalog.filter(c => c.available).map(c => c.id);
    ok(snap(avail) === snap(['great_camp', 'kurgan', 'wall_centuries', 'great_tract']), snap(avail));
  });
  t('выбранное и строящееся: прогресс и остаток дней', () => {
    const s = makeSim({ eraIndex: 0 });
    startWonder(s, 'great_camp');
    s.day += 1; wondersNewDay(s, createRng(1)); s.day += 1; wondersNewDay(s, createRng(1));
    const p = wonderReport(s);
    ok(p.has === true && p.statusWord === 'Строится', snap(p.statusWord));
    ok(p.progress === 2 && p.buildDays === WONDERS.great_camp.days, snap({ p: p.progress, b: p.buildDays }));
    ok(p.daysLeft === p.buildDays - p.progress, snap(p.daysLeft));
    ok(p.catalog.find(c => c.id === 'great_camp').chosen === true, 'выбор не подсвечен');
  });
  t('стоит / разрушено — слова статуса для панели', () => {
    const s = makeSim({ eraIndex: 0 });
    startWonder(s, 'great_camp');
    finishBuild(s, createRng(108));
    ok(wonderReport(s).statusWord === 'Стоит', snap(wonderReport(s).statusWord));
    s.wonders.destroyed = true; s.wonders.destroyedDay = s.day;
    const dead = wonderReport(s);
    ok(dead.statusWord === 'Разрушено' && /навсегда/.test(dead.hint), snap(dead.hint));
  });
}

console.log('\n--- Сохранение: круг бит-в-бит ---');
{
  const roundtrip = (st) => restoreWonders(JSON.parse(JSON.stringify(serializeWonders(st))));
  const rng = createRng(109);
  const states = [];
  const a = makeSim({ eraIndex: 0 }); startWonder(a, 'great_camp'); a.day += 1; wondersNewDay(a, rng);
  states.push(a.wonders);                                        // середина стройки
  const b = makeSim({ eraIndex: 0 }); startWonder(b, 'great_camp'); finishBuild(b, rng);
  states.push(b.wonders);                                        // стоит
  const c = makeSim({ eraIndex: 2 }); startWonder(c, 'wall_centuries'); finishBuild(c, rng);
  c.day += 1; c.empire.state.lost.push({ name: 'Г', day: c.day, pop: 1 }); wondersNewDay(c, rng);
  states.push(c.wonders);                                        // разрушено
  t('все три жизненных состояния ходят кругом без расхождения', () => {
    for (const st of states) ok(snap(serializeWonders(st)) === snap(serializeWonders(roundtrip(st))), snap(serializeWonders(st)));
  });
  t('после загрузки история продолжается одинаково', () => {
    // Снимки ДО тиков: wondersNewDay мутирует переданное состояние, и сравнивать
    // нужно исходные слепки, а не состояния после того, как один из них уже пожил.
    const st = states[1];
    const back = roundtrip(st);
    const before1 = snap(serializeWonders(st)), before2 = snap(serializeWonders(back));
    ok(before1 === before2, 'состояния разъехались ещё до тика');
    const r1 = wondersNewDay({ ...makeSim({ eraIndex: 0 }), wonders: st, day: st.day + 1 }, createRng(110));
    const r2 = wondersNewDay({ ...makeSim({ eraIndex: 0 }), wonders: back, day: st.day + 1 }, createRng(110));
    ok(snap({ m: r1.mods, f: r1.flags }) === snap({ m: r2.mods, f: r2.flags }), 'после загрузки день разъехался');
  });
  t('мусор на входе даёт чистое состояние', () => {
    for (const junk of [null, undefined, 'строка', 42]) {
      const s = restoreWonders(junk);
      ok(s.builtId === null && s.day === -1 && s.progress === 0 && s.done === false, snap(snap(junk)));
    }
  });
  t('чужой id из будущего сейва отбрасывается, а не роняет игру', () => {
    const s = restoreWonders({ v: 1, builtId: 'колосс_с_марса', progress: 5, buildDays: 10, done: true });
    ok(s.builtId === null && s.done === true, snap(s));
  });
  t('перекрученный счётчик разрушений из битого сейва прижимается к потолку', () => {
    const s = restoreWonders({ builtId: 'wall_centuries', destroyed: true, destroyedCount: 7 });
    ok(s.destroyedCount === DESTROY_MAX, snap(s.destroyedCount));
  });

  // Живая партия: чудо проходит через полный serialize/deserialize симуляции.
  const sim = new Simulation(4242);
  Object.assign(sim.res, { wood: 9999, stone: 9999, gold: 9999, steel: 9999, knowledge: 99999 });
  const started = startWonder(sim, 'great_camp');
  t('чудо закладывается в настоящей партии', () => ok(started.ok === true, snap(started)));
  for (let d = 0; d < 14; d++) { sim.day += 1; systemsNewDay(sim); }
  t('ядро применяет отчёт чудес: стройка идёт сама', () => {
    ok(sim.wonders.builtId === 'great_camp' && sim.wonders.progress >= 10, snap({ pr: sim.wonders.progress, id: sim.wonders.builtId }));
  });
  const s1 = JSON.stringify(sim.serialize());
  const back = Simulation.deserialize(s1);
  t('полный сейв партии читается обратно', () => ok(back.ok === true, snap(back.ok)));
  const s2 = JSON.stringify(back.sim.serialize());
  t('круг serialize→deserialize→serialize бит-в-бит', () => ok(s1 === s2, 'сейв разъехался'));
  t('чудо в сейве ядра — ровно тот слепок, что отдаёт модуль', () => {
    ok(snap(JSON.parse(s1).wonders) === snap(serializeWonders(sim.wonders)), 'поле wonders записано чужим форматом');
  });
  t('после загрузки чудо совпадает с оригиналом побитово', () => {
    // Продолжение всей партии после загрузки — семантика ядра (жители сбрасываются
    // в idле намеренно) и территория e2e-save. Здесь проверяем только СВОЁ поле.
    ok(snap(serializeWonders(back.sim.wonders)) === snap(serializeWonders(sim.wonders)), 'чудо после загрузки иное');
  });
}

console.log('\n--- Детерминизм: ни одного случайного числа ---');
{
  const run = (seed) => {
    const s = makeSim({ eraIndex: 0, seed });
    const rng = createRng(seed);
    startWonder(s, 'great_camp');
    for (let d = 1; d <= 30; d++) {
      s.day += 1;
      const rep = wondersNewDay(s, rng);
      s.res.food += rep.mods.res.food || 0;
      s.linkDynasty.legitimacy += rep.mods.legit || 0;
    }
    return { st: snap(serializeWonders(s.wonders)), food: Math.round(s.res.food * 1000) };
  };
  t('два прогона одного сида совпадают до третьего знака', () => {
    const x = run(20260823), y = run(20260823);
    ok(x.st === y.st && x.food === y.food, snap([x, y]));
  });
  t('кубики не расходуются: getState() до и после тридцатидневного прогона тот же', () => {
    const rng = createRng(555);
    const beforeState = rng.getState();
    const s = makeSim({ eraIndex: 0 });
    startWonder(s, 'great_camp');
    for (let d = 1; d <= 30; d++) { s.day += 1; wondersNewDay(s, rng); }
    ok(rng.getState() === beforeState, `поток сдвинулся: ${beforeState} → ${rng.getState()}`);
  });
  t('сигнатура совместима: wondersNewDay терпит чужой rng и не зовёт его', () => {
    const s = makeSim({ eraIndex: 0 });
    startWonder(s, 'great_camp');
    s.day += 1;
    const rep = wondersNewDay(s, undefined);   // намеренно без rng
    ok(rep && Array.isArray(rep.events), 'без rng модуль падает');
  });
}

console.log('\n--- Причины для журнала: интегратор фильтрует их одним словарём ---');
{
  // integrate.js пишет в журнал только особые причины по регулярному выражению.
  // Если формулировка в модуле уйдёт от словаря — причина пропадёт из журнала тихо.
  const dict = /руин|предел|полон|утвердился/;
  const rng = createRng(111);
  const specials = [];
  const probe = (id, era, o = {}) => {
    const s = makeSim({ eraIndex: era, ...o });
    startWonder(s, id);
    finishBuild(s, createRng(112));
    for (let d = 0; d < 3; d++) { s.day += 1; specials.push(...wondersNewDay(s, rng).reasons); }
  };
  probe('great_camp', 0, { res: { food: 1000 }, resCap: { food: 1000 } });   // «амбар полон»
  probe('kurgan', 1, { legit: KURGAN_LEGIT_CAP });                            // «утвердился»
  probe('miracle_harbor', 5, { world: seaWorldAllWater(), buildings: [{ id: 'campfire', x: 32, y: 32 }] }); // «предел»
  t('особые причины попадают в словарь интегратора', () => {
    ok(specials.some(r => dict.test(r)), `ни одна причина не прошла словарь: ${snap(specials)}`);
  });
  t('обычные причины (ход стройки) в журнал не лезут — они для панели', () => {
    const s = makeSim({ eraIndex: 0 });
    startWonder(s, 'great_camp');
    s.day += 1;
    const rep = wondersNewDay(s, rng);
    ok(rep.reasons.every(r => !dict.test(r)) && rep.reasons.length > 0, snap(rep.reasons));
  });
}
function seaWorldAllWater() {
  const w = 64, h = 64;
  return { w, h, startX: 32, startY: 32, tiles: new Array(w * h).fill(TILE.WATER) };
}

console.log('\n--- Гигиена файла ---');
{
  const src = readFileSync(new URL('../src/core/systems/wonders.js', import.meta.url), 'utf8');
  t('Math.random в модуле не вызывается (иначе ломались бы сейвы)', () =>
    ok(!/Math\.random\s*\(/.test(src), 'найден вызов Math.random'));
  t('ядро не знает про экран: ни document, ни window', () =>
    ok(!/\b(document|window|canvas)\b/.test(src), 'DOM в ядре'));
  t('экспортирован весь публичный контракт', () => {
    for (const name of ['WONDERS', 'wondersNewDay', 'wonderReport', 'serializeWonders', 'restoreWonders']) {
      ok(new RegExp(`export\\s+(function\\s+${name}|const\\s+${name})`).test(src), `нет экспорта ${name}`);
    }
  });
}

console.log(`\n=== ${pass} OK / ${fail} FAIL ===`);
if (fail) process.exit(1);
