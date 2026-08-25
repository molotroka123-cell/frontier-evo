// core/simulation.js — сердце игры (engine-agnostic, без DOM).
// Вся логика читает таблицы data.js; весь рандом — через детерминированный rng.
import { createRng, makeNoise2D } from './rng.js';
import * as D from './data.js';
import { generateWorld, tileAt, isWater, stepToward, findNearestTile, hasNeighborTile, makeAnimal, aStar, findFactionSpawns } from './world.js';
import { TILE, WALKABLE, ERAS, TECHS, TECH_ERA_IDX, BUILDINGS, BUILDING_ERA_IDX, SPIRE_STAGES, UNITS, TRAIN_COST, ARMY_UPKEEP, COUNTERS, FACTIONS, DIPLO_FACTORS, MARKET_BASE, SEASONS, DAYS_PER_SEASON, WEATHER_TABLE, WEATHER, EVENT_DEFS, OBJECTIVES, NAMES, NICKNAMES, GREAT_TYPES, SAVE_VERSION } from './data.js';
import { installSystems, systemsNewDay, systemsFactions, systemsHappyMod, systemsWorkMult, systemsPopCapMod, systemsSerialize, systemsRestore, herdsNearest, herdsHunt } from './systems/integrate.js';
import { memoryEatMult } from './systems/link_memory.js';
import { wearWorkMult } from './systems/build2.js';
// Чуда мира: сериализация состояния и чтение эффекта ядром.
import * as WONDER from './systems/wonders.js';

export const DAY_SECONDS = 6;
const EAT_PER_DAY = 0.7;
// Максимум строителей на одном объекте. buildDays задаёт срок именно при такой бригаде.
const BUILDERS_PER_SITE = 3;
// Требование дани: раньше без ограничений — прилетало каждые 5 дней с начала игры.
const TRIBUTE_MIN_DAY = 60;        // первые два месяца игрока не трогают
const TRIBUTE_GAP = 45;            // между любыми двумя требованиями
const TRIBUTE_GAP_FACTION = 120;   // от одного и того же соседа
const TRIBUTE_POWER_RATIO = 1.5;   // вымогатель должен быть в полтора раза сильнее
const MOVE_SPEED = 7;

const TECH_BY_ID = Object.fromEntries(TECHS.map(t => [t.id, t]));

export class Simulation {
  constructor(seed = 20260730, opts = {}) {
    this.seed = seed >>> 0;
    this.rng = createRng(this.seed);
    this.rng.noise = makeNoise2D(createRng(this.seed ^ 0x9e3779b9));
    this.world = generateWorld(this.seed, this.rng);
    this.res = { food: 40, wood: 30, stone: 10, steel: 0, gold: 0, knowledge: 0 };
    this.resCap = { food: 200, wood: 400, stone: 400, steel: 500, gold: 99999, knowledge: 99999 };
    this.techs = new Set(['fire']);
    this.buildings = [];
    this.villagers = [];
    this.animals = [];
    this.army = { soldiers: 0, powerBonus: 0, trainQueue: 0, trainProgress: 0 };
    this.day = 0;
    this.dayTime = 0.35; // 0..1 внутри дня
    this.seasonIdx = 0;
    this.weather = 'sun';
    this.eraIndex = 0;
    this.eraDay = 0; // день внутри эпохи
    this.newEra = null; // для баннера
    this.log = [];
    this.chronicle = []; // {day, era, text}
    this.toasts = [];
    this.speed = 1;
    this.paused = false;
    this.godmode = false;
    this.fastResearch = false;
    this.ngPlus = !!opts.ngPlus;
    this.difficulty = opts.difficulty || 'normal';
    this.factionCount = opts.factions ?? 3;
    // стройка
    this.placing = null;
    this.buildQueue = [];
    // события
    this.pendingEvent = null;
    this.eventCooldown = 10;
    this.farmPenaltyDays = 0;
    this.dcPenaltyDays = 0;
    // армия/рейды
    this.raids = { timer: this.rng.int(40, 70), warning: false, power: 0, from: null, off: false };
    this.repelled = 0;
    this.lastRaidDay = -999;
    // торговля
    this.caravanTimer = 15;
    this.market = { hist: [], prices: { ...MARKET_BASE } };
    // шпиль
    this.spire = { placed: false, stage: 0, progress: 0, invested: SPIRE_STAGES.map(() => ({ food: 0, wood: 0, stone: 0, steel: 0, gold: 0, knowledge: 0 })) };
    this.won = false;
    this.freePlay = false;
    // миссии космопорта
    this.mission = null; // {type:'moon'|'mars', daysLeft}
    this.moonDone = false; this.marsDone = false;
    // великие люди
    this.greatPeople = [];
    this.pendingGreat = null;
    // труд: приоритеты отраслей 1..4
    this.labor = { food: 4, wood: 3, stone: 2, science: 2, build: 3 };
    // фракции
    this.factions = [];
    this.relations = {}; // fid -> R (-100..100)
    this.relFactors = {}; // fid -> [{key, dR, daysLeft...}]
    this.treaties = []; // {a:'player', b:fid, type:'trade'}
    this.wars = []; // {fid, ws, daysLeft...} — войны с игроком
    this.aiWars = []; // войны ИИ-ИИ {a,b,ws}
    this.diploLog = {};
    this.showTerritory = false;
    // метрики
    this.tickMs = 0;
    this.unhappyDays = 0;
    this.autosaveRequested = false;

    // стартовое поселение
    const { startX, startY } = this.world;
    this.placeFree('campfire', startX, startY);
    for (let i = 0; i < 6; i++) this.spawnVillager(startX + this.rng.range(-2, 2), startY + this.rng.range(-2, 2));
    // животные
    for (let i = 0; i < 26; i++) {
      const p = this.randomLand(8, 30);
      if (p) this.animals.push(makeAnimal(this.rng, 'deer', p.x, p.y));
    }
    for (let i = 0; i < 2; i++) {
      const p = this.randomLand(15, 35);
      if (p) this.animals.push(makeAnimal(this.rng, 'mammoth', p.x, p.y));
    }
    // фракции
    this.spawnFactions();
    // подсистемы (зима, границы) — ставятся последними: им нужен готовый мир
    installSystems(this);
    // Старт не с каменного века. Игрок выбирает эпоху на экране новой игры;
    // мы выдаём ему всё, что народ к этому времени уже знал и построил бы,
    // иначе «начать с античности» означало бы античный год с каменным топором.
    if (opts.startEra > 0) this.startFromEra(Math.min(9, opts.startEra | 0));
    this.addChronicle(`Основание поселения. ${ERAS[0].ru}, ${ERAS[0].years}.`);
    this.addLog('Поселение основано. Постройте Хижину — цели слева подскажут путь.');
  }

  // Разворачивает партию в указанной эпохе: технологии, ресурсы, население
  // и опорные постройки. Числа подобраны так, чтобы старт был играбельным,
  // а не «всё уже построено»: даём фундамент, дальше игрок сам.
  startFromEra(idx) {
    this.eraIndex = idx;
    this.eraDay = 0;

    // 1. Технологии: всё, что относится к этой эпохе и более ранним.
    for (const t of TECHS) {
      if ((TECH_ERA_IDX[t.id] ?? 0) <= idx) this.techs.add(t.id);
    }

    // 2. Ресурсы и склады растут с эпохой — иначе первый же день заканчивается
    //    голодом при населении, которое эпохе положено.
    const k = 1 + idx * 0.9;
    this.res.food = Math.round(120 * k);
    this.res.wood = Math.round(90 * k);
    this.res.stone = Math.round(60 * k);
    this.res.steel = idx >= 6 ? Math.round(40 * (idx - 5)) : 0;
    this.res.gold = idx >= 2 ? Math.round(80 * (idx - 1)) : 0;
    this.res.knowledge = 0;
    this.resCap.food = 200 + idx * 220;
    this.resCap.wood = 400 + idx * 260;
    this.resCap.stone = 400 + idx * 260;

    // 3. Опорные постройки: по одной ключевой из каждой пройденной эпохи,
    //    поставленные вокруг кострища. Ставим бесплатно и сразу готовыми.
    const CORE = ['hut', 'granary', 'smithy', 'temple', 'stone_house', 'market',
      'university', 'factory', 'lab', 'datacenter'];
    const cx = this.world.startX, cy = this.world.startY;
    let ring = 2, slot = 0;
    for (let e = 0; e <= idx; e++) {
      const id = CORE[e];
      if (!id || !BUILDINGS[id]) continue;
      // По спирали вокруг центра, пропуская занятое и непригодное.
      for (let tries = 0; tries < 24; tries++) {
        const ang = (slot++ / 6) * Math.PI * 2;
        const x = Math.round(cx + Math.cos(ang) * ring);
        const y = Math.round(cy + Math.sin(ang) * ring);
        if (this.canPlace(id, x, y).ok) {
          const b = this.placeFree(id, x, y);
          const built = this.buildingAt(x, y);
          if (built) { built.done = true; built.progress = 1; }
          void b;
          break;
        }
        if (slot % 6 === 0) ring++;
      }
    }

    // 4. Население под эпоху, но не больше, чем есть жильё.
    const want = Math.min(6 + idx * 3, this.housingCap());
    while (this.villagers.length < want) {
      this.spawnVillager(cx + this.rng.range(-3, 3), cy + this.rng.range(-3, 3));
    }

    this.addChronicle(`Партия начата в эпоху: ${ERAS[idx].ru} (${ERAS[idx].years}).`);
    this.addLog(`Начало в эпоху «${ERAS[idx].ru}»: технологии и первые постройки уже есть.`, 'good');
  }

  randomLand(minR, maxR) {
    const { startX, startY } = this.world;
    for (let i = 0; i < 40; i++) {
      const a = this.rng.range(0, Math.PI * 2), r = this.rng.range(minR, maxR);
      const x = Math.round(startX + Math.cos(a) * r), y = Math.round(startY + Math.sin(a) * r);
      if (x < 1 || y < 1 || x >= this.world.w - 1 || y >= this.world.h - 1) continue;
      if (WALKABLE.has(tileAt(this.world, x, y))) return { x, y };
    }
    return null;
  }

  // ---------- Лог / хроника / тосты ----------
  addLog(text, type = 'info') {
    this.log.push({ day: this.day, text, type });
    if (this.log.length > 120) this.log.splice(0, this.log.length - 120);
  }
  addChronicle(text) { this.chronicle.push({ day: this.day, era: this.eraIndex, text }); }
  toast(text, type = 'info') { this.toasts.push({ text, type, t: 3 }); this.addLog(text, type); }

  // Дерево кончилось и добывать его нечем: единственные постройки, дающие дерево,
  // сами стоят дерева. Порог 12 — чуть выше цены лесопилки (10), чтобы жители
  // прекращали собирать валежник, как только выход из тупика уже оплачен.
  woodCrisis() {
    if (this.res.wood >= 12) return false;
    return !this.buildings.some(b => b.done && !b.destroyed
      && BUILDINGS[b.id].out && BUILDINGS[b.id].out.wood);
  }

  // Голодный кризис имеет смысл, только если склад вообще способен вместить
  // запас. Порог «пяти дней еды» растёт вместе с населением: при 58 жителях он
  // превышает базовую крышу амбаров (200), и город с ПОЛНЫМ складом навсегда
  // считался голодающим — мастеров разгоняли со рабочих мест, стройка оставалась
  // без рук, рост молча вставал (софтлок на 57+). Еда под самой крышей кризисом
  // не считается; почему остановился рост, объясняет отдельное событие в
  // летописи — см. onNewDay.
  inFoodCrisis() {
    if (!this.villagers.length) return false;
    if (this.res.food >= this.resCap.food - 1e-9) return false;
    return this.res.food < this.villagers.length * EAT_PER_DAY * 5;
  }

  // ---------- Фракции ----------
  spawnFactions() {
    const count = Math.min(this.factionCount, FACTIONS.length);
    const picks = [];
    const pool = [...FACTIONS];
    while (picks.length < count) picks.push(pool.splice(this.rng.int(0, pool.length - 1), 1)[0]);
    const spawns = findFactionSpawns(this.world, this.rng, count, this.world.startX, this.world.startY);
    picks.forEach((f, i) => {
      const s = spawns[i] || this.randomLand(24, 40) || { x: 10 + i * 20, y: 10 };
      this.factions.push({
        id: f.id, def: f, P: 8, era: 0, knowPts: 0, techCount: 1,
        armyPts: 4, wallPts: 0, goldPts: 0,
        settlements: [{ x: s.x, y: s.y, capital: true }],
        expansionTimer: Math.ceil(400 / f.traits.expansion),
        alive: true, weak: f.id === 'syndicate',
      });
      this.relations[f.id] = 0;
      this.relFactors[f.id] = [];
      this.diploLog[f.id] = [];
    });
  }

  faction(id) { return this.factions.find(f => f.id === id); }

  // ---------- Стройка ----------
  buildingAt(x, y) {
    return this.buildings.find(b => !b.destroyed && x >= b.x && y >= b.y && x < b.x + (b.size || 1) && y < b.y + (b.size || 1));
  }
  occupiedAt(x, y) { return !!this.buildingAt(x, y); }

  // Возвращает {ok, reason} — каждый отказ объяснён по-человечески
  canPlace(id, x, y) {
    const def = BUILDINGS[id];
    if (!def) return { ok: false, reason: 'Неизвестное здание' };
    if (def.req && !this.techs.has(def.req)) {
      return { ok: false, reason: `Нужна технология: ${TECH_BY_ID[def.req].name}` };
    }
    if (def.unique && this.buildings.some(b => b.id === id && !b.destroyed)) {
      return { ok: false, reason: `${def.name} уже построен — можно только один` };
    }
    const size = def.size || 1;
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) {
      const tx = x + dx, ty = y + dy;
      if (tx < 0 || ty < 0 || tx >= this.world.w || ty >= this.world.h) return { ok: false, reason: 'Край карты' };
      const t = tileAt(this.world, tx, ty);
      if (t === TILE.DEEP || t === TILE.WATER) return { ok: false, reason: 'Вода — строить нельзя' };
      if (t === TILE.MOUNTAIN && id !== 'mine') return { ok: false, reason: 'Горы непроходимы — подойдёт только Шахта' };
      if (this.occupiedAt(tx, ty)) return { ok: false, reason: 'Клетка занята другим зданием' };
    }
    // требования к соседним тайлам
    if (def.needTile === TILE.FOREST && !this.adjacentHas(x, y, size, TILE.FOREST)) return { ok: false, reason: 'Нужен лес вплотную' };
    if (def.needTile === TILE.HILL && !this.adjacentHas(x, y, size, TILE.HILL)) return { ok: false, reason: 'Ставится вплотную к холму' };
    if (def.needTile === TILE.MOUNTAIN && !this.adjacentHas(x, y, size, TILE.MOUNTAIN)) return { ok: false, reason: 'Ставится вплотную к горе' };
    if (def.needTile === TILE.GRASS) {
      let grass = false;
      for (let dy = 0; dy < size && !grass; dy++) for (let dx = 0; dx < size && !grass; dx++) if (tileAt(this.world, x + dx, y + dy) === TILE.GRASS) grass = true;
      if (!grass) return { ok: false, reason: 'Нужен травяной луг' };
    }
    if (def.coast && !(this.adjacentHas(x, y, size, TILE.WATER) || this.adjacentHas(x, y, size, TILE.DEEP))) return { ok: false, reason: 'Ставится только на берегу (рядом с водой)' };
    // ресурсы
    const lack = this.lackCost(def.cost);
    if (lack && !this.godmode) return { ok: false, reason: `Не хватает: ${lack}` };
    // дистанция от поселения
    const camp = this.buildings.find(b => b.id === 'campfire' && !b.destroyed);
    if (camp && Math.hypot(x - camp.x, y - camp.y) > 26) return { ok: false, reason: 'Слишком далеко от поселения' };
    return { ok: true };
  }

  adjacentHas(x, y, size, tileType) {
    for (let dy = -1; dy <= size; dy++) for (let dx = -1; dx <= size; dx++) {
      if (dx >= 0 && dx < size && dy >= 0 && dy < size) continue;
      if (tileAt(this.world, x + dx, y + dy) === tileType) return true;
    }
    return false;
  }

  costMult() { return this.ngPlus ? 1.15 : 1; }

  lackCost(cost) {
    const parts = [];
    const m = this.costMult();
    for (const [r, v] of Object.entries(cost || {})) {
      const need = Math.ceil(v * m);
      if ((this.res[r] || 0) < need) {
        const meta = D.RES.find(q => q.id === r);
        parts.push(`${meta ? meta.icon : r}${need - Math.floor(this.res[r] || 0)}`);
      }
    }
    return parts.length ? parts.join(' ') : null;
  }

  payCost(cost) {
    if (this.godmode) return;
    const m = this.costMult();
    for (const [r, v] of Object.entries(cost || {})) this.res[r] = Math.max(0, this.res[r] - Math.ceil(v * m));
  }

  placeBuilding(id, x, y) {
    const chk = this.canPlace(id, x, y);
    if (!chk.ok) { this.toast(chk.reason, 'warn'); return false; }
    this.payCost(BUILDINGS[id].cost);
    const def = BUILDINGS[id];
    const b = {
      id, x, y, size: def.size || 1, progress: 0,
      buildDays: this.buildDays(def), workers: [], done: false,
      eraBuilt: this.eraIndex, hp: def.wall || 100,
    };
    if (this.hasGreat('architect')) {
      b.progress = b.buildDays; // зодчий: мгновенная постройка
      this.consumeGreat('architect');
      this.toast(`Зодчий возводит «${def.name}» мгновенно!`, 'good');
    }
    this.buildings.push(b);
    this.addLog(`Заложено: ${def.name}.`);
    return true;
  }

  placeFree(id, x, y) {
    const def = BUILDINGS[id];
    const b = { id, x, y, size: def.size || 1, progress: 0, buildDays: 0.01, workers: [], done: true, eraBuilt: this.eraIndex, hp: def.wall || 100 };
    this.buildings.push(b);
    return b;
  }

  buildDays(def) {
    const costSum = Object.values(def.cost || {}).reduce((a, b) => a + b, 0);
    let days = Math.max(1, costSum / 8);
    if (this.techs.has('engineering')) days /= 2;
    if (this.techs.has('nanotech')) days /= 3;
    const syn = this.factions.find(f => f.id === 'syndicate');
    return Math.max(0.5, days);
  }

  // ---------- Эффекты зданий ----------
  doneBuildings() { return this.buildings.filter(b => b.done && !b.destroyed); }
  countBuilding(id) { return this.doneBuildings().filter(b => b.id === id).length; }
  hasBuilding(id) { return this.countBuilding(id) > 0; }

  housingCap() {
    let cap = 0;
    for (const b of this.doneBuildings()) cap += BUILDINGS[b.id].housing || 0;
    // Своя земля тоже даёт где жить: на присвоенной территории ставят
    // выселки. Без этого расширение границ не давало ничего, кроме краски
    // на карте и земельного налога.
    cap += systemsPopCapMod(this);
    return cap;
  }

  globalMult(kind) {
    // goldMult / industry / armyMult — множители от зданий и технологий
    let mult = 1;
    if (kind === 'gold') {
      if (this.hasBuilding('bank')) mult *= 1.25;
      if (this.hasBuilding('stock_exchange')) mult *= 1.3;
      if (this.hasGreat('merchant')) mult *= 1.15;
      if (this.techs.has('internet')) mult *= 1.1;
    }
    if (kind === 'industry') {
      if (this.hasBuilding('power_plant')) mult *= 1.25;
      if (this.hasBuilding('solar')) mult *= 1.2;
      if (this.hasBuilding('npp')) mult *= 1.5;
      if (this.hasBuilding('fusion_reactor')) mult *= 1.5;
      if (this.techs.has('plastics')) mult *= 1.25;
    }
    if (kind === 'army') {
      if (this.hasBuilding('armory')) mult *= 1.15;
      if (this.hasBuilding('foundry')) mult *= 1.2;
    }
    if (kind === 'knowledge') {
      if (this.techs.has('language')) mult *= 1.25;
      if (this.techs.has('writing')) mult *= 1.5;
      if (this.techs.has('philosophy')) mult *= 1.3;
      if (this.techs.has('mathematics')) mult *= 1.15;
      if (this.techs.has('printing')) mult *= 2;
      if (this.techs.has('internet')) mult *= 1.25;
      if (this.techs.has('smartphones')) mult *= 1.1;
      if (this.techs.has('quantum')) mult *= 2;
    }
    if (kind === 'gather') {
      if (this.techs.has('tools')) mult *= 1.3;
      if (this.techs.has('iron')) mult *= 1.25;
      if (this.techs.has('steel_tech')) mult *= 1.25;
      if (this.techs.has('chemistry')) mult *= 1.25;
    }
    // Чудо-множители (Тракт, Академия) встают в тот же стек, что здания и технологии.
    mult *= WONDER.wonderGlobalMult(this, kind);
    return mult;
  }

  happiness() {
    let h = 50;
    const pop = this.villagers.length;
    const housing = this.housingCap();
    // БЫЛО: −20 за само перенаселение. Один-два дня отстающих хижин роняли
    // счастье ниже эмиграционной планки 35, дальше спираль: люди уходят →
    // меньше рабочих → меньше дерева → хижин всё нет. −12 держит сигнал
    // игроку, но не затягивает в воронку; усиленный штраф за +5 сверх остался.
    if (pop > housing) h -= 12;
    const foodDays = this.res.food / Math.max(1, pop * EAT_PER_DAY);
    if (foodDays > 7) h += 10;
    if (this.res.food <= 0) h -= 25;
    for (const b of this.doneBuildings()) h += BUILDINGS[b.id].happy || 0;
    // разнообразие еды
    const variety = (this.hasBuilding('farm') ? 1 : 0) + (this.hasBuilding('pasture') ? 1 : 0) + (this.hasBuilding('port') ? 1 : 0);
    if (variety >= 2) h += 5;
    if (this.techs.has('pottery')) h += 10;
    if (this.techs.has('laws')) h += 10;
    if (this.techs.has('smartphones')) h += 10;
    if (this.raids.warning) h -= 5;
    if (pop > housing + 5) h -= 8;
    if (this.hasGreat('prophet')) h += 10;
    h += WEATHER[this.weather].happy;
    // Разовые эффекты событий («Праздник» +8, «Знамение» +5, уступки бунтующим
    // за 30🪙 +15, авария на АЭС −15). Копились в _happyBonus, но happiness()
    // их не читал — все эти события не меняли счастье ни на единицу.
    h += this._happyBonus || 0;
    // Мёрзнущие недовольны раньше, чем начинают болеть: это первый сигнал игроку,
    // что дров не хватит до весны.
    h += systemsHappyMod(this);
    this._happy = Math.max(0, Math.min(100, Math.round(h)));
    return this._happy;
  }

  // ---------- Великие люди ----------
  hasGreat(type) { return this.greatPeople.some(g => g.type === type && !g.used); }
  consumeGreat(type) { const g = this.greatPeople.find(g => g.type === type && !g.used); if (g) g.used = true; }

  // ---------- Население ----------
  spawnVillager(x, y, age0 = null) {
    // Прежний генератор клеил к имени огрызок в две буквы — выходило «Цвета ви»
    // и «Шана с». Берём настоящие прозвища: читается как имя человека, а не как
    // мусор в строке.
    const name = this.rng.pick(NAMES) + ' ' + this.rng.pick(NICKNAMES);
    // БЫЛО: age = rng.int(1800, 9000) — 18–90 лет. Окно материнства в модуле
    // населения 18–42 года, значит две трети новых жителей появлялись уже за
    // ним: медианный возраст «новорождённого» был 52 года, 91% таких людей
    // исчезали в первые 500 дней, а модуль за 12000 дней насчитывал ноль
    // рождений — поселение было не деревней, а домом престарелых с текучкой.
    // На фронтир (и в основатели, и в переселенцы) идут молодые: 16–34.
    // Диапазон, а не одно число, чтобы поколение не вымирало разом.
    // Бросок делаем всегда, даже когда возраст задан снаружи: иначе поток rng
    // зависел бы от того, каким числом аргументов позвали метод, и партия
    // расходилась бы от одной лишней обёртки над spawnVillager.
    const roll = this.rng.int(1600, 3400);
    const age = age0 == null ? roll : age0;
    this.villagers.push({
      name, x, y, tx: x, ty: y, age,
      job: 'idle', target: null, path: null, busy: 0, hp: 100, home: null,
    });
    return this.villagers[this.villagers.length - 1];
  }

  // Кого забирает беда (голод, мор, рейд) или безысходность (эмиграция).
  // БЫЛО: villagers.pop() во всех четырёх местах — то есть всегда ПОСЛЕДНИЙ
  // добавленный, а последний добавленный — это всегда новорождённый или
  // только что пришедший. Поселение физически не могло накопить людей: любая
  // потеря съедала именно прибыль. Здесь жребий кидает rng (детерминизм цел),
  // а `keep` защищает тех, кем жертвовать нельзя.
  takeVillager(keep = null) {
    const pool = [];
    for (let i = 0; i < this.villagers.length; i++) {
      const v = this.villagers[i];
      if (v.hp <= 0) continue;
      if (keep && keep(v)) continue;
      pool.push(i);
    }
    if (!pool.length) return null;
    const idx = pool[this.rng.int(0, pool.length - 1)];
    return this.villagers.splice(idx, 1)[0];
  }

  // ---------- Исследования ----------
  techCost(t) {
    let cost = t.cost;
    if (this.fastResearch) cost = Math.ceil(cost / 10);
    // диффузия технологий от партнёров по торговле
    const idx = TECHS.indexOf(t);
    for (const tr of this.treaties) {
      const f = this.faction(tr.b);
      if (f && f.techCount > idx) {
        const disc = f.id === 'cog' ? 0.4 : 0.3;
        cost = Math.ceil(cost * (1 - disc));
        break;
      }
    }
    return cost;
  }

  research(id) {
    const t = TECH_BY_ID[id];
    if (!t) return { ok: false, reason: 'Нет такой технологии' };
    if (this.techs.has(id)) return { ok: false, reason: 'Уже изучено' };
    const missing = t.prereq.filter(p => !this.techs.has(p));
    if (missing.length) return { ok: false, reason: `Требует: ${missing.map(m => TECH_BY_ID[m].name).join(', ')}` };
    const cost = this.techCost(t);
    if (this.res.knowledge < cost && !this.godmode) return { ok: false, reason: `Нужно 📜${cost}` };
    if (!this.godmode) this.res.knowledge -= cost;
    this.techs.add(id);
    this.addLog(`Изучено: ${t.name}. ${t.effect}`, 'good');
    if (t.era) this.advanceEra(ERAS.findIndex(e => e.id === t.era));
    return { ok: true };
  }

  advanceEra(idx) {
    if (idx <= this.eraIndex) return;
    this.eraIndex = idx;
    this.eraDay = 0;
    this.newEra = idx;
    this.addChronicle(`Наступила эпоха: ${ERAS[idx].ru} (${ERAS[idx].years}).`);
    this.addLog(`⚡ Новая эпоха: ${ERAS[idx].ru}!`, 'good');
    // великий человек
    if (idx > 0 && this.rng.chance(0.6)) {
      const types = this.rng.pick(GREAT_TYPES, 2) || [this.rng.pick(GREAT_TYPES), this.rng.pick(GREAT_TYPES)];
      const two = [...new Set([this.rng.pick(GREAT_TYPES), this.rng.pick(GREAT_TYPES)])];
      this.pendingGreat = two.length >= 2 ? two : [GREAT_TYPES[0], GREAT_TYPES[1]];
    }
  }

  chooseGreat(typeId) {
    const g = GREAT_TYPES.find(t => t.id === typeId);
    if (!g) return;
    const rec = { type: typeId, ru: g.ru, day: this.day, used: false };
    this.greatPeople.push(rec);
    this.pendingGreat = null;
    this.addChronicle(`Родился великий человек: ${g.ru}.`);
    this.addLog(`🌟 Великий человек: ${g.ru} — ${g.desc}`, 'good');
    if (typeId === 'scientist') this.res.knowledge += 300 * Math.max(1, this.eraIndex);
    if (typeId === 'general') this.army.powerBonus += 2;
    if (typeId === 'prophet' || typeId === 'merchant' || typeId === 'architect') { /* эффект учитывается в формулах */ }
  }

  // ---------- Армия ----------
  bestUnit() {
    let best = UNITS[0];
    for (const u of UNITS) if (this.techs.has(u.req)) best = u;
    return best;
  }
  armyLimit() { return Math.floor(this.villagers.length / 4); }
  defensePower() {
    let def = 0;
    for (const b of this.doneBuildings()) def += BUILDINGS[b.id].defense || 0;
    // Стена Столетий: постоянная прибавка, пока чудо не разрушено.
    def += WONDER.wonderDefense(this);
    return def;
  }
  armyPower() {
    const u = this.bestUnit();
    return this.army.soldiers * (u.power + this.army.powerBonus) * this.globalMult('army');
  }
  trainSoldier() {
    if (!this.hasBuilding('barracks')) return { ok: false, reason: 'Нужна Казарма' };
    if (this.army.soldiers + this.army.trainQueue >= this.armyLimit()) return { ok: false, reason: `Лимит армии: ${this.armyLimit()} (население/4)` };
    if (this.res.food < TRAIN_COST.food || this.res.gold < TRAIN_COST.gold) return { ok: false, reason: `Нужно ${TRAIN_COST.food}🍞 + ${TRAIN_COST.gold}🪙` };
    this.res.food -= TRAIN_COST.food; this.res.gold -= TRAIN_COST.gold;
    this.army.trainQueue++;
    this.addLog('Начато обучение бойца.');
    return { ok: true };
  }

  wealth() {
    let w = this.villagers.length * 20;
    for (const b of this.doneBuildings()) {
      const c = BUILDINGS[b.id].cost || {};
      w += (c.wood || 0) * 0.125 + (c.stone || 0) * 0.167 + (c.steel || 0) * 4 + (c.gold || 0);
    }
    w += (this.res.food + this.res.wood + this.res.stone) / 10 + this.res.steel * 0.4 + this.res.gold / 10;
    return w;
  }

  threatPoints() {
    // БЫЛО: eraBase=40 и степень ^0.7 — упругость волны к росту игрока была
    // 0.561 вместо 1: при удвоении богатства волна росла лишь в 1.5 раза,
    // и отставала от игрока в 2.7–7.6 раза на длинных партиях (репро-волна,
    // 4×12000 дней). Стало линейно, а eraBase 40→30 калибрует стартовую волну
    // на прежний уровень. rng не трогает, в сейве числа нет — совместимо.
    const eraBase = 30 * Math.pow(1.5, this.eraIndex);
    const wRef = 2000 * Math.pow(1.6, this.eraIndex);
    return eraBase * (0.5 + this.wealth() / wRef);
  }

  // ---------- ТИК СИМУЛЯЦИИ ----------
  tick(dt) {
    if (this.paused) return;
    const t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    // догоняем порциями ≤ 0.5 дня
    let remaining = dt;
    while (remaining > 0) {
      const step = Math.min(remaining, 0.5);
      this.tickStep(step);
      remaining -= step;
    }
    this.tickMs = ((typeof performance !== 'undefined') ? performance.now() : Date.now()) - t0;
  }

  tickStep(dtDays) {
    this.dayTime += dtDays;
    while (this.dayTime >= 1) { this.dayTime -= 1; this.day++; this.eraDay++; this.onNewDay(); }
    this.tickVillagers(dtDays);
    // Роботы работают сами, без жителей (см. tickWorkerless).
    this.tickWorkerless(dtDays);
    this.tickAnimals(dtDays);
    this.tickConstruction(dtDays);
    this.tickTraining(dtDays);
    this.tickSpire(dtDays);
    this.tickMission(dtDays);
    for (const t of this.toasts) t.t -= dtDays;
    this.toasts = this.toasts.filter(t => t.t > 0);
  }

  tickVillagers(dt) {
    const speed = MOVE_SPEED * (this.techs.has('wheel') ? 1.2 : 1);
    const happy = this._happy ?? this.happiness();
    // Слёгшие от холода не выходят на работу — падение выработки видно сразу,
    // ещё до первых похорон.
    const happyMult = (happy < 35 ? 0.7 : 1) * systemsWorkMult(this);
    for (const v of this.villagers) {
      if (v.hp <= 0) continue;
      // житель на рабочем месте: производит непрерывно
      if (v.atWork) {
        const b = v.target.b;
        const crisis = this.inFoodCrisis();
        const def = BUILDINGS[b.id];
        if (b.destroyed || (crisis && !(def.out && def.out.food))) { this.release(v); continue; }
        this.produceAt(b, dt, happyMult);
        v.shift -= dt;
        if (v.shift <= 0) this.release(v);
        continue;
      }
      if (!v.target) this.assignJob(v);
      if (!v.target) { v.busy += dt; if (v.busy > 3) { v.busy = 0; v.job = 'idle'; } continue; }
      const arrived = stepToward(this.world, v, v.target.x + 0.5, v.target.y + 0.5, speed * dt);
      if (arrived) this.onArrive(v);
      else {
        v.busy += dt;
        if (v.busy > 3) { v.busy = 0; v.job = 'idle'; v.target = null; v.path = null; }
      }
    }
    this.villagers = this.villagers.filter(v => v.hp > 0);
  }

  // непрерывная выработка здания за dt дней
  produceAt(b, dt, happyMult) {
    const def = BUILDINGS[b.id];
    const out = def.out || {};
    const gather = this.globalMult('gather') * WEATHER[this.weather].gather;
    // Погода входит в выработку ОДИН раз, профильным коэффициентом: у поля это
    // WEATHER.farm, у ручной добычи и промысла — WEATHER.gather. БЫЛО: базовый
    // mult уже нёс погодный gather, а ветка фермы ниже домножала ещё и на
    // WEATHER.farm — двойное перемножение (дождь 0.85×1.15≈0.98 вместо
    // обещанных +15%, снег 0.7×0.4=0.28 вместо 0.4). Отменено для ферм:
    // погодная надбавка gather им больше не достаётся, только технологии
    // труда из globalMult('gather').
    const isFarm = !!(out.food && b.id === 'farm');
    // Аура соседних зданий (кузница def.aura.gather: +10% добычи в радиусе 2).
    // БЫЛО: из поля aura работала только мельница для ферм (отдельный цикл в
    // ветке фермы ниже), а кузница не усиливала никого — desc обещал +10%,
    // которых не существовало. Отменено: аура читается у всех соседей; себя
    // здание не усиливает, а знания/золото/сталь считаются своими множителями
    // и аур добычи не читают (их ветки ниже перезаписывают mult).
    let auraGather = 1;
    for (const m of this.buildings) {
      if (m === b || !m.done || m.destroyed) continue;
      const a = BUILDINGS[m.id].aura;
      if (a && a.gather && Math.hypot(m.x - b.x, m.y - b.y) <= a.r) auraGather *= a.gather;
    }
    // Ветхое здание работает хуже целого: ниже трети прочности — вполсилы.
    // Это единственное место, где износ виден игроку числом, а не картинкой,
    // и именно оно делает ремонт осмысленным, а не украшением.
    let mult = (isFarm ? this.globalMult('gather') : gather) * happyMult * wearWorkMult(this, b) * auraGather;
    if (out.knowledge) mult = this.globalMult('knowledge') * happyMult;
    if (out.gold) mult = this.globalMult('gold') * happyMult;
    if (out.steel) mult = this.globalMult('industry') * happyMult;
    if (out.food) {
      if (b.id === 'farm') {
        if (this.seasonIdx === 3 && !def.winter) mult = 0;
        else {
          mult *= WEATHER[this.weather].farm;
          if (this.techs.has('feudalism')) mult *= 1.2;
          if (this.farmPenaltyDays > 0) mult = 0;
          const radius = 3 + (this.hasBuilding('train_station') ? 2 : 0);
          for (const m of this.doneBuildings()) {
            if (m.id === 'mill' && Math.hypot(m.x - b.x, m.y - b.y) <= radius) mult *= 1.5;
          }
        }
      } else if (this.seasonIdx === 3 && !def.winter) mult *= 0.6;
    }
    if (out.knowledge && b.id === 'datacenter' && this.dcPenaltyDays > 0) mult *= 0.5;
    // Склад продукта полон — не жечь сырьё впустую. Раньше фабрика при стали
    // 500/500 продолжала есть камень и не производила ничего: игрок видел
    // падающий камень при работающем здании и нулевом приросте стали.
    if (def.consume) {
      let room = 0;
      for (const r of Object.keys(out)) {
        room = Math.max(room, (this.resCap[r] ?? Infinity) - this.res[r]);
      }
      if (room <= 1e-6) return;
      let can = true;
      for (const [r, c] of Object.entries(def.consume)) if (this.res[r] < c * dt) can = false;
      if (!can) return;
      for (const [r, c] of Object.entries(def.consume)) this.res[r] -= c * dt;
    }
    for (const [r, amt] of Object.entries(out)) {
      this.res[r] = Math.min(this.resCap[r] || 99999, this.res[r] + amt * dt * mult);
    }
  }

  // Здания без рабочих мест (def.workers === 0, Робозавод) раньше не давали
  // ничего: assignJob их пропускает («!def.workers»), а produceAt зывал только
  // житель, занявший место в tickVillagers. Теперь работают сами — люди не
  // нужны, но всё остальное как у всех: сырьё (def.consume), потолки склада,
  // износ и погода считаются тем же produceAt. passive-здания (Сокровищница)
  // исключены: их золото начисляет onNewDay, здесь вышло бы дважде. Петли нет —
  // один проход по конечному списку готовых зданий за тик.
  tickWorkerless(dt) {
    for (const b of this.doneBuildings()) {
      const def = BUILDINGS[b.id];
      if (def.workers !== 0 || !def.out || def.passive) continue;
      this.produceAt(b, dt, 1); // роботы не унывают и не болеют: happyMult = 1
    }
  }

  assignJob(v) {
    v.busy = 0;
    // Сообщаем о древесном кризисе один раз за эпизод: молчаливый тупик —
    // худшее, что может случиться с партией.
    const wc = this.woodCrisis();
    if (wc && !this._woodCrisisShown) {
      this._woodCrisisShown = true;
      this.toast('Дерево кончилось. Жители пошли собирать валежник — стройте лесопилку.', 'warn');
    } else if (!wc && this._woodCrisisShown && this.res.wood >= 20) {
      this._woodCrisisShown = false;
    }
    // 1. Стройка (до 3 строителей на объект)
    const site = this.buildings.find(b => !b.done && !b.destroyed && b.workers.length < BUILDERS_PER_SITE);
    if (site) { v.job = 'build'; v.target = { kind: 'build', b: site, x: site.x, y: site.y }; site.workers.push(v); return; }
    // 1.5 Продовольственный кризис: еда важнее всего
    const foodCrisis = this.inFoodCrisis();
    // 2. Работа в здании по приоритетам труда
    const catPrio = foodCrisis ? { ...this.labor, food: 99 } : this.labor;
    const jobs = [];
    // считаем занятые места заранее (иначе все ринутся на одно здание)
    const taken = new Map();
    for (const o of this.villagers) {
      if (o !== v && o.target && o.target.kind === 'work') taken.set(o.target.b, (taken.get(o.target.b) || 0) + 1);
    }
    for (const b of this.doneBuildings()) {
      const def = BUILDINGS[b.id];
      if (!def.workers) continue;
      if ((taken.get(b) || 0) >= def.workers) continue;
      // при кризисе еды не-едовые здания пропускаем
      if (foodCrisis && !(def.out && def.out.food)) continue;
      let cat = 'food';
      if (def.out) {
        if (def.out.wood) cat = 'wood';
        else if (def.out.stone || def.out.steel) cat = 'stone';
        else if (def.out.knowledge) cat = 'science';
        else if (def.out.gold) cat = 'stone';
      }
      if (def.out && def.out.food) cat = 'food';
      jobs.push({ b, prio: catPrio[cat] || 1 });
    }
    jobs.sort((a, b) => b.prio - a.prio);
    if (jobs.length) {
      const b = jobs[0].b;
      v.job = 'work'; v.target = { kind: 'work', b, x: b.x, y: b.y };
      return;
    }
    // 3. Охота
    if (this.techs.has('hunting') && this.res.food < this.resCap.food * 0.8) {
      // Охотник идёт не на первого попавшегося зверя из массива, а на
      // ближайшее стадо: у охоты появляется место на карте, и стоянку теперь
      // осмысленно ставить именно там, где водится дичь.
      const near = herdsNearest(this, v.x, v.y);
      const prey = near ? { herd: near.id, x: near.x, y: near.y } : null;
      if (prey) { v.job = 'hunt'; v.target = { kind: 'hunt', herd: prey.herd, x: prey.x, y: prey.y }; return; }
    }
    // 3.5 Древесный кризис. Без него партию можно было запороть насмерть:
    // потратил стартовые 30 дерева на пять хижин — и всё. Лесопилка стоит 10
    // дерева, собиратели 8, других источников дерева в игре нет, рынок требует
    // технологию и ещё 25 дерева на постройку. Игра при этом продолжалась
    // бесконечно, жители были сыты, и никакого сигнала игроку не подавалось.
    // Теперь свободные руки идут за валежником — медленно, но выход есть всегда.
    if (this.woodCrisis()) {
      const spot = findNearestTile(this.world, v.x, v.y, TILE.FOREST, 30);
      if (spot) { v.job = 'deadfall'; v.target = { kind: 'deadfall', x: spot.x, y: spot.y }; return; }
    }
    // 4. Собирательство (при кризисе — все свободные сюда)
    if (this.res.food < this.resCap.food * 0.9 || foodCrisis) {
      const spot = this.randomLand(2, 12);
      if (spot) { v.job = 'forage'; v.target = { kind: 'forage', x: spot.x, y: spot.y }; return; }
    }
    v.job = 'idle';
  }

  onArrive(v) {
    const t = v.target;
    if (!t) return;
    const gather = this.globalMult('gather') * WEATHER[this.weather].gather;
    const happy = this.happiness();
    // Ручной промысел — собирательство, охота, рубка — идёт через этот путь, а не
    // через produceAt. Слёгшие обязаны и здесь приносить меньше, иначе половина
    // экономики болезнь просто не замечает.
    const happyMult = (happy < 35 ? 0.7 : 1) * systemsWorkMult(this);
    if (t.kind === 'build') {
      // Житель просто стоит на площадке; весь прогресс начисляется в
      // tickConstruction по игровому времени. Раньше здесь было
      // `t.b.progress += 0.35` на КАЖДОЕ прибытие, без привязки к dt: стройка
      // шла со скоростью кадров, buildDays из карточки не значил ничего
      // (университет с заявленными 2.9 днями строился за 0.25 дня при мелком
      // шаге и за 1.5 при крупном), а на скорости 8× здания вырастали мгновенно.
      if (t.b.done || t.b.destroyed) { this.release(v); return; }
      v.busy = 0;
      return;
    }
    if (t.kind === 'work') {
      // занял рабочее место: смена 4 дня непрерывного производства
      v.atWork = true;
      v.shift = 4;
      return;
    }
    if (t.kind === 'hunt') {
      // Одна ходка — одна облава. Сколько взято, решает модель стада: она
      // знает и поголовье, и испуг. Здоровье охотнику снимаем здесь: модуль
      // только сообщает, что человек ранен, но сам ничего не мутирует.
      const rep = herdsHunt(this, t.herd, { hunters: 1, skill: 1 });
      if (rep.food > 0) this.res.food = Math.min(this.resCap.food, this.res.food + rep.food);
      if (rep.injured && v.hp !== undefined) v.hp = Math.max(1, v.hp - 3);
      for (const e of rep.events) this.addLog(e.text, e.type === 'bad' ? 'bad' : 'info');
      this.release(v);
      return;
    }
    if (t.kind === 'deadfall') {
      this.res.wood = Math.min(this.resCap.wood, this.res.wood + 1.0 * gather);
      this.release(v);
      return;
    }
    if (t.kind === 'forage') {
      const tile = tileAt(this.world, Math.round(v.x), Math.round(v.y));
      const base = tile === TILE.FOREST ? 1.8 : 1.2;
      this.res.food = Math.min(this.resCap.food, this.res.food + base * gather * 1.6);
      this.release(v);
      return;
    }
    this.release(v);
  }

  release(v) {
    if (v.target && v.target.kind === 'build') {
      const idx = v.target.b.workers.indexOf(v);
      if (idx >= 0) v.target.b.workers.splice(idx, 1);
    }
    v.target = null; v.job = 'idle'; v.busy = 0; v.atWork = false; v.shift = 0;
  }

  finishBuilding(b) {
    b.done = true; b.progress = b.buildDays;
    b.workers.length = 0;
    const def = BUILDINGS[b.id];
    if (def.cap) for (const [r, c] of Object.entries(def.cap)) this.resCap[r] = (this.resCap[r] || 0) + c;
    if (def.passive && def.out) { /* treasury — пассивное золото, учитывается в onNewDay */ }
    this.addLog(`Построено: ${def.name}!`, 'good');
    this.sfx?.('build');
  }

  tickConstruction(dt) {
    for (const b of this.buildings) {
      if (b.done || b.destroyed) continue;
      const builders = b.workers.filter(v => v.hp > 0 && v.target && v.target.kind === 'build' && v.target.b === b);
      b.workers = builders;
      // buildDays — срок при ПОЛНОЙ бригаде (3 строителя, максимум на объект).
      // Меньше рук — дольше стройка, и это честно видно игроку.
      if (builders.length) b.progress += dt * (builders.length / BUILDERS_PER_SITE);
      if (b.progress >= b.buildDays) this.finishBuilding(b);
    }
  }

  tickAnimals(dt) {
    for (const a of this.animals) {
      a.wander -= dt;
      if (a.wander <= 0) {
        a.wander = this.rng.range(2, 5);
        const p = this.randomLand(4, 40);
        if (p) { a.tx = p.x; a.ty = p.y; }
      }
      stepToward(this.world, a, a.tx, a.ty, 3 * dt);
    }
  }

  tickTraining(dt) {
    if (this.army.trainQueue > 0) {
      this.army.trainProgress += dt;
      if (this.army.trainProgress >= 4) {
        this.army.trainProgress = 0;
        this.army.trainQueue--;
        this.army.soldiers++;
        this.addLog(`Боец готов: ${this.bestUnit().name} (всего ${this.army.soldiers}).`, 'good');
        this.sfx?.('build');
      }
    }
  }

  tickSpire(dt) {
    const sb = this.buildings.find(b => b.id === 'spire' && !b.destroyed);
    if (!sb || this.spire.stage >= 5) return;
    // строительство текущей стадии: требует полной оплаты (invested) и времени
    const st = SPIRE_STAGES[this.spire.stage];
    const inv = this.spire.invested[this.spire.stage];
    const paid = Object.entries(st.cost).every(([r, v]) => inv[r] >= v);
    if (paid && sb.done) {
      this.spire.progress += dt;
      if (this.spire.progress >= st.days) {
        this.spire.stage++;
        this.spire.progress = 0;
        this.addChronicle(`Шпиль: завершена стадия «${st.name}» (${this.spire.stage}/5).`);
        this.addLog(`🗼 Шпиль: стадия «${st.name}» завершена!`, 'good');
        this.sfx?.('fanfare');
        if (this.spire.stage >= 5) this.victory();
      }
    }
  }

  investSpire() {
    const sb = this.buildings.find(b => b.id === 'spire' && !b.destroyed);
    if (!sb || this.spire.stage >= 5) return { ok: false, reason: 'Шпиль не построен или завершён' };
    const st = SPIRE_STAGES[this.spire.stage];
    const inv = this.spire.invested[this.spire.stage];
    let moved = false;
    for (const [r, need] of Object.entries(st.cost)) {
      const lack = need - inv[r];
      if (lack <= 0) continue;
      const put = Math.min(lack, Math.floor(this.res[r]));
      if (put > 0) { this.res[r] -= put; inv[r] += put; moved = true; }
    }
    if (!moved) return { ok: false, reason: 'Нечего вложить — не хватает ресурсов' };
    this.addLog(`Вложено в Шпиль (стадия «${st.name}»).`);
    return { ok: true };
  }

  spireStageStatus() {
    if (this.spire.stage >= 5) return { done: true };
    const st = SPIRE_STAGES[this.spire.stage];
    const inv = this.spire.invested[this.spire.stage];
    const paid = Object.entries(st.cost).every(([r, v]) => inv[r] >= v);
    return { stage: this.spire.stage, name: st.name, cost: st.cost, inv, paid, progress: this.spire.progress, days: st.days };
  }

  victory() {
    if (this.won) return;
    this.won = true;
    this.addChronicle('ШПИЛЬ ЦИВИЛИЗАЦИИ завершён. Луч ушёл в звёзды.');
    this.sfx?.('victory');
  }

  tickMission(dt) {
    if (!this.mission) return;
    this.mission.daysLeft -= dt;
    if (this.mission.daysLeft <= 0) {
      if (this.mission.type === 'moon') { this.res.gold += 2000; this.moonDone = true; this.addLog('🌙 Миссия «Луна» завершена: +2000🪙!', 'good'); this.addChronicle('Экспедиция на Луну.'); }
      else { this.res.knowledge += 3000; this.marsDone = true; this.addLog('🚀 Миссия «Марс» завершена: +3000📜!', 'good'); this.addChronicle('Экспедиция на Марс.'); }
      this.mission = null;
    }
  }

  startMission(type) {
    if (this.mission) return { ok: false, reason: 'Миссия уже выполняется' };
    if (type === 'moon' && this.moonDone) return { ok: false, reason: 'Луна уже покорена' };
    if (type === 'mars' && this.marsDone) return { ok: false, reason: 'Марс уже покорен' };
    this.mission = { type, daysLeft: type === 'moon' ? 30 : 60 };
    this.addLog(`Запущена миссия «${type === 'moon' ? 'Луна' : 'Марс'}».`);
    return { ok: true };
  }

  // ---------- НОВЫЙ ДЕНЬ ----------
  onNewDay() {
    const pop = this.villagers.length;
    // погода
    const table = WEATHER_TABLE[this.seasonIdx];
    let roll = this.rng.range(0, 100), acc = 0;
    for (const [w, p] of table) { acc += p; if (roll <= acc) { this.weather = w; break; } }
    // сезон
    if (this.day % DAYS_PER_SEASON === 0) {
      this.seasonIdx = (this.seasonIdx + 1) % 4;
      this.addLog(`Наступила пора: ${SEASONS[this.seasonIdx]}.`);
    }
    // еда
    // Народ, переживший голод, ест скупее: память о беде — это не только
    // слова в летописи, но и меньше зерна со склада каждый день.
    // Полноту амбаров фиксируем ДО трапезы: после неё склад уже неполон, и
    // проверка крыши ниже была бы всегда ложной.
    const foodWasAtRoof = pop > 0 && this.res.food >= this.resCap.food - 1e-9;
    const eat = pop * EAT_PER_DAY * (this.weather === 'snow' ? 1.25 : 1) * memoryEatMult(this);
    this.res.food -= eat;
    // содержание армии
    const upkeep = this.army.soldiers;
    this.res.food -= upkeep * ARMY_UPKEEP.food;
    this.res.gold = Math.max(0, this.res.gold - upkeep * ARMY_UPKEEP.gold);
    // голод
    if (this.res.food <= 0) {
      this.res.food = 0;
      // Голод забирает слабейшего — старика или ребёнка, а не «последнего в
      // массиве» (то есть не всегда только что родившегося; см. takeVillager).
      const victim = this.takeVillager(v => v.age >= 1600 && v.age < 6000)
        || this.takeVillager();
      if (victim) {
        this.addLog(`☠ ${victim.name} умер от голода. Запасайте еду!`, 'bad');
        // День, когда голод УБИЛ. Связь выживания считает голодные сутки по
        // запасу на складе, а склад за ночь успевает подрасти на пару мешков и
        // формально выйти из голода — при том, что людей уже хоронят. Без этой
        // отметки лестница волнений недостижима: счётчик обнуляется быстрее,
        // чем доходит до бунта.
        this.starvedDay = this.day;
      }
    }
    // пассивные знания + кострище
    this.res.knowledge += pop * 0.05;
    if (this.hasBuilding('campfire')) this.res.knowledge += 0.3;
    if (this.hasBuilding('treasury')) this.res.gold += 0.5 * this.globalMult('gold');
    // налоги
    if (this.techs.has('laws')) this.res.gold += pop * 0.05 * this.globalMult('gold');
    // караваны
    if (this.techs.has('trade')) {
      this.caravanTimer--;
      if (this.caravanTimer <= 0) {
        this.caravanTimer = 15;
        let gold = 0.6 * this.countBuilding('market') * this.globalMult('gold');
        if (this.hasBuilding('shipyard')) gold *= 1.5;
        if (this.hasBuilding('train_station')) gold *= 2;
        if (this.hasBuilding('airport')) gold *= 2;
        if (this.techs.has('internet')) gold *= 1.25;
        this.res.gold += gold;
        if (gold > 0) this.addLog(`Караван прибыл: +${gold.toFixed(1)}🪙.`);
      }
    }
    const happy = this.happiness();
    // Рождения и смерти считает модуль населения (systems/population.js через
    // wire_population.js): там пары, окно материнства, возрастная смертность.
    // ЗДЕСЬ БЫЛ ВТОРОЙ, ПРИМИТИВНЫЙ ПУТЬ: «счастье > 40 → spawnVillager». Он
    // и держал рост на нуле. Спавн выдавал человека 18–90 лет (медиана 52), то
    // есть за окном материнства, и таких «новорождённых» приходило по 250–500
    // за партию — при НУЛЕ настоящих рождений у модуля. Поселение обновляло
    // состав стариками и хоронило их: 91% исчезали за первые 500 дней.
    // Приток извне остался — он теперь один и живёт в wire_population.js
    // (_tickMigration), где переселенцу 17–32 года.
    //
    // Потолок роста — жильё, и о нём надо сказать словами: молчаливая стена
    // читается как поломка. Говорим один раз за эпизод, снимаем — когда место
    // появилось.
    const capNow = this.housingCap();
    const housingFull = pop > 0 && pop >= capNow;
    if (housingFull && !this._housingFullShown) {
      this._housingFullShown = true;
      this.addChronicle(`Все места в домах заняты (${pop}/${capNow}) — детей больше не заводят и пришлых не берут. Нужно жильё: Хижина, дальше Каменный дом.`);
    } else if (!housingFull && this._housingFullShown) {
      this._housingFullShown = false;
    }
    // Амбары под крышу, а трёхдневного запаса на нового жителя всё равно не
    // набрать: рост останавливается сам, и это надо называть словами — иначе
    // молчаливый потолок выглядит как поломка, а игрок строит не то. Один раз
    // за эпизод; снимается, когда склад освободился или потолок вырос.
    const foodRoofBlocked = happy > 40 && pop < this.housingCap()
      && foodWasAtRoof && pop * 3 >= this.resCap.food;
    if (foodRoofBlocked && !this._foodRoofShown) {
      this._foodRoofShown = true;
      this.addChronicle(`Амбары полны под крышу (${Math.round(this.resCap.food)}🍞) — запаса на новых жителей не напастись, рост остановился. Нужен Амбар.`);
    } else if (!foodRoofBlocked && this._foodRoofShown) {
      this._foodRoofShown = false;
    }
    // эмиграция при несчастье
    if (happy < 35) {
      this.unhappyDays++;
      // Потолок исхода. Уходят те, кому есть куда идти; корень поселения
      // остаётся при своих домах. БЫЛО дно `pop > 2`: эмиграция работала
      // одноходовым храповиком и за партию вымывала деревню до двух душ (замер
      // на сиде 99: 235 уходов за 12000 дней), а из двух душ уже ничто не
      // вырастало — это и была «нет роста» в чистом виде. Четверть жилья, но
      // не меньше трёх: дома пустыми не бросают.
      const exodusFloor = Math.max(3, Math.round(this.housingCap() * 0.25));
      if (this.unhappyDays >= 3 && pop > exodusFloor && this.rng.chance(0.25)) {
        // Уходит взрослый и одинокий: дети сами не уходят, а семьи держатся
        // друг за друга. Если таких нет — уходит кто угодно, кроме детей.
        const v = this.takeVillager(x => (x.age < 1600) || x.partner)
          || this.takeVillager(x => x.age < 1600);
        if (v) this.addLog(`${v.name} покинул поселение от безысходности.`, 'bad');
      } else if (this.unhappyDays >= 3 && pop <= exodusFloor && !this._exodusFloorShown) {
        // Дно исхода надо назвать словами: иначе игрок видит только, что люди
        // перестали уходить, и не понимает, что делать дальше.
        this._exodusFloorShown = true;
        this.addChronicle(`Ушли все, кому было куда идти; оставшиеся ${pop} держатся за свои дома. Пока счастье ниже 40, пришлых не будет, а детей рождается вдвое меньше — нужны еда, кров и мир с соседями.`);
      }
    } else { this.unhappyDays = 0; this._exodusFloorShown = false; }
    // Разовые эффекты событий затухают к нулю по 1 в день: иначе «Праздник»
    // остался бы вечным бонусом, а авария на АЭС — вечным штрафом.
    if (this._happyBonus) {
      this._happyBonus += this._happyBonus > 0 ? -1 : 1;
      if (Math.abs(this._happyBonus) < 1) this._happyBonus = 0;
    }
    // Подсистемы — до общего сбора мёртвых: зима помечает замёрзших hp=0,
    // и их убирает тот же фильтр, что и умерших от старости.
    systemsNewDay(this);
    // Старение и смерть. Когда подключён модуль населения, возраст двигает он
    // (wire_population.js, внутри systemsNewDay), и смертность считает он же —
    // по возрастной кривой. Этот блок оставался включённым И ПОСЛЕ подключения
    // модуля: жители старели ДВА дня за день (замерено: +200 единиц возраста за
    // 100 дней), то есть жили вдвое меньше и проскакивали окно материнства
    // 18–42 за половину срока. Плюс поверх кривой работала вторая смерть по
    // таймеру 11000. Блок остаётся страховкой для сборок без подсистем.
    if (!this.pop) {
      for (const v of this.villagers) {
        v.age++;
        let life = 11000; // дней
        if (this.techs.has('medicine')) life *= 1.15;
        if (this.hasBuilding('hospital')) life *= 1.3;
        if (this.hasBuilding('biolab')) life *= 1.25;
        if (v.age > life && this.rng.chance(0.02)) {
          v.hp = 0;
          this.addLog(`${v.name} умер от старости (${Math.floor(v.age / 100)} лет).`);
        }
      }
    }
    this.villagers = this.villagers.filter(v => v.hp > 0);
    // события
    if (this.eventCooldown > 0) this.eventCooldown--;
    if (this.farmPenaltyDays > 0) this.farmPenaltyDays--;
    if (this.dcPenaltyDays > 0) this.dcPenaltyDays--;
    if (this.eventCooldown <= 0 && !this.pendingEvent && this.rng.chance(0.03)) this.rollEvent();
    // рейды
    this.tickRaids();
    // фракции
    this.tickFactions();
    // рынок
    this.tickMarket();
    // авария АЭС
    if (this.hasBuilding('npp') && this.rng.chance(0.002)) this.fireEvent(EVENT_DEFS.find(e => e.id === 'npp_event'));
    // автосейв
    if (this.day % 30 === 0) this.autosaveRequested = true;
  }

  // ---------- События ----------
  rollEvent() {
    const pool = EVENT_DEFS.filter(e => {
      if (e.minEra != null && this.eraIndex < e.minEra) return false;
      if (e.req && !this.techs.has(e.req)) return false;
      if (e.season != null && this.seasonIdx !== e.season) return false;
      if (e.cond === 'housing' && this.villagers.length >= this.housingCap()) return false;
      if (e.cond === 'unhappy' && this.happiness() >= 35) return false;
      if (e.cond === 'npp' && !this.hasBuilding('npp')) return false;
      if (e.cond === 'repelled2' && this.repelled < 2) return false;
      return true;
    });
    if (!pool.length) { this.eventCooldown = 5; return; }
    let total = pool.reduce((a, e) => a + e.w * (e.boost && this.hasBuilding(e.boost) ? 2 : 1), 0);
    let r = this.rng.range(0, total);
    for (const e of pool) {
      r -= e.w * (e.boost && this.hasBuilding(e.boost) ? 2 : 1);
      if (r <= 0) { this.fireEvent(e); return; }
    }
  }

  fireEvent(e) {
    this.eventCooldown = 12;
    if (e.choice) {
      this.pendingEvent = e;
      this.addLog(`⚠ Событие: ${e.ru} — ${e.text}`, 'warn');
      this.sfx?.('alarm');
    } else {
      this.addLog(`Событие: ${e.ru} — ${e.text}`, 'info');
      this.applyEffect(e.effect || {});
    }
  }

  resolveEvent(choiceKey) {
    const e = this.pendingEvent;
    if (!e) return;
    this.pendingEvent = null;
    let opt = e.choice[choiceKey];
    if (!opt) return;
    if (opt.cost && this.lackCost(opt.cost)) {
      // Раньше событие просто испарялось: пожар не тушили, но и здание не
      // горело — игрок нажимал кнопку и не происходило ничего. Теперь
      // применяем второй вариант, то есть естественные последствия отказа.
      const other = e.choice[choiceKey === 'a' ? 'b' : 'a'];
      this.toast(`Не хватает: ${this.lackCost(opt.cost)} — событие пошло по другому пути.`, 'warn');
      if (!other || (other.cost && this.lackCost(other.cost))) {
        this.addLog(`Событие «${e.ru}» разрешилось само: платить было нечем.`, 'warn');
        return;
      }
      opt = other;
    }
    if (opt.cost) this.payCost(opt.cost);
    this.applyEffect(opt.effect || {});
    this.addLog(`Решение по событию «${e.ru}»: ${opt.ru}.`);
  }

  applyEffect(fx) {
    if (fx.happy) this._happyBonus = (this._happyBonus || 0) + fx.happy;
    if (fx.pop > 0) {
      for (let i = 0; i < fx.pop; i++) {
        if (this.villagers.length < this.housingCap()) this.spawnVillager(this.world.startX, this.world.startY);
      }
    } else if (fx.pop < 0) {
      // Убыль населения не работала вовсе: цикл `for (i=0; i<fx.pop; i++)` при
      // отрицательном значении не выполнялся ни разу, из-за чего вариант
      // «Подавить» в событии «Бунт» был пустышкой.
      const n = Math.min(this.villagers.length - 1, -fx.pop);
      for (let i = 0; i < n; i++) {
        // На площадь выходят взрослые — под саблю попадают они, не младенцы.
        const v = this.takeVillager(x => x.age < 1600) || this.takeVillager();
        if (!v) break;
        this.addLog(`☠ ${v.name} погиб при подавлении бунта.`, 'bad');
      }
    }
    if (fx.knowledge) this.res.knowledge += fx.knowledge;
    if (fx.gold) this.res.gold = Math.max(0, this.res.gold + fx.gold);
    if (fx.steel) this.res.steel = Math.max(0, this.res.steel + fx.steel);
    if (fx.food) this.res.food = Math.min(this.resCap.food, this.res.food + fx.food);
    if (fx.foodPct) this.res.food = Math.max(0, this.res.food * (1 + fx.foodPct));
    if (fx.woodPct) this.res.wood = Math.max(0, this.res.wood * (1 + fx.woodPct));
    if (fx.goldPct) this.res.gold = Math.max(0, this.res.gold * (1 + fx.goldPct));
    if (fx.farmPenalty) this.farmPenaltyDays = fx.farmPenalty;
    if (fx.dcPenalty) this.dcPenaltyDays = fx.dcPenalty;
    if (fx.plague) {
      const med = this.medicineMult();
      let deaths = Math.min(this.villagers.length - 1, Math.round(fx.plague * med));
      for (let i = 0; i < deaths; i++) {
        const v = this.takeVillager();
        if (!v) { deaths = i; break; }
        this.addLog(`☠ ${v.name} погиб от болезни.`, 'bad');
      }
      this.addLog(deaths ? `Болезнь унесла ${deaths} жителей.` : 'Болезнь обошлась без жертв — спасибо медицине.', deaths ? 'bad' : 'good');
    }
    if (fx.damageBuilding) {
      const candidates = this.doneBuildings().filter(b => b.id !== 'campfire');
      for (let i = 0; i < fx.damageBuilding && candidates.length; i++) {
        const b = candidates.splice(this.rng.int(0, candidates.length - 1), 1)[0];
        b.destroyed = true;
        this.addLog(`🔥 Разрушено: ${BUILDINGS[b.id].name}. Отстройте заново.`, 'bad');
      }
    }
    if (fx.peaceNeighbors) {
      for (const f of this.factions) this.adjustRel(f.id, 15, 'Посредничество послов');
      this.raids.timer = Math.max(this.raids.timer, 60);
    }
  }

  medicineMult() {
    let m = 1;
    if (this.hasBuilding('clinic')) m *= 0.5;
    if (this.hasBuilding('sewers')) m *= 0.3;
    if (this.hasBuilding('hospital')) m *= 0.5;
    return m;
  }

  // ---------- Рейды ----------
  tickRaids() {
    if (this.raids.off || this.eraIndex < 2) return; // рейды с Железного века
    this.raids.timer--;
    if (this.raids.timer <= 2 && !this.raids.warning) {
      this.raids.warning = true;
      this.raids.power = Math.round(this.threatPoints() / 10);
      const aggr = this.factions.filter(f => f.alive).sort((a, b) => b.def.traits.aggression - a.def.traits.aggression)[0];
      this.raids.from = aggr ? aggr.id : null;
      this.addLog(`⚔ Разведчики заметили враждебный отряд${aggr ? ` (${aggr.def.name})` : ''}! До удара ~2 дня. Готовьте армию.`, 'warn');
      this.sfx?.('raid');
    }
    if (this.raids.timer <= 0) {
      this.resolveRaid();
      this.raids.timer = this.rng.int(40, 70);
      this.raids.warning = false;
    }
  }

  resolveRaid() {
    const enemy = Math.round(this.threatPoints() / 10) + this.eraIndex * 2;
    const mine = this.armyPower() + this.defensePower();
    const from = this.raids.from ? this.faction(this.raids.from) : null;
    const fromName = from ? from.def.name : 'Кочевники';
    this.lastRaidDay = this.day;
    if (mine >= enemy) {
      this.repelled++;
      const loot = Math.round(enemy * 1.5);
      this.res.gold += loot;
      this.res.knowledge += Math.round(enemy * 0.5);
      this.addLog(`🛡 Рейд ${fromName} отбит! Сила врага ${enemy} vs наши ${Math.round(mine)}. Трофеи: +${loot}🪙.`, 'good');
      this.addChronicle(`Отбит рейд ${fromName} (день ${this.day}).`);
      this.sfx?.('fanfare');
      if (from) this.adjustRel(from.id, -10, 'Их рейд отбит');
    } else {
      const stolenFood = Math.round(this.res.food * 0.2);
      const stolenGold = Math.round(this.res.gold * 0.2);
      this.res.food -= stolenFood; this.res.gold -= stolenGold;
      // Рейдеры приходят за добром: они уносят пятую часть склада, и людской
      // урон должен быть той же меры. БЫЛО «1–3 убитых» без оглядки на размер
      // поселения: деревня из четверых теряла за один налёт троих — три
      // четверти жителей, и после этого уже не поднималась. Замерено на сиде 11
      // (эпоха 3, постоянные набеги): 463 убитых за партию при населении 3–6,
      // то есть деревня двенадцать раз вырезалась заново. Потолок — четверть
      // поселения, но не меньше одного: налёт всегда стоит крови.
      const victims = Math.min(this.villagers.length - 1, this.rng.int(1, 3),
        Math.max(1, Math.round(this.villagers.length * 0.25)));
      for (let i = 0; i < victims; i++) {
        // Под стрелу попадает кто попало, но не всегда самый младший житель
        // в массиве — рейд не обязан выкашивать именно приплод.
        const v = this.takeVillager();
        if (!v) break;
        this.addLog(`☠ ${v.name} погиб в рейде.`, 'bad');
      }
      const candidates = this.doneBuildings().filter(b => b.id !== 'campfire' && b.id !== 'spire');
      if (candidates.length) {
        const b = this.rng.pick(candidates);
        b.destroyed = true;
        this.addLog(`🔥 Рейдеры разрушили: ${BUILDINGS[b.id].name}.`, 'bad');
      }
      const losses = Math.min(this.army.soldiers, Math.ceil(enemy / 8));
      this.army.soldiers -= losses;
      this.addLog(`💥 Рейд ${fromName} прорвался! Враг ${enemy} vs наши ${Math.round(mine)}. Украдено: ${stolenFood}🍞 ${stolenGold}🪙. Потери: ${victims} жит., ${losses} бойцов.`, 'bad');
      this.addChronicle(`Рейд ${fromName} разорил поселение (день ${this.day}).`);
      this.sfx?.('alarm');
    }
  }

  // ---------- Фракции ----------
  // Живую экономику соседей ведёт systems/civ_ai.js: у каждого соседа свои
  // постройки, склад, наука по настоящему дереву технологий и колонизация
  // с проверкой рельефа. Прежний упрощённый расчёт ниже остаётся запасным
  // путём — на случай сейва или отладки без подсистем.
  tickFactions() {
    const byModule = systemsFactions(this);
    for (const f of this.factions) {
      if (byModule) break;
      if (!f.alive) continue;
      const tr = f.def.traits;
      const weakMult = (f.weak && this.eraIndex < 6) ? 0.6 : 1;
      // население: логистика
      const K = 30 * f.settlements.length * (1 + f.era * 0.35);
      const r = 0.006 * (1 + tr.expansion / 20) * (f.def.penalty.growth || 1);
      f.P += r * f.P * (1 - f.P / K);
      // доходы
      const eraMult = Math.pow(1.25, f.era) * weakMult;
      const income = f.P * 0.12 * eraMult;
      f.goldPts += income * (tr.trade / 10) * (f.def.bonus.gold || 1);
      f.knowPts += income * (tr.science / 10) * (f.def.bonus.science || 1) * (f.def.penalty.science || 1);
      f.armyPts += income * (tr.aggression / 10) * (f.def.bonus.army || 1) * (f.def.penalty.army || 1);
      f.wallPts += income * (tr.defense / 10);
      // технологии
      const nextCost = 20 * Math.pow(1.35, f.techCount);
      if (f.knowPts >= nextCost && f.techCount < TECHS.length) {
        f.knowPts -= nextCost;
        f.techCount++;
        const newEra = TECH_ERA_IDX[TECHS[Math.min(f.techCount - 1, TECHS.length - 1)].id] ?? f.era;
        if (newEra > f.era) { f.era = newEra; this.addLog(`${f.def.name} вступает в эпоху: ${ERAS[newEra].ru}.`); }
      }
      // экспансия
      f.expansionTimer--;
      if (f.expansionTimer <= 0 && f.P > 0.8 * K) {
        f.expansionTimer = Math.ceil(400 / tr.expansion);
        const s = f.settlements[f.settlements.length - 1];
        const nx = Math.max(2, Math.min(this.world.w - 3, s.x + this.rng.int(-8, 8)));
        const ny = Math.max(2, Math.min(this.world.h - 3, s.y + this.rng.int(-8, 8)));
        if (WALKABLE.has(tileAt(this.world, nx, ny))) {
          f.settlements.push({ x: nx, y: ny, capital: false });
          this.addLog(`${f.def.name} основал новый аванпост.`);
        }
      }
    }
    // дипломатический дрейф и факторы
    for (const f of this.factions) {
      if (!f.alive) continue;
      const base = this.agendaBase(f);
      const cur = this.relations[f.id];
      if (cur < base) this.relations[f.id] = Math.min(base, cur + 0.2);
      else if (cur > base) this.relations[f.id] = Math.max(base, cur - 0.2);
      // затухание факторов
      const factors = this.relFactors[f.id];
      for (const fc of factors) {
        if (fc.decay > 0) {
          fc.dR = fc.dR > 0 ? Math.max(0, fc.dR - fc.decay) : Math.min(0, fc.dR + fc.decay);
        }
      }
      this.relFactors[f.id] = factors.filter(fc => fc.decay === 0 || Math.abs(fc.dR) > 0.5);
      this.relations[f.id] = Math.max(-100, Math.min(100, this.relations[f.id]));
    }
    // Utility AI раз в 5 дней
    if (this.day % 5 === 0) this.utilityAI();
    // войны с игроком: WS дрейф и мир
    for (const w of this.wars) {
      const f = this.faction(w.fid);
      if (!f) continue;
      const myArmy = this.armyPower() + 1, theirArmy = f.armyPts + 1;
      if (theirArmy > myArmy) w.ws -= 0.05; else w.ws += 0.05;
      w.ws = Math.max(-100, Math.min(100, w.ws));
      if (w.ws >= 40 && !w.peaceOffered) {
        w.peaceOffered = true;
        const tribute = Math.round(w.ws * 10);
        this.res.gold += tribute;
        this.addLog(`🕊 ${f.def.def ? '' : ''}${f.def.name} просит мира и платит дань ${tribute}🪙. «${f.def.lines.peace}»`, 'good');
        this.endWar(f.id, true);
      } else if (w.ws <= -40 && !w.demanded) {
        w.demanded = true;
        this.pendingEvent = {
          id: 'tribute_demand', ru: 'Требование дани',
          text: `${f.def.name} требует дань ${Math.round(-w.ws * 10)}🪙, иначе — большая война. «${f.def.lines.threat}»`,
          choice: {
            a: { ru: `Заплатить ${Math.round(-w.ws * 10)}🪙`, cost: { gold: Math.round(-w.ws * 10) }, effect: {} },
            b: { ru: 'Отказать (война продолжится)', effect: {} },
          },
          _tributeWar: f.id,
        };
      }
    }
    // войны ИИ-ИИ
    for (const w of this.aiWars) {
      w.ws += this.rng.range(-1, 1);
      if (Math.abs(w.ws) >= 40) {
        this.addLog(`Война ${this.faction(w.a)?.def.name} и ${this.faction(w.b)?.def.name} завершилась миром.`);
        w.over = true;
      }
    }
    this.aiWars = this.aiWars.filter(w => !w.over);
  }

  agendaBase(f) {
    // базовая точка отношения из агенды
    let base = 0;
    const myArmy = this.armyPower();
    const theirArmy = f.armyPts;
    if (f.id === 'wolves') base = myArmy >= theirArmy ? 10 : -15;
    if (f.id === 'guild') base = this.treaties.some(t => t.b === f.id) ? 10 : 0;
    if (f.id === 'dawn') base = this.hasBuilding('temple') ? 10 : 0;
    if (f.id === 'cog') base = this.eraIndex >= f.era ? 10 : -15;
    if (f.id === 'horde') base = this.buildings.length > 15 ? 10 : -15;
    if (f.id === 'tide') base = this.hasBuilding('port') ? 10 : 0;
    if (f.id === 'grove') base = 0;
    if (f.id === 'syndicate') base = this.hasBuilding('factory') ? 10 : (this.eraIndex >= 7 ? -15 : 0);
    return base;
  }

  adjustRel(fid, dR, why) {
    this.relations[fid] = Math.max(-100, Math.min(100, (this.relations[fid] || 0) + dR));
    const f = this.faction(fid);
    const fkey = dR > 0 ? 'gift' : 'declaredWar';
    this.relFactors[fid].push({ key: why, dR, decay: Math.abs(dR) >= 20 ? 0.1 : 0 });
    if (this.relFactors[fid].length > 12) this.relFactors[fid].shift();
    this.diploLog[fid].push({ day: this.day, why, dR });
    if (this.diploLog[fid].length > 6) this.diploLog[fid].shift();
  }

  utilityAI() {
    const T = this.difficulty === 'easy' ? 0.6 : this.difficulty === 'hard' ? 0.15 : 0.3;
    for (const f of this.factions) {
      if (!f.alive) continue;
      const tr = f.def.traits;
      const atWar = this.wars.some(w => w.fid === f.id);
      const R = this.relations[f.id];
      const noise = this.difficulty === 'easy' ? 0.5 : this.difficulty === 'hard' ? 0.1 : 0.25;
      const myArmyEst = this.armyPower() * (1 + this.rng.range(-noise, noise));
      const actions = [];
      const hasTreaty = this.treaties.some(t => t.b === f.id);
      if (!atWar) {
        if (!hasTreaty) actions.push({ act: 'treaty', U: 0.3 * tr.trade / 10 + 0.2 * R / 100 });
        if (this.relations[f.id] <= -40 || (tr.aggression >= 7 && myArmyEst < f.armyPts * 0.4)) {
          actions.push({ act: 'war', U: 0.5 * tr.aggression / 10 - R / 100 - 0.6 * (myArmyEst / (f.armyPts + 1)) });
        }
        if (f.armyPts > myArmyEst * 1.2 && tr.aggression >= 5) {
          actions.push({ act: 'demand', U: 0.3 * tr.aggression / 10 * (f.armyPts / (myArmyEst + 1) - 1.2) });
        }
      }
      if (!actions.length) continue;
      // softmax
      const exps = actions.map(a => Math.exp(a.U / T));
      const sum = exps.reduce((a, b) => a + b, 0);
      let roll = this.rng.next() * sum;
      let chosen = actions[0];
      for (let i = 0; i < actions.length; i++) { roll -= exps[i]; if (roll <= 0) { chosen = actions[i]; break; } }
      if (chosen.act === 'treaty' && chosen.U > 0.25) this.offerTreaty(f);
      else if (chosen.act === 'war' && chosen.U > 0.55 && !this.atPeaceTreaty(f.id)) this.declareWarOnPlayer(f);
      else if (chosen.act === 'demand' && chosen.U > 0.2) this.demandTribute(f);
    }
  }

  atPeaceTreaty(fid) {
    return this._peacePacts && this._peacePacts[fid] > this.day;
  }

  offerTreaty(f) {
    if (this.treaties.some(t => t.b === f.id)) return;
    if (this.relations[f.id] < 0) return;
    this.pendingEvent = this.pendingEvent || {
      id: 'treaty_offer', ru: 'Предложение торгового договора',
      text: `${f.def.name} предлагает торговый договор. ${f.def.leader}: «${f.def.lines.greet}»`,
      choice: {
        a: { ru: 'Принять (+торговля, −30% техи этой фракции)', effect: {} },
        b: { ru: 'Отклонить', effect: {} },
      },
      _treatyFid: f.id,
    };
  }

  // Может ли сосед вообще требовать дань. Раньше проверок не было никаких:
  // utilityAI крутится раз в 5 дней, и требование прилетало с 5-го дня партии
  // бесконечной чередой. Хуже того, оно занимало pendingEvent, а обычные
  // события выпадают только когда тот пуст, — за 300 дней замер показал
  // 60 требований дани и НОЛЬ остальных событий из 22 возможных.
  canDemandTribute(f) {
    if (this.day < TRIBUTE_MIN_DAY) return false;               // не в первые дни
    if (this.day - (this.lastTributeDay || -999) < TRIBUTE_GAP) return false;
    if (this.day - (f.lastTribute || -999) < TRIBUTE_GAP_FACTION) return false;
    // Вымогать может только тот, кто заметно сильнее: требование от слабака
    // читается как насмешка, а не как угроза.
    if (f.armyPts < this.armyPower() * TRIBUTE_POWER_RATIO) return false;
    // И только если есть чем платить — иначе выбор фиктивный.
    return this.res.gold >= 10;
  }

  demandTribute(f) {
    if (!this.canDemandTribute(f)) return;
    this.lastTributeDay = this.day;
    f.lastTribute = this.day;
    const amount = Math.max(8, Math.round(f.armyPts * 2));
    this.pendingEvent = this.pendingEvent || {
      id: 'tribute', ru: 'Требование дани',
      text: `${f.def.name} требует ${amount}🪙. ${f.def.leader}: «${f.def.lines.threat}»`,
      choice: {
        a: { ru: `Заплатить ${amount}🪙`, cost: { gold: amount }, effect: {} },
        b: { ru: 'Отказать (риск войны)', effect: {} },
      },
      _tributeFid: f.id,
    };
  }

  declareWarOnPlayer(f) {
    if (this.wars.some(w => w.fid === f.id)) return;
    if (this.atPeaceTreaty(f.id)) return;
    this.wars.push({ fid: f.id, ws: 0 });
    this.adjustRel(f.id, -60, 'Война');
    this.addLog(`⚔ ${f.def.name} объявляет войну! ${f.def.leader}: «${f.def.lines.war}»`, 'bad');
    this.sfx?.('raid');
    // их рейд придёт быстрее
    this.raids.timer = Math.min(this.raids.timer, this.rng.int(5, 12));
    this.raids.from = f.id;
  }

  endWar(fid, peaceful) {
    this.wars = this.wars.filter(w => w.fid !== fid);
    this._peacePacts = this._peacePacts || {};
    this._peacePacts[fid] = this.day + 100;
    const f = this.faction(fid);
    if (f) this.addLog(`Мир с ${f.def.name} на 100 дней.`);
  }

  // Действия игрока в дипломатии
  diploAction(fid, action, arg) {
    const f = this.faction(fid);
    if (!f || !f.alive) return { ok: false, reason: 'Фракция недоступна' };
    const atWar = this.wars.some(w => w.fid === fid);
    if (action === 'treaty') {
      if (atWar) return { ok: false, reason: 'Идёт война' };
      if (this.treaties.some(t => t.b === fid)) return { ok: false, reason: 'Договор уже есть' };
      if (this.relations[fid] < 0) return { ok: false, reason: 'Отношения слишком плохие' };
      this.treaties.push({ b: fid, type: 'trade' });
      this.adjustRel(fid, 20, 'Торговый договор');
      this.addLog(`Торговый договор с ${f.def.name}. ${f.def.leader}: «${f.def.lines.praise}»`, 'good');
      return { ok: true };
    }
    if (action === 'break') {
      this.treaties = this.treaties.filter(t => t.b !== fid);
      this.adjustRel(fid, -15, 'Договор разорван');
      return { ok: true };
    }
    if (action === 'gift') {
      const amount = Math.min(arg || 50, Math.floor(this.res.gold));
      if (amount < 10) return { ok: false, reason: 'Нужно минимум 10🪙' };
      this.res.gold -= amount;
      // Было `amount / 50` — штатная кнопка «Подарок 50🪙» давала +1 отношения
      // вместо заявленных таблицей +15, а чтобы получить обещанное, требовалось
      // 750 золота. Теперь 50🪙 — это полный эффект из DIPLO_FACTORS.
      this.adjustRel(fid, Math.min(DIPLO_FACTORS.gift.dR, amount / 50 * DIPLO_FACTORS.gift.dR), 'Подарок');
      this.addLog(`Подарок ${amount}🪙 для ${f.def.name}.`);
      return { ok: true };
    }
    if (action === 'demand') {
      const myArmy = this.armyPower(), their = f.armyPts;
      const chance = Math.max(0.05, Math.min(0.9, (myArmy / (their + 1) - 0.8) * 0.5 + this.relations[fid] / 200));
      if (this.rng.chance(chance)) {
        const amount = Math.round(f.armyPts * 1.5);
        this.res.gold += amount;
        this.adjustRel(fid, 8, 'Дань выплачена');
        this.addLog(`${f.def.name} выплачивает дань ${amount}🪙.`, 'good');
      } else {
        this.adjustRel(fid, -10, 'Отказ в дани');
        this.addLog(`${f.def.name} отказалась платить. ${f.def.leader}: «${f.def.lines.threat}»`, 'warn');
        if (f.def.traits.aggression >= 7 && this.rng.chance(0.4)) this.declareWarOnPlayer(f);
      }
      return { ok: true };
    }
    if (action === 'war') {
      if (atWar) return { ok: false, reason: 'Уже воюем' };
      const hasCB = this.wars.length || this.relations[fid] <= -40;
      this.wars.push({ fid, ws: 0 });
      this.adjustRel(fid, -60, 'Вы объявили войну');
      if (!hasCB) {
        for (const o of this.factions) if (o.id !== fid) this.adjustRel(o.id, -20, 'Война без повода');
        this.addLog('Война без законного повода: все фракции относятся хуже (−20).', 'warn');
      }
      this.addLog(`Вы объявили войну: ${f.def.name}.`, 'bad');
      return { ok: true };
    }
    if (action === 'peace') {
      const w = this.wars.find(w => w.fid === fid);
      if (!w) return { ok: false, reason: 'Нет войны' };
      const cost = Math.max(0, Math.round(-w.ws * 10));
      if (cost > 0 && this.res.gold < cost) return { ok: false, reason: `Мир обойдётся в ${cost}🪙` };
      this.res.gold -= cost;
      this.endWar(fid, true);
      this.addLog(`Мир с ${f.def.name}${cost ? ` за ${cost}🪙` : ''}. «${f.def.lines.peace}»`, 'good');
      return { ok: true };
    }
    return { ok: false, reason: 'Неизвестное действие' };
  }

  // обработка спец-событий с колбэками (договор/дань)
  resolveSpecial(choiceKey) {
    const e = this.pendingEvent;
    if (!e) return;
    if (e._treatyFid) {
      if (choiceKey === 'a') this.diploAction(e._treatyFid, 'treaty');
      this.pendingEvent = null;
      return;
    }
    // ВАЖНО: из resolveSpecial нельзя выходить, не сбросив pendingEvent.
    // Интерфейс закрывает окно безусловно (hud.js), а генерация событий в
    // onNewDay заперта проверкой !this.pendingEvent. Раньше нехватка золота на
    // дань оставляла событие висеть навсегда: игрок больше НИ РАЗУ не видел ни
    // урожая, ни пожара, ни чумы, ни предложений договора — половина контента
    // молча выключалась. Поэтому «нечем платить» трактуется как отказ.
    if (e._tributeFid) {
      let paid = false;
      if (choiceKey === 'a') {
        const lack = this.lackCost(e.choice.a.cost);
        if (lack) this.toast(`Нечем платить (${lack}) — вы отказали в дани.`, 'warn');
        else { this.payCost(e.choice.a.cost); paid = true; }
      }
      if (paid) {
        this.adjustRel(e._tributeFid, 8, 'Дань выплачена');
      } else {
        this.adjustRel(e._tributeFid, -10, 'Отказ в дани');
        const f = this.faction(e._tributeFid);
        if (f && f.def.traits.aggression >= 6 && this.rng.chance(0.5)) this.declareWarOnPlayer(f);
      }
      this.pendingEvent = null;
      return;
    }
    if (e._tributeWar) {
      if (choiceKey === 'a') {
        const lack = this.lackCost(e.choice.a.cost);
        if (lack) this.toast(`Нечем платить (${lack}) — война продолжается.`, 'warn');
        else { this.payCost(e.choice.a.cost); this.endWar(e._tributeWar, true); }
      }
      this.pendingEvent = null;
      return;
    }
    this.resolveEvent(choiceKey);
  }

  // ---------- Рынок ----------
  tickMarket() {
    // спрос/предложение от фракций
    const D0 = { food: 0, wood: 0, stone: 0, steel: 0 };
    const S0 = { food: 0, wood: 0, stone: 0, steel: 0 };
    for (const f of this.factions) {
      if (!f.alive) continue;
      const w = f.P * 0.1;
      D0.food += w * 1.2; S0.food += w * (f.def.traits.expansion / 10 + 0.5);
      D0.wood += w * 0.6; S0.wood += w * 0.8;
      D0.stone += w * 0.5; S0.stone += w * 0.6;
      D0.steel += w * (f.def.traits.aggression / 10) * (this.wars.length + this.aiWars.length ? 2 : 1);
      S0.steel += w * (f.def.traits.trade / 10);
    }
    this.market.hist.push({ D: D0, S: S0 });
    if (this.market.hist.length > 10) this.market.hist.shift();
    const avgD = { food: 0, wood: 0, stone: 0, steel: 0 }, avgS = { ...avgD };
    for (const h of this.market.hist) for (const r of ['food', 'wood', 'stone', 'steel']) { avgD[r] += h.D[r]; avgS[r] += h.S[r]; }
    const n = this.market.hist.length || 1;
    for (const r of ['food', 'wood', 'stone', 'steel']) {
      const d = avgD[r] / n, s = avgS[r] / n;
      this.market.prices[r] = MARKET_BASE[r] * Math.max(0.5, Math.min(2, 1 + 0.5 * (d - s) / Math.max(s, 1)));
    }
  }

  marketRate(resId) {
    // цена продажи 1 единицы ресурса в золото для игрока
    let price = this.market.prices[resId] || MARKET_BASE[resId] || 0.1;
    const hasTreaty = this.treaties.length > 0;
    if (!hasTreaty) price *= 0.7; // без договоров — наценка 30% против игрока
    if (this.hasBuilding('treasury')) price *= 1.2;
    return price;
  }

  marketSell(resId, amount) {
    if (!this.hasBuilding('market')) return { ok: false, reason: 'Нужен Рынок' };
    amount = Math.min(amount, Math.floor(this.res[resId]));
    if (amount <= 0) return { ok: false, reason: 'Нечего продавать' };
    const gold = amount * this.marketRate(resId);
    this.res[resId] -= amount;
    this.res.gold += gold;
    this.addLog(`Продано ${amount} ${resId}: +${gold.toFixed(1)}🪙.`);
    return { ok: true };
  }

  marketBuy(resId, amount) {
    if (!this.hasBuilding('market')) return { ok: false, reason: 'Нужен Рынок' };
    const cost = amount * this.marketRate(resId) * 1.25; // покупка дороже
    if (this.res.gold < cost) return { ok: false, reason: `Нужно ${cost.toFixed(1)}🪙` };
    this.res.gold -= cost;
    this.res[resId] = Math.min(this.resCap[resId] || 99999, this.res[resId] + amount);
    this.addLog(`Куплено ${amount} ${resId}: −${cost.toFixed(1)}🪙.`);
    return { ok: true };
  }

  // ---------- Цели ----------
  objectives() {
    return OBJECTIVES.map(o => ({ ...o, done: this.checkObjective(o) }));
  }

  checkObjective(o) {
    const parts = o.check.split('+');
    return parts.every(p => this.checkOne(p.trim(), o));
  }

  checkOne(p, o) {
    if (p.startsWith('building:')) {
      const ids = p.slice(9).split('|');
      return ids.some(id => this.hasBuilding(id)) || (o.checkAlt ? this.checkOne(o.checkAlt, o) : false);
    }
    if (p.startsWith('tech:')) return this.techs.has(p.slice(5));
    if (p.startsWith('pop:')) return this.villagers.length >= +p.slice(4);
    if (p.startsWith('era:')) return this.eraIndex >= +p.slice(4);
    if (p.startsWith('gold:')) return this.res.gold >= +p.slice(5);
    if (p.startsWith('steel:')) return this.res.steel >= +p.slice(6);
    if (p.startsWith('army:')) return this.army.soldiers >= +p.slice(5);
    if (p.startsWith('repelled:')) return this.repelled >= +p.slice(9);
    if (p.startsWith('spire:')) return this.spire.stage >= +p.slice(6);
    if (p.startsWith('any:')) return p.slice(4).split(',').some(id => this.hasBuilding(id));
    return false;
  }

  // ---------- Консоль разработчика ----------
  execCommand(line) {
    const [cmd, ...args] = line.trim().split(/\s+/);
    const out = [];
    const say = (s) => { out.push(s); this.addLog(`> ${line}\n${s}`, 'console'); };
    try {
      switch (cmd) {
        case 'help': {
          say(['РЕСУРСЫ: give <res> <n> · spawn <n> · happy <0-100>',
            'МИР: weather <sun|cloud|rain|snow> · age <eraId> · seed · simulate <days|N years>',
            'НАУКА: research <id|all> · fastresearch · unlockall · era list',
            'АРМИЯ: raid now|off · plague · meteor · kill <n>',
            'ФРАКЦИИ: faction list|rel <id> <n>|war <id>|peace <id>|gift <id> <n>|kill <id> · threat show · market show',
            'ШПИЛЬ: spire stage <1-5> · win · godmode · pop · speed <1|2|4|8> · perf · screenshot · astar test'].join('\n'));
          break;
        }
        case 'give': {
          const r = args[0], n = +args[1] || 100;
          if (!(r in this.res)) return say(`Неизвестный ресурс. Есть: ${Object.keys(this.res).join(', ')}`);
          this.res[r] = Math.min(this.resCap[r] || 99999, this.res[r] + n);
          say(`${r} +${n} → ${Math.floor(this.res[r])}`);
          break;
        }
        case 'spawn': { const n = +args[0] || 5; for (let i = 0; i < n; i++) this.spawnVillager(this.world.startX, this.world.startY); say(`+${n} жителей`); break; }
        case 'weather': { if (WEATHER[args[0]]) { this.weather = args[0]; say(`Погода: ${WEATHER[args[0]].ru}`); } else say('sun|cloud|rain|snow'); break; }
        case 'age': {
          const idx = ERAS.findIndex(e => e.id === args[0]);
          if (idx < 0) return say('Эпохи: ' + ERAS.map(e => e.id).join(', '));
          // открываем все техи до эпохи включительно
          for (const t of TECHS) { if ((TECH_ERA_IDX[t.id] ?? 0) < idx) this.techs.add(t.id); }
          this.advanceEra(idx);
          say(`Эпоха: ${ERAS[idx].ru}`);
          break;
        }
        case 'research': {
          if (args[0] === 'all') { for (const t of TECHS) this.techs.add(t.id); this.eraIndex = 9; say('Все технологии открыты'); }
          else { const r = this.research(args[0]); say(r.ok ? 'Изучено' : r.reason); }
          break;
        }
        case 'simulate': {
          let days = parseInt(args[0]) || 30;
          let requested = days;
          if (args[1] === 'years') { requested = days * 100; days = requested; }
          const capped = Math.min(days, 3650);
          // Было `for (...) this.onNewDay()` — календарь стоял на месте (день
          // инкрементируется в tick, а не в onNewDay), производство и стройка
          // не шли, зато жители исправно ели: `simulate 365` рапортовал
          // «День 0, жителей 0» и стирал поселение. Крутим настоящий тик.
          for (let i = 0; i < capped * 4; i++) this.tick(0.25);
          say(`Выполнено ${capped} дней из запрошенных ${requested} (кап 3650). День ${this.day}, жителей ${this.villagers.length}`);
          break;
        }
        case 'godmode': { this.godmode = !this.godmode; say(`godmode: ${this.godmode ? 'ON' : 'OFF'}`); break; }
        case 'fastresearch': { this.fastResearch = !this.fastResearch; say(`fastresearch: ${this.fastResearch ? 'ON' : 'OFF'}`); break; }
        case 'plague': { this.applyEffect({ plague: 5 }); say('Чума!'); break; }
        case 'meteor': { this.fireEvent(EVENT_DEFS.find(e => e.id === 'meteor_shower')); say('Метеорный дождь'); break; }
        case 'kill': { const n = Math.min(+args[0] || 1, this.villagers.length - 1); for (let i = 0; i < n; i++) this.villagers.pop(); say(`-${n} жителей`); break; }
        case 'pop': { say(`Жителей: ${this.villagers.length}/${this.housingCap()}, счастье ${this.happiness()}%`); break; }
        case 'happy': { this._happyBonus = (+args[0] || 50) - 50; say(`Счастье ≈ ${args[0]}`); break; }
        case 'unlockall': { for (const t of TECHS) this.techs.add(t.id); say('Все технологии открыты (эпоха не меняется)'); break; }
        case 'speed': { this.speed = [1, 2, 4, 8].includes(+args[0]) ? +args[0] : 1; say(`Скорость: ${this.speed}×`); break; }
        case 'seed': { say(`Сид: ${this.seed}`); break; }
        case 'screenshot': { this._screenshotRequested = true; say('Скриншот запрошен'); break; }
        case 'perf': { say(`Тик: ${this.tickMs.toFixed(2)} мс · зданий ${this.buildings.length} · жителей ${this.villagers.length}`); break; }
        case 'era': { say(ERAS.map((e, i) => `${i}: ${e.id} — ${e.ru} (${e.years})`).join('\n')); break; }
        case 'raid': {
          if (args[0] === 'now') { this.raids.timer = 2; this.raids.warning = false; say('Рейд через 2 дня'); }
          else if (args[0] === 'off') { this.raids.off = !this.raids.off; say(`Рейды: ${this.raids.off ? 'OFF' : 'ON'}`); }
          else say('raid now|off');
          break;
        }
        case 'spire': {
          if (args[0] === 'stage') {
            const s = Math.max(1, Math.min(5, +args[1] || 1));
            if (!this.buildings.some(b => b.id === 'spire' && !b.destroyed)) {
              const c = this.buildings.find(b => b.id === 'campfire');
              this.placeFree('spire', (c ? c.x : this.world.startX) + 3, c ? c.y : this.world.startY);
              this.spire.placed = true;
            }
            for (let i = 0; i < s; i++) {
              const inv = this.spire.invested[i];
              for (const [r, v] of Object.entries(SPIRE_STAGES[i].cost)) inv[r] = v;
            }
            this.spire.stage = s;
            if (s >= 5) this.victory();
            say(`Шпиль: стадия ${s}`);
          } else say('spire stage <1-5>');
          break;
        }
        case 'win': { this.spire.stage = 5; this.victory(); say('Победа!'); break; }
        case 'faction': {
          const sub = args[0];
          if (sub === 'list') say(this.factions.map(f => `${f.id}: ${f.def.name} · эпоха ${f.era} · армия ${Math.round(f.armyPts)} · R ${Math.round(this.relations[f.id])}`).join('\n'));
          else if (sub === 'rel') { this.relations[args[1]] = Math.max(-100, Math.min(100, +args[2] || 0)); say(`R(${args[1]}) = ${this.relations[args[1]]}`); }
          else if (sub === 'war') { const f = this.faction(args[1]); if (f) this.declareWarOnPlayer(f); say('Война'); }
          else if (sub === 'peace') { this.endWar(args[1], true); say('Мир'); }
          else if (sub === 'gift') { this.diploAction(args[1], 'gift', +args[2] || 50); say('Подарок отправлен'); }
          else if (sub === 'kill') { const f = this.faction(args[1]); if (f) { f.alive = false; f.settlements = []; } say('Фракция уничтожена'); }
          else say('faction list|rel|war|peace|gift|kill');
          break;
        }
        case 'threat': { say(`wealth ${Math.round(this.wealth())} · threat ${Math.round(this.threatPoints())} · волна ~${Math.round(this.threatPoints() / 10)} силы`); break; }
        case 'market': { say(Object.entries(this.market.prices).map(([r, p]) => `${r}: ${p.toFixed(3)}🪙`).join(' · ')); break; }
        case 'astar': {
          if (args[0] === 'test') {
            const t0 = performance.now();
            let ok = 0;
            for (let i = 0; i < 50; i++) { const p = aStar(this.world, this.world.startX, this.world.startY, this.rng.int(5, 90), this.rng.int(5, 90)); if (p) ok++; }
            say(`A*: ${ok}/50 путей за ${(performance.now() - t0).toFixed(1)} мс`);
          } else say('astar test');
          break;
        }
        case 'great': {
          if (args[0] === 'spawn') { this.chooseGreat(args[1] || 'scientist'); say('Великий человек призван'); }
          else say('great spawn <scientist|general|merchant|architect|prophet>');
          break;
        }
        default: say(`Неизвестная команда: ${cmd}. Введите help.`);
      }
    } catch (err) {
      say(`Ошибка: ${err.message}`);
    }
    return out.join('\n');
  }

  // ---------- Сохранение v3 ----------
  serialize() {
    return {
      version: SAVE_VERSION,
      seed: this.seed, day: this.day, dayTime: this.dayTime, seasonIdx: this.seasonIdx,
      weather: this.weather, eraIndex: this.eraIndex, eraDay: this.eraDay,
      res: this.res, resCap: this.resCap, techs: [...this.techs],
      buildings: this.buildings.map(b => ({ ...b, workers: [] })),
      villagers: this.villagers.map(v => ({ name: v.name, x: v.x, y: v.y, age: v.age, hp: v.hp })),
      animals: this.animals,
      army: this.army, raids: this.raids, repelled: this.repelled,
      spire: this.spire, won: this.won, freePlay: this.freePlay,
      chronicle: this.chronicle, greatPeople: this.greatPeople,
      ngPlus: this.ngPlus, difficulty: this.difficulty, factionCount: this.factionCount,
      labor: this.labor,
      factions: this.factions.map(f => ({ id: f.id, P: f.P, era: f.era, techCount: f.techCount, armyPts: f.armyPts, wallPts: f.wallPts, goldPts: f.goldPts, knowPts: f.knowPts, settlements: f.settlements, alive: f.alive, weak: f.weak, expansionTimer: f.expansionTimer })),
      relations: this.relations, relFactors: this.relFactors, treaties: this.treaties, wars: this.wars, aiWars: this.aiWars,
      market: this.market, caravanTimer: this.caravanTimer,
      mission: this.mission, moonDone: this.moonDone, marsDone: this.marsDone,
      // Висящее событие с выбором — включая самодельные «требование дани» и
      // «предложение договора» с _tributeFid/_treatyFid: раньше при загрузке
      // оно испарялось, и игрок терял окно решения.
      pendingEvent: this.pendingEvent ? { ...this.pendingEvent } : null,
      eventCooldown: this.eventCooldown,
      farmPenaltyDays: this.farmPenaltyDays,   // «Наводнение»: поле не родит N дней
      dcPenaltyDays: this.dcPenaltyDays,       // «Солнечная буря»: дата-центры вполсилы
      // Мирные пакты после войны (_peacePacts[fid] = день окончания). Пустой
      // объект пишем как null: deserialize разворачивает null обратно в {},
      // и круг остаётся бит-в-бит.
      peacePacts: (this._peacePacts && Object.keys(this._peacePacts).length) ? { ...this._peacePacts } : null,
      // Однодневные кэши отчётов связей: happiness() и панели читают их ДО
      // первого newDay после загрузки — пустые отчёты означали сутки неверного
      // счастья и пустых панелей. Ключи совпадают с полями sim.sys один в один.
      dayReports: this.sys ? {
        winterReport: this.sys.winterReport ?? null,
        borderStats: this.sys.borderStats ?? null,
        ecoLinks: this.sys.ecoLinks ?? null,
        memLinks: this.sys.memLinks ?? null,
        buildLinks: this.sys.buildLinks ?? null,
        masterLinks: this.sys.masterLinks ?? null,
        herdsReport: this.sys.herdsReport ?? null,
        intelLinks: this.sys.intelLinks ?? null,
        nbrLinks: this.sys.nbrLinks ?? null,
        indLinks: this.sys.indLinks ?? null,
        warLinks: this.sys.warLinks ?? null,
        dynLinks: this.sys.dynLinks ?? null,
        betrayals: this.sys.betrayals ?? [],
        _repelledSeen: this.sys._repelledSeen ?? null,
      } : null,
      sys: systemsSerialize(this),
      wonders: WONDER.serializeWonders(this.wonders),
      rngState: this.rng.getState(),
      log: this.log.slice(-80),
    };
  }

  static deserialize(json) {
    let data;
    try { data = typeof json === 'string' ? JSON.parse(json) : json; }
    catch { return { ok: false, reason: 'Файл сейва повреждён — начните новую игру' }; }
    if (!data || !data.version) return { ok: false, reason: 'Это не сейв Фронтира' };
    if (data.version > SAVE_VERSION) return { ok: false, reason: 'Сейв новее игры — обновите версию' };
    if (data.version < SAVE_VERSION) data = Simulation.migrate(data);
    const sim = new Simulation(data.seed, { ngPlus: data.ngPlus, difficulty: data.difficulty, factions: data.factionCount });
    // восстанавливаем всё поверх свежего конструктора
    sim.rng.setState(data.rngState ?? data.seed);
    sim.day = data.day; sim.dayTime = data.dayTime ?? 0.35; sim.seasonIdx = data.seasonIdx;
    sim.weather = data.weather; sim.eraIndex = data.eraIndex; sim.eraDay = data.eraDay || 0;
    sim.res = { ...sim.res, ...data.res }; sim.resCap = { ...sim.resCap, ...data.resCap };
    sim.techs = new Set(data.techs);
    sim.buildings = data.buildings.map(b => ({ ...b, workers: [] }));
    sim.villagers = data.villagers.map(v => ({ ...v, tx: v.x, ty: v.y, job: 'idle', target: null, path: null, busy: 0 }));
    sim.animals = data.animals || [];
    sim.army = data.army; sim.raids = data.raids; sim.repelled = data.repelled || 0;
    sim.spire = data.spire; sim.won = data.won; sim.freePlay = data.freePlay || data.won;
    sim.chronicle = data.chronicle || []; sim.greatPeople = data.greatPeople || [];
    sim.labor = data.labor || sim.labor;
    // фракции: связываем с def
    sim.factions = (data.factions || []).map(fs => {
      const def = FACTIONS.find(f => f.id === fs.id) || FACTIONS[0];
      return { ...fs, def };
    }).filter(f => f.alive !== undefined);
    if (!sim.factions.length) sim.spawnFactions();
    sim.relations = data.relations || {}; sim.relFactors = data.relFactors || {};
    sim.treaties = data.treaties || []; sim.wars = data.wars || []; sim.aiWars = data.aiWars || [];
    sim.market = data.market || sim.market; sim.caravanTimer = data.caravanTimer ?? 15;
    sim.mission = data.mission; sim.moonDone = data.moonDone; sim.marsDone = data.marsDone;
    // События, пакты, штрафы и дневные кэши отчётов (v4). Старые сейвы v3 этих
    // полей не писали — здесь честные дефолты: висящих событий и пакетов не
    // было, штрафы нулевые, отчёты связи досчитаются к вечеру первого дня.
    sim.pendingEvent = (data.pendingEvent && data.pendingEvent.id && data.pendingEvent.choice)
      ? { ...data.pendingEvent } : null;
    sim.eventCooldown = data.eventCooldown ?? 10;
    sim.farmPenaltyDays = data.farmPenaltyDays ?? 0;
    sim.dcPenaltyDays = data.dcPenaltyDays ?? 0;
    sim._peacePacts = data.peacePacts || {};
    if (data.dayReports && typeof data.dayReports === 'object' && sim.sys) Object.assign(sim.sys, data.dayReports);
    systemsRestore(sim, data.sys);
    // Чудо переживает сейв целиком: стройка, руины и потолок разрушений.
    sim.wonders = WONDER.restoreWonders(data.wonders);
    sim.log = data.log || [];
    for (const f of sim.factions) {
      if (!(f.id in sim.relations)) sim.relations[f.id] = 0;
      if (!sim.relFactors[f.id]) sim.relFactors[f.id] = [];
      if (!sim.diploLog[f.id]) sim.diploLog[f.id] = [];
    }
    return { ok: true, sim };
  }

  // Миграция v1/v2/v3 → v4: прогресс игрока сохраняется полностью
  static migrate(old) {
    const d = JSON.parse(JSON.stringify(old));
    // карта старых эпох (9, без digital): 0..6 совпадают, 7→modern(7), 8→future(9)
    if (d.version === 1) {
      if (d.eraIndex >= 8) d.eraIndex = 9;
      d.res = { steel: 0, gold: 0, ...d.res };
      d.army = { soldiers: 0, powerBonus: 0, trainQueue: 0, trainProgress: 0 };
      d.raids = { timer: 50, warning: false, power: 0, from: null, off: false };
      d.spire = null; d.chronicle = [];
    }
    if (d.version <= 2) {
      // фракции появятся заново от сида
      d.factions = null; d.relations = null; d.treaties = null; d.wars = null;
    }
    if (d.version <= 3) {
      // v4 добавил pendingEvent/eventCooldown, штрафы событий (farm/dc),
      // мирные пакты и дневные кэши отчётов связей. Сейвы v3 этого не писали:
      // событие не висит, пактов нет ({} — deserialize развернёт как «нет»),
      // штрафы нулевые, отчёты досчитаются к вечеру первого дня.
      d.pendingEvent = d.pendingEvent ?? null;
      d.eventCooldown = d.eventCooldown ?? 10;
      d.farmPenaltyDays = d.farmPenaltyDays ?? 0;
      d.dcPenaltyDays = d.dcPenaltyDays ?? 0;
      d.peacePacts = d.peacePacts ?? null;
      if (d.dayReports === undefined) d.dayReports = null;
    }
    if (!d.spire) d.spire = { placed: false, stage: 0, progress: 0, invested: SPIRE_STAGES.map(() => ({ food: 0, wood: 0, stone: 0, steel: 0, gold: 0, knowledge: 0 })) };
    if (!d.chronicle) d.chronicle = [{ day: 0, era: 0, text: 'Основание поселения (мигрированный сейв).' }];
    if (!d.resCap) d.resCap = undefined;
    if (!d.greatPeople) d.greatPeople = [];
    d.version = SAVE_VERSION;
    return d;
  }
}
