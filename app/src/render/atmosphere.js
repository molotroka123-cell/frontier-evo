// render/atmosphere.js — атмосферный слой: дым труб производств с ветром,
// пыль из-под ног марширующих армий, ночные искры костров и точек огня,
// колыхание крон и развевающиеся флаги столиц.
//
// ГРАНИЦЫ. Модуль ничего не меняет в симуляции и до первого кадра не знает
// о канвасе ничего: вся математика — чистые экспортированные функции от
// (сид мира, координаты источника, номер слота, время, номер кадра), они
// гоняются в node без canvas. Класс AtmosphereFX — только сборка плана кадра
// из данных симуляции (planFrame) и отрисовка уже посчитанного.
//
// СЛУЧАЙНОСТЬ. Ни Math.random, ни rng ядра: каждый вызов rng сдвинул бы
// состояние симуляции, а рендер идёт с разной частотой у разных игроков,
// и сейв поплыл бы. Любое «дрожание» — hash4(worldSeed, x, y, frame): при
// одинаковых входах картинка побайтово совпадает (правило детерминизма
// кадров). Плавное движение — аналитика от времени t, которое вызывающий
// передаёт явно, поэтому слой не копит собственного состояния позиций.
//
// ВЕТЕР. Медленная синусоида дня + сида (windAt): направление держится
// часами, как настоящий фронт, а не дрожит покадрово; внутри суток — очень
// медленный дрейф от t. От одного и того же ветра сносится дым, качаются
// кроны и полощутся флаги — вся атмосфера живёт в одной погоде.
//
// КАЧЕСТВО. Плотность каждого слоя умножается на quality.particles и на
// поправку площади экрана (как в weather.js), сверху стоит ЖЁСТКИЙ потолок
// ATMO_LIMITS: он соблюдаетс даже когда произведение плотностей больше
// единицы (ultra × большой экран), потому именно он обещан бюджетом кадра.
// На пресете eco (particles = 0.2, id 'eco') слой молчит целиком. Всё, что
// вне видимого прямоугольника камеры, отсекается до расчёта позиций.

// ---------------------------------------------------------------------------
// ПОТОЛКИ. Это именно потолки, не цели: столько частиц слой НЕ нарисует ни
// при каком разрешении. Числа даны сразу в слотах «источник × слоты», чтобы
// потолок считался без делений в горячем цикле кадра.
// ---------------------------------------------------------------------------
export const ATMO_LIMITS = {
  smokeCols: 10,      // колонн дыма одновременно
  puffsPerCol: 7,     // слотов-клубов на колонну → 70 клубов максимум
  dustRows: 8,        // марширующих отрядов с пылью
  puffsPerRow: 9,     // клубов на отряд → 72 клуба максимум
  fires: 20,          // точек огня в реестре addFire()
  sparksPerFire: 5,   // искр на костёр ночью → 100 искр максимум
  flags: 8,           // анимированных флагов в кадре
};

// Жизни частиц в секундах. Наружу — чтобы тесты сверяли циклы позиций
// именно с этими константами, а не копировали магические числа.
export const SMOKE_LIFE = 4.6;
export const DUST_LIFE = 1.3;
export const SPARK_LIFE = 0.85;

const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---------------------------------------------------------------------------
// hash4 — единственный источник непредсказуемости в модуле. Тот же смеситель,
// что palette.hash2 / city_lights.hashB, но с двумя лишними входами (сид мира
// и номер кадра) и с Math.imul вместо «умножил и обрезал»: imul даёт честное
// 32-битное произведение, младшие биты не вырождаются на крупных координатах.
// Возвращает [0,1).
// ---------------------------------------------------------------------------
export function hash4(seed, x, y, n) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) +
    Math.imul(seed | 0, 1442695041) + Math.imul(n | 0, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// ВЕТЕР: медленная синусоида номера игрового дня + сида мира.
//   day — целый игровой день; t — секунды (очень медленный дрейф внутри
//   суток: фронт чуть ползёт, но за минуту игры направление не меняется).
// x — главный горизонтальный снос [-1..1], y — слабый поперечный [-0.25..0.25].
// Два несоизмеримых периода дают «погоду», которая не повторяется точно
// каждые N дней, но остаётся детерминированной от (seed, day, t).
// ---------------------------------------------------------------------------
export function windAt(seed, day, t = 0) {
  const ph = hash4(seed, day | 0, 17, 3) * TAU;
  const a = Math.sin(ph + day * 2.21 + t * 0.006);
  const b = Math.sin(ph * 1.618 + day * 0.87 + 1.3 + t * 0.004);
  return { x: a * 0.78 + b * 0.22, y: b * 0.22 };
}

// Колокол жизни частицы: быстрый выход, медленный спад. Общая форма для
// дыма, пыли и искр — иначе каждый слой гаснет «по-своему», и кадр пачкается.
function bell(k) {
  return Math.pow(Math.sin(Math.PI * clamp01(k)), 1.5);
}

// Смягчённый шаг для подъёма: клуб быстро отрывается и дальше тормозит —
// так столб читается дымом, а не поездом по рельсам.
function easeOut(k) {
  return 1 - Math.pow(1 - clamp01(k), 1.7);
}

// ---------------------------------------------------------------------------
// ДЫМ ТРУБ. Один слот колонны = один клуб; позиция пересчитывается каждый
// кадр из времени, без накопления состояния — потому функция чистая.
//   seed — сид мира; sx,sy — устье трубы в тайлах; slot — 0..puffsPerCol-1;
//   wind — результат windAt; t — секунды; frame — номер кадра для микродрожи.
// Возвращает {x, y, r, a, k}: центр и радиус в тайлах, альфа [0..1],
// k — возраст клуба [0..1].
// ---------------------------------------------------------------------------
export function smokePuff(seed, sx, sy, slot, wind, t, frame = 0) {
  // Личная фаза колонны: две трубы рядом дымят вразнобой, а не синхронно.
  const j = hash4(seed, Math.round(sx * 8), Math.round(sy * 8), slot + 31);
  const k = ((t / SMOKE_LIFE) + slot / ATMO_LIMITS.puffsPerCol + j) % 1;
  const rise = easeOut(k) * 3.2;                       // подъём, тайлов
  // Вихляние: два несоизмеримых синуса от фазы слота — струя не прямая.
  const wobX = Math.sin((k * 2.6 + j) * TAU) * (0.05 + 0.10 * k);
  const wobY = Math.cos((k * 1.9 + j * 2.0) * TAU) * 0.04 * k;
  // Микродрожь кадра — ровно по железному правилу: hash(сид, x, y, frame).
  const jitX = (hash4(seed, Math.round(sx * 8) + slot * 57, Math.round(sy * 8), frame) - 0.5)
    * 0.02 * k;
  const x = sx + 0.12 + wind.x * k * 2.2 + wobX + jitX;
  const y = sy - 0.18 - rise + wobY;
  const r = 0.13 + 0.38 * k;                           // клуб растёт и бледнеет
  return { x, y, r, a: bell(k) * 0.34, k };
}

// ---------------------------------------------------------------------------
// ПЫЛЬ ИЗ-ПОД НОГ. Источник — текущая точка пути отряда; клубы рождаются у
// ног и остаются позади колонны (смещение против направления хода), поэтому
// за идущим отрядом тянется шлейф даже без истории позиций.
//   dirX,dirY — единичное направление хода отряда; moving — 0..1 темп марша.
// Возвращает {x, y, r, a} в тайлах либо null, если отряд стоит.
// ---------------------------------------------------------------------------
export function marchDust(seed, mx, my, dirX, dirY, slot, t, moving, frame = 0) {
  if (!moving) return null;
  const j = hash4(seed, Math.round(mx * 8) + slot * 57, Math.round(my * 8), 91);
  const k = ((t / DUST_LIFE) + slot / ATMO_LIMITS.puffsPerRow + j) % 1;
  const back = k * 0.55;                               // шлейф позади колонны
  // Разброс в стороны от оси хода — след шириной с дорогу, а не нитка.
  const side = (hash4(seed, slot, j * 997 | 0, 7) - 0.5) * 2;
  const jit = (hash4(seed, Math.round(mx * 8), Math.round(my * 8) + slot, frame) - 0.5) * 0.03;
  const x = mx - dirX * back - dirY * side * 0.28 + jit;
  const y = my - dirY * back * 0.6 + dirX * side * 0.28 - k * 0.12;
  return { x, y, r: 0.10 + 0.30 * k, a: bell(k) * 0.42 * clamp01(moving) };
}

// ---------------------------------------------------------------------------
// ИСКРЫ КОСТРА. Взлетают по короткой параболе с боковым трепетом и гаснут.
// intensity [0..1] ослабляет всё разом: жар костра, а не его геометрию.
// Возвращает {x, y, r, a} либо null при нулевой интенсивности.
// ---------------------------------------------------------------------------
export function fireSpark(seed, fx, fy, slot, t, intensity, frame = 0) {
  const i = clamp01(intensity);
  if (i <= 0.01) return null;
  const j = hash4(seed, Math.round(fx * 8), Math.round(fy * 8), slot + 77);
  const k = ((t / SPARK_LIFE) + j * 0.63 + slot * 0.21) % 1;
  const flutter = Math.sin((k * (1.4 + j) + j) * TAU) * 0.11 * i;
  const jit = (hash4(seed, Math.round(fx * 8) + slot, Math.round(fy * 8), frame) - 0.5) * 0.02;
  return {
    x: fx + flutter + jit,
    y: fy - 0.15 - easeOut(k) * 0.9 * i,
    r: 0.032 + 0.02 * j,
    a: bell(k) * 0.85 * i,
  };
}

// ---------------------------------------------------------------------------
// КОЛОХАНИЕ КРОН. Смещение верхушки дерева в долях тайла от ветра.
// flex — гибкость породы (SPECIES.flex в vegetation.js): дуб качается слабо,
// берёза сильно. Фаза — от координат клетки: лес волнуется нерегулярно,
// а не махает всеми кронами синхронно, как один куст.
// Возвращает {dx, dy}.
// ---------------------------------------------------------------------------
export function crownSway(seed, x, y, wind, t, flex = 1) {
  const g = hash4(seed, x | 0, y | 0, 11) * TAU;
  const amp = 0.07 * flex * (0.35 + 0.65 * Math.abs(wind.x));
  return {
    dx: amp * Math.sin(t * 1.15 + g + wind.x * 1.8),
    dy: amp * 0.35 * Math.sin(t * 0.9 + g * 1.31),
  };
}

// ---------------------------------------------------------------------------
// ФЛАГ. Вымпел над древком столицы: три опорные точки ткани (верх, середина,
// кончик) в локальных долях тайла от верхней точки древка. По кривой
// «древко → кончик → низ древка» рисуется заполненная фигура; волна бежит
// по ткани тем быстрее и глубже, чем сильнее ветер, а при полном штиле
// кончик повисает (droop).
// ---------------------------------------------------------------------------
export function flagPose(seed, x, y, wind, t) {
  const g = hash4(seed, x | 0, y | 0, 23) * TAU;
  const w = clamp01(Math.abs(wind.x));
  const speed = 2.2 + 3.2 * w;
  const amp = 0.05 + 0.14 * w;
  const ph = t * speed + g;
  const L = 0.82 + 0.10 * w;                 // при ветре полотнище вытягивается
  const droop = (1 - w) * 0.30;              // при штиле кончик повисает
  return {
    tipX: L,
    tipY: 0.28 + droop + amp * Math.sin(ph + 1.1),
    midX: L * 0.55,
    midY: 0.14 + droop * 0.45 + amp * Math.sin(ph),
    botDy: 0.55 + amp * 0.4 * Math.sin(ph + 0.4),
  };
}

// Источники дыма: только «горячие» производства (все id существуют в data.js).
const HOT_IDS = {
  smithy: 1, foundry: 1, workshop: 1, factory: 1,
  train_station: 1, power_plant: 1,
};

// Устье трубы относительно угла здания в долях тайла: у кузницы труба
// справа-сверху, у прочих — центр крыши, чтобы столб не резал конёк.
const SMOKE_ANCHORS = {
  smithy: [0.71, 0.08],
  _def: [0.5, 0.15],
};

// ---------------------------------------------------------------------------
// ЧТО РИСУЕМ. План кадра собирается один раз чистой функцией: её вызывает и
// класс для отрисовки, и тесты в node проверяют потолки без всякого канваса.
//   sim   — состояние симуляции (читаем, не мутируем);
//   rect  — видимая область в тайлах {x0,y0,x1,y1};
//   q     — пресет качества (render/quality.js);
//   areaK — поправка на площадь экрана (как BASE-плотность в weather.js);
//   fires — реестр точек огня addFire().
// Возвращает свежие массивы, ничего не мутирует. Сами позиции частиц план НЕ
// считает — их выводят чистые функции выше уже на этапе отрисовки, поэтому
// потолок источников и потолок частиц проверяются независимо.
// ---------------------------------------------------------------------------
export function planFrame(sim, rect, q, areaK, fires = []) {
  const plan = { smoke: [], dust: [], sparks: [], flags: [], fires: [] };
  // eco и любые пресеты с particles <= 0: слой выключен — план пуст целиком.
  if (!q || !(q.particles > 0) || q.id === 'eco') return plan;
  if (!rect || !Number.isFinite(rect.x0 + rect.y0 + rect.x1 + rect.y1)) return plan;
  const dens = q.particles * (Number.isFinite(areaK) && areaK > 0 ? areaK : 1);

  // Потолки слоя. ceil внизу даёт редким источникам шанс: даже при
  // particles=0.2 остаётся хотя бы один источник — редкость должна
  // читаться, а не исчезать совсем. Минимум сверху — жёсткий ATMO_LIMITS:
  // на ultra × большой экран произведение плотностей доходит до 1.7, и без
  // клампа слой нарушил бы бюджет кадра, ради которого потолок заведён.
  const capSmoke = Math.min(ATMO_LIMITS.smokeCols, Math.ceil(ATMO_LIMITS.smokeCols * dens));
  const capDust = Math.min(ATMO_LIMITS.dustRows, Math.ceil(ATMO_LIMITS.dustRows * dens));
  const capFire = Math.min(ATMO_LIMITS.fires, Math.ceil(ATMO_LIMITS.fires * dens));
  const capFlags = Math.min(ATMO_LIMITS.flags, Math.ceil(ATMO_LIMITS.flags * dens));

  const inView = (x, y, m = 4) =>
    x >= rect.x0 - m && x <= rect.x1 + m && y >= rect.y0 - m && y <= rect.y1 + m;

  // --- дым горячих производств -------------------------------------------
  const blds = (sim && sim.buildings) || [];
  for (let i = 0; i < blds.length && plan.smoke.length < capSmoke; i++) {
    const b = blds[i];
    if (!b || b.destroyed || !b.done) continue;
    if (!HOT_IDS[b.id]) continue;
    const s = SMOKE_ANCHORS[b.id] || SMOKE_ANCHORS._def;
    const sx = b.x + s[0], sy = b.y + s[1];
    if (!inView(sx, sy)) continue;
    plan.smoke.push({ sx, sy });
  }

  // --- пыль марширующих отрядов -------------------------------------------
  // Отряд без пути или добравшийся до конца — стоит, пыли не поднимает.
  const squads = (sim && sim.armyState && sim.armyState.squads) || null;
  if (Array.isArray(squads)) {
    for (let i = 0; i < squads.length && plan.dust.length < capDust; i++) {
      const sq = squads[i];
      if (!sq || sq.dead || !sq.path || sq.pathIdx >= sq.path.length) continue;
      const n = sq.path[sq.pathIdx];
      if (!n || !Number.isFinite(sq.x + sq.y + n.x + n.y)) continue;
      if (!inView(sq.x, sq.y, 6)) continue;          // запас на шлейф позади
      let dx = n.x - sq.x, dy = n.y - sq.y;
      const l = Math.hypot(dx, dy) || 1;
      dx /= l; dy /= l;
      plan.dust.push({ mx: sq.x, my: sq.y, dx, dy });
    }
  }

  // --- огонь: реестр addFire + родные кострища ----------------------------
  const fs = Array.isArray(fires) ? fires : [];
  for (let i = 0; i < fs.length && plan.fires.length < capFire; i++) {
    const f = fs[i];
    if (!f || !Number.isFinite(f.x + f.y)) continue;
    if (!inView(f.x, f.y, 3)) continue;
    plan.fires.push({ x: f.x, y: f.y, i: clamp01(+f.i || 0) });
  }
  for (let i = 0; i < blds.length && plan.fires.length < capFire; i++) {
    const b = blds[i];
    if (!b || b.destroyed || !b.done || b.id !== 'campfire') continue;
    if (!inView(b.x + 0.5, b.y + 0.5)) continue;
    plan.fires.push({ x: b.x + 0.5, y: b.y + 0.5, i: 1 });
  }

  // --- флаги столиц живых фракций ------------------------------------------
  const facs = (sim && sim.factions) || [];
  for (let fi = 0; fi < facs.length && plan.flags.length < capFlags; fi++) {
    const f = facs[fi];
    if (!f || !f.alive) continue;
    const sts = f.settlements || [];
    for (let si = 0; si < sts.length && plan.flags.length < capFlags; si++) {
      const s = sts[si];
      if (!s || !s.capital || !inView(s.x, s.y, 2)) continue;
      plan.flags.push({ x: s.x, y: s.y, color: (f.def && f.def.color) || '#c9a227' });
    }
  }

  // Искры в план не кладём: их позиции — чистые функции от plan.fires,
  // времени и кадра, считать их дважды (в плане и в отрисовке) незачем.
  return plan;
}

// ===========================================================================
// AtmosphereFX — состояние кадра и отрисовка. Всё тяжёлое уже посчитано в
// planFrame; здесь только проходы по плану и ctx-примитивы с потолками.
// ===========================================================================
export class AtmosphereFX {
  constructor(quality) {
    this.q = quality || null;
    this.time = 0;
    this.fires = [];            // реестр addFire: {id, x, y, i}
    this._fireId = 1;
  }

  setQuality(q) { this.q = q || null; }

  // API подпитки от renderer/city_lights: факелы чужих городов, пожары,
  // дозорные костры. Потолок FIFO — новый вытесняет самый старый.
  addFire(x, y, intensity = 1) {
    const id = this._fireId++;
    this.fires.push({ id, x, y, i: clamp01(+intensity || 0) });
    while (this.fires.length > ATMO_LIMITS.fires) this.fires.shift();
    return id;
  }

  removeFire(id) {
    const at = this.fires.findIndex((f) => f.id === id);
    if (at >= 0) this.fires.splice(at, 1);
    return at >= 0;
  }

  clearFires() { this.fires.length = 0; }

  // Единственный вход кадра. Безопасен при любых неполных данных: нет канваса
  // (node), качество выключено, сим пуст — после обновления часов выходим.
  frame(sim, ctx, ox, oy, z, cw, ch, dt, L, q) {
    // Часы идут всегда: вернувшаяся из паузы камера не должна прыгать.
    dt = Math.min(0.05, Math.max(0, dt || 0));
    this.time += dt;
    if (!ctx || typeof document === 'undefined') return;
    if (!q || !(q.particles > 0) || q.id === 'eco') return;
    if (!(cw > 0) || !(ch > 0) || !Number.isFinite(z) || z <= 0) return;
    if (!sim || !sim.world) return;

    const areaK = Math.min(1.7, Math.max(0.35, (cw * ch) / (1280 * 720)));
    const rect = { x0: -ox / z, y0: -oy / z, x1: (cw - ox) / z, y1: (ch - oy) / z };
    const frame = Math.round(this.time * 30);          // квант дрожи: 30 кадров/с
    const seed = sim.world.seed | 0;
    const wind = windAt(seed, sim.day | 0, this.time);
    const night = L ? clamp01(((L.glow || 0) - 0.35) / 0.65) : 0;  // глубокая ночь
    const dayL = L ? clamp01(L.mul == null ? 1 : L.mul) : 1;

    const plan = planFrame(sim, rect, q, areaK, this.fires);

    // --- дым ---------------------------------------------------------------
    if (plan.smoke.length) {
      ctx.fillStyle = '#b8b4ae';
      for (const c of plan.smoke) {
        for (let s = 0; s < ATMO_LIMITS.puffsPerCol; s++) {
          const p = smokePuff(seed, c.sx, c.sy, s, wind, this.time, frame);
          const px = ox + p.x * z, py = oy + p.y * z, pr = Math.max(1.5, p.r * z);
          if (px < -pr || py < -pr || px > cw + pr || py > ch + pr) continue;
          ctx.globalAlpha = p.a * (0.5 + 0.5 * dayL);
          ctx.beginPath(); ctx.arc(px, py, pr, 0, TAU); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }

    // --- пыль марша ---------------------------------------------------------
    if (plan.dust.length) {
      ctx.fillStyle = '#a8946e';
      for (const d of plan.dust) {
        for (let s = 0; s < ATMO_LIMITS.puffsPerRow; s++) {
          const p = marchDust(seed, d.mx, d.my, d.dx, d.dy, s, this.time, 1, frame);
          if (!p) continue;
          const px = ox + p.x * z, py = oy + p.y * z, pr = Math.max(1, p.r * z);
          if (px < -pr || py < -pr || px > cw + pr || py > ch + pr) continue;
          ctx.globalAlpha = p.a * (0.45 + 0.55 * dayL);
          ctx.beginPath(); ctx.arc(px, py, pr, 0, TAU); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }

    // --- огни и искры: только глубокой ночью ---------------------------------
    // lighter вместо обычной краски: пятно тепла должно складываться со
    // сценой, а не замазывать её серой кашей.
    if (night > 0.01 && plan.fires.length) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const f of plan.fires) {
        const fx = ox + f.x * z, fy = oy + f.y * z;
        // Цвет ставится внутри итерации: после первого же прохода кисть
        // осталась бы «искровой» и пятно тепла следующего костра желтило.
        // Пятно тепла: два концентрических круга вместо градиента — дешевле
        // и без создания объектов в кадре.
        ctx.fillStyle = 'rgb(255,150,60)';
        ctx.globalAlpha = 0.16 * f.i * night;
        ctx.beginPath(); ctx.arc(fx, fy, z * 1.5 * (0.7 + 0.3 * f.i), 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgb(255,190,90)';
        ctx.globalAlpha = 0.22 * f.i * night;
        ctx.beginPath(); ctx.arc(fx, fy, z * 0.55, 0, TAU); ctx.fill();
        // Ядро пятна: мерцание — от хеша кадра, не от random.
        const fl = 0.85 + 0.3 * hash4(seed, Math.round(f.x * 8), Math.round(f.y * 8), frame);
        ctx.globalAlpha = Math.min(1, 0.30 * f.i * night * fl);
        ctx.beginPath(); ctx.arc(fx, fy, z * 0.24, 0, TAU); ctx.fill();
      }
      for (const f of plan.fires) {
        for (let s = 0; s < ATMO_LIMITS.sparksPerFire; s++) {
          const p = fireSpark(seed, f.x, f.y, s, this.time, f.i, frame);
          if (!p) continue;
          const px = ox + p.x * z, py = oy + p.y * z, pr = Math.max(0.8, p.r * z);
          if (px < -4 || py < -4 || px > cw + 4 || py > ch + 4) continue;
          ctx.globalAlpha = p.a * night;
          ctx.beginPath(); ctx.arc(px, py, pr, 0, TAU); ctx.fill();
        }
      }
      ctx.restore();
    }

    // --- флаги столиц: анимированный вымпел поверх статичного ---------------
    if (plan.flags.length) {
      for (const f of plan.flags) {
        const pose = flagPose(seed, f.x, f.y, wind, this.time);
        const bx = ox + f.x * z;                    // верх древка: (bx, by)
        const by = oy + f.y * z - z * 2.2;
        const tipX = bx + pose.tipX * z, tipY = by + pose.tipY * z;
        const midX = bx + pose.midX * z, midY = by + pose.midY * z;
        const botY = by + pose.botDy * z;
        ctx.globalAlpha = 0.5 + 0.5 * dayL;
        ctx.fillStyle = f.color;
        ctx.strokeStyle = f.color;
        ctx.lineWidth = Math.max(1, z * 0.05);
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.quadraticCurveTo(midX, midY, tipX, tipY);
        ctx.lineTo(bx, botY);
        ctx.closePath();
        ctx.fill();
        // Нижняя кромка тем же цветом вполсилы: ткань имеет толщину.
        ctx.globalAlpha *= 0.5;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY); ctx.lineTo(bx, botY);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }
}

/* ПОДКЛЮЧЕНИЕ
 * Блок правок renderer.js лежит в хвосте самого app/src/render/renderer.js
 * («ПОДКЛЮЧЕНИЕ атмосферы») — там же, где его будет применять ведущий.
 * Кратко: импорт AtmosphereFX, поле this.atmoFx в конструкторе и ОДИН вызов
 * this.atmoFx.frame(sim, ctx, ox, oy, z, cw, ch, dtReal, L, this.quality)
 * сразу после this.fx.drawWorld(...) в draw(). Отдельных setQuality не нужно:
 * пресет приходит параметром каждый кадр.
 * ===========================================================================
 */
