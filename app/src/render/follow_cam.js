// render/follow_cam.js — камера-наблюдатель (вид от 3-го лица, мечта игрока:
// «наблюдать за жизнью королевы и отдельных жителей, у каждого своя история»).
//
// ПРАВИЛА СЛОЯ (как у всего render/*):
//  • симуляция ТОЛЬКО читается: ни одного поля sim мы не пишем;
//  • sim.rng не зовётся никогда — лишний бросок сдвинул бы детерминированный
//    поток случайностей ядра и разъехались бы сейвы. Вся «случайность» режима
//    (личный масштаб камеры каждого жителя) выводится из hash(seed, id, кадр);
//  • состояние режима живёт в самом модуле (window.__frontierFollow), чтобы
//    ни ядро, ни рендер не тащили чужих полей;
//  • чистая математика без DOM — тестируется в node (app/tests/test-follow-cam.mjs).
//
// КАК РАБОТАЕТ ХОД КАМЕРЫ. Каждую цель (житель идёт — точка едет) мы догоняем
// экспоненциальным затуханием, ровно как camStep в projection3d.js:
//   k = 1 − exp(−dt/τ);  cur += (target − cur)·k.
// Поверх экспоненты стоит потолок скорости (тайлов/сек и зума/сек): без него
// первый кадр после смены цели улетал бы на 13% ВСЕГО расстояния — прыжок
// на сотни пикселей. С потолком далёкий переход выглядит как кинематографичный
// перелёт, а вблизи цели работает чистая экспонента.
//
// ВЫХОД ИЗ РЕЖИМА всегда плавный: включение запоминает позицию камеры, выход
// (Esc, клик по карте, перехват WASD-панорамой) начинает обратный перелёт,
// а не телепорт. Повторный Esc во время возврата отпускает камеру мгновенно.
import { rulerTitle } from '../core/systems/politics.js';

// Постоянная времени экспоненты, сек. Чуть меньше CAM_TAU (0.09) из
// projection3d.js: наблюдателю нужно успевать догонять идущего жителя, но
// ход всё ещё заметно инерционный. Подбор вместе с потолками скоростей даёт
// сходимость перелёта через полпоселения за 60 кадров при 60 FPS (тест).
export const FOLLOW_TAU = 0.08;

// Личный масштаб наблюдения z≈1.6–2.2 (ТЗ): достаточно близко, чтобы читать
// лицо и одежду эпохи, достаточно далеко, чтобы видеть двор вокруг героя.
export const FOLLOW_ZOOM_MIN = 1.6;
export const FOLLOW_ZOOM_MAX = 2.2;

// Потолок скорости перелёта, тайлов/сек. Соседен со скоростью клавиатурной
// камеры main.js (30/z тайлов/сек): игрок не должен замечать «два разных
// темпа» между своим панорамированием и нашим перелётом. Верхняя граница
// скачка за кадр при максимальном зуме: 38/60·32·2.2 ≈ 44.7 px (проверяет тест).
export const FOLLOW_MOVE_SPEED = 38;
// Потолок изменения зума, ед./сек. Диапазон личного масштаба 0.6 проходится
// за ~0.25 c — авто-зум читается как мягкий «наезд», а не щелчок.
export const FOLLOW_ZOOM_SPEED = 2.6;

// Возврат закончен, когда остаточная ошибка меньше этих порогов: дальше камеру
// нельзя отличить от той, что была до включения режима.
export const RETURN_EPS_TILES = 0.02;
export const RETURN_EPS_ZOOM = 0.004;

// Перехват камеры игроком фиксируем, когда реальная камера разошлась с нашей
// сглаженной заметнее, чем накопил бы один кадр клавиатурного хода (~0.5 тайла
// при z=1). Порог 1.2 тайла — это 2–3 кадра удержания WASD: намеренный жест.
export const TAKEOVER_TILES = 1.2;
export const TAKEOVER_ZOOM = 0.3;

// ---------------------------------------------------------------------------
// Детерминированный хеш вместо rng. Тот же стиль смесителя, что hashSeed в
// renderer.js: перемножили, сдвинули, перемножили. Никакого Math.random.
// ---------------------------------------------------------------------------
function keyNum(id) {
  if (typeof id === 'number') return id | 0;
  const s = String(id);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}

// hash01(seed, id, кадр) → [0,1). Параметр «кадр» оставлен контрактом ТЗ:
// сегодня случайности зависят только от (seed, id), но если понадобится,
// например, дыхание камеры, оно обязано идти отсюда, а не из rng.
export function hash01(seed, id, frame = 0) {
  let h = ((seed | 0) ^ Math.imul(keyNum(id), 374761393) ^ Math.imul(frame | 0, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Личный масштаб наблюдаемого: закреплён за (сид мира, ключ жителя), поэтому
// один и тот же человек всегда снимается с одной и той же крупности — и между
// кадрами, и между загрузками сейва.
export function personalZoom(seed, key) {
  return FOLLOW_ZOOM_MIN + (FOLLOW_ZOOM_MAX - FOLLOW_ZOOM_MIN) * hash01(seed, key, 0);
}

// ---------------------------------------------------------------------------
// Что можно наблюдать. Правитель первым — главная идея режима («жизнь королевы»).
// ---------------------------------------------------------------------------
// У трона нет ног на карте: politics.state.ruler хранит только имя/возраст/черты.
// Ставим правителя в сердце поселения — старейшее уцелевшее здание (костёр
// основания живёт в buildings[0], пока не разрушен), иначе среднее по живым,
// иначе стартовая точка мира.
export function rulerAnchor(sim) {
  let best = null;
  for (const b of (sim && sim.buildings) || []) {
    if (b && !b.destroyed) { best = b; break; }
  }
  if (best) {
    // центр здания: координаты — левый верхний угол клетки размером size
    const s = best.size || 1;
    return { x: (best.x | 0) + s / 2, y: (best.y | 0) + s / 2 };
  }
  const vs = aliveVillagers(sim);
  if (vs.length) {
    let sx = 0, sy = 0;
    for (const v of vs) { sx += v.x; sy += v.y; }
    return { x: sx / vs.length, y: sy / vs.length };
  }
  const w = (sim && sim.world) || {};
  return { x: Number.isFinite(w.startX) ? w.startX : 48, y: Number.isFinite(w.startY) ? w.startY : 48 };
}

function aliveVillagers(sim) {
  const vs = (sim && Array.isArray(sim.villagers)) ? sim.villagers : [];
  // Живость — строго по контракту ядра: фильтр hp>0 (см. tickVillagers).
  return vs.filter(v => v && v.hp > 0);
}

// Список целей наблюдения. Порядок детерминирован: правитель, затем живые
// жители в порядке массива ядра. Ключ устойчив между кадрами: pid выдаёт
// population.js, и он переживает перестановки массива; без pid (только что
// заспавненный до первой синхронизации) падаем на индекс — он тоже стабилен,
// потому что ядро удаляет умерших фильтром, а новорождённых дописывает в конец.
export function rosterOf(sim) {
  const out = [];
  if (!sim) return out;
  const pol = sim.politics && sim.politics.state;
  if (pol && pol.ruler) {
    const p = rulerAnchor(sim);
    out.push({
      key: 'ruler', kind: 'ruler',
      // rulerTitle даёт «Вождь/Монарх/Королева…» — титул читается из строя правления
      name: rulerTitle(pol),
      x: p.x, y: p.y,
    });
  }
  const vs = (sim && Array.isArray(sim.villagers)) ? sim.villagers : [];
  for (let i = 0; i < vs.length; i++) {
    const v = vs[i];
    if (!v || !(v.hp > 0)) continue;
    out.push({
      key: v.pid != null ? 'p' + v.pid : 'i' + i,
      kind: 'villager', ref: v, name: v.name, x: v.x, y: v.y,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Состояние режима. Живёт в window.__frontierFollow (см. followStore ниже):
// ни sim, ни Renderer не должны знать о существовании этого файла.
// phase: 'idle' — режим выключен и камера наша не трогаем
//        'follow' — следим за целью key
//        'return' — плавно возвращаем камеру на saved
// ---------------------------------------------------------------------------
export function createFollowState(seed = 0) {
  return {
    phase: 'idle',
    idx: 0,                    // индекс текущей цели в последнем ростере
    key: null,
    label: '',                 // имя для HUD/подсказок
    cur: { x: 48, y: 48, zoom: 1 },   // сглаженное положение нашей камеры
    saved: null,               // {x,y,zoom} камеры игрока до включения
    seed: seed | 0,
    last: null,                // последний результат шага (для HUD/отладки)
  };
}

// Циклический сдвиг индекса — «следующий» от последнего ведёт к первому.
const cyc = (i, n) => ((i % n) + n) % n;

// Включить режим (dir=+1 — начать с правителя) или перескочить на соседнюю цель.
export function followActivate(st, sim, dir = 1) {
  if (!st) return false;
  const ros = rosterOf(sim);
  if (!ros.length) return false;           // наблюдать не за кем — пустой мир
  if (st.phase === 'follow') {
    st.idx = cyc(st.idx + (dir >= 0 ? 1 : -1), ros.length);
  } else {
    // Свежее включение: всегда начинаем с правителя («жизнь королевы» —
    // главная витрина режима), куда бы ни указывала кнопка. Прежняя позиция
    // камеры ещё не снята — снимет её первым кадром apply, там, где известна
    // реальная камера.
    if (st.phase === 'idle') st.saved = null;
    st.idx = 0;
    st.phase = 'follow';
  }
  _adopt(st, ros);
  return true;
}

// Обёртка под клавиши [ и ]: включает или листает.
export function followCycle(st, sim, dir = 1) {
  return followActivate(st, sim, dir);
}

function _adopt(st, ros) {
  const e = ros[st.idx];
  st.key = e.key;
  st.label = e.name;
}

// Выход из режима. Первый вызов — плавный возврат; повторный во время
// возврата — отпустить камеру немедленно (игрок уже сказал «хватит»).
export function followBreak(st) {
  if (!st || st.phase === 'idle') return false;
  if (st.phase === 'follow') {
    st.phase = 'return';
    st.key = null;
    return true;
  }
  st.phase = 'idle';
  return true;
}

// Клик по карте снимает слежение (житель идёт — камера едет; игрок кликнул —
// режим снят). Всегда false в node и вне режима: вызов безопасно ставить
// первой строкой обработчика pointerdown.
export function followClickBreak(st) {
  if (!st || st.phase !== 'follow') return false;
  return followBreak(st);
}

// ---------------------------------------------------------------------------
// Шаг математики. Мутирует ТОЛЬКО st. Возвращает применённую камеру либо null
// (режим ничего не делает — рендер живёт своей жизнью).
// opts: { tau, moveSpeed, zoomSpeed } — тестам нужно выключать потолки,
// чтобы проверять чистую экспоненту отдельно от ограничителя.
// ---------------------------------------------------------------------------
export function followStep(st, sim, dt, opts = {}) {
  if (!st || st.phase === 'idle') return null;
  const tau = num(opts.tau, FOLLOW_TAU);
  const moveCap = num(opts.moveSpeed, FOLLOW_MOVE_SPEED);
  const zoomCap = num(opts.zoomSpeed, FOLLOW_ZOOM_SPEED);
  // Кламп dt — тот же, что у игрового цикла main.frame: вкладка спала,
  // вернулась с dt=5 c, и камера не должна прыгать через полкарты.
  const t = Math.max(0, Math.min(0.1, num(dt, 0)));
  const k = t > 0 ? 1 - Math.exp(-t / tau) : 0;

  let tx, ty, tz;

  if (st.phase === 'follow') {
    const ros = rosterOf(sim);
    if (!ros.length) {
      // Все наблюдаемые погибли — возвращаем камеру туда, где стояли,
      // и тихо гасим режим: пустому миру нечего показывать.
      st.saved = { ...st.cur };
      st.phase = 'return';
      st.key = null;
    } else {
      // Цель умерла/исчезла (фильтр hp>0 выкинул её из ростера) — берём
      // первую живую циклически от прежнего индекса: детерминированно и без
      // скачков в сторону.
      let at = ros.findIndex(e => e.key === st.key);
      if (at < 0) { st.idx = cyc(st.idx, ros.length); at = st.idx; _adopt(st, ros); }
      else st.idx = at;
      const e = ros[at];
      // Позиция читается из ростера, а тот — из sim каждый кадр: житель идёт,
      // и цель уезжает вместе с ним. Зума касается личный масштаб героя.
      tx = e.x; ty = e.y;
      tz = personalZoom(st.seed, e.key);
      st.label = e.name;
    }
  }

  if (st.phase === 'return') {
    const s = st.saved || st.cur;
    tx = s.x; ty = s.y; tz = s.zoom;
  }

  // Экспоненциальный шаг к цели…
  let nx = st.cur.x + (tx - st.cur.x) * k;
  let ny = st.cur.y + (ty - st.cur.y) * k;
  let nz = st.cur.zoom + (tz - st.cur.zoom) * k;
  // …потолок пути за кадр: дальний переход превращается в равномерный
  // перелёт, ближний — остаётся экспонентой (лимит далеко не выбирается).
  if (moveCap > 0 && t > 0) {
    const dx = nx - st.cur.x, dy = ny - st.cur.y;
    const d = Math.hypot(dx, dy);
    const lim = moveCap * t;
    if (d > lim && d > 0) { nx = st.cur.x + dx * (lim / d); ny = st.cur.y + dy * (lim / d); }
  }
  if (zoomCap > 0 && t > 0) {
    const dz = nz - st.cur.zoom;
    const lim = zoomCap * t;
    if (Math.abs(dz) > lim) nz = st.cur.zoom + Math.sign(dz) * lim;
  }

  st.cur.x = nx; st.cur.y = ny; st.cur.zoom = nz;

  // Конвергенция возврата: дальше камера неотличима от прежней — отпускаем.
  if (st.phase === 'return') {
    const s = st.saved || st.cur;
    if (Math.hypot(st.cur.x - s.x, st.cur.y - s.y) <= RETURN_EPS_TILES &&
        Math.abs(st.cur.zoom - s.zoom) <= RETURN_EPS_ZOOM) {
      st.phase = 'idle';
      st.saved = null;
    }
  }

  st.last = { x: st.cur.x, y: st.cur.y, zoom: st.cur.zoom, phase: st.phase, label: st.label };
  return st.last;
}

function num(v, dflt) {
  const n = +v;
  return Number.isFinite(n) ? n : dflt;
}

// ---------------------------------------------------------------------------
// Точка применения из renderer.draw(). Единственное место, где мы трогаем
// внешний мир — поля this.cam рендера, который сам их создал и сам же читает.
// ---------------------------------------------------------------------------
export function followApplyCam(st, sim, dt, cam) {
  if (!st || !cam) return null;
  // Новая партия или загрузка сейва: сид сменился — старая цель принадлежит
  // мёртвому миру. Гасим режим, пусть игрок включает заново: тянуть камеру
  // к координатам прошлого прогона было бы грубой ошибкой.
  if (sim && (sim.seed | 0) !== st.seed) {
    st.seed = sim.seed | 0;
    st.phase = 'idle';
    st.saved = null;
    st.key = null;
  }
  if (st.phase === 'idle') return null;

  // Первый кадр слежения: снимаем «прежнюю позицию» с реальной камеры.
  if (st.phase === 'follow' && !st.saved) {
    st.saved = { x: cam.x, y: cam.y, zoom: cam.zoom };
    st.cur = { x: cam.x, y: cam.y, zoom: cam.zoom };
  }

  // Перехват игроком: WASD/панорама/прыжок по миникарте уже подвинули cam,
  // пока мы держали свой cur. Мирно отпускаем режим и летим вслед за рукой.
  if (st.phase === 'follow' && st.saved &&
      (Math.hypot(cam.x - st.cur.x, cam.y - st.cur.y) > TAKEOVER_TILES ||
       Math.abs(cam.zoom - st.cur.zoom) > TAKEOVER_ZOOM)) {
    st.saved = { x: cam.x, y: cam.y, zoom: cam.zoom };
    st.phase = 'return';
    st.key = null;
  } else if (st.phase === 'return' && st.saved &&
      (Math.hypot(cam.x - st.cur.x, cam.y - st.cur.y) > TAKEOVER_TILES ||
       Math.abs(cam.zoom - st.cur.zoom) > TAKEOVER_ZOOM)) {
    // Перехват посреди возврата: возвращаемся уже к новой точке, а не
    // боремся с игроком за старую.
    st.saved = { x: cam.x, y: cam.y, zoom: cam.zoom };
  }

  const out = followStep(st, sim, dt);
  if (!out) return null;
  // Применяем ПОСЛЕ шага: draw() дальше сам посчитает ox,oy от этих значений,
  // так что кадр рисуется уже «камерой наблюдателя» без дрожания на стыке.
  cam.x = out.x;
  cam.y = out.y;
  cam.zoom = out.zoom;
  return out;
}

// ---------------------------------------------------------------------------
// Доступ из браузера: единственный синглтон в window.__frontierFollow.
// В node (тесты) window нет — возвращаем null, чистые функции принимают
// состояние параметром и глобальность не трогают.
// ---------------------------------------------------------------------------
export function followStore(win = (typeof window !== 'undefined' ? window : null)) {
  if (!win) return null;
  if (!win.__frontierFollow) win.__frontierFollow = createFollowState();
  return win.__frontierFollow;
}

// ---------------------------------------------------------------------------
// ПОДКЛЮЧЕНИЕ
//
// ── app/src/render/renderer.js — применение цели к cam ─────────────────────
//
// Шаг 1. Импорт. Якорь (Grep=1):
//   import { makeCam } from './projection3d.js';
// Вставить ПОСЛЕ:
//   import { followStore, followApplyCam } from './follow_cam.js';
//
// Шаг 2. Ход камеры раз в кадр. Якорь (Grep=1):
//     this.tuneAuto(dtReal);
// Вставить СРАЗУ ПОСЛЕ (до расчёта ox,oy — тогда весь кадр рисуется уже
// камерой наблюдателя; когда режим выключен, функция молчит и ничего
// не меняет: нулевой риск для обычной игры):
//     // Камера-наблюдатель: плавно ведёт this.cam за жителем/правителем.
//     followApplyCam(followStore(), sim, dtReal, this.cam);
//
// ── app/src/main.js — клавиши и снятие режима вводом ───────────────────────
//
// Шаг 1. Импорт. Якорь (Grep=1):
//   import { tileAt } from './core/world.js';
// Вставить ПОСЛЕ:
//   import { followStore, followCycle, followBreak, followClickBreak } from './render/follow_cam.js';
//
// Шаг 2. Клавиши [ и ] (следующий/предыдущий житель; вход — сразу к правителю).
// Якорь (Grep=1):
//   if (e.key === '+' || e.key === '=') zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1.15);
// Вставить ПЕРЕД:
//   // Наблюдатель: [ — предыдущий, ] — следующий (правитель всегда первый).
//   // 'х'/'ъ' — те же клавиши в русской раскладке.
//   if (e.key === '[' || e.key === 'х' || e.key === 'Х') followCycle(followStore(), sim, -1);
//   if (e.key === ']' || e.key === 'ъ' || e.key === 'Ъ') followCycle(followStore(), sim, +1);
//
// Шаг 3. Esc — выход из режима БЕЗ открытия меню. Якорь (Grep=1):
//   if (e.key === 'Escape') {
// Заменить ветку целиком на:
//   if (e.key === 'Escape') {
//     if (sim.placing) cancelPlace();
//     else if (followBreak(followStore())) { /* вышли из наблюдателя; меню не открываем */ }
//     else if (document.getElementById('modalWrap').classList.contains('show')) hud.closeModal();
//     else hud.showMenu();
//   }
//
// Шаг 4. Любое касание карты снимает слежение. Якорь (Grep=1):
//     audio.unlock();
// Вставить СРАЗУ ПОСЛЕ (это первая строка обработчика canvas pointerdown —
// клик, панорама и долгий тап одинаково честно возвращают камеру игроку):
//     followClickBreak(followStore());
//
// Необязательно (подпись, кто на экране): в конце followApplyCam можно отдавать
// st.last.label — например, hud.toast(`${out.label}`, 'good') при смене цели.
// HUD править не обязательно: режим полноценно работает и без подписи.
// ---------------------------------------------------------------------------
