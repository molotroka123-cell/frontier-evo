// Тесты карточки-биографии жителя (app/src/ui/villager_story.js) — G6.
// Запуск: node app/tests/test-villager-story.mjs
//
// DOM в node нет и не нужен: у villager_story.js чистая часть (лента storyOf,
// модель карточки, разметка, разрешение цели follow-камеры) отделена от
// рендера маркером «DOM-ЧАСТЬ», как у ui/inspector.js. Сам импорт модуля —
// уже проверка: он обязан проходить без document/window.
//
// Симуляции здесь подставные (минимальные объекты ровно с теми полями, которые
// читают чистые функции и population.js/inspector.js): карточка — потребитель,
// и её модели обязаны работать на ЧТЕНИИ чужого состояния.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const {
  STORY_POLL_MS, FEED_MAX, ADULT_DAYS,
  fmtDay, asSubject, statusOf, kinOf,
  storyOf, storyCard, storyHtml, followTarget,
} = await import('../src/ui/villager_story.js');
const { DOCK_FREE_PX } = await import('../src/ui/inspector.js');
const { YEAR } = await import('../src/core/systems/population.js');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('OK', name); } catch (e) { fail++; console.log('FAIL', name, '—', e.message); } };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || ''} ждали ${JSON.stringify(b)}, получили ${JSON.stringify(a)}`); };
const ok = (v, m) => { if (!v) throw new Error(m || 'ложь'); };

const HERE = join(dirname(fileURLToPath(import.meta.url)));
const CODE = readFileSync(join(HERE, '..', 'src', 'ui', 'villager_story.js'), 'utf8');

// ---------- подставные данные ----------

// Минимальный sim: день, летопись, журнал, жители, политика — только то,
// что реально читают чистые функции карточки.
function simFixture() {
  return {
    day: 2500,
    chronicle: [],
    log: [],
    villagers: [],
    politics: null,
  };
}

function rulerPol(name, since) {
  return { politics: { state: { ruler: { name, age: 34, since } } } };
}

// ---------- константы контракта ----------

t('док держится свободным: значение общее с инспектором (76px)', () => {
  eq(DOCK_FREE_PX, 76);
});

t('период опроса сопоставим с инспектором, лента ограничена разумно', () => {
  ok(STORY_POLL_MS >= 200 && STORY_POLL_MS <= 1000, `опрос ${STORY_POLL_MS} мс`);
  ok(FEED_MAX >= 10 && FEED_MAX <= 100, `лента ${FEED_MAX} записей`);
});

t('совершеннолетие выведено из игрового года: 16 лет × YEAR', () => {
  eq(ADULT_DAYS, 1600);
  eq(ADULT_DAYS, 16 * YEAR);
});

// ---------- подпись дня ----------

t('fmtDay: положительный день и день до основания поселения', () => {
  eq(fmtDay(120), 'День 120');
  eq(fmtDay(0), 'День 0');
  eq(fmtDay(-40), 'За 40 дн. до основания');
});

// ---------- вехи из чисел жителя ----------

t('младенец: веха рождения есть, совершеннолетия ещё нет', () => {
  const sim = simFixture();
  sim.day = 700;
  const v = { name: 'Мира Тихая', sex: 'ж', age: 200, hp: 100, job: 'idle' };
  const feed = storyOf(sim, v);
  ok(feed.some(e => e.day === 500 && e.text === 'Родилась.'), 'веха рождения на дне 500');
  ok(!feed.some(e => e.text.includes('совершеннолетие')), 'до 16 лет вехи взросления нет');
});

t('взрослый: рождение и совершеннолетие выстроены по дням, мужской род', () => {
  const sim = simFixture(); // day 2500
  const v = { name: 'Огнеслав Крепкий', sex: 'м', age: 2000, hp: 100, job: 'idle' };
  const feed = storyOf(sim, v);
  ok(feed.some(e => e.day === 500 && e.text === 'Родился.'), 'рождение: 2500−2000');
  ok(feed.some(e => e.day === 2100 && /Вырос:/.test(e.text)), 'взросление: 500+1600');
  // Дни строго неубывают — сортировка по возрастанию.
  for (let i = 1; i < feed.length; i++) ok(feed[i].day >= feed[i - 1].day, 'лента отсортирована');
});

t('старше поселения: отрицательный день рождения не теряется', () => {
  const sim = simFixture(); // day 2500
  const v = { name: 'Старейшина Холмов', age: 4000, hp: 100, job: 'idle' };
  const feed = storyOf(sim, v);
  ok(feed.some(e => e.day === -1500 && e.text === 'Родился.'), 'день рождения ушёл в минус честно');
  ok(feed[0].day === -1500, 'самое раннее событие открывает ленту');
});

// ---------- упоминания в хронике и журнале ----------

t('упоминания имени собираются из хроники и лога дословно', () => {
  const sim = simFixture();
  sim.chronicle = [
    { day: 90, era: 0, text: 'Наступила эпоха: Каменный век.' },
    // Ядро пишет о жителях в именительном падеже («Мира Тихая покинула…»),
    // поэтому полное имя в тексте — штатный вид упоминания.
    { day: 100, era: 0, text: 'Мира Тихая спасла посёлок от волков.' },
  ];
  sim.log = [
    { day: 130, text: '☠ Мира Тихая погибла от болезни.', type: 'bad' },
    { day: 131, text: 'Изучено: Огонь.', type: 'good' },
  ];
  const v = { name: 'Мира Тихая', sex: 'ж', age: 300, hp: 100, job: 'idle' };
  const texts = storyOf(sim, v).map(e => e.text);
  ok(texts.includes('Мира Тихая спасла посёлок от волков.'), 'строка хроники попала дословно');
  ok(texts.includes('☠ Мира Тихая погибла от болезни.'), 'строка лога попала дословно');
  eq(texts.filter(x => x.includes('Изучено')).length, 0, 'чужие строки не приплетены');
  eq(texts.filter(x => x.includes('эпоха')).length, 0, 'упоминания без имени отфильтрованы');
});

t('склонённая форма имени не приписывается жителю сознательно', () => {
  // «У Миры Тихой…» — косвенный падеж: строгий поиск по полному имени
  // защищает от чужих упоминаний и тёзок, лучше молчать, чем врать.
  const sim = simFixture();
  sim.chronicle = [{ day: 100, era: 0, text: 'У Миры Тихой родилась дочь — Дана Тихая.' }];
  const mother = { name: 'Мира Тихая', sex: 'ж', age: 300, hp: 100, job: 'idle' };
  const daughter = { name: 'Дана Тихая', sex: 'ж', age: 0, hp: 100, job: 'idle' };
  eq(storyOf(sim, mother).some(e => e.text.includes('родилась дочь')), false,
    'материнская строка не попала в ленту матери');
  ok(storyOf(sim, daughter).some(e => e.text.includes('родилась дочь')),
    'но ребёнок своё упоминание получает');
});

t('дубликат «лог+летопись» показывается один раз', () => {
  const sim = simFixture();
  sim.chronicle = [{ day: 77, era: 1, text: 'Огнеслав Крепкий стал мастером-лесорубом.' }];
  sim.log = [{ day: 77, text: 'Огнеслав Крепкий стал мастером-лесорубом.' }];
  const v = { name: 'Огнеслав Крепкий', age: 900, hp: 100, job: 'idle' };
  eq(storyOf(sim, v).filter(e => e.text.includes('мастером-лесорубом')).length, 1);
});

t('сортировка устойчива к порядку источников: раннее событие всплывает наверх', () => {
  const sim = simFixture();
  // Упоминание дня 3000 добавлено ПОСЛЕДНИМ по времени, но обязано встать
  // после вех, а не по порядку поступления.
  sim.chronicle = [{ day: 3000, era: 2, text: 'Мира Тихая открыла школу.' }];
  sim.villagers = [{ name: 'Мира Тихая', sex: 'ж', age: 2950, hp: 100, job: 'idle' }];
  const feed = storyOf(sim, sim.villagers[0]);
  eq(feed[0].day, -450, 'рождение раньше всего остального (2500−2950)');
  for (let i = 1; i < feed.length; i++) ok(feed[i].day >= feed[i - 1].day, 'порядок неубывающий');
});

// ---------- заслуги и нынешнее ремесло ----------

t('заслуги из deeds попадают в ленту без двойных точек', () => {
  const sim = simFixture(); // day 2500
  const v = { name: 'Огнеслав Крепкий', age: 900, hp: 100, job: 'work',
    prof: 'wood', rank: 3, deeds: ['стал мастером-лесорубом.'] };
  const hit = storyOf(sim, v).find(e => e.text.startsWith('В послужном списке'));
  ok(hit, 'строка заслуг на месте');
  eq(hit.text, 'В послужном списке: стал мастером-лесорубом.');
  eq(hit.day, 2500, 'deeds без дат честно стоят на сегодняшнем дне');
});

t('нынешнее ремесло замыкает ленту сегодняшним днём', () => {
  const sim = simFixture(); // day 2500
  const v = { name: 'Трудана Сильная', sex: 'ж', age: 800, hp: 100, job: 'hunt', prof: null };
  const last = storyOf(sim, v)[storyOf(sim, v).length - 1];
  eq(last.day, 2500);
  ok(/Нынче:/.test(last.text), `формулировка «нынче», получили: ${last.text}`);
});

// ---------- трон ----------

t('правитель: псевдожитель, восшествие и статус', () => {
  const sim = Object.assign(simFixture(), rulerPol('Ярослав Медведев', 900));
  const s = asSubject(sim, 'ruler');
  ok(s && s.ruler, 'маркер «ruler» разрешается в трон');
  eq(s.v.name, 'Ярослав Медведев');
  eq(s.v.age, 3400, 'возраст правителя переведён из лет в дни по YEAR');
  const throne = storyOf(sim, 'ruler').find(e => e.day === 900);
  ok(throne && throne.text === 'Вступил на трон.', 'веха восшествия на дне ruler.since');
  const card = storyCard(sim, 'ruler');
  eq(card.emoji, '👑');
  eq(card.rows.find(r => r.k === 'Статус').v, 'Правитель');
});

t('житель с именем правителя получает статус правителя даже ребёнком', () => {
  const sim = Object.assign(simFixture(), rulerPol('Малютка Царь', 2400));
  const kid = { name: 'Малютка Царь', sex: 'м', age: 800, hp: 100, job: 'idle' }; // 8 лет
  eq(statusOf(sim, kid), 'Правитель', 'трон важнее возраста');
});

// ---------- статусы и родня ----------

t('statusOf: ребёнок, ремесленник, житель без признаков', () => {
  const sim = simFixture();
  eq(statusOf(sim, { name: 'А', age: 800, hp: 1 }), 'Ребёнок');           // 8 лет
  eq(statusOf(sim, { name: 'Б', age: 2000, hp: 1, prof: 'stone' }), 'Ремесленник');
  eq(statusOf(sim, { name: 'В', age: 2000, hp: 1, job: 'idle' }), 'Житель');
  eq(statusOf(sim, null), 'Житель', 'пустышка не ломает классификацию');
});

t('kinOf собирает супруга, родителей и детей по pid; мёртвые молчат', () => {
  const sim = simFixture();
  const mother = { name: 'Мать Большая', pid: 1, sex: 'ж', hp: 100 };
  const spouse = { name: 'Супруг Верный', pid: 2, sex: 'м', hp: 100 };
  sim.villagers = [mother, spouse];
  const v = { name: 'Дочь Единственная', sex: 'ж', hp: 100,
    partner: 2, parents: [1, 999], children: 3 }; // pid 999 умер — его нет в массиве
  const kin = kinOf(sim, v);
  ok(kin.includes('Супруг: Супруг Верный'), 'супруг найден по pid');
  ok(kin.includes('Родители: Мать Большая'), 'живой родитель назван');
  ok(!kin.includes('999'), 'мёртвый родитель не выдуман');
  ok(kin.includes('Детей: 3'), 'число детей названо');
  eq(kinOf(sim, { name: 'Одинокий Странник', hp: 1 }), null, 'без родни строки нет');
});

// ---------- пустая история и живучесть к мусору ----------

t('пустая история даёт вежливую заглушку в разметке', () => {
  const html = storyHtml({ title: 'Немой Отшельник', emoji: '🧍', rows: [], feed: [], earlier: 0 });
  ok(html.includes('Летопись пока молчит'), 'заглушка объясняет тишину');
  ok(html.includes('Немой Отшельник'), 'карточка без фактов всё же представлена именем');
});

t('мусор на входе не роняет чистые функции', () => {
  eq(storyOf(null, null).length, 0);
  eq(storyOf({}, {}).length, 0);
  eq(storyOf(simFixture(), { hp: 100 }).length, 0, 'житель без имени — не цель');
  eq(storyCard(null, 'ruler'), null, 'трона нет — карточки нет');
  eq(storyHtml(null), '');
  eq(asSubject(simFixture(), 'ruler'), null, 'политики нет — маркер гасится');
  eq(storyOf(simFixture(), { name: 'X', age: 'не число', hp: 1 }).length, 1, 'битый возраст не убивает веху');
});

// ---------- модель карточки ----------

t('storyCard: шапка, строки, лента и счётчик старых записей', () => {
  const sim = simFixture(); // day 2500
  sim.politics = { state: { ruler: { name: 'Ярослав Медведев', age: 34, since: 900 } } };
  sim.villagers = [
    { name: 'Ярослав Медведев', sex: 'м', age: 2000, hp: 100, job: 'work', pid: 5,
      prof: 'food', trait: 'diligent', partner: 6, children: 2 },
    { name: 'Супруга Верная', sex: 'ж', pid: 6, hp: 100 },
  ];
  const card = storyCard(sim, { kind: 'v', v: sim.villagers[0] });
  eq(card.title, 'Ярослав Медведев');
  const row = k => card.rows.find(r => r.k === k);
  eq(row('Возраст').v, '20 лет');
  eq(row('Статус').v, 'Правитель');
  ok(row('Родня').v.includes('Супруга Верная'), 'родня видна в карточке');
  ok(row('Характер').v.length > 0, 'черта названа словами модуля населения');
  ok(card.feed.length > 0 && card.earlier === 0, 'короткая жизнь целиком влезает в ленту');
});

t('длинная жизнь обрезается до FEED_MAX с честным счётчиком', () => {
  const sim = simFixture();
  const extra = FEED_MAX + 3;
  for (let d = 0; d < extra; d++) {
    sim.chronicle.push({ day: d * 10, era: 0, text: `Герой Летописный, деяние №${d}.` });
  }
  // К 33 упоминаниям добавляется веха рождения (2500−100 = день 2400) —
  // всего 34 записи: за кадром остаются ровно 4.
  const v = { name: 'Герой Летописный', age: 100, hp: 100, job: 'idle' };
  const card = storyCard(sim, v);
  eq(card.feed.length, FEED_MAX, 'в ленте ровно последние записи');
  eq(card.earlier, 4, 'остальное сочтено');
  const html = storyHtml(card);
  ok(html.includes('и ещё 4 более ранних записей'), 'счётчик виден игроку');
  ok(!html.includes('деяние №0.'), 'самые старые строки ушли за кадр');
  ok(!html.includes('деяние №3.'), 'граница обреза проходит по счётчику');
});

// ---------- детерминизм HTML и экранирование ----------

t('storyHtml детерминирован и экранирует данные мира', () => {
  const sim = simFixture();
  sim.chronicle = [{ day: 40, era: 0, text: '<script>злой()</script> упоминает Мира Тихая' }];
  const v = { name: '<img src=x onerror=1> Мира Тихая', sex: 'ж', age: 300, hp: 100, job: 'idle' };
  sim.villagers = [v];
  const h1 = storyHtml(storyCard(sim, v));
  const h2 = storyHtml(storyCard(sim, v));
  eq(h1, h2, 'одно состояние — один HTML');
  ok(!h1.includes('<img src=x'), 'имя жителя экранировано');
  ok(h1.includes('&lt;img'), 'экранирование сохранило текст');
  ok(!h1.includes('<script>'), 'летопись не исполняется');
  const other = storyHtml(storyCard(sim, { kind: 'ruler' }));
  eq(other, '', 'трона нет — разметки нет');
});

t('в разметке есть крестик закрытия и подписи для скринридера', () => {
  const sim = simFixture();
  const html = storyHtml(storyCard(sim, { name: 'Кто-то Простой', age: 1700, hp: 100, job: 'idle' }));
  ok(html.includes('data-ft-close'), 'крестик закрытия на месте');
  ok(html.includes('aria-label="Закрыть"'), 'крестик подписан для скринридера');
  ok(html.includes('Лента жизни'), 'лента озаглавлена');
});

// ---------- разрешение цели follow-камеры (G5) ----------

t('followTarget: ключ p<pid> находит жителя по постоянному идентификатору', () => {
  const sim = simFixture();
  const v7 = { name: 'Семидневный', pid: 7, hp: 100 };
  sim.villagers = [v7];
  const F = { sim, __frontierFollow: { phase: 'follow', key: 'p7' } };
  const got = followTarget(F);
  ok(got && got.kind === 'v' && got.v === v7, 'цель разрешена в того самого жителя');
});

t('followTarget: ключ i<idx>, трон и выключенный режим', () => {
  const sim = simFixture();
  sim.villagers = [{ name: 'A', hp: 100 }, { name: 'B', hp: 100 }];
  eq(followTarget({ sim, __frontierFollow: { phase: 'follow', key: 'i1' } }).v.name, 'B');
  eq(followTarget({ sim, __frontierFollow: { phase: 'follow', key: 'i9' } }), null, 'индекс вне массива');
  const pol = Object.assign(sim, rulerPol('Ярослав Медведев', 900));
  eq(followTarget({ sim: pol, __frontierFollow: { phase: 'follow', key: 'ruler' } }).kind, 'ruler');
  eq(followTarget({ sim: pol, __frontierFollow: { phase: 'idle', key: 'ruler' } }), null, 'режим выключен — цели нет');
  eq(followTarget(null), null, 'нет окна — нет цели');
});

// ---------- дисциплина чистой части ----------

t('pure/DOM части разделены маркером, в чистой нет document/window', () => {
  const noComments = CODE
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');
  const cut = noComments.indexOf('function ensureCss');
  ok(cut > 0, 'DOM-часть начинается с ensureCss');
  ok(CODE.includes('===== DOM-ЧАСТЬ'), 'маркер раздела на месте');
  const pure = noComments.slice(0, cut);
  ok(!/\bdocument\b/.test(pure), 'в чистой части нет document');
  ok(!/\bwindow\b/.test(pure), 'в чистой части нет window');
  ok(!/querySelector|createElement|innerHTML/.test(pure), 'чистая часть не строит DOM сама');
  // DOM-часть наоборот обязана ждать браузера: автозапуск под флагом окна.
  ok(CODE.includes('__frontierStory'), 'повторный запуск погашен флагом');
});

console.log(`\n=== ${pass} OK / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
