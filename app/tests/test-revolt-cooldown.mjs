// Тесты кулдауна летописи о восстаниях (wire_politics.js).
// Запуск: node app/tests/test-revolt-cooldown.mjs
//
// ЗАЧЕМ. Живой прогон показал: «Восстание» — 26–32% ВСЕХ записей летописи,
// потому что wire_politics пишет событие при каждом e.revolt. Летопись хранит
// СОБЫТИЯ («сегодня началось X»), а не повторяющееся состояние: одна и та же
// причина восстания честна для записи не чаще раза в REVOLT_CHRONICLE_CD дней.
// ПЕРВОЕ восстание и СМЕНА причины пишутся всегда; сам бунт (грабёж складов,
// toast, счётчик revolts) не глушится — глушится только строка в летописи.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRng } from '../src/core/rng.js';
import { Simulation } from '../src/core/simulation.js';
import { TURMOIL_DAYS } from '../src/core/systems/politics.js';
import {
  REVOLT_CHRONICLE_CD,
  installPolitics, politicsNewDay, politicsSerialize, politicsRestore,
  renderPoliticsPanel,
} from '../src/core/systems/wire_politics.js';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('OK', name); } catch (e) { fail++; console.log('FAIL', name, '—', e.message); } };
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };

const REVOLT_RE = /^Восстание/;
const share = (num_, den) => den > 0 ? num_ / den : 1;

// Поддельный sim: ровно те поля, что читает wire_politics, без DOM.
function fakeSim(seed, over = {}) {
  const sim = {
    rng: createRng(seed),
    day: 1000, eraIndex: 3, eraDay: 5,
    villagers: new Array(24), housingCap: () => 40, _happy: 50,
    res: { food: 900, gold: 600 }, buildings: [], techs: new Set(),
    wars: [], repelled: 0, army: { soldiers: 6 }, spire: { stage: 1 },
    pendingLaw: null, pendingEvent: null,
    toast: () => {}, sfx: () => {}, fireEvent: () => {}, adjustRel: () => {},
    logs: [], chronicle: [],
    addLog(text, type) { this.logs.push({ text, type }); },
    addChronicle(text) { this.chronicle.push({ day: this.day, text }); },
  };
  Object.assign(sim, over);
  installPolitics(sim);
  return sim;
}

const revoltLines = (sim) => sim.chronicle.filter(c => REVOLT_RE.test(c.text));

// Готовим бунт на ближайший вызов politicsNewDay. Стабильность чуть ниже нуля:
// клампа в dailyPolitics вернёт её ровно в 0 даже при плюсовом дрейфе, значит
// восстание случится детерминированно при любом контексте. revoltCd сброшен,
// чтобы проверять именно запись в летопись, а не родной кулдаун politics.js.
function armRevolt(sim) {
  const st = sim.politics.state;
  st.stability = -5;
  st.revoltCd = 0;
}

// Все сословия спокойны, мира нет, смуты нет — причина бунта «base».
function calmContext(sim) {
  sim._happy = 50;
  sim.wars = [];
  const st = sim.politics.state;
  st.turmoil = 0;
  for (const fid of Object.keys(st.factions)) st.factions[fid] = 55;
}

console.log('--- Живой прогон ядра: доля записей «Восстание» в летописи ---');
{
  const SEED = 4242, DAYS = 900;
  const sim = new Simulation(SEED, { startEra: 2 });
  for (let d = 0; d < DAYS; d++) {
    // Худший случай из багрепорта: недовольство держится постоянно, стабильность
    // каждый день у нуля — восстание гаснет только о родной кулдаун события.
    const st = sim.politics.state;
    st.stability = Math.min(st.stability, 0);
    sim.tick(1);
  }
  const revolts = revoltLines(sim).length;
  const total = sim.chronicle.length;
  const frac = share(revolts, total);
  console.log(`    замер: восстаний-событий=${sim.politics.state.revolts}, строк «Восстание»=${revolts}, всего записей=${total}, доля=${(frac * 100).toFixed(1)}%`);
  // Гейты валидности сценария сняты с живого замера (сид 4242): если ядро
  // изменится так, что бунтов или фона станет меньше, доля потеряет смысл —
  // тест обязан об этом сказать, а не рапортовать зелёный на пустоте.
  t('сценарий состоялся: бунты были и летопись не пустая', () => {
    ok(sim.politics.state.revolts >= 6, `бунтов слишком мало: ${sim.politics.state.revolts}`);
    ok(total >= 40, `летопись слишком бедна для доли: ${total}`);
  });
  // Порог 20% выбран по замерам, а не с потолка: при постоянном восстании
  // события идут раз в ~60 дней (родной REVOLT_COOLDOWN), и честный кулдаун
  // записи «раз в K=90 на причину» физически не может утопить долю ниже ~13%
  // (сид 4242: 25.6% → 13.6%, сид 11: 26.1% → 15.5%). 20% бьёт по спаму
  // багрепорта с запасом и не превращает починку в натяжку.
  t(`доля записей «Восстание» ниже 20% (в багрепорте было 26–32%)`, () => {
    ok(frac <= 0.20, `доля ${(frac * 100).toFixed(1)}% > 20%`);
  });
}

console.log('\n--- Первое восстание пишется всегда ---');
t('первый бунт попадает в летопись', () => {
  const sim = fakeSim(11);
  calmContext(sim);
  armRevolt(sim);
  politicsNewDay(sim);
  ok(revoltLines(sim).length === 1, `записей ${revoltLines(sim).length}`);
});

console.log('\n--- Одна причина молчит REVOLT_CHRONICLE_CD дней ---');
t('повторный бунт той же причины не пишет вторую запись', () => {
  const sim = fakeSim(21);
  calmContext(sim);
  armRevolt(sim);
  politicsNewDay(sim);                       // запись №1
  sim.day += 30;                             // всё ещё далеко до кулдауна
  calmContext(sim);
  armRevolt(sim);
  politicsNewDay(sim);                       // событие есть, записи нет
  ok(sim.politics.state.revolts === 2, 'само восстание не произошло — глушится только строка');
  ok(revoltLines(sim).length === 1, `записей ${revoltLines(sim).length}, ждали 1`);
});
t('спустя REVOLT_CHRONICLE_CD дней та же причина пишет снова', () => {
  const sim = fakeSim(22);
  calmContext(sim);
  armRevolt(sim);
  politicsNewDay(sim);                       // запись №1, день D
  const firstDay = revoltLines(sim)[0].day;
  sim.day += REVOLT_CHRONICLE_CD - 1;
  calmContext(sim); armRevolt(sim); politicsNewDay(sim);   // за день до срока — молчим
  ok(revoltLines(sim).length === 1, `за день до срока записей ${revoltLines(sim).length}`);
  sim.day += 1;
  calmContext(sim); armRevolt(sim); politicsNewDay(sim);   // срок вышел — пишем
  ok(revoltLines(sim).length === 2, `после срока записей ${revoltLines(sim).length}`);
  ok(revoltLines(sim)[1].day - firstDay >= REVOLT_CHRONICLE_CD, 'промежуток меньше кулдауна');
});

console.log('\n--- Смена причины пробивает кулдаун ---');
t('новая причина пишется сразу, прежняя продолжает молчать', () => {
  const sim = fakeSim(31);
  // Причина №1: война.
  sim.wars = [{ fid: 'orda' }];
  armRevolt(sim);
  politicsNewDay(sim);
  ok(revoltLines(sim).length === 1, 'первое восстание не записано');
  // Через 10 дней (< кулдауна) причина другая: мир, народ несчастен, сословия злы.
  sim.day += 10;
  sim.wars = [];
  sim._happy = 10;
  const st = sim.politics.state;
  for (const fid of Object.keys(st.factions)) st.factions[fid] = 10;
  armRevolt(sim);
  politicsNewDay(sim);
  ok(sim.politics.state.revolts === 2, 'событие не случилось');
  ok(revoltLines(sim).length === 2, `смена причины не пробила кулдаун: записей ${revoltLines(sim).length}`);
  // И тут же третья, тоже новая: смута при мире и спокойных сословиях.
  sim.day += 5;
  sim.wars = [];
  sim._happy = 50;
  for (const fid of Object.keys(st.factions)) st.factions[fid] = 55;
  st.turmoil = TURMOIL_DAYS;
  armRevolt(sim);
  politicsNewDay(sim);
  ok(revoltLines(sim).length === 3, `третья причина не записана: ${revoltLines(sim).length}`);
});

console.log('\n--- Состояние видно в панелях, счёт событий не глушится ---');
t('подавленная запись не прячет недовольство в панели «Держава»', () => {
  const sim = fakeSim(41);
  calmContext(sim);
  armRevolt(sim); politicsNewDay(sim);       // запись №1
  sim.day += 30;
  calmContext(sim); armRevolt(sim); politicsNewDay(sim);   // подавлено
  ok(sim.politics.state.revolts === 2, 'счётчик восстаний не растёт');
  const html = renderPoliticsPanel(sim);
  ok(/Восстаний пережито/.test(html), 'панель не показывает число восстаний');
  ok(/стабильность \d+/.test(html), 'панель не показывает стабильность');
});

console.log('\n--- Кулдаун переживает сейв/загрузку ---');
t('restore восстанавливает память причин', () => {
  const sim = fakeSim(51);
  calmContext(sim);
  armRevolt(sim); politicsNewDay(sim);       // запись №1 в день D
  const writeDay = revoltLines(sim)[0].day;
  const data = JSON.parse(JSON.stringify(politicsSerialize(sim)));
  const sim2 = fakeSim(999);                 // другой сид: память придёт из сейва
  politicsRestore(sim2, data);
  sim2.day = writeDay + 30;                  // внутри кулдауна
  calmContext(sim2); armRevolt(sim2); politicsNewDay(sim2);
  ok(sim2.politics.state.revolts === 2, 'после загрузки восстание не случилось');
  ok(revoltLines(sim2).length === 0, `кулдаун забыт при загрузке: записей ${revoltLines(sim2).length}`);
  // Битый сейв не роняет модуль: память просто пустая, первое восстание напишется.
  const sim3 = fakeSim(52);
  politicsRestore(sim3, { laws: null, politics: null, revoltChron: { base: 'ерунда', war: -5 } });
  ok(typeof sim3.politics.revoltChron === 'object', 'нет объекта памяти после мусорного сейва');
});

console.log('\n--- Детерминизм сида ---');
t('один сид — одинаковая летопись, кулдаун реально глушит часть событий', () => {
  const script = (sim) => {
    // Война не кончается: причина всех бунтов одна и та же («war»), бунты
    // каждые 45 дней — чаще кулдауна записи. Честная летопись обязана
    // записать лишь малую часть событий.
    sim.wars = [{ fid: 'orda' }];
    sim._happy = 50;
    for (let i = 0; i < 260; i++) {
      if (i % 45 === 0) armRevolt(sim);
      sim.day++;
      politicsNewDay(sim);
    }
    return { events: sim.politics.state.revolts, lines: sim.chronicle.map(c => `${c.day}|${c.text}`) };
  };
  const a = script(fakeSim(77));
  const b = script(fakeSim(77));
  ok(a.lines.length === b.lines.length && a.lines.every((v, i) => v === b.lines[i]), 'один сид дал разные летописи');
  ok(a.events >= 3, `сценарий без бунтов, проверять нечего: ${a.events}`);
  // В строках уже лежит «день|текст», поэтому ищем вхождение, а не начало строки.
  const revoltsA = a.lines.filter(x => REVOLT_RE.test(x.slice(x.indexOf('|') + 1))).length;
  ok(revoltsA >= 1, 'ни одна запись не прошла');
  ok(revoltsA < a.events, `кулдаун не глушит: записей ${revoltsA} при событиях ${a.events}`);
});

console.log('\n--- Гигиена ---');
t('wire_politics.js: без вызовов Math.random и DOM', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/core/systems/wire_politics.js', import.meta.url)), 'utf8');
  // Слова в комментариях («Math.random не используется», «обращений к document
  // нет») не считаются — ловим именно ВЫЗОВ через точку/скобку, как это делает
  // test-link-memory для Math.random.
  ok(!/Math\.random\s*\(/.test(src), 'найден вызов Math.random — детерминизм сломан');
  // «к document.» в комментарии — точка конца предложения, поэтому после имени
  // требуется именно обращение к свойству: точка+имя или скобка.
  ok(!/\b(document|window|localStorage)\s*(\.\w|\[\s*['"\w])/.test(src.split('/* ПОДКЛЮЧЕНИЕ')[0]), 'найден DOM/браузерный API');
});

console.log(`\n=== ${pass} OK / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
