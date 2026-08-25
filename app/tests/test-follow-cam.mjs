// Тесты камеры-наблюдателя (app/src/render/follow_cam.js).
// Запуск: node app/tests/test-follow-cam.mjs
//
// Модуль обязан быть чистым: ни DOM, ни Math.random, ни rng симуляции.
// Симуляция здесь НЕ настоящая — фейковые объекты той же формы, что ядро
// (sim.villagers / sim.politics.state.ruler / sim.buildings / sim.world):
// тест проверяет контракт чтения, а не поведение ядра.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TILE_PX } from '../src/render/projection3d.js';

const {
  hash01, personalZoom, rosterOf, rulerAnchor,
  createFollowState, followActivate, followCycle, followBreak,
  followClickBreak, followStep, followApplyCam, followStore,
  FOLLOW_TAU, FOLLOW_MOVE_SPEED, FOLLOW_ZOOM_SPEED,
  FOLLOW_ZOOM_MIN, FOLLOW_ZOOM_MAX,
  RETURN_EPS_TILES, RETURN_EPS_ZOOM,
} = await import('../src/render/follow_cam.js');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('OK', name); } catch (e) { fail++; console.log('FAIL', name, '—', e.message); } };
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const near = (a, b, eps, msg) => ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b} (допуск ${eps})`);

// ---------- фикстуры формы ядра ----------
const vil = (pid, name, x, y, hp = 100) => ({ pid, name, x, y, age: 3200, job: 'idle', hp });
function makeSim(over = {}) {
  return {
    seed: over.seed ?? 777,
    world: { startX: 48, startY: 48 },
    buildings: over.buildings ?? [],
    villagers: over.villagers ?? [],
    politics: { state: { gov: over.gov ?? 'monarchy', ruler: over.ruler ?? null } },
  };
}
// Один кадр при 60 FPS через настоящий путь применения (renderer.draw).
const frame60 = (st, sim, cam) => followApplyCam(st, sim, 1 / 60, cam);
const dist2d = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

// ------------------------------------------------ чистота: node, без DOM
t('модуль импортируется в node без window/document; followStore() === null', () => {
  // Сам факт верхнего await-import уже доказывает отсутствие DOM на уровне модуля.
  ok(followStore() === null, 'в node followStore обязан вернуть null');
  ok(typeof document === 'undefined', 'тест должен идти вне DOM');
});

t('в коде нет document.*, состояние режима — только __frontierFollow', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/render/follow_cam.js'), 'utf8');
  // Сравниваем только КОД: в блоке «ПОДКЛЮЧЕНИЕ» слово document. допустимо —
  // там цитируется обработчик main.js, который модуль не содержит.
  const code = src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  ok(!code.includes('document.'), 'исполняемому коду render-слоя document не нужен');
  ok(src.includes('__frontierFollow'), 'синглтон должен жить в window.__frontierFollow');
});

// ------------------------------------------------ хеш вместо rng
t('hash01 детерминирован, лежит в [0,1), разные id дают разные значения', () => {
  for (const id of ['ruler', 'p1', 'p2', 7, 'Иван']) {
    near(hash01(777, id, 0), hash01(777, id, 0), 0, 'повтор вызова');
    near(hash01(777, id, 999), hash01(777, id, 999), 0, 'повтор вызова с кадром');
    const h = hash01(777, id, 0);
    ok(h >= 0 && h < 1, `значение вне [0,1): ${h}`);
  }
  const vals = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map(k => hash01(42, k, 0)));
  ok(vals.size >= 5, `хеш слишком коллизионный: ${vals.size}/6 уникальных`);
});

t('personalZoom всегда внутри личного диапазона 1.6..2.2', () => {
  let i = 0;
  for (const seed of [0, 1, 20260730, -5, 2 ** 31]) {
    for (const key of ['ruler', 'p1', 'p9', 'i12', 'Марья']) {
      const z = personalZoom(seed, key);
      ok(z >= FOLLOW_ZOOM_MIN && z <= FOLLOW_ZOOM_MAX, `zoom ${z} вне диапазона`);
      near(z, personalZoom(seed, key), 0, 'стабильность между вызовами');
      i++;
    }
  }
  ok(i >= 25, 'сетка прогонов обеднела');
});

// ------------------------------------------------ ростер наблюдаемых
t('ростер: правитель первый, мёртвые исключены, ключи устойчивы', () => {
  const sim = makeSim({
    ruler: { name: 'Мара', age: 34, traits: [] },
    villagers: [
      vil(11, 'Олег Крепкий', 10, 10),
      vil(22, 'Марья Тихая', 20, 20, 0),   // мёртвый
      vil(33, 'Гурт Ленивый', 30, 30),
      { name: 'БезПидОна', x: 5, y: 5, age: 2000, job: 'idle', hp: 100 }, // pid ещё не выдан
    ],
  });
  const ros = rosterOf(sim);
  ok(ros[0].kind === 'ruler' && ros[0].name.includes('Мара'), 'правитель обязан быть первым');
  ok(!ros.some(e => e.key === 'p22'), 'мёртвый житель попал в ростер');
  ok(JSON.stringify(ros.map(e => e.key)) === JSON.stringify(['ruler', 'p11', 'p33', 'i3']),
    'ключи/порядок съехали: ' + ros.map(e => e.key));
  near(ros[1].x, 10, 0, 'координаты читаются из sim на месте');
});

t('якорь правителя: живое здание → центр здания; без зданий → живые; совсем пусто → старт мира', () => {
  const a = rulerAnchor(makeSim({ buildings: [{ x: 40, y: 40, size: 2 }, { x: 50, y: 50 }] }));
  near(a.x, 41, 1e-9, 'центр первого уцелевшего здания по X');
  near(a.y, 41, 1e-9, 'центр первого уцелевшего здания по Y');

  const b = rulerAnchor(makeSim({ buildings: [{ x: 1, y: 1, destroyed: true }], villagers: [vil(1, 'A', 10, 12), vil(2, 'B', 20, 22)] }));
  near(b.x, 15, 1e-9, 'среднее по живым по X');
  near(b.y, 17, 1e-9, 'среднее по живым по Y');

  const c = rulerAnchor(makeSim());
  near(c.x, 48, 1e-9, 'запасной путь — startX');
});

// ------------------------------------------------ сглаживание
t('сходимость за ≤60 шагов: перелёт ~24 тайла + авто-зум до личного масштаба', () => {
  const sim = makeSim({
    ruler: { name: 'Мара', age: 34 },
    buildings: [{ x: 40, y: 40, size: 1 }],
    villagers: [vil(1, 'Олег', 90, 90)],
  });
  const st = createFollowState(sim.seed);
  // Стартуем на границе поселения: дистанция до трона ~24 тайла — типичный
  // «переход через посёлок», тот случай, ради которого режим и существует.
  const cam = { x: 58, y: 57, zoom: 1 };
  ok(followCycle(st, sim, +1) === true, 'активация не удалась');
  const tgt = rosterOf(sim)[0];
  const pz = personalZoom(sim.seed, tgt.key);
  let out = null;
  for (let i = 0; i < 60; i++) out = frame60(st, sim, cam);
  ok(out, 'режим не отдал ни одного кадра');
  near(out.x, tgt.x, 0.05, 'X сошёлся за секунду');
  near(out.y, tgt.y, 0.05, 'Y сошёлся за секунду');
  near(out.zoom, pz, 0.02, 'личный зум дотянут');
  near(cam.x, out.x, 0, 'применённая камера = результат шага');
  ok(st.phase === 'follow', 'фаза слежения потерялась');
});

t('чистая экспонента (потолки отключены) сходится из 90 тайлов за ≤60 шагов', () => {
  const sim = makeSim({
    ruler: { name: 'Мара', age: 34 },
    buildings: [{ x: 40, y: 40 }],
    villagers: [vil(1, 'Олег', 44, 44)],
  });
  const st = createFollowState(sim.seed);
  followActivate(st, sim, +1);                 // следим за правителем
  st.saved = { x: 48, y: 48, zoom: 1 };        // имитируем снятый «кадр до»
  st.cur = { x: 48 - 90, y: 48, zoom: 0.5 };   // стартуем через полкарты
  const tgt = rosterOf(sim)[0];
  const pz = personalZoom(sim.seed, tgt.key);
  let out = null;
  // Потолки глушим большим КОНЕЧНЫМ лимитом: num() сознательно считает
  // нечисла (включая Infinity) испорченным вводом и подставляет дефолт —
  // защита кадра от мусора из UI важнее удобства тестов.
  const off = { moveSpeed: 1e9, zoomSpeed: 1e9 };
  for (let i = 0; i < 60; i++) {
    out = followStep(st, sim, 1 / 60, off);
  }
  near(out.x, tgt.x, 0.05, 'X чистой экспоненты');
  near(out.y, tgt.y, 0.05, 'Y чистой экспоненты');
  near(out.zoom, pz, 0.01, 'зум чистой экспоненты');
  ok(FOLLOW_TAU > 0 && FOLLOW_TAU < 1, 'тау вне разумных пределов');
});

t('смена цели через полкарты: скачок за кадр ≤ 45 px даже при максимальном зуме', () => {
  const sim = makeSim({
    ruler: { name: 'Мара', age: 34 },
    buildings: [{ x: 40, y: 40 }],
    villagers: [vil(1, 'Далеко', 84, 84)],
  });
  const st = createFollowState(sim.seed);
  const cam = { x: 40.5, y: 40.5, zoom: 1 };
  followCycle(st, sim, +1);                    // правитель под ногами
  for (let i = 0; i < 30; i++) frame60(st, sim, cam);
  near(dist2d(cam.x, cam.y, 40.5, 40.5), 0, 0.05, 'камера осела у трона');
  followCycle(st, sim, +1);                    // резкая смена цели за ~44 тайла
  const before = { ...cam };
  const out = frame60(st, sim, cam);
  const jumpPx = dist2d(cam.x, cam.y, before.x, before.y) * TILE_PX * out.zoom;
  // N=45px: потолок FOLLOW_MOVE_SPEED·dt·TILE_PX·z_max = 38/60·32·2.2 ≈ 44.7 px
  ok(jumpPx <= 45, `скачок ${jumpPx.toFixed(1)} px превысил лимит 45 px`);
});

// ------------------------------------------------ листание целей
t('следующий/предыдущий цикличны, детерминированы, правитель — входная точка', () => {
  const mk = () => makeSim({
    ruler: { name: 'Мара', age: 34 },
    villagers: [vil(1, 'A', 10, 10), vil(2, 'B', 20, 20), vil(3, 'C', 30, 30)],
  });
  // Оба направления холодным нажатием стартуют с правителя (idx=0):
  // «жизнь королевы» — витрина режима, куда бы ни ткнул игрок.
  const run = (dir, steps) => {
    const sim = mk();
    const st = createFollowState(sim.seed);
    followActivate(st, sim, dir);
    const seq = [];
    for (let i = 0; i < steps; i++) { seq.push(st.key); followCycle(st, sim, dir); }
    seq.push(st.key);
    return seq;
  };
  const fwd = run(+1, 5);   // 4 цели + полный круг
  ok(JSON.stringify(fwd) === JSON.stringify(['ruler', 'p1', 'p2', 'p3', 'ruler', 'p1']),
    'цикл вперёд сломан: ' + fwd.join(','));
  const bwd = run(-1, 5);
  ok(JSON.stringify(bwd) === JSON.stringify(['ruler', 'p3', 'p2', 'p1', 'ruler', 'p3']),
    'цикл назад сломан: ' + bwd.join(','));
  ok(JSON.stringify(run(+1, 5)) === JSON.stringify(fwd), 'тот же ввод дал другую последовательность');
  // Пустой мир: активация честно отказывает, а не падает.
  const stEmpty = createFollowState(1);
  ok(followCycle(stEmpty, makeSim(), +1) === false, 'пустой ростер должен отказать в активации');
});

// ------------------------------------------------ смерть цели
t('умершая цель исключается: камера переходит к живой без запрещённого скачка', () => {
  const sim = makeSim({
    ruler: { name: 'Мара', age: 34 },
    buildings: [],
    villagers: [vil(1, 'A', 50, 50), vil(2, 'B', 52, 52), vil(3, 'C', 54, 54)],
  });
  const st = createFollowState(sim.seed);
  const cam = { x: 51, y: 51, zoom: 2 };
  followActivate(st, sim, +1);                 // ruler: якорь — среднее по живым (52,52)
  followCycle(st, sim, +1);                    // → p1
  for (let i = 0; i < 45; i++) frame60(st, sim, cam);
  ok(st.key === 'p1', 'не встали на p1');
  sim.villagers.find(v => v.pid === 1).hp = 0; // цель умерла
  const before = { ...cam };
  const out = frame60(st, sim, cam);           // следующий кадр
  ok(st.key !== 'p1' && st.key !== null, 'после смерти цели ключ не переключился');
  const alive = rosterOf(sim).some(e => e.key === st.key);
  ok(alive, 'переключились на мёртвого/несуществующего');
  const jumpPx = dist2d(cam.x, cam.y, before.x, before.y) * TILE_PX * out.zoom;
  ok(jumpPx <= 45, `автопереход дал скачок ${jumpPx.toFixed(1)} px`);
  ok(!rosterOf(sim).some(e => e.key === 'p1'), 'мёртвый остался в ростере');
  // Все наблюдаемые погибли (и трон опустел) — режим сам гасится,
  // а не крутится по пустому списку.
  for (const v of sim.villagers) v.hp = 0;
  sim.politics.state.ruler = null;
  frame60(st, sim, cam);
  ok(st.phase === 'return' || st.phase === 'idle', 'пустой мир должен гасить режим');
});

// ------------------------------------------------ выход из режима
t('Esc-выход плавный: возврат к прежней позиции без скачков, затем фаза idle', () => {
  const sim = makeSim({
    ruler: { name: 'Мара', age: 34 },
    buildings: [{ x: 40, y: 40 }],
    villagers: [vil(1, 'A', 80, 80)],
  });
  const st = createFollowState(sim.seed);
  const home = { x: 55, y: 55, zoom: 1.1 };    // где стоял игрок до включения
  const cam = { ...home };
  followCycle(st, sim, +1);
  for (let i = 0; i < 60; i++) frame60(st, sim, cam);
  ok(st.phase === 'follow', 'не вошли в слежение');
  ok(followBreak(st) === true, 'первый Esc должен сниматься');
  ok(st.phase === 'return', 'выход обязан начинать плавный возврат');
  near(st.saved.x, home.x, 1e-9, 'точка возврата — прежняя позиция камеры');
  let maxJump = 0, steps = 0;
  while (st.phase !== 'idle' && steps < 240) {
    const b = { ...cam };
    frame60(st, sim, cam);
    maxJump = Math.max(maxJump, dist2d(cam.x, cam.y, b.x, b.y) * TILE_PX * cam.zoom);
    steps++;
  }
  ok(st.phase === 'idle', 'возврат не завершился за 4 секунды кадров');
  ok(steps <= 180, `возврат затянулся: ${steps} кадров`);
  near(cam.x, home.x, RETURN_EPS_TILES * 2, 'вернулись по X');
  near(cam.y, home.y, RETURN_EPS_TILES * 2, 'вернулись по Y');
  near(cam.zoom, home.zoom, RETURN_EPS_ZOOM * 2, 'вернулись по зуму');
  ok(maxJump <= 45, `возврат прыгал по ${maxJump.toFixed(1)} px за кадр`);
  // Повторный Esc посреди возврата отпускает камеру немедленно.
  followCycle(st, sim, +1);
  followBreak(st);
  ok(followBreak(st) === true && st.phase === 'idle', 'второй Esc во время возврата должен отпустить сразу');
});

t('клик по карте снимает слежение; вне режима клики ничего не ломают', () => {
  const sim = makeSim({ ruler: { name: 'Мара', age: 34 }, villagers: [vil(1, 'A', 10, 10)] });
  const st = createFollowState(sim.seed);
  ok(followClickBreak(st) === false, 'клик вне режима не должен ничего делать');
  followActivate(st, sim, +1);
  ok(followClickBreak(st) === true, 'клик в режиме должен снимать слежение');
  ok(st.phase === 'return', 'клик обязан давать плавный возврат, а не телепорт');
  ok(followClickBreak(st) === false, 'повторный клик в фазе возврата — уже не про слежение');
});

t('перехват камеры игроком (WASD/панорама) мирно завершает режим', () => {
  const sim = makeSim({ ruler: { name: 'Мара', age: 34 }, villagers: [vil(1, 'A', 50, 50)] });
  const st = createFollowState(sim.seed);
  const cam = { x: 50.5, y: 50.5, zoom: 1.8 };
  followCycle(st, sim, +1);
  frame60(st, sim, cam);                       // первый кадр: снимает «точку до»
  ok(st.phase === 'follow', 'не вошли в режим');
  // Игрок тащит карту от ТЕКУЩЕГО положения камеры — именно его мы и должны
  // запомнить как новую точку возврата, а не абстрактные 55.5.
  const hand = { x: cam.x + 5, y: cam.y, zoom: cam.zoom };
  cam.x = hand.x;
  frame60(st, sim, cam);
  ok(st.phase !== 'follow', 'перехват не снял слежение');
  near(st.saved.x, hand.x, 1e-9, 'возврат должен идти к точке руки игрока');
  near(st.saved.zoom, hand.zoom, 1e-9, 'зум перехвата тоже запомнен');
});

t('новая партия (другой сид) сбрасывает режим — камера не тянется к прошлому миру', () => {
  const sim1 = makeSim({ seed: 111, ruler: { name: 'Мара', age: 34 }, villagers: [vil(1, 'A', 10, 10)] });
  const st = createFollowState(sim1.seed);
  const cam = { x: 12, y: 12, zoom: 2 };
  followCycle(st, sim1, +1);
  ok(frame60(st, sim1, cam), 'режим не завёлся');
  const sim2 = makeSim({ seed: 222, ruler: { name: 'Друга', age: 30 }, villagers: [vil(9, 'B', 90, 90)] });
  const out = frame60(st, sim2, cam);
  ok(out === null && st.phase === 'idle', 'сид сменился, а режим продолжал вести камеру');
});

// Сводка в формате раннера tools/test-all.mjs (он ищет «=== N OK / M FAIL ===»).
console.log(`=== ${pass} OK / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
