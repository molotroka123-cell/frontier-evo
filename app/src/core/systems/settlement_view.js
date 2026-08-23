// core/systems/settlement_view.js — производный вид поселений фракций.
//
// ЗАЧЕМ. Рендер (render/faction_town.js) и карточки UI хотят готовый силуэт
// города: ступень роста, стены, войну, свежий ущерб, население, знамя. Хранить
// это в sim нельзя: состояние, которое всегда выводится из других полей,
// раздувало бы сейвы и рассинхронивалось. Поэтому вид ЧИСТО производный —
// только чтение sim; сериализация симуляции до и после вызовов совпадает
// байт-в-байт (критичный тест).
//
// ДЕТЕРМИНИЗМ. Никакого глобального рандома и общего потока sim.rng: каждый
// вызов общего генератора сдвинул бы ход симуляции и поплыли бы реплеи. Всё
// разнообразие (знамя) — из hash2 координат, тем же кормом, что питает разброс
// в рендере, чтобы «приметы места» были согласованы на экране.
//
// КЭШ. WeakMap по объекту поселения; слот живёт, пока совпадают
// (seed мира, день) и не было явного invalidateSettlementViews(). Смена дня —
// естественная инвалидация: почти всё во виде (война, ущерб) меняется со
// временем, а P и поселения правятся раз в день.
import { hash2 } from '../../render/palette.js';

// Пороги ступеней по населению фракции P. Масштабируются эпохой: в поздних
// эрах мир крупнее, и тот же народ относительно «мельче».
const TIER_THRESHOLDS = [14, 28, 50, 80];
const ERA_SCALE = 0.35;
const MAX_TIER = 4;

// Стены считаются пересечением двух ограничений:
//   — сколько положено самой застройке по ступени города;
//   — сколько фракция в принципе способна построить и удержать (черта defense):
//     оборотистые возводят камень, «голые» обходятся частоколом и хуже.
const wallsByTier = t => (t >= 4 ? 2 : t >= 2 ? 1 : 0);
const wallsByDefense = d => (d >= 8 ? 2 : d >= 4 ? 1 : 0);

// Ущерб ищем только в свежем хвосте лога: он сам обрезается до 120 записей,
// а последние 30 покрывают текущие дни. Копать глубже — значит рисовать дым
// над набегом годичной давности.
const DAMAGE_WINDOW = 30;
// «Рядом» — пара клеток: отряд из wire_army.js выходит в поле именно к этому
// поселению, дальние цели пишут свои координаты и до чужого города не долетают.
const DAMAGE_RADIUS2 = 8 * 8;
// Военные записи помечены ⚔ (выход отряда, бой); координаты — первая пара
// чисел в скобках. Объявления войны без координат парсер пропускает сам.
const WAR_MARK = '⚔';
const COORD_RE = /\((-?\d+)[,;]\s*(-?\d+)\)/;

// --- кэш -----------------------------------------------------------------

const VIEW_CACHE = new WeakMap(); // s -> { seed, day, version, view }
let cacheVersion = 0;

export function invalidateSettlementViews() {
  // Версия вместо обхода контейнера: WeakMap не итерируется, а полный сброс
  // нужен редко (тесты, ручная правка данных) — O(1) здесь честнее.
  cacheVersion++;
}

// Свежие записи рейдов/боёв рядом с поселением. Идём с конца лога: свежий
// след важнее старого, а большинство посёлков чисто — выходим после первой
// же проверки окна.
function scanDamage(sim, sx, sy) {
  const log = sim.log;
  if (!Array.isArray(log)) return false;
  const start = Math.max(0, log.length - DAMAGE_WINDOW);
  for (let i = log.length - 1; i >= start; i--) {
    const e = log[i];
    if (!e || typeof e.text !== 'string' || e.text.indexOf(WAR_MARK) < 0) continue;
    const m = COORD_RE.exec(e.text);
    if (!m) continue;
    const dx = Number(m[1]) - sx;
    const dy = Number(m[2]) - sy;
    if (dx * dx + dy * dy <= DAMAGE_RADIUS2) return true;
  }
  return false;
}

// Сам расчёт. Порядок полей фиксирован литералом: его читают тесты и JSON-срезы.
function buildView(sim, f, s) {
  // Ступень: сколько порогов эпохи взял народ; столица тянет на ступень выше,
  // но потолок 4 никого не пускает дальше «города с башнями».
  const scale = 1 + (sim.eraIndex | 0) * ERA_SCALE;
  const P = Math.max(0, Number(f.P) || 0);
  let base = 0;
  for (let i = 0; i < TIER_THRESHOLDS.length; i++) {
    if (P >= TIER_THRESHOLDS[i] * scale) base++;
  }
  const isCapital = !!s.capital || (Array.isArray(f.settlements) && f.settlements[0] === s);
  const tier = Math.min(MAX_TIER, base + (isCapital ? 1 : 0));

  const traits = f.def && f.def.traits ? f.def.traits : null;
  const walls = Math.min(
    wallsByTier(tier),
    wallsByDefense(Number(traits && traits.defense) || 0),
  );

  // Война — только открытые реестры: войны с игроком (wars.fid) и ИИ-ИИ
  // (aiWars.a/b). Тайных намерений для вида не существует: запись есть — воюют.
  const id = f.id;
  const atWar = (Array.isArray(sim.wars) && sim.wars.some(w => w && w.fid === id))
    || (Array.isArray(sim.aiWars) && sim.aiWars.some(w => w && (w.a === id || w.b === id)));

  const damaged = scanDamage(sim, s.x | 0, s.y | 0);

  // Население делим на все поселения: вид показывает «жителей под знаменем»
  // на город, а не перепись конкретного дома.
  const nSett = Math.max(1, Array.isArray(f.settlements) ? f.settlements.length : 1);
  const pop = Math.floor(P / nSett);

  // Знамя — примета самого места: зависит только от координат, поэтому
  // стабильно по дням и переживает смену хозяина поселения.
  const banner = (hash2(s.x | 0, s.y | 0) * 3) | 0;

  return { tier, walls, atWar, damaged, pop, banner };
}

export function settlementView(sim, f, s) {
  if (!sim || !f || !s) return null;
  const seed = sim.seed >>> 0;   // сид генерации мира — он же ключ эпохи данных
  const day = sim.day | 0;
  let slot = VIEW_CACHE.get(s);
  if (!slot || slot.seed !== seed || slot.day !== day || slot.version !== cacheVersion) {
    slot = { seed, day, version: cacheVersion, view: buildView(sim, f, s) };
    VIEW_CACHE.set(s, slot);
  }
  return slot.view;
}
