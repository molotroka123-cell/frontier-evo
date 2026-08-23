// core/systems/wonders.js — ЧУДЕСА МИРА: одно на партию, одно на эпоху.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ. Чудо — это не здание: у него другая экономика смысла.
// Здание игрок ставит десятками и без оглядки, а чудо он выбирает ОДИН раз за
// партию, копит на него и помнит о нём до конца игры — и даже после того, как
// его разрушили. Такая ставка не влезает в BUILDINGS без костылей (уникальность,
// стройка на N дней, потеря эффекта, запрет второго раза) — поэтому здесь.
//
// ПРАВИЛА ЧИСТОТЫ.
//   · Модуль НИКОГДА не трогает sim напрямую, кроме команд игрока
//     (startWonder списывает цену — команда обязана менять мир, см. build2.js).
//   · Дневной ход возвращает отчёт {mods,reasons,events,flags}; применяет его
//     integrate.js. Событие завершения и разрушения несёт флаг chronicle:true —
//     летопись пополняется СОБЫТИЯМИ, а не состояниями.
//   · Ни одного броска случайности: чудеса обязаны быть воспроизводимы сидом,
//     как мир и стада. Параметр rng принят для совместимости подписей и НЕ
//     расходуется (тест ловит это по getState()).
//   · У каждого эффекта есть ПОТОЛОК-константа: прибавка от чуда не может расти
//     бесконечно ни от времени, ни от размера державы. Потолок недостижим «в
//     лоб», его нельзя обойти долгой игрой — это защита от эксплойта ожидания.

import { ERAS, RES, TILE } from '../data.js';
import { tileAt } from '../world.js';

// ═══════════════════════════════════════════════════════════════════════════
// ПОТОЛКИ И ПАРАМЕТРЫ (экспортируются: на них опирается тест)
// ═══════════════════════════════════════════════════════════════════════════

// Сколько чудес можно возвести за партию. Ровно одно: выбор чуда — это выбор
// судьбы державы, а не строчка в очереди покупок.
export const WONDERS_PER_RUN = 1;

// Сколько раз чудо может быть разрушено за партию. Один: повторное взятие
// поселения не должно превращаться в «добычу чуда» и бесконечный источник
// драмы в летописи — первое падение уже всё сказало.
export const DESTROY_MAX = 1;

// Большой Стоян: еда в день и жёсткий потолок этой прибавки. Потолок выше
// базовой ставки — он страхует будущие усиления и явно говорит тесту и игроку,
// что «больше 4 хлебов в день Стоян не даст никогда».
export const STOYAN_FOOD_DAY = 2.5;
export const STOYAN_FOOD_CAP = 4;

// Курган Предков: законность рода растёт медленно и только до отметки ниже
// LEGIT_THRONE_CAP из link_dynasty.js — курган укрепляет дом, но не заменяет
// правление. Выше 75 народ уже не любит «за камни».
export const KURGAN_LEGIT_RATE = 0.06;
export const KURGAN_LEGIT_CAP = 75;

// Стена Столетий: плоская прибавка к обороне поселения с потолком. Оборона
// складывается из зданий, и чудо не имеет права делать осады бессмысленными.
export const WALL_DEF_BONUS = 12;
export const WALL_DEF_CAP = 18;

// Великий Тракт: множитель дохода торговых путей (совместим с globalMult
// ядра) и общий потолок множителя — чудо усиливает торговлю, но не съедает её.
export const TRACT_GOLD_MULT = 1.25;
export const TRACT_MULT_CAP = 1.4;

// Академия Звездочётов: множитель науки и его потолок. Наука — самый стекуемый
// ресурс игры, поэтому потолок здесь строже всех.
export const ACADEMY_KNOW_MULT = 1.12;
export const ACADEMY_MULT_CAP = 1.25;

// Чудо-Гавань: золото с каждой водной клетки вокруг поселения и суточный
// потолок. Без потолка приморский старт с гаванью печатал бы бесконечную казну.
export const HARBOR_GOLD_PER_TILE = 0.35;
export const HARBOR_GOLD_CAP = 6;
export const HARBOR_RADIUS = 7;

// Длительность строек в днях. Чудо строится ГОРАЗДО дольше любого здания —
// иначе это не подвиг, а заказ из каталога.
export const WONDER_DAYS_DEFAULT = 20;

// ═══════════════════════════════════════════════════════════════════════════
// ДАННЫЕ ШЕСТИ ЧУДЕС — по одному на эпоху 0…5 (см. ERAS в core/data.js)
// effect.cap — потолок соответствующей прибавки; тексты — словами для игрока.
// ═══════════════════════════════════════════════════════════════════════════

export const WONDERS = {
  great_camp: {
    id: 'great_camp', ru: 'Большой Стоян', icon: '🏕',
    era: 0, // Каменный век
    cost: { wood: 80 },
    days: 10,
    effect: { kind: 'foodDay', perDay: STOYAN_FOOD_DAY, cap: STOYAN_FOOD_CAP },
    text: 'Вечное стойбище у большой воды: табуны подходят сами, ягодные поля не истощаются. Поселение получает хлеб из воздуха — понемногу, каждый день.',
  },
  kurgan: {
    id: 'kurgan', ru: 'Курган Предков', icon: '⛰',
    era: 1, // Бронзовый век
    cost: { wood: 60, stone: 45 },
    days: 14,
    effect: { kind: 'legit', rate: KURGAN_LEGIT_RATE, cap: KURGAN_LEGIT_CAP },
    text: 'Курган первых вождей, каких помнит степь. Пока он стоит, род правит по праву крови: законность двора медленно, но верно крепнет — до известного предела.',
  },
  wall_centuries: {
    id: 'wall_centuries', ru: 'Стена Столетий', icon: '🧱',
    era: 2, // Железный век
    cost: { wood: 40, stone: 120 },
    days: 18,
    effect: { kind: 'defense', bonus: WALL_DEF_BONUS, cap: WALL_DEF_CAP },
    text: 'Её клали прадеды, достраивали деды, стояли на ней отцы. Поселение получает постоянную прибавку к обороне — враги считают камни, а не ваши стрелы.',
  },
  great_tract: {
    id: 'great_tract', ru: 'Великий Тракт', icon: '🛤',
    era: 3, // Античность
    cost: { wood: 90, stone: 70, gold: 60 },
    days: 22,
    effect: { kind: 'mult', stat: 'gold', mult: TRACT_GOLD_MULT, cap: TRACT_MULT_CAP },
    text: 'Вымощенная артерия между рынками мира. Все торговые пути богатее: караваны идут быстрее и довозят больше золота, чем когда-либо.',
  },
  star_academy: {
    id: 'star_academy', ru: 'Академия Звездочётов', icon: '🔭',
    era: 4, // Средневековье
    cost: { stone: 100, gold: 120, knowledge: 150 },
    days: 26,
    effect: { kind: 'mult', stat: 'knowledge', mult: ACADEMY_KNOW_MULT, cap: ACADEMY_MULT_CAP },
    text: 'Башня, из которой смотрят не на соседей, а на звёзды. Вся наука державы ускоряется: переписчики, лекари и механики учатся быстрее.',
  },
  miracle_harbor: {
    id: 'miracle_harbor', ru: 'Чудо-Гавань', icon: '⚓',
    era: 5, // Ренессанс
    cost: { stone: 140, steel: 40, gold: 180 },
    days: 30,
    effect: { kind: 'waterGold', perTile: HARBOR_GOLD_PER_TILE, radius: HARBOR_RADIUS, cap: HARBOR_GOLD_CAP },
    text: 'Молы, маяк и прилив, который сам приносит товар. Каждая водная клетка вокруг поселения платит золотом — но море щедро лишь до меры.',
  },
};

// Русское имя ресурса-иконкой для строк эффекта (RES из data.js).
function _icon(resId) {
  const m = RES.find(r => r.id === resId);
  return m ? m.icon : resId;
}

// Эффект словами — с числом и потолком. Игрок обязан видеть не только «что
// даст», но и «больше чего не даст»: скрытые потолки портят доверие к игре.
export function effectText(def) {
  const e = def.effect;
  switch (e.kind) {
    case 'foodDay': return `+${e.perDay}${_icon('food')}/день (потолок ${e.cap}/день)`;
    case 'legit': return `+законность рода ${e.rate}/день (до ${e.cap})`;
    case 'defense': return `+${e.bonus} к обороне поселения (потолок ${e.cap})`;
    case 'mult': return `${e.stat === 'gold' ? 'торговые пути' : 'наука'} ×${e.mult} (потолок ×${e.cap})`;
    case 'waterGold': return `+${e.perTile}${_icon('gold')} с водной клетки (до ${e.cap}${_icon('gold')}/день)`;
    default: return '';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// СОСТОЯНИЕ
// ═══════════════════════════════════════════════════════════════════════════

export function createWonders() {
  return {
    v: 1,
    day: -1,            // сутки последнего тика: второй тик того же дня молчит
    builtId: null,      // какое чудо выбрано в этой партии (раз и навсегда)
    progress: 0,        // накоплено дней стройки
    buildDays: 0,       // длительность стройки, зафиксированная при закладке
    done: false,
    destroyed: false,   // разрушено при взятии поселения
    destroyedCount: 0,  // сколько раз разрушалось (потолок DESTROY_MAX)
    destroyedDay: null, // день разрушения — для летописи и панели
    builtDay: null,     // день завершения стройки
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// КОМАНДЫ ИГРОКА (единственные функции файла, меняющие мир напрямую)
// ═══════════════════════════════════════════════════════════════════════════

// Можно ли начать именно это чудо. Причины отказа — всегда словами: карточка
// в HUD показывает их как есть, поэтому формулировки — часть интерфейса.
export function canStartWonder(sim, id) {
  const def = WONDERS[id];
  if (!def) return { ok: false, reason: 'Такого чуда не существует' };
  const st = sim.wonders || (sim.wonders = createWonders());
  if (st.builtId) {
    const had = WONDERS[st.builtId];
    return {
      ok: false,
      reason: st.builtId === id
        ? (st.done ? `«${had.ru}» уже стоит` : `«${had.ru}» уже строится`)
        : `Чудо в этой партии уже было: «${had.ru}». Второго не будет`,
    };
  }
  if ((sim.eraIndex | 0) < def.era) {
    return { ok: false, reason: `Чудо принадлежит эпохе «${ERAS[def.era].ru}»` };
  }
  const lack = typeof sim.lackCost === 'function' ? sim.lackCost(def.cost) : null;
  if (lack) return { ok: false, reason: `Не хватает: ${lack}` };
  return { ok: true };
}

// Заложить чудо. Цена списывается сразу (как у зданий ядра): замысел без
// оплаты превратил бы чудо в ещё один чертёж, а оно того дороже.
export function startWonder(sim, id) {
  const chk = canStartWonder(sim, id);
  if (!chk.ok) return chk;
  const def = WONDERS[id];
  if (typeof sim.payCost === 'function') sim.payCost(def.cost);
  const st = sim.wonders || (sim.wonders = createWonders());
  st.builtId = id;
  st.progress = 0;
  st.buildDays = def.days || WONDER_DAYS_DEFAULT;
  st.done = false;
  st.destroyed = false;
  return { ok: true, id, days: st.buildDays };
}

// ═══════════════════════════════════════════════════════════════════════════
// АКТИВНЫЙ ЭФФЕКТ — то, что читает ядро
// ═══════════════════════════════════════════════════════════════════════════

// Живо ли чудо: построено и не разрушено. Разрушенное чудо эффект теряет
// полностью — руины вдохновляют только летописцев.
function _active(st) {
  return !!(st && st.done && !st.destroyed);
}

// Множитель для globalMult(kind) ядра. Совместим по форме: ядро домножает
// свой стек на возвращённое число. Потолок применён и здесь, а не только в
// данных: данные могут поправить балансом, этот кламп — последняя линия.
export function wonderGlobalMult(sim, kind) {
  const st = sim && sim.wonders;
  if (!_active(st)) return 1;
  const e = WONDERS[st.builtId] && WONDERS[st.builtId].effect;
  if (!e || e.kind !== 'mult' || e.stat !== kind) return 1;
  return Math.min(e.cap || Infinity, e.mult);
}

// Плоская прибавка к обороне поселения (для defensePower ядра).
export function wonderDefense(sim) {
  const st = sim && sim.wonders;
  if (!_active(st)) return 0;
  const e = WONDERS[st.builtId] && WONDERS[st.builtId].effect;
  if (!e || e.kind !== 'defense') return 0;
  return Math.min(e.cap || Infinity, e.bonus);
}

// Сколько водных клеток вокруг сердца поселения. Без мира (тесты, стол) воды
// нет — гавань честно не приносит ничего, а не падает.
function _waterTiles(sim) {
  if (!sim.world || typeof tileAt !== 'function') return 0;
  let cx = sim.world.startX, cy = sim.world.startY;
  const camp = Array.isArray(sim.buildings)
    ? sim.buildings.find(b => b.id === 'campfire' && !b.destroyed) : null;
  if (camp) { cx = camp.x; cy = camp.y; }
  const r = HARBOR_RADIUS;
  let n = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const t = tileAt(sim.world, Math.round(cx) + dx, Math.round(cy) + dy);
      if (t === TILE.WATER || t === TILE.DEEP) n++;
    }
  }
  return n;
}

// Текущая законность рода — читаем память связи династии. Если её нет (ранние
// дни, тесты), считаем от стартовой отметки link_dynasty.js: курган не должен
// получать бесконечный запас хода от незнания.
const LEGIT_START_FALLBACK = 55;
function _legitNow(sim) {
  const L = sim.linkDynasty && Number.isFinite(Number(sim.linkDynasty.legitimacy))
    ? Number(sim.linkDynasty.legitimacy)
    : LEGIT_START_FALLBACK;
  return Math.max(0, Math.min(100, L));
}

// ═══════════════════════════════════════════════════════════════════════════
// ДНЕВНОЙ ХОД — чистая функция отчёта
// ═══════════════════════════════════════════════════════════════════════════

export function wondersNewDay(sim, rng /* резервируется; кубики чуду не нужны */) {
  void rng; // детерминизм: бросок сдвинул бы общий поток случайностей партии
  const out = {
    mods: { res: {}, legit: 0, defenseFlat: 0, globalMult: {} },
    reasons: [],
    events: [],
    flags: { builtId: null, completed: false, destroyedNow: false, active: false },
  };
  if (!sim.wonders) sim.wonders = createWonders();
  const st = sim.wonders;
  out.flags.builtId = st.builtId;
  const day = sim.day | 0;
  if (st.day === day) return out; // второй вызов тех же суток — молчание
  st.day = day;

  const def = st.builtId ? WONDERS[st.builtId] : null;
  if (!def) return out; // чудо ещё не выбрано: тишина — тоже состояние партии

  // --- Разрушение при взятии поселения -------------------------------------
  // Взятие видит только по свежей записи empire.state.lost (списки ведут
  // empire.js и связи) — разбирать летопись строками запрещено правилами.
  // Потолок DESTROY_MAX: вторая потеря поселения чудо уже не трогает.
  const lost = sim.empire && sim.empire.state && Array.isArray(sim.empire.state.lost)
    ? sim.empire.state.lost : [];
  const capturedToday = lost.some(l => l && l.day === day);
  if (_active(st) && capturedToday && st.destroyedCount < DESTROY_MAX) {
    st.destroyed = true;
    st.destroyedCount += 1;
    st.destroyedDay = day;
    out.flags.destroyedNow = true;
    out.events.push({
      text: `💀 ${def.icon} «${def.ru}» разрушено при взятии поселения. Его сила ушла навсегда.`,
      type: 'bad',
      chronicle: true,
    });
    out.reasons.push(`«${def.ru}» лежит в руинах: разрушено в день ${day}.`);
    return out; // в день гибели чудо уже не работает — эффект теряется сразу
  }

  // --- Стройка ---------------------------------------------------------------
  if (!st.done) {
    st.progress += 1;
    if (st.progress >= st.buildDays) {
      st.done = true;
      st.builtDay = day;
      out.flags.completed = true;
      out.events.push({
        text: `🏛 Народ завершил великий труд: ${def.icon} «${def.ru}» возведено! ${def.text}`,
        type: 'good',
        chronicle: true,
      });
      out.reasons.push(`«${def.ru}» достроено за ${st.buildDays} дней.`);
    } else {
      out.reasons.push(`«${def.ru}»: стройка идёт, день ${st.progress} из ${st.buildDays}.`);
      return out; // стройка эффектов ещё не даёт
    }
  }

  // --- Действующий эффект (с потолками) --------------------------------------
  if (!_active(st)) return out;
  out.flags.active = true;
  const e = def.effect;

  if (e.kind === 'foodDay') {
    // Еда упирается в три потолка сразу: ставку дня, потолок чуда и свободное
    // место на складе. Полный амбар не даёт чуду копить сверх меры.
    const room = Math.max(0, (sim.resCap && sim.resCap.food != null ? sim.resCap.food : Infinity) - (sim.res ? sim.res.food || 0 : 0));
    const gain = Math.min(e.perDay, e.cap, room);
    if (gain > 0) out.mods.res.food = (out.mods.res.food || 0) + gain;
    if (gain < e.perDay) out.reasons.push('Стоян даёт меньше: амбар полон.');
  }

  if (e.kind === 'legit') {
    const headroom = Math.max(0, e.cap - _legitNow(sim));
    const d = Math.min(e.rate, headroom);
    if (d > 0) out.mods.legit = d;
    else out.reasons.push('Курган больше не добавляет: род утвердился.');
  }

  if (e.kind === 'defense') {
    out.mods.defenseFlat = Math.min(e.cap || Infinity, e.bonus);
  }

  if (e.kind === 'mult') {
    out.mods.globalMult[e.stat] = Math.min(e.cap || Infinity, e.mult);
  }

  if (e.kind === 'waterGold') {
    const n = _waterTiles(sim);
    const gain = Math.min(e.cap, n * e.perTile);
    if (gain > 0) out.mods.res.gold = (out.mods.res.gold || 0) + gain;
    if (gain >= e.cap) out.reasons.push('Гавань вышла на предел щедрости моря.');
  }

  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// ОТЧЁТ ДЛЯ HUD — слова и готовые числа, панель не считает сама
// ═══════════════════════════════════════════════════════════════════════════

export function wonderReport(sim) {
  const st = sim.wonders || createWonders();
  const eraIdx = sim.eraIndex | 0;
  const catalog = Object.values(WONDERS).map(def => ({
    id: def.id,
    ru: def.ru,
    icon: def.icon,
    eraName: ERAS[def.era] ? ERAS[def.era].ru : `эпоха ${def.era}`,
    available: eraIdx >= def.era,
    chosen: st.builtId === def.id,
    cost: def.cost,
    days: def.days,
    effectRu: effectText(def),
    text: def.text,
  }));
  const base = {
    has: !!st.builtId,
    catalog,
    canStart: st.builtId ? { ok: false, reason: 'Чудо в этой партии уже выбиралось' } : null,
  };
  if (!st.builtId) {
    const open = catalog.find(c => c.available);
    base.statusWord = 'Не выбрано';
    base.hint = open ? `Доступно с эпохи «${open.eraName}» — успейте выбрать одно.` : '';
    return base;
  }
  const def = WONDERS[st.builtId];
  base.canStart = canStartWonder(sim, st.builtId);
  base.name = def.ru;
  base.icon = def.icon;
  base.effectRu = effectText(def);
  base.text = def.text;
  if (st.destroyed) {
    base.statusWord = 'Разрушено';
    base.hint = `Пало в день ${st.destroyedDay}. Эффект утрачен навсегда.`;
    return base;
  }
  if (!st.done) {
    base.statusWord = 'Строится';
    base.progress = st.progress;
    base.buildDays = st.buildDays;
    base.daysLeft = Math.max(0, st.buildDays - st.progress);
    base.hint = `Камень кладут ${st.progress}-й день из ${st.buildDays}: осталось ~${base.daysLeft} дн.`;
    return base;
  }
  base.statusWord = 'Стоит';
  base.hint = `Возведено в день ${st.builtDay}. ${effectText(def)}.`;
  return base;
}

// ═══════════════════════════════════════════════════════════════════════════
// СОХРАНЕНИЕ — круговое бит-в-бит
// ═══════════════════════════════════════════════════════════════════════════

export function serializeWonders(state) {
  if (!state) return null;
  return {
    v: 1,
    day: state.day,
    builtId: state.builtId || null,
    progress: state.progress,
    buildDays: state.buildDays,
    done: !!state.done,
    destroyed: !!state.destroyed,
    destroyedCount: state.destroyedCount,
    destroyedDay: state.destroyedDay,
    builtDay: state.builtDay,
  };
}

export function restoreWonders(data) {
  const s = createWonders();
  if (!data || typeof data !== 'object') return s;
  s.day = num(data.day, -1);
  s.builtId = WONDERS[data.builtId] ? data.builtId : null; // чужие id из будущего сейва молча отбрасываются
  s.progress = Math.max(0, num(data.progress, 0));
  s.buildDays = Math.max(0, num(data.buildDays, 0));
  s.done = !!data.done;
  s.destroyed = !!data.destroyed;
  s.destroyedCount = Math.max(0, num(data.destroyedCount, 0)) % (DESTROY_MAX + 1);
  s.destroyedDay = num(data.destroyedDay, null);
  s.builtDay = num(data.builtDay, null);
  return s;
}

// ─── Мелочи ───
function num(v, def) { return Number.isFinite(v) ? v : def; }

/* ПОДКЛЮЧЕНИЕ ─────────────────────────────────────────────────────────────────

1) integrate.js — вызов в новый день (применитель отчёта):

   ЯКОРЬ A (импорт, после строки `import * as HERD from './herds.js';`, Grep=1):
     import * as WON from './wonders.js';

   ЯКОРЬ B (installSystems, после строки `sim.herds = HERD.createHerds();`, Grep=1):
     // Чуда: одно на партию. Состояние пустое до первого выбора игрока.
     sim.wonders = WON.createWonders();

   ЯКОРЬ C (systemsNewDay, после строки `applyHerds(sim);` и ДО applyMemoryLinks, Grep=1):
     // Чудеса идут перед памятью: завершение или гибель чуда — событие тех же
     // суток, которое летопись обязана застать.
     applyWonders(sim);

   ЯКОРЬ D (новая функция рядом с applyHerds, вставить ЦЕЛИКОМ):
     // Применитель отчёта чудес. Модуль считает — здесь начисляем.
     function applyWonders(sim) {
       if (!sim.wonders) sim.wonders = WON.createWonders();
       const rep = WON.wondersNewDay(sim, sim.rng);
       sim.sys.wonderRep = rep;                       // для HUD: готовые числа
       for (const [r, add] of Object.entries(rep.mods.res)) {
         if (!(r in sim.res) || !add) continue;
         sim.res[r] = Math.min(sim.resCap[r] ?? 99999, sim.res[r] + add);
       }
       if (rep.mods.legit > 0 && sim.linkDynasty) {
         sim.linkDynasty.legitimacy = Math.min(100, (Number.isFinite(Number(sim.linkDynasty.legitimacy))
           ? Number(sim.linkDynasty.legitimacy) : 55) + rep.mods.legit);
       }
       // Плоская оборона и множители читаются ядром через WONDER.wonderDefense /
       // wonderGlobalMult (см. блок simulation.js) — здесь они не начисляются.
       for (const r of rep.reasons) if (/руин|предел|полон|утвердился/.test(r)) sim.addLog(r, 'info');
       for (const e of rep.events) {
         sim.addLog(e.text, e.type === 'good' ? 'good' : e.type);
         if (e.chronicle) sim.addChronicle(e.text);
       }
       return rep;
     }

   ЯКОРЬ E (для панели «Стройка», рядом с export function buildQueue..., Grep=1):
     export function wonderPanel(sim) { return WON.wonderReport(sim); }

2) simulation.js — сериализация и чтение эффекта ядром:

   ЯКОРЬ A (импорт, после строки `import { wearWorkMult } ...`, Grep=1):
     import * as WONDER from './systems/wonders.js';

   ЯКОРЬ B (serialize(), внутри возвращаемого объекта, после строки `sys: systemsSerialize(this),`, Grep=1):
       wonders: WONDER.serializeWonders(this.wonders),

   ЯКОРЬ C (static deserialize(...), после строки `systemsRestore(sim, data.sys);`, Grep=1):
     // Чудо переживает сейв целиком: стройка, руины и потолки разрушений.
     sim.wonders = WONDER.restoreWonders(data.wonders);

   ЯКОРЬ D (globalMult(kind), последней строкой перед `return mult;`, Grep=1):
     // Чудо-множители (Тракт, Академия) встают в тот же стек, что здания и технологии.
     mult *= WONDER.wonderGlobalMult(this, kind);

   ЯКОРЬ E (defensePower(), последней строкой перед `return def;`, Grep=1):
     // Стена Столетий: постоянная прибавка, пока чудо не разрушено.
     def += WONDER.wonderDefense(this);

3) hud.js — карточка в Стройке, категория «Культ и Чудеса»:

   ЯКОРЬ A (импорт, дополнить строку `import { PANELS, memoryPanel, ...` , Grep=1):
     import { wonderPanel } from '../core/systems/integrate.js';

   ЯКОРЬ B (panel_build(), перед финальным `return html;`, Grep=1):
     // Культ и Чудеса: одна карточка судьбы вместо сетки построек.
     const wpnl = wonderPanel(s);
     html += `<h4 class="group">Культ и Чудеса</h4>`;
     for (const w of wpnl.catalog) {
       const dis = !w.available || wpnl.has;
       const why = wpnl.has ? 'Чудо в этой партии уже выбрано'
         : !w.available ? `Эпоха: ${w.eraName}` : '';
       html += `<div class="card ${dis ? 'disabled' : ''} ${wpnl.has && w.chosen ? 'done-card' : ''}" data-wonder="${w.id}">
         <div class="ttl"><span>${w.icon} ${w.ru}</span><span class="cost">${this.costStr(w.cost)}</span></div>
         <div class="desc">${w.effectRu}</div>
         <div class="desc">${w.text}</div>
         ${why ? `<div class="reason">${why}</div>` : ''}
       </div>`;
     }
     if (wpnl.has) {
       html += `<div class="card ${wpnl.statusWord === 'Разрушено' ? 'disabled' : 'done-card'}">
         <div class="ttl"><span>${wpnl.icon} ${wpnl.name}</span><span>${wpnl.statusWord}</span></div>
         <div class="desc">${wpnl.hint || ''}</div></div>`;
     }

   ЯКОРЬ C (обработчик кликов там, где ветвится data-build/data-tech, добавить ветку, Grep=1):
     const wk = t.getAttribute && t.getAttribute('data-wonder');
     if (wk) {
       const r = WON.startWonder(this.sim, wk); // импорт startWonder из wonders.js
       this.sim.toast(r.ok ? `Заложено чудо «${WON.WONDERS[wk].ru}»!` : r.reason, r.ok ? 'good' : 'warn');
     }

────────────────────────────────────────────────────────────────────────────── */
