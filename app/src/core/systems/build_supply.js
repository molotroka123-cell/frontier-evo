// core/systems/build_supply.js — подвоз материалов рабочими на недострои.
//
// ═══ ЗАЧЕМ ЭТОТ ФАЙЛ ═══
//
// Сейчас здание платит всю стоимость мгновенно из общих складов в момент
// клика: брёвна телепортируются на площадку, и у державы с одним амбаром и
// стройкой за двадцать клеток логистики нет вовсе. Мастер-план альфы называет
// это дырой. Здесь она закрывается расчётом: модуль считает очередь доставки
// от ближайшего склада к каждому недострою (sim.buildings с !b.done), срок
// прихода повозки и потолок скорости стройки.
//
// Это ОТЧЁТНИК: чистая функция дня supplyNewDay(sim) читает мир и возвращает
// отчёт {mods, reasons, events, flags}, а применяет его integrate.js. Ни одной
// мутации sim — тест доказывает идентичность sim.serialize() до и после.
// Math.random и sim.rng не вызываются: свой поток от сида держит реплей и
// сравнение партий честными, как это уже сделано для стад ('HERD').
//
// ═══ КАК СЧИТАЕТСЯ ═══
//
//   Нужда. Недострой ждёт остаток сметы: долю стоимости, ещё не отработанную
//   строителями (progress/buildDays). Считать её от текущего склада нельзя:
//   склад общий и мгновенный, его тратит ядро. Модуль отвечает на вопрос
//   «что и куда должно быть доставлено», а «хватит ли» решает применитель.
//
//   Источники. Всё готовое (done) из BUILDINGS, у чего есть cap, — это склад;
//   плюс столица: кострище держит неприкосновенный запас, поэтому везти можно
//   даже когда амбаров нет вовсе. Доставка идёт от БЛИЖАЙШЕГО источника.
//
//   Приоритет. Недострои в радиусе CAPITAL_RADIUS от кострища обслуживаются
//   первыми: столица прежде окраин, иначе окраина с соседним амбаром обгоняла
//   бы стройку стен у костра.
//
//   Скорость. Обоз идёт PORTER_BASE_SPEED клеток в день, и каждая свободная
//   рука (житель без дела) добавляет PORTER_PER_HAND: подвоз живёт людьми,
//   а не абстрактным коэффициентом.
//
//   Потолок. Одновременных доставок не больше DELIVERIES_MAX — остальное ждёт,
//   и каждый выход из петли назван словами игрока в reasons[].
//
// ═══ ЧТО В ОТЧЁТЕ ═══
//   mods.buildSpeedCap — множитель ≤1 прогресса недостроев: чем больше строек
//                        ждёт обоз, тем медленнее растут все.
//   flags.deliveries   — [{bx, by, need:{ресурс:кол-во}, etaDays, from:{x,y}}]
//                        очередь сегодняшних доставок, первая — важнейшая.
//   reasons            — причины словами, по-русски, для панели и отладки.
//   events             — редкие события: не чаще раза за EVENT_EVERY_DAYS
//                        дней, потому что ежедневный рапорт обоза игрок
//                        перестал бы читать на второй день.
//
// ═══ ПОДКЛЮЧЕНИЕ (integrate.js) ═══
// Применять будет integrate.js, НЕ этот файл. Якоря проверены подсчётом строк:
// node -e "console.log(require('fs').readFileSync('app/src/core/systems/integrate.js','utf8').split(String.fromCharCode(10)).filter(l=>l.includes('<фрагмент>')).length)"
//
//   1) Импорт. Якорь «import * as B2 from './build2.js';» — совпадений: 1.
//      Вставить СРАЗУ ПОСЛЕ него:
//          import * as BSUP from './build_supply.js';
//
//   2) Вызов в systemsNewDay. Якорь «applyBuild(sim);» — совпадений: 1
//      (вызов внутри systemsNewDay; определение функции так не пишется).
//      Вставить СРАЗУ ПОСЛЕ него строку:
//          applySupply(sim);
//
//   3) Сам применитель. Якорь «function applyGhost(sim) {» — совпадений: 1.
//      Вставить ПЕРЕД ним:
//          function applySupply(sim) {
//            const L = BSUP.supplyNewDay(sim);
//            sim.sys.supplyLinks = L;           // для HUD: панель читает готовое
//            for (const e of L.events) sim.addLog(e.text, e.type);
//            return L;
//          }
//      Причины (L.reasons) целиком в журнал лить НЕ надо: они для панели,
//      иначе дневной лог превращается в рапорт обоза.
//
// ═══ ЧЕГО ЭТОТ ФАЙЛ НЕ ДЕЛАЕТ ═══
// Не списывает ресурсы, не двигает жителей, не пишет журнал и не трогает
// прогресс построек: всё это — сторона применителя. Пока никто applySupply
// не вызывает, экономика (simulation.js, test-economy/test-build2/test-production)
// не меняется ни на бит.
import { BUILDINGS } from '../data.js';
import { createRng } from '../rng.js';

// Соль своего потока случайностей. Читается как «CABBA6E» → cabbage, обоз
// с припасом: мнемоника вместо магического числа. Свой поток обязателен:
// броски в общий sim.rng сдвинули бы весь последующий мир после каждого дня.
export const SUPPLY_SEED_SALT = 0x0CABBA6E;

// Потолок одновременных доставок. Больше четырёх повозок одновременно — это
// уже не обоз маленького поселения, а транспортная компания; пусть остальное
// честно ждёт следующей ходки.
export const DELIVERIES_MAX = 4;

// Радиус столицы. Стройка ближе восьми клеток от кострища считается
// столичной и получает подвоз вне очереди.
export const CAPITAL_RADIUS = 8;

// Обоз без помощи идёт три клетки в день: туда, разгрузка, обратно.
export const PORTER_BASE_SPEED = 3;
// Каждая свободная рука ускоряет обоз почти на треть клетки в день: носильщики
// ходят навстречу друг другу с тюками. Потолок скорости — человеческий.
export const PORTER_PER_HAND = 0.35;
export const PORTER_SPEED_MAX = 12;

// Сколько единиц груза возят за день. Хижине хватает одной ходки, замку —
// двадцати двух: вот почему большой замок встаёт надолго без дорог.
export const LOAD_PER_DAY = 10;

// Нижняя граница потолка скорости. Даже совсем без обоза стройка ползёт на
// сорока процентах: строители тянут что могут на своих плечах.
export const SPEED_CAP_FLOOR = 0.4;

// Событие о подвозе — не чаще раза за пять суток. Ежедневное «повозка в пути»
// игрок читает дважды, на третий день игнорирует всё.
export const EVENT_EVERY_DAYS = 5;

function num(v, dflt = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

function clamp01(x) {
  return x < 0 ? 0 : (x > 1 ? 1 : x);
}

// Остаток сметы недостроя: сколько каждой позиции ещё должно приехать.
// Прогресс может быть битым (отрицательным, больше срока) — доля зажата в 0..1,
// чтобы мусорная запись не породила отрицательную нужду.
export function remainingNeed(def, b) {
  const cost = (def && typeof def === 'object' && def.cost) || {};
  let total = 0;
  for (const v of Object.values(cost)) total += num(v);
  if (!(total > 0)) return null; // бесплатному зданию везти нечего
  const bd = num(b && b.buildDays, 0);
  const frac = bd > 0 ? clamp01(num(b && b.progress, 0) / bd) : 0;
  const need = {};
  let units = 0;
  for (const [r, v] of Object.entries(cost)) {
    const q = Math.ceil(num(v) * (1 - frac));
    if (q > 0) { need[r] = q; units += q; }
  }
  return units > 0 ? { need, units } : null;
}

function inWorld(sim, x, y) {
  const w = sim.world;
  // Мир неизвестен или бит — координаты не проверяем, лишь бы число: выкидывать
  // стройку только потому, что у нас нет карты, было бы хуже.
  if (!w || !Number.isFinite(Number(w.w)) || !Number.isFinite(Number(w.h))) return true;
  return x >= 0 && y >= 0 && x < Number(w.w) && y < Number(w.h);
}

// ═══════════════════════════════════════════════════════════════════════════
// ЧИСТАЯ ФУНКЦИЯ ДНЯ
// ═══════════════════════════════════════════════════════════════════════════

export function supplyNewDay(sim) {
  const out = {
    mods: { buildSpeedCap: 1 },
    reasons: [],
    events: [],
    flags: { deliveries: [], served: 0, starved: 0, freeHands: 0, speed: PORTER_BASE_SPEED },
  };
  if (!sim || typeof sim !== 'object') {
    out.reasons.push('Симуляции нет — обоз спит в парке.');
    return out;
  }

  // Свой поток от сида: детерминизм без чужих бросков. Создаётся заново на
  // каждом вызове — отчёт зависит только от состояния мира и сида.
  const rng = createRng(((num(sim.seed) | 0) ^ SUPPLY_SEED_SALT) >>> 0);
  const day = Math.floor(num(sim.day));
  const rawList = Array.isArray(sim.buildings) ? sim.buildings : [];

  // --- 1. Недострои ----------------------------------------------------------
  const sites = [];
  let junkSkipped = 0;
  for (const b of rawList) {
    if (!b || typeof b !== 'object') { junkSkipped++; continue; }
    if (b.done || b.destroyed) continue; // достроенное и разрушенное — не наша забота
    const def = BUILDINGS[b.id];
    if (!def) { junkSkipped++; continue; } // неизвестный id: возить не по чему
    const x = num(b.x, NaN);
    const y = num(b.y, NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) { junkSkipped++; continue; }
    if (!inWorld(sim, x, y)) { junkSkipped++; continue; }
    const rest = remainingNeed(def, b);
    if (!rest) continue; // смета выбрана: это дострой, материалы уже на месте
    sites.push({ x, y, need: rest.need, units: rest.units });
  }

  // --- 2. Источники: склады и столица ---------------------------------------
  const sources = [];
  for (const b of rawList) {
    if (!b || typeof b !== 'object' || !b.done || b.destroyed) continue;
    const def = BUILDINGS[b.id];
    // Склад ищем по данным, а не по списку имён: у чего есть cap, то хранит.
    if (!def || !def.cap) continue;
    const x = num(b.x, NaN);
    const y = num(b.y, NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !inWorld(sim, x, y)) continue;
    sources.push({ x, y, name: def.name, capital: false });
  }
  const w = sim.world || {};
  const capX = num(w.startX);
  const capY = num(w.startY);
  // Кострище всегда принимает припас: без этого правило «везти от ближайшего
  // склада» оставило бы первую же стройку без подвоза до первого амбара.
  sources.push({ x: capX, y: capY, name: 'столица', capital: true });

  if (!sites.length) {
    out.reasons.push(junkSkipped > 0
      ? `Недостроев нет; битых записей строек пропущено: ${junkSkipped}.`
      : 'Недостроев нет — обоз стоит в парке.');
    return out;
  }

  // --- 3. Свободные руки и скорость обоза ------------------------------------
  let freeHands = 0;
  if (Array.isArray(sim.villagers)) {
    for (const v of sim.villagers) {
      if (v && typeof v === 'object' && (v.job === 'idle' || !v.target)) freeHands++;
    }
  }
  const speed = Math.min(PORTER_SPEED_MAX, PORTER_BASE_SPEED + freeHands * PORTER_PER_HAND);
  out.flags.freeHands = freeHands;
  out.flags.speed = Math.round(speed * 100) / 100;

  // Расстояние до ближайшего источника и флаг столичности — один проход,
  // до сортировки: сортировочная функция обязана быть дешёвой и честной.
  for (const s of sites) {
    s.capital = Math.hypot(s.x - capX, s.y - capY) <= CAPITAL_RADIUS;
    let bestD = Infinity;
    for (const src of sources) {
      const d = Math.hypot(s.x - src.x, s.y - src.y);
      if (d < bestD - 1e-9) bestD = d;
    }
    s.dist = bestD;
    // Жребий гасит дрожь сортировки при равных расстояниях: без него порядок
    // зависел бы от порядка зданий в массиве, а он меняется при сносах.
    s.tie = rng.next();
  }

  // --- 4. Порядок разнарядки: столица, затем близость ------------------------
  sites.sort((a, b) => {
    if (a.capital !== b.capital) return a.capital ? -1 : 1;
    if (Math.abs(a.dist - b.dist) > 1e-9) return a.dist - b.dist;
    return a.tie - b.tie;
  });

  // --- 5. Разнарядка с потолком ----------------------------------------------
  let starved = 0;
  for (const s of sites) {
    // Потолок петли: дальше повозок нет, остаток честно ждёт. Выход назван
    // словами ниже, в reasons.
    if (out.flags.deliveries.length >= DELIVERIES_MAX) { starved++; continue; }
    let src = null;
    let bd = Infinity;
    for (const cand of sources) {
      const d = Math.hypot(s.x - cand.x, s.y - cand.y);
      if (d < bd - 1e-9) { bd = d; src = cand; }
    }
    const roadDays = Math.max(1, Math.round((bd * 2) / Math.max(1, speed)));
    const haulDays = Math.max(1, Math.ceil(s.units / LOAD_PER_DAY));
    out.flags.deliveries.push({
      bx: s.x,
      by: s.y,
      need: { ...s.need },
      etaDays: roadDays + haulDays,
      from: src ? { x: src.x, y: src.y } : null,
    });
  }
  out.flags.served = out.flags.deliveries.length;
  out.flags.starved = starved;

  // --- 6. Потолок скорости недостроев ----------------------------------------
  // Все обеспечены повозками — стройка идёт в полную силу; каждый ожидающий
  // отнимает долю, но не ниже SPEED_CAP_FLOOR: строители тянут и сами.
  out.mods.buildSpeedCap = sites.length > 0
    ? Math.max(SPEED_CAP_FLOOR, Math.min(1,
        SPEED_CAP_FLOOR + (1 - SPEED_CAP_FLOOR) * (out.flags.served / sites.length)))
    : 1;

  // --- 7. Причины словами ------------------------------------------------------
  if (junkSkipped > 0) out.reasons.push(`Битых записей о стройках пропущено: ${junkSkipped}.`);
  const capitalSites = sites.reduce((n, s) => n + (s.capital ? 1 : 0), 0);
  if (capitalSites > 0) {
    out.reasons.push(`Первым подвоз в столицу: недостроев у кострища ${capitalSites} (радиус ${CAPITAL_RADIUS}).`);
  }
  if (starved > 0) {
    out.reasons.push(`Потолок обоза: одновременных доставок не больше ${DELIVERIES_MAX}, ждут своей ходки ${starved}.`);
  }
  out.reasons.push(`Свободных рук ${freeHands}: скорость обоза ${out.flags.speed} кл/день, повозок в пути ${out.flags.served}.`);

  // --- 8. Событие — одно и редко ------------------------------------------------
  // Ворота дня: любое слово игроку — не чаще раза в EVENT_EVERY_DAYS суток,
  // иначе спокойный ход засыпает журнал рапортами об одном и том же.
  if (day >= 0 && day % EVENT_EVERY_DAYS === 0 && (out.flags.served > 0 || starved > 0)) {
    if (starved > 0) {
      out.events.push({
        text: `🚚 Обоз перегружен: доставок ${out.flags.served}, строек ждёт ${starved}.`,
        type: 'warn',
      });
    } else {
      const minEta = Math.min(...out.flags.deliveries.map(d => d.etaDays));
      out.events.push({
        text: `🚚 Подвоз идёт: повозок ${out.flags.served}, первая придёт через ${minEta} дн.`,
        type: 'info',
      });
    }
  }
  return out;
}
