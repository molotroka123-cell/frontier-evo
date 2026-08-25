// render/sprites.js — процедурные спрайты построек с объёмом и ФАКТУРОЙ.
//
// Здание рисуется ОДИН раз в offscreen-канвас и дальше только копируется на
// экран. Это позволяет тратить на один спрайт сотни операций (доски с фасками,
// кладка со сколами, черепица рядами, солома прядями) — то, что было бы
// неприемлемо в каждом кадре.
//
// Геометрия — «ложная изометрия»: у коробки видно переднюю грань, боковую
// (темнее, справа) и верх (светлее, свет сверху-слева 45°). Светотень мягкая:
// в спрайт печатаются AO-тени в щелях (под свесом, у двери, за трубой) и блик
// по свету на коньке. Градиенты в кадре запрещены, но здесь они печатаются в
// кэшируемую текстуру — поэтому ими можно пользоваться свободно.
//
// Вся случайность фактур идёт из seed спрайта (ctx.seed): один и тот же город
// выглядит одинаково от запуска к запуску, Math.random запрещён.
import { ERA_PALETTE, shade, mixHex, hash2, noise2 } from './palette.js';

// Архетип силуэта на каждое здание: именно он делает город узнаваемым,
// иначе все 55 построек сводятся к шести одинаковым «категориям».
const ARCH = {
  campfire: 'campfire', hut: 'hut', forager: 'lean', lumber: 'shed', quarry: 'quarry',
  story_fire: 'storyfire', hunter_lodge: 'tent', pasture: 'field', farm: 'field', granary: 'silo',
  mine: 'mineshaft', smithy: 'forge', market: 'stalls', stone_house: 'house', palisade: 'wall',
  barracks: 'barracks', armory: 'forge', treasury: 'vault', port: 'dock', aqueduct: 'arches',
  temple: 'columned', clinic: 'house', amphitheater: 'amphi', academy: 'columned', castle: 'keep',
  university: 'columned', mill: 'mill', guild_hall: 'shed', bank: 'columned', stone_walls: 'wall',
  press: 'shed', observatory: 'dome', shipyard: 'shipyard', foundry: 'factory', workshop: 'shed',
  train_station: 'shed', factory: 'factory', sewers: 'sewers', stock_exchange: 'columned',
  power_plant: 'factory', lab: 'lab', apartment: 'highrise', media_tower: 'tower',
  hospital: 'house', airport: 'airport', npp: 'reactor', datacenter: 'flat', solar: 'solar',
  robo_factory: 'factory', biolab: 'dome', skyscraper: 'highrise', ai_core: 'aicore',
  fusion_reactor: 'reactor', spaceport: 'pad', spire: 'spire',
  // Склады раньше не имели своего архетипа и рисовались обычным домом:
  // три разных здания выглядели одной хижиной.
  woodshed: 'woodpile', stoneyard: 'stonepile', depot: 'warehouse',
};

// Высота постройки в долях ширины тайла. Раньше здесь стояла одна константа
// 1.55 на всё — и небоскрёб, и хижина выходили одного роста, отчего город
// читался как набор одинаковых коробок.
//
// Числа взяты от реального роста: масштаб карты 1 тайл ≈ 8 м (docs/art-direction.md §7),
// значит землянка в 3 м — это 0.38 тайла, а башня в 90 м упирается в потолок,
// который мы себе позволяем. Потолок нужен: настоящий небоскрёб в масштабе
// закрыл бы полэкрана и спрятал под собой карту.
const ARCH_H = {
  // земля и ямы — почти без вертикали
  field: 0.30, quarry: 0.42, mineshaft: 0.70, sewers: 0.34, pad: 0.40, solar: 0.34,
  // очаги и навесы
  campfire: 0.45, storyfire: 0.85, lean: 0.60, tent: 0.75, woodpile: 0.62, stonepile: 0.70,
  // жильё и мастерские каменного и бронзового века
  hut: 0.90, house: 1.15, shed: 0.95, stalls: 0.80, forge: 1.10, dock: 0.95,
  // общественные постройки античности
  columned: 1.70, amphi: 1.15, arches: 1.25, silo: 1.35, mill: 1.65, dome: 1.55,
  // укрепления
  wall: 1.00, barracks: 1.20, keep: 2.10, vault: 1.30,
  // промышленность
  factory: 1.70, warehouse: 1.10, shipyard: 1.25, lab: 1.40, reactor: 1.90, flat: 0.90,
  airport: 1.30,
  // современность и будущее — единственное, чему положено возвышаться
  highrise: 3.20, tower: 3.60, aicore: 2.40, spire: 4.20,
};
const ARCH_H_DEFAULT = 1.15;

export function archHeight(arch) { return ARCH_H[arch] ?? ARCH_H_DEFAULT; }

export class SpriteCache {
  constructor(quality) {
    this.q = quality;
    this.map = new Map();
  }
  setQuality(q) { this.q = q; this.map.clear(); }

  // Возвращает { cv, glow, sil, hFact } — спрайт, карта свечения окон,
  // чёрный силуэт для теней и высота в долях тайла.
  building(id, def, era, sizeTiles) {
    const key = `${id}|${era}|${sizeTiles}|${this.q.detail}`;
    let s = this.map.get(key);
    if (s) return s;
    s = bake(id, def, era, sizeTiles, this.q.detail);
    this.map.set(key, s);
    return s;
  }
}

// базовое разрешение спрайта на один тайл ширины
const BASE = [56, 96, 132];

function bake(id, def, era, sizeTiles, detail) {
  const W = BASE[detail] * sizeTiles;
  // Высота своя у каждого архетипа (см. ARCH_H). Небольшой запас сверху нужен
  // под конёк, трубу и мачту — иначе они срезаются рамкой холста.
  const HFACT = archHeight(ARCH[id] || 'house') * 1.12;
  const H = Math.round(W * HFACT);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  const glow = document.createElement('canvas');
  glow.width = W; glow.height = H;
  const gc = glow.getContext('2d');

  const pal = ERA_PALETTE[era];
  const arch = ARCH[id] || 'house';
  // «пол» спрайта: низ тайла. Всё, что выше, — объём здания.
  const groundY = H - W * 0.16;

  // Само здание рисуется в отдельный холст: по нему печётся тёмный контур.
  // Без контура постройка сливается с травой и крышами соседей, а с ним даже
  // мелкий спрайт читается силуэтом — это главное, что отличает нарисованный
  // арт от «квадратиков».
  const body = document.createElement('canvas');
  body.width = W; body.height = H;
  const bc = body.getContext('2d');
  // Мягкий слой: зарево огня, дым, ореолы. Обводить их нельзя — полупрозрачный
  // градиент превращается в чёрный ком, — поэтому они кладутся ПОСЛЕ обводки.
  const soft = document.createElement('canvas');
  soft.width = W; soft.height = H;
  const fc = soft.getContext('2d');
  const ctx = { c: bc, gc, soft: fc, W, H, groundY, pal, era, id, detail, seed: hash2(id.length * 7 + era, W) };

  plate({ c, W, groundY });
  (DRAW[arch] || DRAW.house)(ctx);
  strokeOutline(c, body, Math.max(1, Math.round(W / 100)));
  c.drawImage(body, 0, 0);
  c.drawImage(soft, 0, 0);

  // Чёрный силуэт для тени печётся здесь же. Считать его в кадре через
  // ctx.filter='brightness(0)' нельзя: фильтры Canvas2D чудовищно медленные
  // и срезали кадр с 60 до 40 FPS на городе.
  const sil = document.createElement('canvas');
  sil.width = W; sil.height = H;
  const sc = sil.getContext('2d');
  sc.drawImage(cv, 0, 0);
  sc.globalCompositeOperation = 'source-in';
  sc.fillStyle = '#000';
  sc.fillRect(0, 0, W, H);

  return { cv, glow, sil, hFact: HFACT };
}

// ---------------------------------------------------------------------------
// Детерминированный шум
// ---------------------------------------------------------------------------

// Поток случайных чисел из seed спрайта. Math.random запрещён: город обязан
// выглядеть одинаково от запуска к запуску, а спрайт — от пересборки к пересборке.
function rng(seed, salt = 0) {
  let s = (Math.imul(seed | 0, 2654435761) + Math.imul(salt + 1, 40503) + 1) | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Точка и её линейная интерполяция — крыши считаются между двумя рёбрами.
const P = (x, y) => [x, y];
const lerpP = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];

// ---------------------------------------------------------------------------
// Примитивы
// ---------------------------------------------------------------------------

// Тёмная обводка силуэта: тот же приём, что у спрайтов жителей.
function strokeOutline(c, body, k) {
  const sil = document.createElement('canvas');
  sil.width = body.width; sil.height = body.height;
  const sc = sil.getContext('2d');
  sc.drawImage(body, 0, 0);
  sc.globalCompositeOperation = 'source-in';
  sc.fillStyle = 'rgba(26,20,16,0.8)';
  sc.fillRect(0, 0, sil.width, sil.height);
  for (const [dx, dy] of [[-k, 0], [k, 0], [0, -k], [0, k], [-k, -k], [k, -k], [-k, k], [k, k]]) {
    c.drawImage(sil, dx, dy);
  }
}

// Утоптанная площадка под зданием — «сажает» его на землю.
function plate({ c, W, groundY }) {
  const g = c.createRadialGradient(W / 2, groundY, W * 0.1, W / 2, groundY, W * 0.55);
  g.addColorStop(0, 'rgba(84,68,48,0.42)');
  g.addColorStop(1, 'rgba(84,68,48,0)');
  c.fillStyle = g;
  c.beginPath(); c.ellipse(W / 2, groundY, W * 0.52, W * 0.2, 0, 0, 7); c.fill();
}

// AO-полоса сверху вниз: щели под свесом крыши, подоконником или балкой
// всегда собирают тень — без неё нависающий элемент выглядит наклеенным.
function aoDown(c, x, y, w, h, a = 0.26) {
  if (h <= 0 || w <= 0) return;
  const g = c.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, `rgba(18,12,8,${a})`);
  g.addColorStop(1, 'rgba(18,12,8,0)');
  c.fillStyle = g;
  c.fillRect(x, y, w, h);
}

// Контактная тень у земли или под нависающим объёмом.
function aoGround(c, cx, cy, rx, ry, a = 0.30) {
  const g = c.createRadialGradient(cx, cy, rx * 0.15, cx, cy, rx);
  g.addColorStop(0, `rgba(20,14,8,${a})`);
  g.addColorStop(1, 'rgba(20,14,8,0)');
  c.fillStyle = g;
  c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, 7); c.fill();
}

// Коробка в ложной изометрии: передняя грань, боковая справа (темнее), верх (светлее).
// x,y — левый-верхний угол ПЕРЕДНЕЙ грани; d — глубина «вбок-вверх».
function box(c, x, y, w, h, d, col, opt = {}) {
  const top = opt.top || shade(col, 0.22);
  const side = opt.side || shade(col, -0.3);
  // верх
  c.fillStyle = top;
  c.beginPath();
  c.moveTo(x, y); c.lineTo(x + d, y - d * 0.55); c.lineTo(x + w + d, y - d * 0.55); c.lineTo(x + w, y);
  c.closePath(); c.fill();
  // боковая
  c.fillStyle = side;
  c.beginPath();
  c.moveTo(x + w, y); c.lineTo(x + w + d, y - d * 0.55); c.lineTo(x + w + d, y + h - d * 0.55); c.lineTo(x + w, y + h);
  c.closePath(); c.fill();
  // передняя с вертикальным градиентом — низ всегда темнее, это читается как объём
  const g = c.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, shade(col, 0.10));
  g.addColorStop(1, shade(col, -0.16));
  c.fillStyle = g;
  c.fillRect(x, y, w, h);
  // светлая кромка на освещённом ребре
  c.fillStyle = 'rgba(255,248,225,0.20)';
  c.fillRect(x, y, w, Math.max(1, h * 0.045));
  c.fillRect(x, y, Math.max(1, w * 0.03), h);
  // AO под верхним ребром передней грани: щель между стеной и нависающим
  // верхом собирает грязь и тень — без неё коробка выглядит плоской наклейкой
  if (opt.ao !== false) aoDown(c, x, y + Math.max(1, h * 0.045), w, Math.max(3, h * 0.13), 0.16);
}

// Двускатная крыша над коробкой: возвращает точки скатов для фактуры.
// A,B — карниз (лево/право), D,C — конёк (близ/далек).
function gablePts(x, y, w, d, rise) {
  return {
    A: P(x, y), B: P(x + w, y),
    D: P(x + w / 2, y - rise * 0.55),
    C: P(x + w / 2 + d, y - d * 0.55 - rise),
  };
}

function gable(c, x, y, w, d, rise, col, era, seed, detail) {
  const { A, B, C, D } = gablePts(x, y, w, d, rise);
  // дальний скат темнее: свет сверху-слева его не достаёт
  c.fillStyle = shade(col, -0.26);
  c.beginPath();
  c.moveTo(x + d, y - d * 0.55); c.lineTo(x + w + d, y - d * 0.55);
  c.lineTo(C[0], C[1]); c.lineTo(D[0], D[1]);
  c.closePath(); c.fill();
  c.fillStyle = 'rgba(0,0,0,0.14)';
  c.beginPath();
  c.moveTo(x + d, y - d * 0.55); c.lineTo(x + w + d, y - d * 0.55);
  c.lineTo(C[0], C[1]); c.lineTo(D[0], D[1]);
  c.closePath(); c.fill();
  // ближний скат — на него ложится материал эпохи
  c.fillStyle = shade(col, 0.14);
  c.beginPath();
  c.moveTo(A[0], A[1]); c.lineTo(B[0], B[1]);
  c.lineTo(C[0], C[1]); c.lineTo(D[0], D[1]);
  c.closePath(); c.fill();
  roofSkin(c, A, B, C, D, era, col, rng(seed, 31), detail);
  ridgeCap(c, D, C, col);
  // конёк ловит блик по свету (свет сверху-слева)
  c.strokeStyle = 'rgba(255,248,225,0.45)';
  c.lineWidth = Math.max(1, w * 0.008);
  c.beginPath(); c.moveTo(D[0] - w * 0.004, D[1] - 1); c.lineTo(C[0] - w * 0.004, C[1] - 1); c.stroke();
  // свес крыши: тень на стене под ним + сам свес
  c.fillStyle = shade(col, -0.12);
  c.fillRect(x - w * 0.04, y - w * 0.012, w * 1.08, w * 0.028);
  aoDown(c, x, y + w * 0.016, w, Math.max(4, w * 0.10), 0.30);
}

// Конёк: тёмная капа со светлой верхней кромкой.
function ridgeCap(c, D, C, col) {
  c.strokeStyle = shade(col, -0.38);
  const lw = Math.max(2, Math.hypot(C[0] - D[0], C[1] - D[1]) * 0.06);
  c.lineWidth = lw;
  c.beginPath(); c.moveTo(D[0], D[1]); c.lineTo(C[0], C[1]); c.stroke();
  c.strokeStyle = 'rgba(255,248,225,0.35)';
  c.lineWidth = Math.max(1, lw * 0.4);
  c.beginPath(); c.moveTo(D[0], D[1] - lw * 0.35); c.lineTo(C[0], C[1] - lw * 0.35); c.stroke();
}

// ---------------------------------------------------------------------------
// Материал крыши по эпохе: солома → дранка → черепица → сланец → фальц-металл.
// A,B — карниз; D,C — конёк. Всё рисуется внутри клина ската.
// ---------------------------------------------------------------------------
function roofSkin(c, A, B, C, D, era, col, R, detail) {
  c.save();
  c.beginPath();
  c.moveTo(A[0], A[1]); c.lineTo(B[0], B[1]); c.lineTo(C[0], C[1]); c.lineTo(D[0], D[1]);
  c.closePath(); c.clip();
  const slopeLen = Math.hypot(D[0] - A[0], D[1] - A[1]);
  const rows = detail === 0 ? 4 : Math.max(4, Math.round(slopeLen / (era === 1 || era === 0 ? 10 : 7)));
  const rowAt = k => [lerpP(A, D, k / rows), lerpP(B, C, k / rows)];

  if (era <= 1) {
    // СОЛОМА: пряди по склону + тёмный прогиб у конька. Голосовая фактура
    // «расчёски» читается даже на 56px, поэтому это главный материал ранних эпох.
    c.fillStyle = shade(col, 0.06);
    c.fillRect(A[0] - 4, D[1] - 4, B[0] - A[0] + 8, B[1] - D[1] + 8);
    const strands = detail === 0 ? rows * 4 : rows * 9;
    for (let i = 0; i < strands; i++) {
      const k0 = R() * 0.9, u = R();
      const p1 = lerpP(lerpP(A, D, k0), lerpP(B, C, k0), u);
      const k1 = Math.min(1, k0 + 0.09 + R() * 0.06);
      const p2 = lerpP(lerpP(A, D, k1), lerpP(B, C, k1), Math.min(1, Math.max(0, u + (R() - 0.5) * 0.08)));
      c.strokeStyle = shade(col, (R() - 0.42) * 0.42);
      c.lineWidth = Math.max(1, slopeLen / rows * 0.30);
      c.beginPath(); c.moveTo(p1[0], p1[1]); c.lineTo(p2[0], p2[1]); c.stroke();
    }
    // прогиб: под коньком солома лежит плотнее и темнее
    const t0 = rowAt(rows - 1.2), t1 = rowAt(rows);
    c.fillStyle = 'rgba(30,20,8,0.22)';
    c.beginPath();
    c.moveTo(t0[0][0], t0[0][1]); c.lineTo(t0[1][0], t0[1][1]);
    c.lineTo(t1[1][0], t1[1][1]); c.lineTo(t1[0][0], t1[0][1]);
    c.closePath(); c.fill();
    // солнечная полоса на середине ската
    const m0 = rowAt(rows * 0.45), m1 = rowAt(rows * 0.62);
    c.fillStyle = 'rgba(255,240,200,0.12)';
    c.beginPath();
    c.moveTo(m0[0][0], m0[0][1]); c.lineTo(m0[1][0], m0[1][1]);
    c.lineTo(m1[1][0], m1[1][1]); c.lineTo(m1[0][0], m1[0][1]);
    c.closePath(); c.fill();
  } else if (era === 2) {
    // ДРАНКА: деревянный гонт короткими рядами со смещением
    for (let k = 0; k < rows; k++) {
      const [p0, p1] = rowAt(k), [q0, q1] = rowAt(k + 1);
      c.fillStyle = shade(col, (R() - 0.5) * 0.2);
      c.beginPath();
      c.moveTo(p0[0], p0[1]); c.lineTo(p1[0], p1[1]); c.lineTo(q1[0], q1[1]); c.lineTo(q0[0], q0[1]);
      c.closePath(); c.fill();
      // тень на стыке рядов: нижний гонт лежит ПОД верхним
      c.strokeStyle = 'rgba(20,12,6,0.34)';
      c.lineWidth = Math.max(1, slopeLen / rows * 0.22);
      c.beginPath(); c.moveTo(p0[0], p0[1]); c.lineTo(p1[0], p1[1]); c.stroke();
      // вертикальные стыки со смещением через ряд
      const n = 4;
      for (let i = 0; i < n; i++) {
        const u = (i + (k % 2) * 0.5) / n;
        const a = lerpP(p0, p1, u), b = lerpP(q0, q1, u);
        c.strokeStyle = 'rgba(20,12,6,0.22)';
        c.lineWidth = 1;
        c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
      }
    }
  } else if (era <= 5) {
    // ЧЕРЕПИЦА: ряды со смещением, тень на стыке, редкие светлые/тёмные черепки
    for (let k = 0; k < rows; k++) {
      const [p0, p1] = rowAt(k), [q0, q1] = rowAt(k + 1);
      c.fillStyle = shade(col, (R() - 0.5) * 0.16);
      c.beginPath();
      c.moveTo(p0[0], p0[1]); c.lineTo(p1[0], p1[1]); c.lineTo(q1[0], q1[1]); c.lineTo(q0[0], q0[1]);
      c.closePath(); c.fill();
      c.strokeStyle = 'rgba(20,10,4,0.32)';
      c.lineWidth = Math.max(1, slopeLen / rows * 0.20);
      c.beginPath(); c.moveTo(p0[0], p0[1]); c.lineTo(p1[0], p1[1]); c.stroke();
      const n = detail === 0 ? 4 : 5;
      for (let i = 0; i < n; i++) {
        const u = (i + (k % 2) * 0.5) / n;
        const a = lerpP(p0, p1, u), b = lerpP(q0, q1, u);
        c.strokeStyle = 'rgba(20,10,4,0.20)';
        c.lineWidth = 1;
        c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
      }
      // выцветшая или оббитая черепица — редкая, но сразу оживляет ряд
      if (detail >= 1 && R() < 0.3) {
        const u = R() * 0.8 + 0.1;
        const a = lerpP(p0, p1, u), b = lerpP(q0, q1, Math.min(1, u + 0.12));
        c.fillStyle = R() < 0.5 ? 'rgba(255,240,210,0.20)' : 'rgba(30,16,8,0.22)';
        c.beginPath();
        c.moveTo(a[0], a[1]); c.lineTo(lerpP(p0, p1, Math.min(1, u + 0.12))[0], lerpP(p0, p1, Math.min(1, u + 0.12))[1]);
        c.lineTo(b[0], b[1]); c.lineTo(lerpP(q0, q1, u)[0], lerpP(q0, q1, u)[1]);
        c.closePath(); c.fill();
      }
    }
  } else if (era === 6) {
    // СЛАНЕЦ: тёмные тонкие ряды, скупые вертикальные швы
    for (let k = 0; k < rows; k++) {
      const [p0, p1] = rowAt(k), [q0, q1] = rowAt(k + 1);
      c.fillStyle = shade(col, (R() - 0.5) * 0.12);
      c.beginPath();
      c.moveTo(p0[0], p0[1]); c.lineTo(p1[0], p1[1]); c.lineTo(q1[0], q1[1]); c.lineTo(q0[0], q0[1]);
      c.closePath(); c.fill();
      c.strokeStyle = 'rgba(8,8,10,0.35)';
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(p0[0], p0[1]); c.lineTo(p1[0], p1[1]); c.stroke();
      if (R() < 0.7) {
        const u = R();
        const a = lerpP(p0, p1, u), b = lerpP(q0, q1, u);
        c.strokeStyle = 'rgba(8,8,10,0.18)';
        c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
      }
    }
  } else {
    // ФАЛЬЦ-МЕТАЛЛ: вертикальные швы со светлой фаской, панельная ржавчина
    const g = c.createLinearGradient(A[0], A[1], D[0], D[1]);
    g.addColorStop(0, shade(col, 0.10));
    g.addColorStop(1, shade(col, -0.06));
    c.fillStyle = g;
    c.fillRect(A[0] - 4, D[1] - 4, B[0] - A[0] + 8, B[1] - D[1] + 8);
    const seams = 5;
    for (let i = 0; i <= seams; i++) {
      const u = i / seams + 0.5 / seams;
      const a = lerpP(A, D, u), b = lerpP(B, C, u);
      c.strokeStyle = 'rgba(10,14,18,0.35)';
      c.lineWidth = Math.max(1, slopeLen * 0.02);
      c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
      c.strokeStyle = 'rgba(255,255,255,0.16)';
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(a[0] + 1.5, a[1]); c.lineTo(b[0] + 1.5, b[1]); c.stroke();
    }
    // горизонтальная реборда посередине
    const [m0, m1] = rowAt(0.5);
    c.strokeStyle = 'rgba(255,255,255,0.10)';
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(m0[0], m0[1]); c.lineTo(m1[0], m1[1]); c.stroke();
    // потёки ржавчины у карниза — металл должен быть старым, а не из каталога
    if (detail >= 1) {
      for (let i = 0; i < 3; i++) {
        const u = R();
        const a = lerpP(A, B, u);
        c.strokeStyle = 'rgba(140,80,40,0.20)';
        c.lineWidth = Math.max(1, slopeLen * 0.03);
        c.beginPath(); c.moveTo(a[0], a[1]);
        c.lineTo(a[0] + (R() - 0.5) * 3, a[1] + slopeLen * (0.15 + R() * 0.2)); c.stroke();
      }
    }
  }
  c.restore();
}

// Бахрома соломы по карнизу: рисуется ПОСЛЕ клипа, свисает ниже кромки.
function thatchFringe(c, A, B, col, R, n = 14) {
  c.strokeStyle = shade(col, -0.18);
  c.lineWidth = Math.max(1, Math.hypot(B[0] - A[0], B[1] - A[1]) * 0.012);
  for (let i = 0; i <= n; i++) {
    const p = lerpP(A, B, i / n);
    const len = 2 + R() * 4;
    c.beginPath(); c.moveTo(p[0], p[1]);
    c.lineTo(p[0] + (R() - 0.5) * 3, p[1] + len); c.stroke();
  }
}

// ---------------------------------------------------------------------------
// Материалы стен. Каждый — отдельный «художник», диспетчер по эпохе ниже.
// ---------------------------------------------------------------------------

// Брёвна каменного века: цилиндры с корой, топорные грани, щели.
function logWall(c, x, y, w, h, col, R, detail) {
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  c.fillStyle = col; c.fillRect(x, y, w, h);
  const rows = Math.max(3, Math.round(h / (w * 0.17)));
  const rh = h / rows;
  for (let i = 0; i < rows; i++) {
    const yy = y + i * rh;
    const tone = (R() - 0.5) * 0.2;
    // бревно-цилиндр: блик сверху, тень снизу
    c.fillStyle = shade(col, 0.05 + tone);
    c.fillRect(x, yy, w, rh);
    c.fillStyle = 'rgba(255,246,220,0.13)';
    c.fillRect(x, yy + rh * 0.08, w, Math.max(1, rh * 0.16));
    c.fillStyle = shade(col, -0.24 + tone * 0.5);
    c.fillRect(x, yy + rh * 0.6, w, rh * 0.4);
    // кора: короткие тёмные штрихи, у каждого бревна свои
    if (detail >= 1) {
      c.strokeStyle = 'rgba(38,24,12,0.42)';
      c.lineWidth = 1;
      const n = 2 + Math.round(R() * 2);
      for (let k = 0; k < n; k++) {
        const kx = x + R() * w * 0.94;
        c.beginPath(); c.moveTo(kx, yy + rh * 0.2);
        c.lineTo(kx + (R() - 0.5) * w * 0.1, yy + rh * 0.8); c.stroke();
      }
    }
  }
  // мох и грязь в щелях у земли
  aoDown(c, x, y + h * 0.72, w, h * 0.28, 0.20);
  c.restore();
}

// Дощатая раскладка: доски с фаской (свет слева, шов справа) и сучками.
function plankWall(c, x, y, w, h, col, R, detail) {
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  const n = Math.max(4, Math.round(w / Math.max(6, w * 0.17)));
  const pw = w / n;
  for (let i = 0; i < n; i++) {
    const px = x + i * pw;
    const tone = (R() - 0.5) * 0.18;
    c.fillStyle = shade(col, tone);
    c.fillRect(px, y, pw, h);
    // фаска: свет на левом ребре доски, тень в правом шве
    c.fillStyle = 'rgba(255,246,220,0.16)';
    c.fillRect(px, y, Math.max(1, pw * 0.14), h);
    c.fillStyle = 'rgba(24,14,6,0.30)';
    c.fillRect(px + pw - Math.max(1, pw * 0.12), y, Math.max(1, pw * 0.12), h);
    // сучок: тёмный овал с бликом — на 2-3 досках из всех
    if (detail >= 1 && R() < 0.3) {
      const ky = y + h * (0.15 + R() * 0.7), kx = px + pw * 0.5;
      c.fillStyle = 'rgba(40,24,10,0.55)';
      c.beginPath(); c.ellipse(kx, ky, Math.max(1, pw * 0.10), Math.max(1, pw * 0.16), 0, 0, 7); c.fill();
      c.fillStyle = 'rgba(90,60,30,0.5)';
      c.beginPath(); c.ellipse(kx, ky - pw * 0.03, Math.max(1, pw * 0.05), Math.max(1, pw * 0.07), 0, 0, 7); c.fill();
    }
  }
  aoDown(c, x, y + h * 0.8, w, h * 0.2, 0.14);
  c.restore();
}

// Каменная кладка: смещение рядов, индивидуальный тон камней, сколы.
function stoneWall(c, x, y, w, h, col, R, detail, rows = 5) {
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  c.fillStyle = shade(col, -0.44); c.fillRect(x, y, w, h); // раствор в швах
  const rh = h / rows, cols = 4;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * 0.5;
    for (let i = -1; i < cols; i++) {
      const bx = x + (i + off) * (w / cols) + 1;
      const bw = w / cols - 2;
      const by = y + r * rh + 1, bh = rh - 2;
      const tone = (R() - 0.5) * 0.26;
      c.fillStyle = shade(col, tone);
      c.fillRect(bx, by, bw, bh);
      // свет сверху-слева, тень снизу — каждый камень чуть выпуклый
      c.fillStyle = 'rgba(255,248,225,0.13)';
      c.fillRect(bx, by, bw, Math.max(1, bh * 0.2));
      c.fillStyle = 'rgba(0,0,0,0.16)';
      c.fillRect(bx, by + bh * 0.78, bw, Math.max(1, bh * 0.22));
      // скол: тёмная выщербина на случайном камне
      if (detail >= 1 && R() < 0.2) {
        c.fillStyle = 'rgba(28,24,20,0.55)';
        c.beginPath();
        c.moveTo(bx + bw * 0.2, by + bh * 0.35);
        c.lineTo(bx + bw * 0.55, by + bh * 0.2);
        c.lineTo(bx + bw * 0.42, by + bh * 0.68);
        c.closePath(); c.fill();
      }
    }
  }
  // сырость у земли
  aoDown(c, x, y + h * 0.7, w, h * 0.3, 0.20);
  c.restore();
}

// Кирпич: мелкие ряды в полкирпича, светлая расшивка, потёки сажи.
function brickWall(c, x, y, w, h, col, R, detail) {
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  c.fillStyle = mixHex(col, '#b8a88f', 0.55); c.fillRect(x, y, w, h); // расшивка
  const rows = Math.max(4, Math.round(h / Math.max(4, w * 0.07)));
  const rh = h / rows, bw = w / 4;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * bw * 0.5;
    for (let i = -1; i < 5; i++) {
      const bx = x + i * bw + off + 0.7, by = y + r * rh + 0.7;
      const kw = bw - 1.4, kh = rh - 1.4;
      if (kw <= 0 || kh <= 0) continue;
      let tone = (R() - 0.5) * 0.18;
      if (R() < 0.1) tone = -0.3; // пережжённый кирпич
      c.fillStyle = shade(col, tone);
      c.fillRect(bx, by, kw, kh);
      c.fillStyle = 'rgba(255,246,220,0.10)';
      c.fillRect(bx, by, kw, Math.max(1, kh * 0.22));
    }
  }
  // потёки: светлые высолы и тёмная копоть под карнизом
  if (detail >= 1) {
    for (let i = 0; i < 3; i++) {
      const sx = x + R() * w;
      c.strokeStyle = 'rgba(255,255,240,0.08)';
      c.lineWidth = Math.max(1.5, w * 0.03);
      c.beginPath(); c.moveTo(sx, y);
      c.lineTo(sx + (R() - 0.5) * 2, y + h * (0.3 + R() * 0.4)); c.stroke();
    }
  }
  aoDown(c, x, y, w, h * 0.1, 0.12);
  aoDown(c, x, y + h * 0.78, w, h * 0.22, 0.16);
  c.restore();
}

// Штукатурка с пятном возраста: неровный тон, трещинки, грязь у земли.
function plasterWall(c, x, y, w, h, col, R, detail, seed) {
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  c.fillStyle = col; c.fillRect(x, y, w, h);
  // пятна возраста: крупные мягкие, через шум — чтобы не была шахматка
  const cells = Math.max(2, Math.round(w / 18));
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < Math.max(2, Math.round(h / 18)); j++) {
      const n = noise2(i * 5.3 + seed * 13, j * 4.1 + seed * 7);
      if (n < 0.62) continue;
      const cx = x + (i + 0.5) * (w / cells), cy = y + (j + 0.5) * (h / Math.max(2, Math.round(h / 18)));
      c.fillStyle = n > 0.8 ? 'rgba(120,96,60,0.10)' : 'rgba(60,52,40,0.08)';
      c.beginPath(); c.ellipse(cx, cy, w * 0.16, h * 0.12, n * 3, 0, 7); c.fill();
    }
  }
  // мелкая крапина штукатурки
  if (detail >= 1) {
    for (let i = 0; i < 14; i++) {
      c.fillStyle = R() < 0.5 ? 'rgba(255,250,230,0.10)' : 'rgba(60,50,36,0.10)';
      c.fillRect(x + R() * w, y + R() * h, 1.4, 1.4);
    }
  }
  // трещина: одна тонкая ломаная — стена старая, но стоит
  if (detail >= 2) {
    c.strokeStyle = 'rgba(50,40,28,0.35)';
    c.lineWidth = 1;
    let cx = x + w * (0.2 + R() * 0.6), cy = y + h * 0.08;
    c.beginPath(); c.moveTo(cx, cy);
    for (let s = 0; s < 4; s++) { cx += (R() - 0.5) * w * 0.1; cy += h * 0.2; c.lineTo(cx, cy); }
    c.stroke();
  }
  aoDown(c, x, y + h * 0.8, w, h * 0.2, 0.15);
  c.restore();
}

// Фахверк поверх штукатурки: стойки, пояса, раскосы — направление от seed.
function timberFrame(c, x, y, w, h, pal, R, stories = 1) {
  const beam = shade(pal.trim, -0.22);
  const bw = Math.max(2, w * 0.055);
  // раскосы и стойки рисуем первыми, пояса — поверх их концов
  for (let s = 0; s < stories; s++) {
    const sy = y + (h * s) / stories + bw, sh = h / stories - bw * 2;
    if (sh < bw) continue;
    const bays = 3;
    for (let i = 0; i < bays; i++) {
      // раскос: направление чередуется, наклон чуть «пляшет» от seed
      const dir = ((i + s) % 2 === 0) === (R() < 0.85) ? 1 : -1;
      const x0 = x + i * (w / bays), x1 = x0 + w / bays;
      c.strokeStyle = beam;
      c.lineWidth = bw * 0.7;
      c.beginPath();
      if (dir > 0) { c.moveTo(x0 + bw * 0.8, sy + sh); c.lineTo(x1 - bw * 0.8, sy + bw * 0.4); }
      else { c.moveTo(x0 + bw * 0.8, sy + bw * 0.4); c.lineTo(x1 - bw * 0.8, sy + sh); }
      c.stroke();
    }
    for (let i = 1; i < bays; i++) {
      const px = x + (w * i) / bays - bw * 0.4;
      c.fillStyle = beam;
      c.fillRect(px, sy, bw * 0.8, sh);
    }
  }
  // угловые стойки и горизонтальные пояса
  c.fillStyle = beam;
  c.fillRect(x, y, bw, h);
  c.fillRect(x + w - bw, y, bw, h);
  for (let s = 0; s <= stories; s++) {
    const yy = s === stories ? y + h - bw : y + (h * s) / stories;
    c.fillRect(x, yy, w, bw);
    // брус ловит свет верхней гранью
    c.fillStyle = 'rgba(255,244,214,0.18)';
    c.fillRect(x, yy, w, Math.max(1, bw * 0.35));
    c.fillStyle = beam;
    if (s > 0 && s < stories) aoDown(c, x + bw, yy + bw, w - bw * 2, bw * 1.8, 0.20);
  }
}

// Панельные швы: фаска на стыке (свет+тень), пояса этажей, блик неба.
function panelWall(c, x, y, w, h, col, R, detail) {
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  c.fillStyle = col; c.fillRect(x, y, w, h);
  for (let i = 1; i < 5; i++) {
    const px = x + (w * i) / 5;
    c.fillStyle = 'rgba(255,255,255,0.12)';
    c.fillRect(px - 1.5, y, 1.5, h);
    c.fillStyle = 'rgba(0,0,0,0.20)';
    c.fillRect(px, y, 1.5, h);
  }
  for (let i = 1; i < 3; i++) aoDown(c, x, y + (h * i) / 3, w, Math.max(3, h * 0.05), 0.15);
  // блик неба: одна широкая диагональная полоса — печётся в спрайт
  const g = c.createLinearGradient(x, y, x + w * 0.6, y + h);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.09)');
  g.addColorStop(0.62, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(x, y, w, h);
  aoDown(c, x, y + h * 0.78, w, h * 0.22, 0.15);
  c.restore();
}

// Сплошное остекление: печём отражение неба градиентом + светящиеся окна.
function glassWall(c, gc, x, y, w, h, pal, R, detail, litP = 0.45) {
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  const g = c.createLinearGradient(x, y, x + w * 0.45, y + h);
  g.addColorStop(0, mixHex(pal.glass, '#d8ecf8', 0.5));
  g.addColorStop(0.55, pal.glass);
  g.addColorStop(1, shade(pal.glass, -0.3));
  c.fillStyle = g;
  c.fillRect(x, y, w, h);
  const cols = 4, rows = Math.max(3, Math.min(10, Math.round(h / Math.max(8, w * 0.2))));
  const cw = w / cols, chh = h / rows;
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < cols; i++) {
      const px = x + i * cw, py = y + r * chh;
      const lit = R() < litP;
      if (lit) {
        // тёплое окно: светится и в карте свечения
        c.fillStyle = mixHex(pal.glass, pal.glow, 0.72);
        c.fillRect(px + 1, py + 1, cw - 2, chh - 2);
        gc.fillStyle = pal.glow;
        gc.fillRect(px + 1, py + 1, cw - 2, chh - 2);
      } else {
        // разнотон тёмного стекла — одинаковые ячейки выдают процедурность
        c.fillStyle = `rgba(8,16,28,${0.10 + R() * 0.28})`;
        c.fillRect(px + 1, py + 1, cw - 2, chh - 2);
      }
    }
    // спандрель между этажами
    c.fillStyle = shade(pal.trim, 0.05);
    c.fillRect(x, y + (r + 1) * chh - 1.5, w, 1.5);
  }
  // переплёты
  c.fillStyle = shade(pal.trim, 0.12);
  for (let i = 1; i < cols; i++) c.fillRect(x + i * cw - 1, y, 2, h);
  c.strokeStyle = shade(pal.trim, -0.2);
  c.lineWidth = 1.5;
  c.strokeRect(x, y, w, h);
  c.restore();
}

// Каменный цоколь: кладка крупнее и темнее стены, сверху — слив-полоса.
function footing(c, x, y, w, h, col, R, detail) {
  stoneWall(c, x, y, w, h, shade(col, -0.22), R, detail, Math.max(2, Math.round(h / 7)));
  c.fillStyle = 'rgba(255,248,225,0.16)';
  c.fillRect(x, y, w, 1.5);
}

// Диспетчер материала стены по эпохе. force — для зданий с «своим» материалом
// (храм всегда камень, замок всегда камень, небоскрёб всегда стекло).
function wallMat(ctx, x, y, w, h, col, opt = {}) {
  const { c, era, detail, seed, gc, pal } = ctx;
  const R = rng(seed, opt.salt || 17);
  const force = opt.force || '';
  if (detail < 1) {
    // на 56px остаётся только светотеневая полоса и намёк на швы — иначе
    // фактура превращается в серый шум. Коробку рисует вызывающий.
    c.fillStyle = col; c.fillRect(x, y, w, h);
    c.strokeStyle = 'rgba(0,0,0,0.18)'; c.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      c.beginPath(); c.moveTo(x, y + (h * i) / 4); c.lineTo(x + w, y + (h * i) / 4); c.stroke();
    }
    aoDown(c, x, y, w, Math.max(3, h * 0.12), 0.2);
    return;
  }
  if (force === 'stone') { stoneWall(c, x, y, w, h, col, R, detail, opt.rows || 5); return; }
  if (force === 'brick') { brickWall(c, x, y, w, h, col, R, detail); return; }
  if (force === 'glass') { glassWall(c, gc, x, y, w, h, pal, R, detail, opt.litP); return; }
  if (force === 'panel') { panelWall(c, x, y, w, h, col, R, detail); return; }
  if (force === 'plaster') { plasterWall(c, x, y, w, h, col, R, detail, seed % 97); return; }
  if (force === 'plank') { plankWall(c, x, y, w, h, col, R, detail); return; }
  switch (era) {
    case 0: logWall(c, x, y, w, h, col, R, detail); break;
    case 1: plankWall(c, x, y, w, h, col, R, detail); break;
    case 2:
      // тяжёлый сруб на каменном основании
      plankWall(c, x, y, w, h, col, R, detail);
      footing(c, x, y + h * 0.8, w, h * 0.2, col, rng(seed, 23), detail);
      break;
    case 3:
      stoneWall(c, x, y, w, h, col, R, detail, 5);
      break;
    case 4:
      // средневековье: штукатурка + фахверк
      plasterWall(c, x, y, w, h, col, R, detail, seed % 97);
      timberFrame(c, x, y, w, h, pal, R, opt.stories || 1);
      break;
    case 5:
      // ренессанс: штукатурка + кирпичное крыльцо-цоколь
      plasterWall(c, x, y, w, h, col, R, detail, seed % 97);
      footing(c, x, y + h * 0.82, w, h * 0.18, mixHex(col, '#8a4a30', 0.4), rng(seed, 29), detail);
      break;
    case 6:
      brickWall(c, x, y, w, h, col, R, detail);
      break;
    case 7:
      panelWall(c, x, y, w, h, col, R, detail);
      break;
    case 8:
      panelWall(c, x, y, w, h, col, R, detail);
      break;
    default:
      panelWall(c, x, y, w, h, col, R, detail);
  }
}

// ---------------------------------------------------------------------------
// Двери, окна, трубы, дым
// ---------------------------------------------------------------------------

// Окно: рама с тенью, стеклянный блик, подоконник-слив, ставни по эпохе.
function win(c, gc, x, y, w, h, pal, lit = true, opt = {}) {
  if (opt.shutters) {
    // ставни: тёмное дерево по бокам, дощечки-жалюзи
    const sw = w * 0.55;
    c.fillStyle = shade(pal.accent, -0.35);
    c.fillRect(x - sw * 1.05, y - h * 0.08, sw, h * 1.16);
    c.fillRect(x + w + sw * 0.05, y - h * 0.08, sw, h * 1.16);
    c.strokeStyle = 'rgba(0,0,0,0.3)';
    c.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      c.beginPath();
      c.moveTo(x - sw * 1.05, y + h * 1.08 * i / 4); c.lineTo(x - sw * 0.05, y + h * 1.08 * i / 4);
      c.moveTo(x + w + sw * 0.05, y + h * 1.08 * i / 4); c.lineTo(x + w + sw * 1.05, y + h * 1.08 * i / 4);
      c.stroke();
    }
  }
  // рама: тёмный переплёт
  c.fillStyle = shade(pal.trim, -0.38);
  c.fillRect(x - w * 0.10, y - h * 0.10, w * 1.20, h * 1.20);
  c.fillStyle = pal.glass;
  c.fillRect(x, y, w, h);
  // блик: свет падает сверху-слева
  c.fillStyle = 'rgba(255,244,214,0.20)';
  c.beginPath();
  c.moveTo(x, y); c.lineTo(x + w * 0.5, y); c.lineTo(x, y + h * 0.75);
  c.closePath(); c.fill();
  // средник на широких окнах
  if (w > h * 0.85) {
    c.fillStyle = shade(pal.trim, -0.38);
    c.fillRect(x + w / 2 - Math.max(0.5, w * 0.04), y, Math.max(1, w * 0.08), h);
  }
  // подоконник ловит свет и роняет тень
  c.fillStyle = 'rgba(255,248,225,0.30)';
  c.fillRect(x - w * 0.14, y + h * 1.08, w * 1.28, Math.max(1, h * 0.12));
  aoDown(c, x - w * 0.1, y + h * 1.2, w * 1.2, Math.max(2, h * 0.3), 0.14);
  if (lit) { gc.fillStyle = pal.glow; gc.fillRect(x, y, w, h); }
}

// Дверь: AO-ниша вокруг, дощатое полотно, петли-полосы, ступенька.
function door(c, x, y, w, h, pal, opt = {}) {
  // ниша двери всегда темнее стены вокруг — AO печётся в спрайт
  const g = c.createRadialGradient(x + w / 2, y + h * 0.55, w * 0.2, x + w / 2, y + h * 0.55, w * 1.4);
  g.addColorStop(0, 'rgba(14,9,5,0.36)');
  g.addColorStop(1, 'rgba(14,9,5,0)');
  c.fillStyle = g;
  c.fillRect(x - w * 1.1, y - h * 0.25, w * 3.2, h * 1.6);
  c.fillStyle = shade(pal.trim, -0.3);
  if (opt.round) {
    c.beginPath();
    c.moveTo(x, y + h); c.lineTo(x, y + h * 0.3);
    c.quadraticCurveTo(x + w / 2, y - h * 0.12, x + w, y + h * 0.3);
    c.lineTo(x + w, y + h); c.closePath(); c.fill();
  } else {
    c.fillRect(x, y, w, h);
  }
  // доски полотна
  c.strokeStyle = 'rgba(0,0,0,0.28)';
  c.lineWidth = 1;
  for (let i = 1; i < 3; i++) {
    c.beginPath(); c.moveTo(x + (w * i) / 3, y + h * 0.06); c.lineTo(x + (w * i) / 3, y + h); c.stroke();
  }
  // петли-полосы с заклёпками
  c.fillStyle = 'rgba(24,18,12,0.85)';
  c.fillRect(x + w * 0.06, y + h * 0.22, w * 0.88, Math.max(1, h * 0.07));
  c.fillRect(x + w * 0.06, y + h * 0.68, w * 0.88, Math.max(1, h * 0.07));
  // ступенька перед дверью ловит свет
  c.fillStyle = 'rgba(255,248,225,0.16)';
  c.fillRect(x - w * 0.1, y + h, w * 1.2, Math.max(1, h * 0.09));
}

// Труба: кирпичные пояса, оголовок, AO на крыше в месте проходки.
function chimney(c, x, y, w, h, col, opt = {}) {
  box(c, x, y, w, h, w * 0.5, col, { ao: false });
  // пояса кладки
  c.fillStyle = 'rgba(0,0,0,0.25)';
  c.fillRect(x, y + h * 0.45, w, Math.max(1, h * 0.08));
  c.fillStyle = 'rgba(255,255,255,0.12)';
  c.fillRect(x, y + h * 0.45 - 1, w, 1);
  // оголовок-шапка
  c.fillStyle = shade(col, 0.18);
  c.fillRect(x - w * 0.14, y - Math.max(2, h * 0.05), w * 1.28, Math.max(2, h * 0.07));
  c.fillStyle = 'rgba(20,16,14,0.6)';
  c.fillRect(x + w * 0.12, y - Math.max(1, h * 0.03), w * 0.76, Math.max(1.5, h * 0.05));
  // AO на крыше вокруг основания трубы
  if (opt.roofAO) aoGround(c, x + w * 0.75, y + h + w * 0.06, w * 1.5, w * 0.5, 0.22);
}

// Дым из трубы: цепочка мягких клубов в soft-слое (обводке не подлежит).
function smoke(fc, x, y, s, seed) {
  const R = rng(seed, 77);
  for (let i = 0; i < 4; i++) {
    const t = i / 4;
    const px = x + (R() - 0.3) * s * (0.4 + t * 1.2) + s * 0.5 * t;
    const py = y - s * (0.8 + t * 2.1);
    const r = s * (0.26 + t * 0.6);
    const g = fc.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, `rgba(226,222,214,${0.30 - t * 0.18})`);
    g.addColorStop(1, 'rgba(226,222,214,0)');
    fc.fillStyle = g;
    fc.beginPath(); fc.arc(px, py, r, 0, 7); fc.fill();
  }
}

// ---------------------------------------------------------------------------
// Архетипы. У каждого — свой силуэт и свои материалы: город читается профилями
// (амбар шире, башня выше, храм — фронтон), а эпохи — фактурой стен и крыш.
// ---------------------------------------------------------------------------
const DRAW = {
  // Каменный век: шатёр из шкур на жердях. Лоскуты и сшивка вместо ровного
  // конуса — «циркульный» силуэт мгновенно выдаёт программный арт.
  hut(ctx) {
    const { c, W, groundY, pal, era, detail, seed } = ctx;
    if (era >= 3) return DRAW.house(ctx);
    const R = rng(seed, 41);
    const r = W * 0.36, apex = groundY - W * 0.78;
    // конус с провисшими кромками
    c.fillStyle = shade(pal.wall, -0.12);
    c.beginPath();
    c.moveTo(W / 2 - r, groundY);
    c.quadraticCurveTo(W / 2 - r * 0.82, groundY - W * 0.42, W / 2 - r * 0.06, apex);
    c.quadraticCurveTo(W / 2 + r * 0.88, groundY - W * 0.44, W / 2 + r, groundY);
    c.closePath(); c.fill();
    // лоскуты шкур: перекрывающиеся пятна разного тона
    const nP = detail >= 1 ? 5 : 3;
    for (let i = 0; i < nP; i++) {
      const px = W / 2 + (R() - 0.5) * r * 1.3;
      const py = groundY - W * (0.12 + R() * 0.42);
      const pr = W * (0.09 + R() * 0.08);
      c.fillStyle = R() < 0.5 ? 'rgba(255,240,210,0.10)' : 'rgba(40,28,16,0.16)';
      c.beginPath(); c.ellipse(px, py, pr, pr * 0.7, R() * 3, 0, 7); c.fill();
    }
    // свет слева
    c.fillStyle = 'rgba(255,246,220,0.16)';
    c.beginPath();
    c.moveTo(W / 2 - r, groundY);
    c.quadraticCurveTo(W / 2 - r * 0.82, groundY - W * 0.42, W / 2 - r * 0.06, apex);
    c.lineTo(W / 2, apex); c.closePath(); c.fill();
    // вертикальная сшивка шкур
    c.strokeStyle = 'rgba(30,20,10,0.4)';
    c.lineWidth = 1;
    for (const k of [-0.55, -0.2, 0.25, 0.6]) {
      c.beginPath();
      c.moveTo(W / 2 + k * r, groundY);
      c.lineTo(W / 2 + k * r * 0.25, apex + W * 0.06); c.stroke();
    }
    // вход: тёмный клин + откинутый клапан
    c.fillStyle = 'rgba(22,16,10,0.8)';
    c.beginPath();
    c.moveTo(W / 2 - r * 0.24, groundY);
    c.lineTo(W / 2 - r * 0.13, groundY - W * 0.3);
    c.lineTo(W / 2 + r * 0.15, groundY - W * 0.3);
    c.lineTo(W / 2 + r * 0.26, groundY);
    c.closePath(); c.fill();
    c.fillStyle = shade(pal.wall, 0.06);
    c.beginPath();
    c.moveTo(W / 2 + r * 0.26, groundY);
    c.quadraticCurveTo(W / 2 + r * 0.5, groundY - W * 0.2, W / 2 + r * 0.16, groundY - W * 0.32);
    c.lineTo(W / 2 + r * 0.15, groundY - W * 0.3); c.closePath(); c.fill();
    // дымовое отверстие на верхушке
    c.fillStyle = 'rgba(20,14,8,0.7)';
    c.beginPath(); c.ellipse(W / 2 + W * 0.02, apex + W * 0.045, W * 0.05, W * 0.03, 0.3, 0, 7); c.fill();
    // жерди наружу и перекрестие на верхушке
    c.strokeStyle = shade(pal.trim, -0.2);
    c.lineWidth = Math.max(1, W * 0.022);
    for (const k of [-0.5, 0, 0.5]) {
      c.beginPath();
      c.moveTo(W / 2 + k * r * 0.5, apex - W * 0.06);
      c.lineTo(W / 2 + k * r * 1.15, groundY);
      c.stroke();
    }
    c.lineWidth = Math.max(1, W * 0.016);
    c.beginPath();
    c.moveTo(W / 2 - W * 0.06, apex - W * 0.02); c.lineTo(W / 2 + W * 0.07, apex - W * 0.09);
    c.moveTo(W / 2 + W * 0.06, apex - W * 0.02); c.lineTo(W / 2 - W * 0.07, apex - W * 0.09);
    c.stroke();
    aoGround(c, W / 2, groundY - W * 0.005, r * 1.12, W * 0.055, 0.28);
  },

  house(ctx) {
    const { c, gc, W, groundY, pal, era, detail, seed, soft } = ctx;
    const R = rng(seed, 51);
    const w = W * 0.68, x = (W - w) / 2, d = W * 0.16;
    const floors = era >= 6 ? 2 : 1;
    const h = W * (era >= 6 ? 0.52 : 0.38);
    const y = groundY - h;
    box(c, x, y, w, h, d, pal.wall);
    wallMat(ctx, x, y, w, h, pal.wall, { stories: floors, salt: 51 });
    if (era >= 8) {
      // плоская кровля со светлой кромкой-парапетом
      c.fillStyle = pal.trim;
      c.fillRect(x - w * 0.03, y - W * 0.03, w + w * 0.06 + d, W * 0.035);
      c.fillStyle = 'rgba(255,255,255,0.20)';
      c.fillRect(x - w * 0.03, y - W * 0.03, w + w * 0.06 + d, 1.5);
    } else {
      gable(c, x, y, w, d, W * 0.22, pal.roof, era, seed, detail);
      if (era <= 1) {
        const { A, B } = gablePts(x, y, w, d, W * 0.22);
        thatchFringe(c, A, B, pal.roof, rng(seed, 61));
      }
      if (detail >= 2 && era >= 3 && era <= 5) {
        // слуховое окно на скате — мансарда читается даже издалека
        const dxx = x + w * 0.28, dyy = y - W * 0.085;
        c.fillStyle = shade(pal.roof, -0.08);
        c.beginPath();
        c.moveTo(dxx, dyy); c.lineTo(dxx + w * 0.17, dyy);
        c.lineTo(dxx + w * 0.085, dyy - W * 0.075);
        c.closePath(); c.fill();
        c.strokeStyle = shade(pal.roof, -0.3);
        c.lineWidth = 1;
        c.stroke();
        win(c, gc, dxx + w * 0.055, dyy - W * 0.012, w * 0.06, W * 0.034, pal, R() < 0.6);
      }
    }
    if (era <= 7 && detail >= 1) {
      chimney(c, x + w * 0.68, y - W * 0.2, w * 0.13, W * 0.22, shade(pal.roof, -0.2), { roofAO: true });
      if (era <= 6) smoke(soft, x + w * 0.75, y - W * 0.24, w * 0.12, seed);
    }
    const cols = era >= 6 ? 3 : 2;
    for (let f = 0; f < floors; f++) {
      for (let i = 0; i < cols; i++) {
        win(c, gc, x + w * (0.13 + i * 0.32), y + h * (0.20 + f * 0.38), w * 0.15, h * 0.20, pal,
          R() < (era >= 7 ? 0.55 : 0.5), { shutters: era >= 3 && era <= 5 && detail >= 2 });
      }
    }
    door(c, x + w * 0.40, groundY - h * 0.44, w * 0.18, h * 0.44, pal, { round: era <= 5 });
  },

  // Навес собирателей: столбы с корой, кровля из коры продольными полосами.
  lean(ctx) {
    const { c, W, groundY, pal, detail, seed } = ctx;
    const R = rng(seed, 71);
    const w = W * 0.6, x = (W - w) / 2, d = W * 0.14;
    const postH = W * 0.3, y = groundY - postH;
    for (const k of [0, 1]) {
      const px = x + k * (w - w * 0.07);
      c.fillStyle = shade(pal.trim, -0.2);
      c.fillRect(px, y, w * 0.07, postH);
      c.fillStyle = 'rgba(255,246,220,0.14)';
      c.fillRect(px, y, Math.max(1, w * 0.02), postH);
    }
    // односкатный навес из коры
    const rise = W * 0.07;
    const A = P(x - w * 0.08, y), B = P(x + w + w * 0.08, y - W * 0.02);
    const C = P(B[0] + d, B[1] - d * 0.55 - rise), D = P(A[0] + d, A[1] - d * 0.55 - rise);
    c.fillStyle = shade(pal.roof, 0.05);
    c.beginPath();
    c.moveTo(A[0], A[1]); c.lineTo(B[0], B[1]); c.lineTo(C[0], C[1]); c.lineTo(D[0], D[1]);
    c.closePath(); c.fill();
    // продольные полосы коры с разнотоном
    for (let i = 0; i < 8; i++) {
      const u = i / 8, u2 = u + 0.07;
      const a1 = lerpP(A, B, u), b1 = lerpP(D, C, u);
      const a2 = lerpP(A, B, u2), b2 = lerpP(D, C, u2);
      c.fillStyle = shade(pal.roof, (R() - 0.5) * 0.3);
      c.beginPath();
      c.moveTo(a1[0], a1[1]); c.lineTo(b1[0], b1[1]); c.lineTo(b2[0], b2[1]); c.lineTo(a2[0], a2[1]);
      c.closePath(); c.fill();
    }
    // тень под навесом: под ним всегда сумрачно
    aoDown(c, x - w * 0.08, y, w * 1.16 + d * 0.4, W * 0.06, 0.30);
    if (detail >= 1) {
      // корзины и вязанка хвороста под навесом
      c.fillStyle = shade(pal.trim, -0.05);
      c.beginPath(); c.ellipse(W * 0.4, groundY - W * 0.05, W * 0.09, W * 0.05, 0, 0, 7); c.fill();
      c.strokeStyle = 'rgba(50,36,20,0.5)'; c.lineWidth = 1;
      c.beginPath(); c.ellipse(W * 0.4, groundY - W * 0.05, W * 0.06, W * 0.03, 0, 0, 7); c.stroke();
      c.strokeStyle = shade(pal.trim, -0.15);
      c.lineWidth = Math.max(1, W * 0.014);
      for (let i = 0; i < 4; i++) {
        c.beginPath();
        c.moveTo(W * (0.55 + i * 0.02), groundY - W * 0.02);
        c.lineTo(W * (0.6 + i * 0.03), groundY - W * 0.12); c.stroke();
      }
    }
    aoGround(c, W / 2, groundY, W * 0.42, W * 0.06, 0.22);
  },

  // Шатры охотников из шкур: лоскуты, растяжки, копья у входа.
  tent(ctx) {
    const { c, W, groundY, pal, detail, seed } = ctx;
    const R = rng(seed, 75);
    for (const [ox, sc] of [[-0.18, 0.8], [0.16, 1]]) {
      const r = W * 0.26 * sc, cx = W / 2 + W * ox, apex = groundY - W * 0.55 * sc;
      c.fillStyle = shade(pal.wall, ox < 0 ? -0.18 : -0.05);
      c.beginPath();
      c.moveTo(cx - r, groundY);
      c.quadraticCurveTo(cx - r * 0.85, groundY - W * 0.3 * sc, cx, apex);
      c.quadraticCurveTo(cx + r * 0.9, groundY - W * 0.32 * sc, cx + r, groundY);
      c.closePath(); c.fill();
      // лоскуты
      for (let i = 0; i < 3; i++) {
        c.fillStyle = R() < 0.5 ? 'rgba(255,240,210,0.12)' : 'rgba(40,28,16,0.14)';
        c.beginPath();
        c.ellipse(cx + (R() - 0.5) * r, groundY - W * (0.1 + R() * 0.3) * sc,
          W * 0.06 * sc, W * 0.045 * sc, R() * 3, 0, 7);
        c.fill();
      }
      // свет слева
      c.fillStyle = 'rgba(255,246,220,0.14)';
      c.beginPath();
      c.moveTo(cx - r, groundY); c.lineTo(cx, apex); c.lineTo(cx - r * 0.2, groundY);
      c.closePath(); c.fill();
      // вход-клин
      c.fillStyle = 'rgba(22,16,10,0.75)';
      c.beginPath();
      c.moveTo(cx - r * 0.2, groundY); c.lineTo(cx, apex + W * 0.14 * sc); c.lineTo(cx + r * 0.2, groundY);
      c.closePath(); c.fill();
      // растяжки от верхушки к колышкам
      c.strokeStyle = 'rgba(40,30,18,0.5)';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(cx, apex + W * 0.02); c.lineTo(cx - r * 1.35, groundY - W * 0.01);
      c.moveTo(cx, apex + W * 0.02); c.lineTo(cx + r * 1.3, groundY - W * 0.01);
      c.stroke();
    }
    // копья у входа
    c.strokeStyle = shade(pal.trim, -0.3);
    c.lineWidth = Math.max(1, W * 0.018);
    for (const k of [-0.06, 0.02]) {
      c.beginPath();
      c.moveTo(W * (0.3 + k), groundY); c.lineTo(W * (0.28 + k), groundY - W * 0.34); c.stroke();
      // наконечник
      c.fillStyle = '#b8b4ac';
      c.beginPath();
      c.moveTo(W * (0.28 + k), groundY - W * 0.34);
      c.lineTo(W * (0.28 + k) - W * 0.012, groundY - W * 0.3);
      c.lineTo(W * (0.28 + k) + W * 0.012, groundY - W * 0.3);
      c.closePath(); c.fill();
    }
    aoGround(c, W / 2, groundY, W * 0.44, W * 0.05, 0.2);
  },

  shed(ctx) {
    const { c, gc, W, groundY, pal, era, detail, seed } = ctx;
    const w = W * 0.74, x = (W - w) / 2, d = W * 0.15, h = W * 0.34, y = groundY - h;
    box(c, x, y, w, h, d, pal.wall);
    wallMat(ctx, x, y, w, h, pal.wall, { salt: 91 });
    // односкатная крыша материалом эпохи
    const A = P(x - w * 0.04, y), B = P(x + w + w * 0.04, y - W * 0.05);
    const C = P(B[0] + d, B[1] - d * 0.55), D = P(A[0] + d, A[1] - d * 0.55);
    c.fillStyle = shade(pal.roof, 0.12);
    c.beginPath();
    c.moveTo(A[0], A[1]); c.lineTo(B[0], B[1]); c.lineTo(C[0], C[1]); c.lineTo(D[0], D[1]);
    c.closePath(); c.fill();
    roofSkin(c, A, B, C, D, era, pal.roof, rng(seed, 95), detail);
    if (era <= 1) thatchFringe(c, A, B, pal.roof, rng(seed, 97));
    aoDown(c, A[0], y, w * 1.08, Math.max(4, W * 0.05), 0.3);
    // ворота с раскосом — сарай без больших дверей не сарай
    const dw = w * 0.26, dxx = x + w * 0.36, dh = h * 0.72, dyy = groundY - dh;
    c.fillStyle = shade(pal.trim, -0.22);
    c.fillRect(dxx, dyy, dw, dh);
    c.strokeStyle = shade(pal.trim, 0.1);
    c.lineWidth = Math.max(1.5, W * 0.012);
    c.strokeRect(dxx, dyy, dw, dh);
    c.beginPath(); c.moveTo(dxx, dyy); c.lineTo(dxx + dw, groundY);
    c.moveTo(dxx + dw, dyy); c.lineTo(dxx, groundY); c.stroke();
    win(c, gc, x + w * 0.1, y + h * 0.22, w * 0.14, h * 0.22, pal);
    if (detail >= 1) {
      // штабель брёвен: торцы с годовыми кольцами
      for (let i = 0; i < 3; i++) {
        const bx = x + w * 0.72, by = groundY - W * (0.06 + i * 0.045);
        c.fillStyle = shade(pal.trim, -0.05 + i * 0.04);
        c.fillRect(bx, by, w * 0.22, W * 0.038);
        c.strokeStyle = 'rgba(50,32,16,0.5)';
        c.lineWidth = 1;
        c.beginPath(); c.ellipse(bx, by + W * 0.019, W * 0.008, W * 0.017, 0, 0, 7); c.stroke();
      }
    }
  },

  // Кузня: каменный низ, дощатый верх, зарево горна и дым.
  forge(ctx) {
    const { c, gc, W, groundY, pal, era, detail, seed, soft } = ctx;
    const w = W * 0.7, x = (W - w) / 2, d = W * 0.15, h = W * 0.36, y = groundY - h;
    box(c, x, y, w, h, d, pal.wall);
    // низ каменный — огнеупорное основание горна
    stoneWall(c, x, y + h * 0.55, w, h * 0.45, mixHex(pal.wall, '#8a8478', 0.5), rng(seed, 81), detail, 3);
    plankWall(c, x, y, w, h * 0.55, pal.wall, rng(seed, 83), detail);
    gable(c, x, y, w, d, W * 0.15, pal.roof, era, seed, detail);
    chimney(c, x + w * 0.72, y - W * 0.3, w * 0.16, W * 0.34, shade(pal.roof, -0.25), { roofAO: true });
    smoke(soft, x + w * 0.8, y - W * 0.34, w * 0.14, seed);
    // горн: проём и зарево — светится и днём
    const mx = x + w * 0.16, my = groundY - h * 0.5;
    c.fillStyle = '#1d130c';
    c.fillRect(mx, my, w * 0.3, h * 0.5);
    const g = soft.createRadialGradient(mx + w * 0.15, groundY - h * 0.22, 0, mx + w * 0.15, groundY - h * 0.22, w * 0.2);
    g.addColorStop(0, 'rgba(255,190,90,0.95)');
    g.addColorStop(1, 'rgba(255,90,20,0)');
    soft.fillStyle = g;
    soft.fillRect(x + w * 0.1, groundY - h * 0.6, w * 0.45, h * 0.6);
    gc.fillStyle = '#ff9b3c';
    gc.fillRect(mx + w * 0.02, my + h * 0.05, w * 0.26, h * 0.42);
    if (detail >= 1) {
      // наковальня на колоде + бочка закалки
      c.fillStyle = shade(pal.trim, -0.3);
      c.fillRect(x + w * 0.55, groundY - h * 0.3, w * 0.12, h * 0.3);
      c.fillStyle = '#3a3a40';
      c.fillRect(x + w * 0.535, groundY - h * 0.38, w * 0.15, h * 0.08);
      c.fillStyle = '#4a3a28';
      c.fillRect(x + w * 0.86, groundY - h * 0.26, w * 0.1, h * 0.26);
      c.fillStyle = 'rgba(120,180,220,0.5)';
      c.beginPath(); c.ellipse(x + w * 0.91, groundY - h * 0.24, w * 0.035, h * 0.03, 0, 0, 7); c.fill();
    }
  },

  // Рынок: прилавок, товар с бликом, полосатый навес с тенью под ним.
  stalls(ctx) {
    const { c, W, groundY, pal, detail, seed } = ctx;
    const R = rng(seed, 101);
    const w = W * 0.76, x = (W - w) / 2, d = W * 0.13, h = W * 0.3, y = groundY - h;
    box(c, x, y, w, h, d, pal.wall);
    plankWall(c, x, y, w, h, pal.wall, rng(seed, 103), detail);
    // полосатый навес: полотнища с рваным нижним краем
    const ay = y - W * 0.04;
    const stripes = 5, sw = w / stripes;
    for (let i = 0; i < stripes; i++) {
      c.fillStyle = i % 2 ? '#d8d2c0' : '#c05a3a';
      c.beginPath();
      c.moveTo(x + i * sw, ay); c.lineTo(x + (i + 1) * sw, ay);
      c.lineTo(x + (i + 1) * sw + d * 0.7, ay - W * 0.1);
      c.lineTo(x + i * sw + d * 0.7, ay - W * 0.1);
      c.closePath(); c.fill();
      // тень на стыке полотнищ
      if (i > 0) {
        c.fillStyle = 'rgba(0,0,0,0.12)';
        c.fillRect(x + i * sw - 1, ay - W * 0.1, 2, W * 0.1);
      }
    }
    // тень под навесом на прилавке
    aoDown(c, x, y + h * 0.05, w, h * 0.4, 0.3);
    if (detail >= 1) {
      // товар на прилавке: блик по свету сверху-слева
      const goods = ['#c9803c', '#8a5a2a', '#b83c3c', '#d0a83c'];
      for (let i = 0; i < 4; i++) {
        const gx = x + w * (0.14 + i * 0.2), gy = groundY - h * 0.2, gr = w * 0.045;
        c.fillStyle = goods[i];
        c.beginPath(); c.arc(gx, gy, gr, 0, 7); c.fill();
        c.fillStyle = 'rgba(255,248,225,0.35)';
        c.beginPath(); c.arc(gx - gr * 0.3, gy - gr * 0.3, gr * 0.35, 0, 7); c.fill();
      }
      // развешенная дичь/рыба на задней планке
      c.strokeStyle = shade(pal.trim, -0.2);
      c.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        const hx = x + w * (0.3 + i * 0.18);
        c.beginPath(); c.moveTo(hx, y + h * 0.1); c.lineTo(hx, y + h * 0.3); c.stroke();
        c.fillStyle = '#9a8a70';
        c.beginPath(); c.ellipse(hx, y + h * 0.36, w * 0.02, h * 0.08, 0, 0, 7); c.fill();
      }
    }
  },

  // Амбар-гранарий: шире дома, большие ворота с раскосами, сеновал во фронтона.
  silo(ctx) {
    const { c, gc, W, groundY, pal, era, detail, seed } = ctx;
    const R = rng(seed, 91);
    const w = W * 0.82, x = (W - w) / 2, d = W * 0.15, h = W * 0.42, y = groundY - h;
    box(c, x, y, w, h, d, pal.wall);
    wallMat(ctx, x, y, w, h, pal.wall, { salt: 91 });
    gable(c, x, y, w, d, W * 0.26, pal.roof, era, seed, detail);
    if (era <= 1) {
      const { A, B } = gablePts(x, y, w, d, W * 0.26);
      thatchFringe(c, A, B, pal.roof, rng(seed, 93));
    }
    // проём сеновала во фронтоне: тёмный полукруг, из него торчит солома
    c.fillStyle = '#241a10';
    c.beginPath();
    c.arc(x + w / 2, y - W * 0.03, w * 0.09, Math.PI, 0);
    c.closePath(); c.fill();
    c.strokeStyle = '#c8a850';
    c.lineWidth = 1.2;
    for (let i = 0; i < 5; i++) {
      const a = Math.PI + (i / 5) * Math.PI;
      c.beginPath();
      c.moveTo(x + w / 2 + Math.cos(a) * w * 0.08, y - W * 0.03 + Math.sin(a) * w * 0.08);
      c.lineTo(x + w / 2 + Math.cos(a) * w * 0.11, y - W * 0.03 + Math.sin(a) * w * 0.11);
      c.stroke();
    }
    // большие ворота с крестовыми раскосами и поперечинами
    const dw = w * 0.34, dx = x + w / 2 - dw / 2, dh = h * 0.66, dyy = groundY - dh;
    c.fillStyle = shade(pal.trim, -0.18);
    c.fillRect(dx, dyy, dw, dh);
    c.strokeStyle = shade(pal.trim, 0.14);
    c.lineWidth = Math.max(2, W * 0.014);
    c.strokeRect(dx, dyy, dw, dh);
    c.beginPath();
    c.moveTo(dx, dyy); c.lineTo(dx + dw, groundY);
    c.moveTo(dx + dw, dyy); c.lineTo(dx, groundY);
    c.stroke();
    c.lineWidth = Math.max(1, W * 0.01);
    c.beginPath();
    c.moveTo(dx, dyy + dh * 0.33); c.lineTo(dx + dw, dyy + dh * 0.33);
    c.moveTo(dx, dyy + dh * 0.66); c.lineTo(dx + dw, dyy + dh * 0.66);
    c.stroke();
    // вентрешётка на коньке: считаем середину конька у gable, иначе «плавает»
    const gp = gablePts(x, y, w, d, W * 0.26);
    const vx = (gp.D[0] + gp.C[0]) / 2 - w * 0.05, vy = (gp.D[1] + gp.C[1]) / 2;
    c.fillStyle = shade(pal.wall, 0.05);
    c.fillRect(vx, vy - W * 0.045, w * 0.1, W * 0.045);
    c.fillStyle = 'rgba(255,255,255,0.14)';
    c.fillRect(vx, vy - W * 0.045, w * 0.1, 1.2);
    c.fillStyle = shade(pal.roof, -0.1);
    c.beginPath();
    c.moveTo(vx - w * 0.015, vy - W * 0.045); c.lineTo(vx + w * 0.115, vy - W * 0.045);
    c.lineTo(vx + w * 0.05, vy - W * 0.08); c.closePath(); c.fill();
    aoGround(c, W / 2, groundY, w * 0.55, W * 0.06, 0.22);
  },

  quarry(ctx) {
    const { c, W, groundY, pal, detail, seed } = ctx;
    const R = rng(seed, 121);
    // яма с террасами: дно темнее, стенки светлее к краю
    c.fillStyle = 'rgba(40,34,28,0.55)';
    c.beginPath(); c.ellipse(W / 2, groundY - W * 0.06, W * 0.36, W * 0.16, 0, 0, 7); c.fill();
    c.fillStyle = 'rgba(70,62,52,0.5)';
    c.beginPath(); c.ellipse(W / 2, groundY - W * 0.07, W * 0.28, W * 0.12, 0, 0, 7); c.fill();
    c.fillStyle = 'rgba(34,30,26,0.6)';
    c.beginPath(); c.ellipse(W / 2, groundY - W * 0.08, W * 0.16, W * 0.07, 0, 0, 7); c.fill();
    // блоки с фактурой скола
    for (let i = 0; i < 4; i++) {
      const bx = W * (0.2 + (i % 2) * 0.36), by = groundY - W * (0.1 + Math.floor(i / 2) * 0.13);
      box(c, bx, by, W * 0.17, W * 0.11, W * 0.07, '#9a9690');
      // снятая фаска по верхнему ребру — след от скарпели
      c.strokeStyle = 'rgba(255,255,255,0.25)';
      c.lineWidth = 1;
      c.strokeRect(bx + 1, by + 1, W * 0.17 - 2, W * 0.11 - 2);
      if (detail >= 1 && R() < 0.6) {
        c.fillStyle = 'rgba(40,36,32,0.4)';
        c.beginPath();
        c.moveTo(bx + W * 0.05, by + W * 0.03);
        c.lineTo(bx + W * 0.09, by + W * 0.02);
        c.lineTo(bx + W * 0.07, by + W * 0.06);
        c.closePath(); c.fill();
      }
    }
    // щебень по краю ямы
    if (detail >= 1) {
      for (let i = 0; i < 8; i++) {
        c.fillStyle = R() < 0.5 ? '#8a867e' : '#a09c94';
        c.beginPath();
        c.ellipse(W * (0.14 + R() * 0.72), groundY - W * (0.02 + R() * 0.05), W * 0.014, W * 0.01, R() * 3, 0, 7);
        c.fill();
      }
    }
    if (detail >= 1) {
      // лестница-стремянка в яму
      c.strokeStyle = shade(pal.trim, -0.2);
      c.lineWidth = Math.max(1, W * 0.016);
      c.beginPath();
      c.moveTo(W * 0.66, groundY - W * 0.03); c.lineTo(W * 0.74, groundY - W * 0.3); c.stroke();
      c.lineWidth = 1;
      for (let i = 1; i < 5; i++) {
        const t = i / 5;
        c.beginPath();
        c.moveTo(W * (0.66 + 0.08 * t) - W * 0.02, groundY - W * (0.03 + 0.27 * t));
        c.lineTo(W * (0.66 + 0.08 * t) + W * 0.02, groundY - W * (0.03 + 0.27 * t));
        c.stroke();
      }
    }
  },

  // Шахта: отвал с жилой руды, крепь-портал, рельсы и вагонетка.
  mineshaft(ctx) {
    const { c, W, groundY, pal, detail, seed } = ctx;
    const R = rng(seed, 131);
    // склон породы: пятна шума вместо плоской заливки
    c.fillStyle = '#6d6560';
    c.beginPath();
    c.moveTo(W * 0.12, groundY); c.lineTo(W * 0.3, groundY - W * 0.52);
    c.lineTo(W * 0.78, groundY - W * 0.46); c.lineTo(W * 0.92, groundY);
    c.closePath(); c.fill();
    c.save();
    c.beginPath();
    c.moveTo(W * 0.12, groundY); c.lineTo(W * 0.3, groundY - W * 0.52);
    c.lineTo(W * 0.78, groundY - W * 0.46); c.lineTo(W * 0.92, groundY);
    c.closePath(); c.clip();
    for (let i = 0; i < 10; i++) {
      c.fillStyle = R() < 0.5 ? 'rgba(255,248,230,0.08)' : 'rgba(20,16,12,0.14)';
      c.beginPath();
      c.ellipse(W * (0.15 + R() * 0.7), groundY - W * R() * 0.5, W * 0.06, W * 0.04, R() * 3, 0, 7);
      c.fill();
    }
    // блёстки руды: редкие тёплые точки в породе
    if (detail >= 1) {
      for (let i = 0; i < 5; i++) {
        c.fillStyle = 'rgba(216,164,72,0.7)';
        c.fillRect(W * (0.16 + R() * 0.66), groundY - W * (0.06 + R() * 0.4), 1.6, 1.6);
      }
    }
    c.restore();
    // свет слева на склоне
    c.fillStyle = 'rgba(255,248,225,0.14)';
    c.beginPath();
    c.moveTo(W * 0.12, groundY); c.lineTo(W * 0.3, groundY - W * 0.52); c.lineTo(W * 0.42, groundY);
    c.closePath(); c.fill();
    // крепь входа: стойки, верхняк, раскосы
    const ex = W * 0.4, ew = W * 0.24, eh = W * 0.3;
    c.fillStyle = '#171310';
    c.fillRect(ex, groundY - eh, ew, eh);
    // тьма внутри с тёплым отсветом фонаря
    if (detail >= 1) {
      const g = c.createRadialGradient(ex + ew / 2, groundY - eh * 0.3, 0, ex + ew / 2, groundY - eh * 0.3, ew * 0.5);
      g.addColorStop(0, 'rgba(255,180,90,0.18)');
      g.addColorStop(1, 'rgba(255,180,90,0)');
      c.fillStyle = g;
      c.fillRect(ex, groundY - eh, ew, eh);
    }
    c.fillStyle = shade(pal.trim, -0.15);
    c.fillRect(ex - W * 0.03, groundY - eh, W * 0.04, eh);
    c.fillRect(ex + ew - W * 0.01, groundY - eh, W * 0.04, eh);
    c.fillRect(ex - W * 0.05, groundY - eh - W * 0.04, ew + W * 0.1, W * 0.045);
    // раскосы крепи
    c.strokeStyle = shade(pal.trim, -0.25);
    c.lineWidth = Math.max(1.5, W * 0.016);
    c.beginPath();
    c.moveTo(ex - W * 0.01, groundY - eh * 0.9); c.lineTo(ex + ew * 0.2, groundY - eh);
    c.moveTo(ex + ew + W * 0.01, groundY - eh * 0.9); c.lineTo(ex + ew * 0.8, groundY - eh);
    c.stroke();
    if (detail >= 1) {
      // рельсы от входа + вагонетка с рудой
      c.strokeStyle = '#4a4640';
      c.lineWidth = Math.max(1, W * 0.008);
      c.beginPath();
      c.moveTo(ex + ew * 0.25, groundY); c.lineTo(W * 0.16, groundY);
      c.moveTo(ex + ew * 0.75, groundY); c.lineTo(W * 0.3, groundY);
      c.stroke();
      box(c, W * 0.14, groundY - W * 0.14, W * 0.18, W * 0.1, W * 0.06, '#8a6a4a');
      c.fillStyle = '#5a5a60';
      c.beginPath(); c.arc(W * 0.19, groundY - W * 0.02, W * 0.025, 0, 7); c.fill();
      c.beginPath(); c.arc(W * 0.28, groundY - W * 0.02, W * 0.025, 0, 7); c.fill();
      // горка руды в вагонетке
      c.fillStyle = '#6a625c';
      c.beginPath();
      c.moveTo(W * 0.15, groundY - W * 0.14);
      c.quadraticCurveTo(W * 0.23, groundY - W * 0.22, W * 0.31, groundY - W * 0.14);
      c.closePath(); c.fill();
    }
  },

  // Поле/пастбище: борозды в перспективе, всходы, овцы, пугало.
  field(ctx) {
    const { c, W, groundY, id, detail, seed } = ctx;
    const R = rng(seed, 141);
    const w = W * 0.86, x = (W - w) / 2, top = groundY - W * 0.26;
    c.fillStyle = id === 'pasture' ? '#6f9a52' : '#9a7f3c';
    c.beginPath();
    c.moveTo(x, groundY); c.lineTo(x + w, groundY);
    c.lineTo(x + w - W * 0.1, top); c.lineTo(x + W * 0.1, top);
    c.closePath(); c.fill();
    if (id === 'pasture') {
      // загон: столбы + две жерди
      c.strokeStyle = '#7a5f3d';
      c.lineWidth = Math.max(1, W * 0.016);
      c.strokeRect(x + W * 0.04, top + W * 0.02, w - W * 0.08, groundY - top - W * 0.03);
      c.lineWidth = Math.max(1, W * 0.01);
      for (let i = 0; i < 5; i++) {
        const px = x + W * 0.06 + (w - W * 0.12) * (i / 4);
        c.beginPath(); c.moveTo(px, top + W * 0.03); c.lineTo(px, groundY - W * 0.015); c.stroke();
      }
      if (detail >= 1) {
        // овцы: тулово-облачко, тёмная голова по ветру, тень
        for (const [sx, sy, ss] of [[0.42, 0.1, 1], [0.6, 0.05, 0.85]]) {
          const px = W * sx, py = groundY - W * sy, k = W * 0.05 * ss;
          c.fillStyle = 'rgba(40,60,30,0.3)';
          c.beginPath(); c.ellipse(px, py + k * 0.7, k * 1.2, k * 0.3, 0, 0, 7); c.fill();
          c.fillStyle = '#efe8dc';
          c.beginPath(); c.ellipse(px, py, k * 1.15, k * 0.75, 0, 0, 7); c.fill();
          c.fillStyle = '#3a3230';
          c.beginPath(); c.ellipse(px + k * 1.05, py - k * 0.35, k * 0.32, k * 0.28, 0, 0, 7); c.fill();
        }
      }
    } else {
      // борозды сходятся в перспективе + тень между грядами
      for (let i = 1; i < 5; i++) {
        const t = i / 5;
        c.strokeStyle = 'rgba(70,48,22,0.5)';
        c.lineWidth = Math.max(1, W * 0.014);
        c.beginPath();
        c.moveTo(x + W * 0.1 * t, groundY - (groundY - top) * t);
        c.lineTo(x + w - W * 0.1 * t, groundY - (groundY - top) * t);
        c.stroke();
        c.strokeStyle = 'rgba(255,230,170,0.14)';
        c.beginPath();
        c.moveTo(x + W * 0.1 * t, groundY - (groundY - top) * t + 1.5);
        c.lineTo(x + w - W * 0.1 * t, groundY - (groundY - top) * t + 1.5);
        c.stroke();
      }
      if (detail >= 1) {
        // всходы: Y-образные ростки с зёрнами
        c.strokeStyle = '#d8c05a';
        c.lineWidth = 1;
        for (let i = 0; i < 7; i++) {
          const px = x + W * 0.12 + (w - W * 0.24) * (i / 6);
          const py = groundY - W * 0.1 - R() * W * 0.05;
          c.beginPath();
          c.moveTo(px, py + W * 0.05); c.lineTo(px, py);
          c.moveTo(px, py); c.lineTo(px - W * 0.012, py - W * 0.025);
          c.moveTo(px, py); c.lineTo(px + W * 0.012, py - W * 0.025);
          c.stroke();
        }
        // пугало: шест, перекладина, соломенная шляпа
        if (detail >= 2) {
          const sx = W * 0.72, sy = top + W * 0.04;
          c.strokeStyle = '#6b4f35';
          c.lineWidth = Math.max(1.5, W * 0.014);
          c.beginPath();
          c.moveTo(sx, groundY - W * 0.06); c.lineTo(sx, sy);
          c.moveTo(sx - W * 0.05, sy + W * 0.03); c.lineTo(sx + W * 0.05, sy + W * 0.03);
          c.stroke();
          c.fillStyle = '#c8a850';
          c.beginPath(); c.arc(sx, sy - W * 0.012, W * 0.018, 0, 7); c.fill();
          c.beginPath();
          c.ellipse(sx, sy - W * 0.028, W * 0.03, W * 0.008, 0, 0, 7); c.fill();
        }
      }
    }
  },

  // Стена: частокол из брёвен с вязанками или камень с зубцами и бойницей.
  wall(ctx) {
    const { c, W, groundY, id, pal, detail, seed } = ctx;
    const stone = id === 'stone_walls';
    const w = W * 0.94, x = (W - w) / 2, h = W * 0.3, y = groundY - h, d = W * 0.12;
    if (stone) {
      box(c, x, y, w, h, d, '#8e8a84');
      stoneWall(c, x, y, w, h, '#8e8a84', rng(seed, 151), detail, 4);
      // зубцы с фактурой и тенью под нависающим рядом
      for (let i = 0; i < 4; i++) {
        const mx = x + w * (0.04 + i * 0.25);
        box(c, mx, y - W * 0.1, w * 0.14, W * 0.11, d * 0.6, '#9a968f');
        c.fillStyle = 'rgba(255,255,255,0.12)';
        c.fillRect(mx, y - W * 0.1, w * 0.14, 1.5);
      }
      aoDown(c, x, y, w, W * 0.045, 0.32);
      // бойница-щель
      c.fillStyle = '#1a1612';
      c.fillRect(x + w * 0.47, y + h * 0.3, w * 0.03, h * 0.4);
    } else {
      // вязанки за частоколом: горизонтальные пучки брёвен
      c.fillStyle = shade('#8a6a44', -0.2);
      c.fillRect(x, y + h * 0.25, w, W * 0.05);
      c.fillRect(x, y + h * 0.62, w, W * 0.05);
      // заострённые колья: каждое бревно своего тона, с корой
      const R = rng(seed, 153);
      for (let i = 0; i < 7; i++) {
        const px = x + w * (0.03 + i * 0.14);
        const tone = (R() - 0.5) * 0.24;
        c.fillStyle = shade('#8a6a44', tone);
        c.beginPath();
        c.moveTo(px, groundY);
        c.lineTo(px, y + h * 0.1);
        c.lineTo(px + w * 0.055, y - W * 0.06);
        c.lineTo(px + w * 0.11, y + h * 0.1);
        c.lineTo(px + w * 0.11, groundY);
        c.closePath(); c.fill();
        // кора: блик слева, тень справа
        c.fillStyle = 'rgba(255,246,220,0.13)';
        c.fillRect(px + w * 0.008, y + h * 0.12, Math.max(1, w * 0.012), h * 0.88);
        c.fillStyle = 'rgba(20,12,6,0.22)';
        c.fillRect(px + w * 0.09, y + h * 0.12, Math.max(1, w * 0.014), h * 0.88);
        // трещина в торце кола
        if (detail >= 1 && R() < 0.5) {
          c.strokeStyle = 'rgba(30,18,8,0.5)';
          c.lineWidth = 1;
          c.beginPath();
          c.moveTo(px + w * 0.055, y - W * 0.055);
          c.lineTo(px + w * 0.055, y - W * 0.005); c.stroke();
        }
      }
    }
    aoGround(c, W / 2, groundY, w * 0.52, W * 0.05, 0.24);
  },

  // Казарма: длинный дом, знамя, щит и копья у стены.
  barracks(ctx) {
    const { c, gc, W, groundY, pal, era, detail, seed } = ctx;
    const R = rng(seed, 161);
    const w = W * 0.8, x = (W - w) / 2, d = W * 0.16, h = W * 0.36, y = groundY - h;
    box(c, x, y, w, h, d, pal.wall);
    wallMat(ctx, x, y, w, h, pal.wall, { salt: 161 });
    gable(c, x, y, w, d, W * 0.2, pal.roof, era, seed, detail);
    // знамя на фасаде: древко, полотнище с раздвоенным краем
    const fx = x + w * 0.08;
    c.strokeStyle = shade(pal.trim, -0.3);
    c.lineWidth = Math.max(1.5, W * 0.012);
    c.beginPath(); c.moveTo(fx, groundY - h * 0.1); c.lineTo(fx, y - W * 0.16); c.stroke();
    c.fillStyle = pal.accent;
    c.beginPath();
    c.moveTo(fx, y - W * 0.16); c.lineTo(fx + W * 0.11, y - W * 0.13);
    c.lineTo(fx + W * 0.07, y - W * 0.10); c.lineTo(fx + W * 0.11, y - W * 0.07);
    c.lineTo(fx, y - W * 0.04);
    c.closePath(); c.fill();
    c.fillStyle = 'rgba(0,0,0,0.15)';
    c.beginPath();
    c.moveTo(fx, y - W * 0.04); c.lineTo(fx + W * 0.11, y - W * 0.07);
    c.lineTo(fx + W * 0.07, y - W * 0.10); c.lineTo(fx + W * 0.055, y - W * 0.09);
    c.lineTo(fx, y - W * 0.06);
    c.closePath(); c.fill();
    door(c, x + w * 0.42, groundY - h * 0.5, w * 0.17, h * 0.5, pal, { round: era <= 5 });
    // окна-бойницы с решёткой в ранние эпохи
    for (const wx of [0.12, 0.72]) {
      const lit = R() < 0.5;
      win(c, gc, x + w * wx, y + h * 0.24, w * 0.13, h * 0.22, pal, lit);
      if (era <= 5) {
        c.strokeStyle = 'rgba(20,14,8,0.7)';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(x + w * wx + w * 0.065, y + h * 0.24);
        c.lineTo(x + w * wx + w * 0.065, y + h * 0.46);
        c.stroke();
      }
    }
    if (detail >= 1) {
      // копья стоймя + щит у стены
      c.strokeStyle = shade(pal.trim, -0.3);
      c.lineWidth = Math.max(1, W * 0.014);
      for (let i = 0; i < 4; i++) {
        c.beginPath();
        c.moveTo(x + w * (0.88 + i * 0.022), groundY);
        c.lineTo(x + w * (0.895 + i * 0.022), groundY - h * 0.85); c.stroke();
      }
      c.fillStyle = '#8e3a30';
      c.beginPath(); c.arc(x + w * 0.9, groundY - h * 0.25, w * 0.06, 0, 7); c.fill();
      c.strokeStyle = '#d8cfc0';
      c.lineWidth = Math.max(1, W * 0.008);
      c.stroke();
      c.fillStyle = 'rgba(230,220,190,0.8)';
      c.beginPath(); c.arc(x + w * 0.9, groundY - h * 0.25, w * 0.02, 0, 7); c.fill();
      // чучело-мишень для тренировки
      c.strokeStyle = shade(pal.trim, -0.25);
      c.lineWidth = Math.max(1.5, W * 0.014);
      c.beginPath();
      c.moveTo(x + w * 0.3, groundY); c.lineTo(x + w * 0.3, groundY - h * 0.7);
      c.moveTo(x + w * 0.26, groundY - h * 0.5); c.lineTo(x + w * 0.34, groundY - h * 0.5);
      c.stroke();
    }
  },

  // Казна: рустованный камень, окованная дверь, решётчатое окно.
  vault(ctx) {
    const { c, gc, W, groundY, pal, detail, seed } = ctx;
    const w = W * 0.6, x = (W - w) / 2, d = W * 0.15, h = W * 0.36, y = groundY - h;
    box(c, x, y, w, h, d, shade(pal.wall, -0.1));
    // руст: крупные камни с глубокой фаской
    stoneWall(c, x, y, w, h, shade(pal.wall, -0.12), rng(seed, 171), detail, 4);
    // карниз под кровлей
    c.fillStyle = shade(pal.wall, 0.1);
    c.fillRect(x - w * 0.05, y - W * 0.05, w + w * 0.1 + d * 0.6, W * 0.06);
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.fillRect(x - w * 0.05, y - W * 0.05 + W * 0.06, w + w * 0.1 + d * 0.6, 1.5);
    // окованная дверь: полосы металла с заклёпками, кольцо
    const dw = w * 0.36, dx = x + w * 0.32, dh = h * 0.62, dyy = groundY - dh;
    c.fillStyle = '#3a2f24';
    c.fillRect(dx, dyy, dw, dh);
    c.fillStyle = '#5a5248';
    for (const k of [0.25, 0.7]) {
      c.fillRect(dx, dyy + dh * k, dw, Math.max(2, dh * 0.08));
    }
    if (detail >= 1) {
      c.fillStyle = '#787064';
      for (const k of [0.25, 0.7]) {
        for (const rx of [0.2, 0.8]) {
          c.beginPath(); c.arc(dx + dw * rx, dyy + dh * k + dh * 0.04, Math.max(1, dw * 0.03), 0, 7); c.fill();
        }
      }
      // кольцо-ручка
      c.strokeStyle = '#787064';
      c.lineWidth = Math.max(1.5, W * 0.01);
      c.beginPath(); c.arc(dx + dw * 0.78, dyy + dh * 0.45, dw * 0.07, 0, 7); c.stroke();
    }
    c.strokeStyle = shade(pal.accent, -0.3);
    c.lineWidth = Math.max(1.5, W * 0.014);
    c.strokeRect(dx, dyy, dw, dh);
    // решётчатое окно-щель высоко
    c.fillStyle = '#181410';
    c.fillRect(x + w * 0.1, y + h * 0.2, w * 0.08, h * 0.16);
    c.strokeStyle = '#5a5248';
    c.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      c.beginPath();
      c.moveTo(x + w * 0.1 + w * 0.08 * i / 3, y + h * 0.2);
      c.lineTo(x + w * 0.1 + w * 0.08 * i / 3, y + h * 0.36); c.stroke();
    }
  },

  // Порт: настил с заделкой швов, сарай, бочки, мачта с парусом.
  dock(ctx) {
    const { c, gc, W, groundY, pal, era, detail, seed } = ctx;
    const R = rng(seed, 181);
    // настил
    c.fillStyle = shade(pal.trim, -0.05);
    c.beginPath();
    c.moveTo(W * 0.08, groundY); c.lineTo(W * 0.92, groundY);
    c.lineTo(W * 0.82, groundY - W * 0.14); c.lineTo(W * 0.18, groundY - W * 0.14);
    c.closePath(); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.22)';
    c.lineWidth = 1;
    for (let i = 1; i < 6; i++) {
      const t = i / 6;
      c.beginPath();
      c.moveTo(W * (0.08 + 0.1 * t), groundY - W * 0.14 * t);
      c.lineTo(W * (0.92 - 0.1 * t), groundY - W * 0.14 * t); c.stroke();
    }
    // гвозди-точки на досках
    if (detail >= 1) {
      c.fillStyle = 'rgba(30,22,12,0.5)';
      for (let i = 0; i < 8; i++) {
        const t = 0.15 + (i % 4) * 0.22, u = i < 4 ? 0.3 : 0.7;
        c.beginPath();
        c.arc(W * (0.1 + t * 0.8), groundY - W * 0.14 * u, 1, 0, 7); c.fill();
      }
    }
    // сарай
    const w = W * 0.34, x = W * 0.14, h = W * 0.26, y = groundY - W * 0.14 - h;
    box(c, x, y, w, h, W * 0.1, pal.wall);
    plankWall(c, x, y, w, h, pal.wall, rng(seed, 183), detail);
    gable(c, x, y, w, W * 0.1, W * 0.12, pal.roof, Math.min(era, 5), seed, detail);
    aoGround(c, W * 0.31, groundY - W * 0.02, w * 0.7, W * 0.04, 0.25);
    if (detail >= 1) {
      // бочки и кнехт
      for (const [bx, by] of [[0.56, 0.06], [0.62, 0.03]]) {
        c.fillStyle = '#7a5a38';
        c.beginPath();
        c.ellipse(W * bx, groundY - W * by, W * 0.032, W * 0.045, 0, 0, 7); c.fill();
        c.strokeStyle = 'rgba(40,28,14,0.6)';
        c.lineWidth = 1;
        c.beginPath(); c.ellipse(W * bx, groundY - W * by, W * 0.032, W * 0.045, 0, 0, 7); c.stroke();
        c.beginPath();
        c.moveTo(W * bx - W * 0.03, groundY - W * by - W * 0.012);
        c.lineTo(W * bx + W * 0.03, groundY - W * by - W * 0.012); c.stroke();
      }
      // бухта каната
      c.strokeStyle = '#a08a60';
      c.lineWidth = Math.max(1.5, W * 0.012);
      c.beginPath(); c.arc(W * 0.72, groundY - W * 0.03, W * 0.025, 0, 7); c.stroke();
      c.beginPath(); c.arc(W * 0.72, groundY - W * 0.03, W * 0.014, 0, 7); c.stroke();
      // мачта с парусом
      c.strokeStyle = shade(pal.trim, -0.3);
      c.lineWidth = Math.max(1.5, W * 0.02);
      c.beginPath(); c.moveTo(W * 0.68, groundY - W * 0.12); c.lineTo(W * 0.68, groundY - W * 0.62); c.stroke();
      c.fillStyle = 'rgba(240,235,220,0.92)';
      c.beginPath();
      c.moveTo(W * 0.68, groundY - W * 0.58); c.quadraticCurveTo(W * 0.84, groundY - W * 0.44, W * 0.86, groundY - W * 0.38);
      c.quadraticCurveTo(W * 0.78, groundY - W * 0.3, W * 0.68, groundY - W * 0.2);
      c.closePath(); c.fill();
      // полосы ткани на парусе
      c.strokeStyle = 'rgba(120,110,90,0.3)';
      c.lineWidth = 1;
      for (const k of [0.3, 0.6]) {
        c.beginPath();
        c.moveTo(W * 0.68, groundY - W * (0.58 - k * 0.38));
        c.quadraticCurveTo(W * 0.8, groundY - W * (0.48 - k * 0.3), W * (0.68 + 0.18 * (1 - k * 0.5)), groundY - W * (0.5 - k * 0.3));
        c.stroke();
      }
    }
  },

  // Акведук: кладка, арки с тенями в интрадосе, жёлоб с водой и блеском.
  arches(ctx) {
    const { c, W, groundY, pal, detail, seed } = ctx;
    const w = W * 0.94, x = (W - w) / 2, h = W * 0.42, y = groundY - h;
    c.fillStyle = shade(pal.wall, -0.05);
    c.fillRect(x, y, w, h);
    stoneWall(c, x, y, w, h, shade(pal.wall, -0.05), rng(seed, 191), detail, 6);
    // проёмы-арки прорезаем насквозь: акведук — сквозная конструкция
    c.globalCompositeOperation = 'destination-out';
    const holes = [];
    for (let i = 0; i < 3; i++) {
      const ax = x + w * (0.08 + i * 0.3), aw = w * 0.22;
      holes.push([ax, aw]);
      c.beginPath();
      c.moveTo(ax, groundY); c.lineTo(ax, y + h * 0.42);
      c.quadraticCurveTo(ax + aw / 2, y + h * 0.02, ax + aw, y + h * 0.42);
      c.lineTo(ax + aw, groundY); c.closePath(); c.fill();
    }
    c.globalCompositeOperation = 'source-over';
    // тень в интрадосе каждой арки + импосты
    for (const [ax, aw] of holes) {
      c.save();
      c.beginPath();
      c.moveTo(ax, groundY); c.lineTo(ax, y + h * 0.42);
      c.quadraticCurveTo(ax + aw / 2, y + h * 0.02, ax + aw, y + h * 0.42);
      c.lineTo(ax + aw, groundY); c.closePath();
      c.clip();
      // тень по левой щеке арки — свет падает справа-сверху внутрь
      const g = c.createLinearGradient(ax, 0, ax + aw, 0);
      g.addColorStop(0, 'rgba(20,14,8,0.5)');
      g.addColorStop(0.5, 'rgba(20,14,8,0.1)');
      g.addColorStop(1, 'rgba(20,14,8,0.35)');
      c.fillStyle = g;
      c.fillRect(ax, y, aw, h);
      c.restore();
      // импосты: камни-упоры пяты арки
      c.fillStyle = shade(pal.wall, 0.12);
      c.fillRect(ax - w * 0.015, y + h * 0.4, w * 0.03, h * 0.06);
      c.fillRect(ax + aw - w * 0.015, y + h * 0.4, w * 0.03, h * 0.06);
    }
    // зелёные потёки у земли — вода рядом всегда
    if (detail >= 1) {
      c.fillStyle = 'rgba(90,120,70,0.25)';
      for (const [ax, aw] of holes) {
        c.beginPath();
        c.ellipse(ax + aw * 0.5, groundY - W * 0.01, aw * 0.5, W * 0.025, 0, 0, 7); c.fill();
      }
    }
    // жёлоб с водой: каменная ванна + блики на воде
    c.fillStyle = shade(pal.wall, 0.18);
    c.fillRect(x - w * 0.01, y - W * 0.05, w + w * 0.02, W * 0.055);
    c.fillStyle = 'rgba(90,170,220,0.75)';
    c.fillRect(x + w * 0.04, y - W * 0.035, w * 0.92, W * 0.022);
    c.fillStyle = 'rgba(255,255,255,0.35)';
    for (let i = 0; i < 5; i++) {
      c.fillRect(x + w * (0.1 + i * 0.17), y - W * 0.032, w * 0.05, 1.2);
    }
    aoDown(c, x, y, w, W * 0.04, 0.3);
  },

  // Храм/базилика: стилобат, целла в тени, колоннада, антаблемент и фронтон —
  // все ярусы встык, иначе «шляпа» висит в воздухе и рушит силуэт.
  columned(ctx) {
    const { c, gc, W, groundY, pal, detail, seed } = ctx;
    const w = W * 0.8, x = (W - w) / 2, d = W * 0.15;
    // пропорции классического ордера: ступени → колонны → антаблемент → фронтон
    const stepH = W * 0.03;
    const colH = W * 0.3;
    const entH = W * 0.055;
    const pedH = W * 0.16;
    const baseY = groundY - stepH * 3;   // верх стилобата
    const colTopY = baseY - colH;        // верх колонн = низ антаблемента
    const entY = colTopY - entH;         // верх антаблемента = база фронтона
    // стилобат в три ступени, каждая ниже светлее — камень ловит свет сверху
    for (let s = 0; s < 3; s++) {
      const sw = w + w * 0.12 - s * w * 0.045;
      box(c, x - (sw - w) / 2, groundY - stepH * (s + 1), sw, stepH, d * 0.5,
        shade(pal.wall, -0.06 - s * 0.04), { ao: false });
    }
    // целла: стена в глубине портика всегда темнее — колоннада на её фоне
    box(c, x, entY, w, baseY - entY, d, shade(pal.wall, -0.24), { ao: false });
    // колонны с каннелюрами
    const n = 5;
    for (let i = 0; i < n; i++) {
      const cx = x + w * (0.045 + i * 0.212), cw = w * 0.105;
      // база и капитель: плиты чуть шире ствола
      c.fillStyle = shade(pal.wall, 0.2);
      c.fillRect(cx - cw * 0.14, baseY - W * 0.018, cw * 1.28, W * 0.018);
      c.fillRect(cx - cw * 0.14, colTopY, cw * 1.28, W * 0.02);
      // ствол: свет слева, ядро, тень справа
      const g = c.createLinearGradient(cx, 0, cx + cw, 0);
      g.addColorStop(0, shade(pal.wall, -0.1));
      g.addColorStop(0.28, shade(pal.wall, 0.3));
      g.addColorStop(0.72, shade(pal.wall, -0.02));
      g.addColorStop(1, shade(pal.wall, -0.34));
      c.fillStyle = g;
      c.fillRect(cx, colTopY + W * 0.02, cw, baseY - colTopY - W * 0.038);
      // каннелюры: тёмный желобок со светлой кромкой
      if (detail >= 1) {
        for (let f = 1; f < 4; f++) {
          const fx = cx + cw * f / 4;
          c.strokeStyle = 'rgba(40,32,22,0.35)';
          c.lineWidth = 1;
          c.beginPath();
          c.moveTo(fx, colTopY + W * 0.025); c.lineTo(fx, baseY - W * 0.02); c.stroke();
          c.strokeStyle = 'rgba(255,250,230,0.16)';
          c.beginPath();
          c.moveTo(fx + 1.2, colTopY + W * 0.025); c.lineTo(fx + 1.2, baseY - W * 0.02); c.stroke();
        }
      }
    }
    // антаблемент: архитрав с триглифами, ровно на капителях
    c.fillStyle = shade(pal.wall, 0.1);
    c.fillRect(x - w * 0.04, colTopY - entH, w + w * 0.08 + d * 0.5, entH);
    c.fillStyle = 'rgba(0,0,0,0.22)';
    c.fillRect(x - w * 0.04, colTopY - 1.5, w + w * 0.08 + d * 0.5, 1.5);
    c.fillStyle = 'rgba(255,250,230,0.18)';
    c.fillRect(x - w * 0.04, colTopY - entH, w + w * 0.08 + d * 0.5, 1.5);
    if (detail >= 1) {
      c.fillStyle = shade(pal.wall, -0.16);
      for (let i = 0; i < 7; i++) {
        const tx = x + w * (0.03 + i * 0.152);
        c.fillRect(tx, colTopY - entH * 0.72, w * 0.028, entH * 0.5);
      }
    }
    // фронтон: тимпан в тени, карниз, блик по левому скату, акротерии
    c.fillStyle = shade(pal.wall, 0.22);
    c.beginPath();
    c.moveTo(x - w * 0.06, entY); c.lineTo(x + w / 2, entY - pedH);
    c.lineTo(x + w + w * 0.06, entY);
    c.closePath(); c.fill();
    c.fillStyle = 'rgba(80,60,36,0.3)';
    c.beginPath();
    c.moveTo(x - w * 0.03, entY - 1); c.lineTo(x + w / 2, entY - pedH + W * 0.024);
    c.lineTo(x + w + w * 0.03, entY - 1);
    c.closePath(); c.fill();
    c.fillStyle = shade(pal.wall, 0.3);
    for (const ax of [x - w * 0.06, x + w / 2, x + w + w * 0.06]) {
      const ay = ax === x + w / 2 ? entY - pedH : entY;
      c.fillRect(ax - w * 0.013, ay - W * 0.026, w * 0.026, W * 0.026);
    }
    c.strokeStyle = 'rgba(255,248,225,0.42)';
    c.lineWidth = Math.max(1.5, W * 0.008);
    c.beginPath();
    c.moveTo(x - w * 0.06, entY); c.lineTo(x + w / 2, entY - pedH); c.stroke();
    // дверь со свечением внутри — храм живёт
    door(c, x + w * 0.42, baseY - W * 0.16, w * 0.16, W * 0.16, pal, { round: true });
    if (detail >= 1) { gc.fillStyle = pal.glow; gc.fillRect(x + w * 0.44, baseY - W * 0.145, w * 0.12, W * 0.13); }
    aoGround(c, W / 2, groundY, w * 0.56, W * 0.055, 0.24);
  },

  // Амфитеатр: ярусы сидений со ступенями, радиальные лестницы, стена сцены.
  amphi(ctx) {
    const { c, W, groundY, pal, detail, seed } = ctx;
    const cx = W / 2, cy = groundY - W * 0.04;
    // ярусы от внешнего к внутреннему: кромка ловит свет сверху, под ней —
    // тень-полумесяц; никаких заливок-хорд, они читаются грязными пятнами
    for (let i = 3; i >= 0; i--) {
      const r = W * (0.2 + i * 0.09);
      const ty = cy - i * W * 0.045;
      c.fillStyle = shade(pal.wall, i % 2 ? 0.08 : -0.06);
      c.beginPath(); c.ellipse(cx, ty, r, r * 0.44, 0, 0, 7); c.fill();
      // свет по верхней-левой кромке яруса
      c.strokeStyle = 'rgba(255,248,225,0.28)';
      c.lineWidth = Math.max(1, W * 0.01);
      c.beginPath();
      c.ellipse(cx, ty - W * 0.004, r * 0.985, r * 0.43, 0, Math.PI * 1.08, Math.PI * 1.92);
      c.stroke();
      // тень под кромкой: сиденья нависают над следующим ярусом
      c.strokeStyle = 'rgba(20,14,8,0.3)';
      c.lineWidth = Math.max(1.5, W * 0.014);
      c.beginPath();
      c.ellipse(cx, ty + W * 0.008, r * 0.94, r * 0.41, 0, Math.PI * 0.12, Math.PI * 0.88);
      c.stroke();
      // радиальные лестницы-диазомы
      if (detail >= 1) {
        c.strokeStyle = 'rgba(30,24,16,0.32)';
        c.lineWidth = Math.max(1, W * 0.008);
        for (const a of [0.35, 0.8, 1.25, 1.7, 2.15, 2.6]) {
          c.beginPath();
          c.moveTo(cx + Math.cos(a) * r * 0.55, ty + Math.sin(a) * r * 0.25);
          c.lineTo(cx + Math.cos(a) * r, ty + Math.sin(a) * r * 0.44);
          c.stroke();
        }
      }
    }
    // арена: тёмный эллипс с песком по краю
    c.fillStyle = 'rgba(40,34,26,0.5)';
    c.beginPath(); c.ellipse(cx, cy - W * 0.02, W * 0.14, W * 0.07, 0, 0, 7); c.fill();
    c.fillStyle = 'rgba(200,170,120,0.25)';
    c.beginPath(); c.ellipse(cx, cy - W * 0.02, W * 0.12, W * 0.058, 0, 0, 7); c.fill();
    // стена сцены: ниши-двери и колонны между ними
    const sw = W * 0.42, sx = cx - sw / 2, sy = cy - W * 0.01;
    c.fillStyle = shade(pal.wall, 0.04);
    c.fillRect(sx, sy, sw, W * 0.075);
    c.fillStyle = 'rgba(255,248,225,0.16)';
    c.fillRect(sx, sy, sw, 1.5);
    c.fillStyle = 'rgba(0,0,0,0.2)';
    c.fillRect(sx, sy + W * 0.075, sw, 1.5);
    for (const k of [-0.3, 0, 0.3]) {
      c.fillStyle = '#1c1712';
      c.fillRect(cx + sw * k - W * 0.02, sy + W * 0.02, W * 0.04, W * 0.055);
      c.fillStyle = shade(pal.wall, 0.22);
      c.fillRect(cx + sw * k - W * 0.032, sy + W * 0.012, W * 0.012, W * 0.063);
      c.fillRect(cx + sw * k + W * 0.02, sy + W * 0.012, W * 0.012, W * 0.063);
    }
    aoGround(c, cx, groundY, W * 0.5, W * 0.05, 0.2);
  },

  // Донжон: высокая глухая башня, машикули, фланкирующие башни с конусами.
  keep(ctx) {
    const { c, gc, W, groundY, pal, era, detail, seed } = ctx;
    const w = W * 0.56, x = (W - w) / 2, d = W * 0.16;
    const donjH = W * 0.58;
    const y = groundY - donjH;
    // донжон выше и уже угловых башен — силуэт замка держат вертикали
    box(c, x, y, w, donjH, d, pal.wall);
    stoneWall(c, x, y, w, donjH, pal.wall, rng(seed, 211), detail, 7);
    // зубцы по верху донжона
    for (let i = 0; i < 4; i++) {
      box(c, x + w * (0.03 + i * 0.25), y - W * 0.07, w * 0.16, W * 0.08, d * 0.4, shade(pal.wall, 0.08), { ao: false });
    }
    aoDown(c, x, y, w, W * 0.05, 0.35);
    // окна-бойницы: узкие щели с расширением наружу
    for (const [wx, wy] of [[0.2, 0.3], [0.62, 0.3], [0.2, 0.62], [0.62, 0.62]]) {
      const lit = rng(seed, 211 + wx * 10)() < 0.4;
      c.fillStyle = '#15100c';
      c.fillRect(x + w * wx, y + donjH * wy, w * 0.05, donjH * 0.09);
      c.fillStyle = '#2a241e';
      c.fillRect(x + w * wx + 1, y + donjH * wy, w * 0.05 - 2, donjH * 0.02);
      if (lit) { gc.fillStyle = pal.glow; gc.fillRect(x + w * wx, y + donjH * wy, w * 0.05, donjH * 0.09); }
    }
    // ворота: арка + решётка-порткулис
    const gw = w * 0.3, gx = x + w / 2 - gw / 2, gh = donjH * 0.42, gy = groundY - gh;
    door(c, gx, gy, gw, gh, pal, { round: true });
    c.save();
    c.beginPath();
    c.moveTo(gx, groundY); c.lineTo(gx, gy + gh * 0.3);
    c.quadraticCurveTo(gx + gw / 2, gy - gh * 0.12, gx + gw, gy + gh * 0.3);
    c.lineTo(gx + gw, groundY); c.closePath(); c.clip();
    c.strokeStyle = 'rgba(16,12,8,0.85)';
    c.lineWidth = Math.max(1, W * 0.008);
    for (let i = 1; i < 4; i++) {
      c.beginPath(); c.moveTo(gx + gw * i / 4, gy); c.lineTo(gx + gw * i / 4, groundY); c.stroke();
    }
    for (let i = 1; i < 5; i++) {
      c.beginPath(); c.moveTo(gx, gy + gh * i / 5); c.lineTo(gx + gw, gy + gh * i / 5); c.stroke();
    }
    c.restore();
    // фланкирующие башни с коническими крышами и флагами
    for (const k of [-0.16, 0.84]) {
      const tx = x + w * k, tw = w * 0.3, th = donjH * 1.06, ty = groundY - th;
      box(c, tx, ty, tw, th, d * 0.6, shade(pal.wall, -0.04));
      stoneWall(c, tx, ty, tw, th, shade(pal.wall, -0.04), rng(seed, 221 + Math.round(k * 10)), detail, 7);
      // коническая крыша с рядами черепицы-дугами
      const coneH = W * 0.2;
      c.fillStyle = shade(pal.roof, 0.02);
      c.beginPath();
      c.moveTo(tx - tw * 0.14, ty); c.lineTo(tx + tw / 2, ty - coneH); c.lineTo(tx + tw * 1.14, ty);
      c.closePath(); c.fill();
      c.strokeStyle = 'rgba(20,12,6,0.3)';
      c.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const t = i / 4;
        c.beginPath();
        c.moveTo(tx - tw * 0.14 + tw * 0.14 * t, ty - coneH * t);
        c.lineTo(tx + tw * 1.14 - tw * 0.14 * t, ty - coneH * t);
        c.stroke();
      }
      // блик по левому краю конуса
      c.strokeStyle = 'rgba(255,248,225,0.3)';
      c.beginPath();
      c.moveTo(tx - tw * 0.14, ty); c.lineTo(tx + tw * 0.42, ty - coneH * 0.92); c.stroke();
      // флаг
      c.strokeStyle = shade(pal.trim, -0.3);
      c.lineWidth = Math.max(1, W * 0.008);
      c.beginPath();
      c.moveTo(tx + tw / 2, ty - coneH); c.lineTo(tx + tw / 2, ty - coneH - W * 0.09); c.stroke();
      c.fillStyle = pal.accent;
      c.beginPath();
      c.moveTo(tx + tw / 2, ty - coneH - W * 0.09);
      c.lineTo(tx + tw / 2 + W * 0.07, ty - coneH - W * 0.07);
      c.lineTo(tx + tw / 2, ty - coneH - W * 0.045);
      c.closePath(); c.fill();
      // бойница с тёплым светом
      c.fillStyle = '#15100c';
      c.fillRect(tx + tw * 0.42, ty + th * 0.3, tw * 0.14, th * 0.1);
      if (rng(seed, 231)() < 0.5) { gc.fillStyle = pal.glow; gc.fillRect(tx + tw * 0.42, ty + th * 0.3, tw * 0.14, th * 0.1); }
    }
    aoGround(c, W / 2, groundY, w * 0.62, W * 0.055, 0.24);
  },

  // Мельница: дом, большое колесо с лопастями, лоток и пена воды.
  mill(ctx) {
    const { c, W, groundY, pal, era, detail, seed } = ctx;
    const w = W * 0.5, x = W * 0.12, d = W * 0.13, h = W * 0.42, y = groundY - h;
    box(c, x, y, w, h, d, pal.wall);
    wallMat(ctx, x, y, w, h, pal.wall, { salt: 241 });
    gable(c, x, y, w, d, W * 0.16, pal.roof, era, seed, detail);
    // колесо: двойной обод, спицы, лопасти между ними
    const cx = W * 0.76, cy = groundY - W * 0.2, r = W * 0.2;
    c.strokeStyle = shade(pal.trim, -0.2);
    c.lineWidth = Math.max(2, W * 0.028);
    c.beginPath(); c.arc(cx, cy, r, 0, 7); c.stroke();
    c.lineWidth = Math.max(1.5, W * 0.018);
    c.beginPath(); c.arc(cx, cy, r * 0.78, 0, 7); c.stroke();
    c.lineWidth = Math.max(1.5, W * 0.016);
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * r * 0.2, cy + Math.sin(a) * r * 0.2);
      c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); c.stroke();
    }
    // лопасти: заштрихованные сектора между спицами
    c.fillStyle = 'rgba(90,66,40,0.55)';
    for (let i = 0; i < 8; i++) {
      const a0 = i / 8 * Math.PI * 2 + 0.08, a1 = (i + 1) / 8 * Math.PI * 2 - 0.08;
      c.beginPath();
      c.moveTo(cx + Math.cos(a0) * r * 0.78, cy + Math.sin(a0) * r * 0.78);
      c.arc(cx, cy, r * 0.78, a0, a1);
      c.arc(cx, cy, r, a1, a0, true);
      c.closePath(); c.fill();
    }
    // ось колеса
    c.fillStyle = '#3a3026';
    c.beginPath(); c.arc(cx, cy, r * 0.09, 0, 7); c.fill();
    // AO на стене за колесом: колесо нависает
    aoGround(c, cx, cy, r * 1.05, r * 1.05, 0.25);
    // лоток воды и пена у колеса
    if (detail >= 1) {
      c.fillStyle = 'rgba(110,180,220,0.6)';
      c.fillRect(cx - r, groundY - W * 0.06, r * 2, W * 0.06);
      c.fillStyle = 'rgba(255,255,255,0.5)';
      for (let i = 0; i < 6; i++) {
        c.beginPath();
        c.arc(cx - r + (i / 5) * r * 2, groundY - W * 0.045 - (i % 2) * W * 0.015, W * 0.008, 0, 7);
        c.fill();
      }
    }
  },

  // Купол: барабан с рёбрами, сфера с меридианами, фонарь наверху.
  dome(ctx) {
    const { c, gc, W, groundY, pal, era, detail, seed } = ctx;
    const w = W * 0.68, x = (W - w) / 2, d = W * 0.15, h = W * 0.34, y = groundY - h;
    box(c, x, y, w, h, d, pal.wall);
    stoneWall(c, x, y, w, h, pal.wall, rng(seed, 251), detail, 4);
    aoDown(c, x, y, w, Math.max(3, h * 0.1), 0.2);
    // купол: свет сверху-слева печём радиальным градиентом
    const cx = W / 2, cy = y, R0 = w * 0.4;
    const g = c.createRadialGradient(cx - w * 0.14, cy - w * 0.16, w * 0.03, cx, cy, w * 0.44);
    g.addColorStop(0, shade(pal.roof, 0.42));
    g.addColorStop(0.6, shade(pal.roof, 0.08));
    g.addColorStop(1, shade(pal.roof, -0.24));
    c.fillStyle = g;
    c.beginPath(); c.arc(cx, cy, R0, Math.PI, 0); c.fill();
    // меридианы купола: рёбра каркаса
    c.strokeStyle = 'rgba(20,14,8,0.22)';
    c.lineWidth = 1;
    for (const k of [-0.5, -0.2, 0.2, 0.5]) {
      c.beginPath();
      c.ellipse(cx + k * R0 * 0.55, cy, Math.abs(k) * R0 * 0.5 + R0 * 0.08, R0, 0, Math.PI, 0);
      c.stroke();
    }
    // горизонтальные пояса
    for (const k of [0.45, 0.75]) {
      c.beginPath(); c.ellipse(cx, cy, R0 * k, R0 * k * 0.9, 0, Math.PI, 0); c.stroke();
    }
    // основание купола: тёмная пятка
    c.fillStyle = shade(pal.roof, -0.3);
    c.fillRect(cx - w * 0.42, cy - W * 0.012, w * 0.84, W * 0.026);
    // фонарь наверху
    c.fillStyle = shade(pal.wall, 0.1);
    c.fillRect(cx - w * 0.05, cy - R0 - W * 0.05, w * 0.1, W * 0.05);
    c.fillStyle = shade(pal.roof, 0.1);
    c.beginPath();
    c.moveTo(cx - w * 0.06, cy - R0 - W * 0.05);
    c.lineTo(cx, cy - R0 - W * 0.085);
    c.lineTo(cx + w * 0.06, cy - R0 - W * 0.05);
    c.closePath(); c.fill();
    if (era >= 8) {
      // светящиеся дорожки по куполу — цифровая эпоха
      c.strokeStyle = pal.trim; c.lineWidth = Math.max(1, W * 0.014);
      for (const k of [0.55, 0.78]) { c.beginPath(); c.arc(cx, cy, R0 * k, Math.PI, 0); c.stroke(); }
      gc.strokeStyle = pal.glow; gc.lineWidth = Math.max(1, W * 0.02);
      for (const k of [0.55, 0.78]) { gc.beginPath(); gc.arc(cx, cy, R0 * k, Math.PI, 0); gc.stroke(); }
      gc.fillStyle = pal.glow;
      gc.fillRect(cx - w * 0.04, cy - R0 - W * 0.045, w * 0.08, W * 0.04);
    } else if (detail >= 1) {
      // телескоп в прорези купола
      c.fillStyle = '#181410';
      c.fillRect(cx - w * 0.03, cy - R0 * 0.72, w * 0.06, R0 * 0.5);
      c.strokeStyle = shade(pal.trim, -0.1); c.lineWidth = Math.max(1.5, W * 0.028);
      c.beginPath(); c.moveTo(cx, cy - w * 0.12); c.lineTo(cx + w * 0.3, cy - w * 0.36); c.stroke();
      c.fillStyle = '#c8d4dc';
      c.beginPath(); c.arc(cx + w * 0.3, cy - w * 0.36, W * 0.014, 0, 7); c.fill();
    }
    win(c, gc, x + w * 0.16, y + h * 0.3, w * 0.16, h * 0.3, pal);
    win(c, gc, x + w * 0.66, y + h * 0.3, w * 0.16, h * 0.3, pal);
  },

  // Завод: кирпич, шедовое остекление со светом, трубы с дымом, ворота.
  factory(ctx) {
    const { c, gc, W, groundY, pal, era, detail, seed, soft } = ctx;
    const w = W * 0.84, x = (W - w) / 2, d = W * 0.15, h = W * 0.4, y = groundY - h;
    box(c, x, y, w, h, d, pal.wall);
    wallMat(ctx, x, y, w, h, pal.wall, { force: era <= 5 ? 'plank' : 'brick', salt: 261 });
    // шедовая кровля: наклонное стекло ловит северный свет и горит в glow
    const teeth = 4, tw = w / teeth;
    for (let i = 0; i < teeth; i++) {
      const tx = x + i * tw;
      c.fillStyle = mixHex(pal.glass, pal.glow, 0.25);
      c.beginPath();
      c.moveTo(tx + 1, y); c.lineTo(tx + tw * 0.55, y - W * 0.08); c.lineTo(tx + 1, y - W * 0.08);
      c.closePath(); c.fill();
      gc.fillStyle = pal.glow;
      gc.beginPath();
      gc.moveTo(tx + 1, y); gc.lineTo(tx + tw * 0.55, y - W * 0.08); gc.lineTo(tx + 1, y - W * 0.08);
      gc.closePath(); gc.fill();
      c.fillStyle = shade(pal.roof, i % 2 ? 0.06 : -0.06);
      c.beginPath();
      c.moveTo(tx, y - W * 0.08); c.lineTo(tx + tw * 0.55, y - W * 0.08); c.lineTo(tx + tw, y);
      c.closePath(); c.fill();
      c.strokeStyle = 'rgba(10,10,12,0.4)';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(tx + tw * 0.55, y - W * 0.08); c.lineTo(tx + tw, y); c.stroke();
    }
    aoDown(c, x, y, w, W * 0.035, 0.3);
    // трубы: высокая главная + короткая, дым только у главной
    chimney(c, x + w * 0.06, y - W * 0.4, w * 0.11, W * 0.45, shade(pal.roof, -0.25), { roofAO: true });
    chimney(c, x + w * 0.22, y - W * 0.3, w * 0.09, W * 0.35, shade(pal.roof, -0.3), {});
    smoke(soft, x + w * 0.115, y - W * 0.44, w * 0.1, seed);
    // ряд верхних окон + ворота с раскосами
    for (let i = 0; i < 4; i++) win(c, gc, x + w * (0.36 + i * 0.15), y + h * 0.3, w * 0.1, h * 0.28, pal);
    const dw = w * 0.24, dx = x + w * 0.38, dh = h * 0.42, dyy = groundY - dh;
    c.fillStyle = shade(pal.trim, -0.25);
    c.fillRect(dx, dyy, dw, dh);
    c.strokeStyle = shade(pal.trim, 0.1);
    c.lineWidth = Math.max(1.5, W * 0.012);
    c.strokeRect(dx, dyy, dw, dh);
    c.beginPath();
    c.moveTo(dx, dyy); c.lineTo(dx + dw, groundY);
    c.moveTo(dx + dw, dyy); c.lineTo(dx, groundY); c.stroke();
    if (detail >= 1) {
      // вывеска-полоса с акцентом и «текстом» из тёмных штрихов
      c.fillStyle = pal.accent;
      c.fillRect(x + w * 0.36, y + h * 0.12, w * 0.28, h * 0.1);
      c.fillStyle = 'rgba(20,16,10,0.7)';
      for (let i = 0; i < 5; i++) {
        c.fillRect(x + w * (0.385 + i * 0.05), y + h * 0.155, w * 0.028, h * 0.03);
      }
    }
  },

  // Многоэтажка: до 7 эпохи — кирпич с штраблеными окнами, дальше — стеклобашня.
  highrise(ctx) {
    const { c, gc, W, groundY, pal, id, era, detail, seed } = ctx;
    const R = rng(seed, 271);
    const tall = id === 'skyscraper';
    const w = W * (tall ? 0.46 : 0.58), x = (W - w) / 2, d = W * 0.14;
    const h = W * (tall ? 1.0 : 0.66), y = groundY - h;
    box(c, x, y, w, h, d, pal.wall);
    if (era < 7) {
      wallMat(ctx, x, y, w, h, pal.wall, { force: 'brick', salt: 271 });
      const rows = tall ? 8 : 4, cols = 3;
      // межэтажные пояса: без них башня — просто таблица окон
      c.fillStyle = shade(pal.wall, -0.22);
      for (let r = 0; r <= rows; r++) {
        c.fillRect(x, y + h * (0.02 + r * (0.9 / rows)), w, Math.max(1.5, h * 0.016));
      }
      for (let r = 0; r < rows; r++) {
        for (let i = 0; i < cols; i++) {
          const k = hash2(r * 13 + i, id.length);
          const lit = k > 0.35;
          const wx = x + w * (0.1 + i * 0.29), wy = y + h * (0.06 + r * (0.9 / rows));
          // крупные окна с наличником: мелкие дырки читаются «тюрьмой»
          win(c, gc, wx, wy, w * 0.2, h * (0.55 / rows), pal, lit);
          c.fillStyle = 'rgba(255,248,225,0.25)';
          c.fillRect(wx - w * 0.03, wy - h * 0.012, w * 0.26, Math.max(1, h * 0.012));
          // занавески на редких окнах
          if (detail >= 2 && k > 0.8) {
            c.fillStyle = 'rgba(230,226,210,0.5)';
            c.fillRect(wx, wy, w * 0.2, h * (0.55 / rows) * 0.4);
          }
        }
      }
      // парапет + антенна
      c.fillStyle = shade(pal.roof, -0.1);
      c.fillRect(x - w * 0.04, y - W * 0.03, w + w * 0.08 + d * 0.7, W * 0.035);
      c.fillStyle = 'rgba(255,255,255,0.16)';
      c.fillRect(x - w * 0.04, y - W * 0.03, w + w * 0.08 + d * 0.7, 1.5);
      if (tall) {
        box(c, x + w * 0.24, y - W * 0.12, w * 0.5, W * 0.1, d * 0.5, shade(pal.wall, -0.08));
        c.strokeStyle = pal.trim; c.lineWidth = Math.max(1, W * 0.012);
        c.beginPath(); c.moveTo(x + w / 2, y - W * 0.12); c.lineTo(x + w / 2, y - W * 0.26); c.stroke();
        c.fillStyle = '#ff5a4a';
        c.beginPath(); c.arc(x + w / 2, y - W * 0.27, W * 0.02, 0, 7); c.fill();
        gc.fillStyle = '#ff5a4a';
        gc.beginPath(); gc.arc(x + w / 2, y - W * 0.27, W * 0.04, 0, 7); gc.fill();
      }
      // вход с козырьком
      door(c, x + w * 0.4, groundY - h * 0.14, w * 0.2, h * 0.14, pal);
      c.fillStyle = shade(pal.trim, -0.05);
      c.fillRect(x + w * 0.32, groundY - h * 0.14 - W * 0.035, w * 0.36, W * 0.03);
      aoDown(c, x + w * 0.34, groundY - h * 0.14, w * 0.32, W * 0.03, 0.3);
    } else {
      // стеклобашня: отражение неба + светящиеся кабины
      glassWall(c, gc, x, y, w, h, pal, R, detail, tall ? 0.5 : 0.42);
      // жёсткое ребро по свету
      c.fillStyle = 'rgba(255,255,255,0.15)';
      c.fillRect(x, y, Math.max(1.5, w * 0.03), h);
      c.fillStyle = 'rgba(0,0,0,0.2)';
      c.fillRect(x + w - Math.max(1.5, w * 0.03), y, Math.max(1.5, w * 0.03), h);
      // технический этаж-отступ
      box(c, x + w * 0.2, y - W * 0.12, w * 0.6, W * 0.1, d * 0.5, shade(pal.wall, -0.1));
      panelWall(c, x + w * 0.2, y - W * 0.12, w * 0.6, W * 0.1, shade(pal.wall, -0.1), rng(seed, 273), detail);
      // мачта с маячком
      c.strokeStyle = pal.trim; c.lineWidth = Math.max(1, W * 0.012);
      c.beginPath(); c.moveTo(x + w / 2, y - W * 0.12); c.lineTo(x + w / 2, y - W * 0.28); c.stroke();
      c.fillStyle = '#ff5a4a';
      c.beginPath(); c.arc(x + w / 2, y - W * 0.29, W * 0.02, 0, 7); c.fill();
      gc.fillStyle = '#ff5a4a';
      gc.beginPath(); gc.arc(x + w / 2, y - W * 0.29, W * 0.045, 0, 7); gc.fill();
      // портал входа со светящейся полосой
      c.fillStyle = shade(pal.trim, -0.2);
      c.fillRect(x + w * 0.38, groundY - h * 0.1, w * 0.24, h * 0.1);
      c.fillStyle = pal.glass;
      c.fillRect(x + w * 0.4, groundY - h * 0.09, w * 0.2, h * 0.09);
      gc.fillStyle = pal.glow;
      gc.fillRect(x + w * 0.4, groundY - h * 0.09, w * 0.2, h * 0.09);
      c.fillStyle = shade(pal.trim, -0.05);
      c.fillRect(x + w * 0.34, groundY - h * 0.1 - W * 0.035, w * 0.32, W * 0.035);
    }
  },

  // Телебашня: основание, широкий ствол с рёбрами, обручи, тарелки, мачта.
  tower(ctx) {
    const { c, gc, W, groundY, pal, detail, seed } = ctx;
    const w = W * 0.34, x = (W - w) / 2, d = W * 0.1, h = W * 0.9, y = groundY - h;
    // основание-пристройка шире ствола: башня не «иголка в песке»
    box(c, x - w * 0.7, groundY - W * 0.18, w * 2.4, W * 0.18, d, shade(pal.wall, -0.05));
    panelWall(c, x - w * 0.7, groundY - W * 0.18, w * 2.4, W * 0.18, shade(pal.wall, -0.05), rng(seed, 281), detail);
    win(c, gc, x - w * 0.5, groundY - W * 0.15, w * 0.6, W * 0.08, pal);
    win(c, gc, x + w * 0.2, groundY - W * 0.15, w * 0.6, W * 0.08, pal);
    door(c, x - w * 0.09, groundY - W * 0.1, w * 0.18, W * 0.1, pal);
    // ствол
    box(c, x, y, w, h, d, pal.wall);
    panelWall(c, x, y, w, h, pal.wall, rng(seed, 283), detail);
    // вертикальное ребро по свету
    c.fillStyle = 'rgba(255,255,255,0.16)';
    c.fillRect(x, y, Math.max(1, w * 0.1), h);
    c.fillStyle = 'rgba(0,0,0,0.18)';
    c.fillRect(x + w - Math.max(1, w * 0.1), y, Math.max(1, w * 0.1), h);
    // аппаратные обручи
    for (const k of [0.28, 0.52]) {
      c.fillStyle = shade(pal.trim, -0.1);
      c.fillRect(x - w * 0.09, y + h * k, w * 1.18, Math.max(2, h * 0.014));
      c.fillStyle = 'rgba(255,255,255,0.2)';
      c.fillRect(x - w * 0.09, y + h * k, w * 1.18, 1);
    }
    // тарелки-антенны на стволе
    for (const k of [0.34, 0.58]) {
      c.fillStyle = '#c8d0d8';
      c.beginPath();
      c.ellipse(x + w * 1.12, y + h * k, w * 0.16, w * 0.1, -0.5, 0, 7);
      c.fill();
      c.strokeStyle = 'rgba(40,44,50,0.5)';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(x + w * 0.95, y + h * k); c.lineTo(x + w * 1.1, y + h * k - w * 0.06); c.stroke();
    }
    // смотровая площадка со светящейся лентой
    c.fillStyle = shade(pal.trim, -0.05);
    c.fillRect(x - w * 0.16, y + h * 0.12, w * 1.32, h * 0.05);
    c.fillStyle = pal.glass;
    c.fillRect(x - w * 0.1, y + h * 0.13, w * 1.2, h * 0.03);
    gc.fillStyle = pal.glow;
    gc.fillRect(x - w * 0.1, y + h * 0.13, w * 1.2, h * 0.03);
    // мачта и красный маячок
    c.strokeStyle = shade(pal.trim, -0.1); c.lineWidth = Math.max(1.5, W * 0.02);
    c.beginPath(); c.moveTo(x + w / 2, y); c.lineTo(x + w / 2, y - W * 0.26); c.stroke();
    c.fillStyle = '#ff5a4a';
    c.beginPath(); c.arc(x + w / 2, y - W * 0.27, W * 0.028, 0, 7); c.fill();
    gc.fillStyle = '#ff5a4a';
    gc.beginPath(); gc.arc(x + w / 2, y - W * 0.27, W * 0.05, 0, 7); gc.fill();
  },

  // Реактор: градирни с паром, машинный зал с жалюзи, торус термояда.
  reactor(ctx) {
    const { c, gc, W, groundY, pal, id, detail, seed, soft } = ctx;
    const R = rng(seed, 291);
    // градирни: гиперболоид, швы бетона, тёмное горло, пар
    for (const k of [0.2, 0.56]) {
      const cx = W * (k + 0.11), base = W * 0.21, top = W * 0.14, th = W * 0.54;
      const g = c.createLinearGradient(cx - base / 2, 0, cx + base / 2, 0);
      g.addColorStop(0, shade(pal.wall, -0.26));
      g.addColorStop(0.35, shade(pal.wall, 0.16));
      g.addColorStop(1, shade(pal.wall, -0.3));
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(cx - base / 2, groundY);
      c.bezierCurveTo(cx - base * 0.42, groundY - th * 0.5, cx - top / 2, groundY - th * 0.75, cx - top / 2, groundY - th);
      c.lineTo(cx + top / 2, groundY - th);
      c.bezierCurveTo(cx + top / 2, groundY - th * 0.75, cx + base * 0.42, groundY - th * 0.5, cx + base / 2, groundY);
      c.closePath(); c.fill();
      // вертикальные швы опалубки
      c.strokeStyle = 'rgba(0,0,0,0.13)';
      c.lineWidth = 1;
      for (let i = 1; i < 5; i++) {
        const u = i / 5;
        c.beginPath();
        c.moveTo(cx - base / 2 + base * u, groundY);
        c.quadraticCurveTo(cx - top / 2 + top * u, groundY - th * 0.7, cx - top / 2 + top * u, groundY - th);
        c.stroke();
      }
      // горизонтальный пояс-стык
      c.beginPath();
      c.moveTo(cx - base * 0.44, groundY - th * 0.45);
      c.quadraticCurveTo(cx, groundY - th * 0.55, cx + base * 0.44, groundY - th * 0.45);
      c.stroke();
      // тёмный обрез горла
      c.fillStyle = 'rgba(20,24,30,0.5)';
      c.beginPath(); c.ellipse(cx, groundY - th, top / 2, top * 0.16, 0, 0, 7); c.fill();
      // пар: мягкие клубы в soft-слое
      for (let i = 0; i < 3; i++) {
        const px = cx + (R() - 0.5) * top * 0.8, py = groundY - th - W * (0.05 + i * 0.09);
        const pr = W * (0.07 + i * 0.035);
        const sg = soft.createRadialGradient(px, py, 0, px, py, pr);
        sg.addColorStop(0, `rgba(230,232,236,${0.3 - i * 0.07})`);
        sg.addColorStop(1, 'rgba(230,232,236,0)');
        soft.fillStyle = sg;
        soft.beginPath(); soft.arc(px, py, pr, 0, 7); soft.fill();
      }
    }
    // машинный зал с металлической крышей
    const hx = W * 0.1, hw = W * 0.8, hh = W * 0.2, hy = groundY - hh;
    box(c, hx, hy, hw, hh, W * 0.1, shade(pal.wall, -0.1));
    panelWall(c, hx, hy, hw, hh, shade(pal.wall, -0.1), rng(seed, 293), detail);
    const rA = P(hx, hy), rB = P(hx + hw, hy);
    const rC = P(hx + hw + W * 0.1, hy - W * 0.055), rD = P(hx + W * 0.1, hy - W * 0.055);
    c.fillStyle = shade(pal.roof, 0.06);
    c.beginPath();
    c.moveTo(rA[0], rA[1]); c.lineTo(rB[0], rB[1]); c.lineTo(rC[0], rC[1]); c.lineTo(rD[0], rD[1]);
    c.closePath(); c.fill();
    roofSkin(c, rA, rB, rC, rD, 7, pal.roof, rng(seed, 295), detail);
    aoDown(c, hx, hy, hw, W * 0.03, 0.3);
    // жалюзи вентячеек: горизонтальные ламели
    for (let i = 0; i < 3; i++) {
      const lx = hx + hw * (0.12 + i * 0.3), ly = hy + hh * 0.25, lw = hw * 0.2;
      c.fillStyle = '#20242a';
      c.fillRect(lx, ly, lw, hh * 0.4);
      c.strokeStyle = 'rgba(160,170,180,0.4)';
      c.lineWidth = 1;
      for (let s = 1; s < 5; s++) {
        c.beginPath();
        c.moveTo(lx + 1, ly + hh * 0.4 * s / 5);
        c.lineTo(lx + lw - 1, ly + hh * 0.4 * s / 5); c.stroke();
      }
    }
    // ворота с сигнальной полосой
    c.fillStyle = shade(pal.trim, -0.25);
    c.fillRect(hx + hw * 0.44, groundY - hh * 0.55, hw * 0.12, hh * 0.55);
    for (let i = 0; i < 4; i++) {
      c.fillStyle = i % 2 ? '#d8a020' : '#28241e';
      c.fillRect(hx + hw * 0.44, groundY - hh * 0.55 + hh * 0.55 * i / 4, hw * 0.12, hh * 0.55 / 4);
    }
    if (id === 'fusion_reactor') {
      // торус удержания: кольцо со свечением и катушками
      const cx = W / 2, cy = groundY - W * 0.42;
      c.strokeStyle = pal.trim; c.lineWidth = Math.max(2, W * 0.03);
      c.beginPath(); c.ellipse(cx, cy, W * 0.2, W * 0.09, 0, 0, 7); c.stroke();
      c.fillStyle = shade(pal.wall, -0.2);
      for (const k of [-0.6, -0.2, 0.2, 0.6]) {
        c.fillRect(cx + W * 0.2 * k - W * 0.012, cy - W * 0.075, W * 0.024, W * 0.15);
      }
      gc.strokeStyle = pal.glow; gc.lineWidth = Math.max(2, W * 0.05);
      gc.beginPath(); gc.ellipse(cx, cy, W * 0.2, W * 0.09, 0, 0, 7); gc.stroke();
    } else if (detail >= 1) {
      // сигнальные огни на градирнях
      gc.fillStyle = '#ff5a4a';
      gc.beginPath(); gc.arc(W * 0.31, groundY - W * 0.55, W * 0.012, 0, 7); gc.fill();
      gc.beginPath(); gc.arc(W * 0.67, groundY - W * 0.55, W * 0.012, 0, 7); gc.fill();
    }
  },

  // Солнечная ферма: панели с ячейками и блеском, инвертор с диодом.
  solar(ctx) {
    const { c, gc, W, groundY, pal, detail, seed } = ctx;
    for (let r = 0; r < 3; r++) {
      for (let i = 0; i < 3; i++) {
        const px = W * (0.1 + i * 0.29), py = groundY - W * (0.1 + r * 0.15);
        // ноги панели
        c.strokeStyle = '#4a4a50';
        c.lineWidth = Math.max(1, W * 0.008);
        c.beginPath();
        c.moveTo(px + W * 0.05, py); c.lineTo(px + W * 0.05, py - W * 0.02);
        c.moveTo(px + W * 0.16, py); c.lineTo(px + W * 0.16, py - W * 0.02);
        c.stroke();
        // тёмная рама + синее поле
        c.fillStyle = '#10141c';
        c.beginPath();
        c.moveTo(px - W * 0.01, py); c.lineTo(px + W * 0.25, py);
        c.lineTo(px + W * 0.21, py - W * 0.1); c.lineTo(px - W * 0.05, py - W * 0.1);
        c.closePath(); c.fill();
        c.fillStyle = '#1e2c44';
        c.beginPath();
        c.moveTo(px, py - W * 0.008); c.lineTo(px + W * 0.235, py - W * 0.008);
        c.lineTo(px + W * 0.2, py - W * 0.092); c.lineTo(px - W * 0.04, py - W * 0.092);
        c.closePath(); c.fill();
        // сетка ячеек
        if (detail >= 1) {
          c.strokeStyle = 'rgba(120,160,220,0.3)';
          c.lineWidth = 1;
          for (let s = 1; s < 4; s++) {
            const u = s / 4;
            c.beginPath();
            c.moveTo(lerpP(P(px, py - W * 0.008), P(px - W * 0.04, py - W * 0.092), u)[0], lerpP(P(px, py - W * 0.008), P(px - W * 0.04, py - W * 0.092), u)[1]);
            c.lineTo(lerpP(P(px + W * 0.235, py - W * 0.008), P(px + W * 0.2, py - W * 0.092), u)[0], lerpP(P(px + W * 0.235, py - W * 0.008), P(px + W * 0.2, py - W * 0.092), u)[1]);
            c.stroke();
          }
        }
        // блик солнца: диагональная полоса
        c.fillStyle = 'rgba(160,200,250,0.35)';
        c.beginPath();
        c.moveTo(px + W * 0.02, py - W * 0.008);
        c.lineTo(px + W * 0.09, py - W * 0.008);
        c.lineTo(px + W * 0.05, py - W * 0.092);
        c.lineTo(px - W * 0.02, py - W * 0.092);
        c.closePath(); c.fill();
      }
    }
    // инвертор: шкаф с вентиляцией и диодом
    box(c, W * 0.72, groundY - W * 0.2, W * 0.2, W * 0.2, W * 0.08, pal.wall);
    panelWall(c, W * 0.72, groundY - W * 0.2, W * 0.2, W * 0.2, pal.wall, rng(seed, 301), detail);
    c.fillStyle = '#20242a';
    c.fillRect(W * 0.75, groundY - W * 0.15, W * 0.09, W * 0.09);
    c.strokeStyle = 'rgba(160,170,180,0.4)';
    c.lineWidth = 1;
    for (let s = 1; s < 4; s++) {
      c.beginPath();
      c.moveTo(W * 0.75 + 1, groundY - W * 0.15 + W * 0.09 * s / 4);
      c.lineTo(W * 0.84 - 1, groundY - W * 0.15 + W * 0.09 * s / 4);
      c.stroke();
    }
    c.fillStyle = '#5ae07d';
    c.fillRect(W * 0.87, groundY - W * 0.17, W * 0.014, W * 0.014);
    gc.fillStyle = '#5ae07d';
    gc.fillRect(W * 0.866, groundY - W * 0.174, W * 0.022, W * 0.022);
  },

  // Космодром: плита с габаритом и копотью, ракета с fins, ферма, бак.
  pad(ctx) {
    const { c, gc, W, groundY, pal } = ctx;
    // плита
    c.fillStyle = shade(pal.wall, -0.15);
    c.beginPath(); c.ellipse(W / 2, groundY - W * 0.03, W * 0.42, W * 0.16, 0, 0, 7); c.fill();
    c.fillStyle = shade(pal.wall, -0.05);
    c.beginPath(); c.ellipse(W / 2, groundY - W * 0.045, W * 0.42, W * 0.155, 0, 0, 7); c.fill();
    // габаритное кольцо: штрихи
    c.strokeStyle = pal.accent; c.lineWidth = Math.max(1.5, W * 0.016);
    c.setLineDash([W * 0.05, W * 0.04]);
    c.beginPath(); c.ellipse(W / 2, groundY - W * 0.045, W * 0.3, W * 0.11, 0, 0, 7); c.stroke();
    c.setLineDash([]);
    // копоть под стартовым столом
    c.fillStyle = 'rgba(20,18,16,0.4)';
    c.beginPath(); c.ellipse(W / 2, groundY - W * 0.04, W * 0.1, W * 0.035, 0, 0, 7); c.fill();
    // ракета: обшивка с бликом, иллюминатор, пояс, стабилизаторы
    const cx = W / 2, rw = W * 0.15, rh = W * 0.72, ry = groundY - W * 0.08 - rh;
    const g = c.createLinearGradient(cx - rw / 2, 0, cx + rw / 2, 0);
    g.addColorStop(0, '#b8c2cc'); g.addColorStop(0.35, '#f2f6fa'); g.addColorStop(1, '#98a2ac');
    c.fillStyle = g;
    c.fillRect(cx - rw / 2, ry, rw, rh);
    // швы секций обшивки
    c.strokeStyle = 'rgba(60,70,80,0.35)';
    c.lineWidth = 1;
    for (const k of [0.3, 0.62]) {
      c.beginPath();
      c.moveTo(cx - rw / 2, ry + rh * k); c.lineTo(cx + rw / 2, ry + rh * k); c.stroke();
    }
    // стабилизаторы: широкие, с косой кромкой — без них ракета «колбаса»
    c.fillStyle = '#c8452e';
    c.beginPath();
    c.moveTo(cx - rw / 2 + 1, ry + rh * 0.78);
    c.lineTo(cx - rw * 1.25, ry + rh);
    c.lineTo(cx - rw / 2 + 1, ry + rh);
    c.closePath(); c.fill();
    c.fillStyle = '#a83824';
    c.beginPath();
    c.moveTo(cx + rw / 2 - 1, ry + rh * 0.78);
    c.lineTo(cx + rw * 1.25, ry + rh);
    c.lineTo(cx + rw / 2 - 1, ry + rh);
    c.closePath(); c.fill();
    // иллюминатор + пояс
    c.fillStyle = '#20303c';
    c.beginPath(); c.arc(cx, ry + rh * 0.2, rw * 0.16, 0, 7); c.fill();
    c.strokeStyle = '#e8eef4';
    c.lineWidth = Math.max(1, W * 0.008);
    c.stroke();
    c.fillStyle = '#c8452e';
    c.fillRect(cx - rw / 2, ry + rh * 0.42, rw, rh * 0.07);
    // головной обтекатель
    c.fillStyle = '#e8eef4';
    c.beginPath();
    c.moveTo(cx - rw / 2, ry); c.quadraticCurveTo(cx, ry - W * 0.22, cx + rw / 2, ry);
    c.closePath(); c.fill();
    // башня обслуживания: ферма с поперечинами и площадкой у ракеты
    const gx2 = cx + rw * 1.05, gw2 = W * 0.05;
    c.fillStyle = shade(pal.trim, -0.25);
    c.fillRect(gx2, ry + rh * 0.05, gw2, ry + rh - ry - rh * 0.05 + W * 0.02);
    c.strokeStyle = shade(pal.trim, -0.1);
    c.lineWidth = Math.max(1, W * 0.008);
    for (let i = 0; i < 5; i++) {
      const ay = ry + rh * (0.15 + i * 0.15);
      c.beginPath();
      c.moveTo(gx2, ay); c.lineTo(cx + rw / 2, ay + W * 0.008); c.stroke();
    }
    // площадка на верхушке фермы
    c.fillStyle = shade(pal.trim, -0.05);
    c.fillRect(gx2 - W * 0.012, ry + rh * 0.05 - W * 0.012, gw2 + W * 0.024, W * 0.014);
    c.fillStyle = '#ff5a4a';
    c.beginPath(); c.arc(gx2 + gw2 / 2, ry + rh * 0.05 - W * 0.02, W * 0.008, 0, 7); c.fill();
    gc.fillStyle = '#ff5a4a';
    gc.beginPath(); gc.arc(gx2 + gw2 / 2, ry + rh * 0.05 - W * 0.02, W * 0.016, 0, 7); gc.fill();
    // кольцо подсветки на плите
    gc.strokeStyle = pal.glow;
    gc.lineWidth = Math.max(1.5, W * 0.02);
    gc.beginPath(); gc.ellipse(cx, groundY - W * 0.045, W * 0.3, W * 0.11, 0, 0, 7); gc.stroke();
  },

  // Дата-центр: низкий корпус с лентой серверного свечения, HVAC на крыше.
  flat(ctx) {
    const { c, gc, W, groundY, pal, detail, seed } = ctx;
    const w = W * 0.84, x = (W - w) / 2, d = W * 0.14, h = W * 0.26, y = groundY - h;
    box(c, x, y, w, h, d, pal.wall);
    panelWall(c, x, y, w, h, pal.wall, rng(seed, 311), detail);
    // лента серверных окон: длинные тонкие, часть тёмная
    for (let i = 0; i < 5; i++) {
      const lit = rng(seed, 313)() < 0.7;
      const wx = x + w * (0.07 + i * 0.19);
      c.fillStyle = shade(pal.trim, -0.35);
      c.fillRect(wx - w * 0.008, y + h * 0.26, w * 0.136, h * 0.42);
      c.fillStyle = lit ? mixHex(pal.glass, pal.glow, 0.7) : shade(pal.glass, -0.2);
      c.fillRect(wx, y + h * 0.28, w * 0.12, h * 0.38);
      if (lit) { gc.fillStyle = pal.glow; gc.fillRect(wx, y + h * 0.28, w * 0.12, h * 0.38); }
      // вентиляционные прорези под лентой
      c.fillStyle = 'rgba(0,0,0,0.3)';
      for (let s = 0; s < 3; s++) {
        c.fillRect(wx + w * 0.01, y + h * 0.7 + s * h * 0.07, w * 0.1, 1.2);
      }
    }
    // парапет
    c.fillStyle = shade(pal.roof, 0);
    c.fillRect(x - w * 0.03, y - W * 0.025, w + w * 0.06 + d * 0.7, W * 0.03);
    c.fillStyle = 'rgba(255,255,255,0.16)';
    c.fillRect(x - w * 0.03, y - W * 0.025, w + w * 0.06 + d * 0.7, 1.2);
    // HVAC-блоки с вентиляторами
    for (const k of [0.12, 0.42, 0.68]) {
      const bx = x + w * k, by = y - W * 0.025;
      box(c, bx, by - W * 0.07, w * 0.14, W * 0.07, W * 0.04, shade(pal.wall, -0.15), { ao: false });
      c.strokeStyle = '#3a3e46';
      c.lineWidth = Math.max(1.5, W * 0.012);
      c.beginPath(); c.arc(bx + w * 0.07 + W * 0.02, by - W * 0.035, W * 0.022, 0, 7); c.stroke();
      c.beginPath();
      c.moveTo(bx + w * 0.07 + W * 0.02, by - W * 0.035);
      c.lineTo(bx + w * 0.07 + W * 0.02 + W * 0.018, by - W * 0.035 - W * 0.012);
      c.stroke();
    }
  },

  campfire(ctx) {
    const { c, gc, soft, W, groundY, seed, detail } = ctx;
    const R = rng(seed, 321);
    // кольцо камней: каждый камень своего тона, с бликом по свету
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      const sx = W / 2 + Math.cos(a) * W * 0.2, sy = groundY - W * 0.03 + Math.sin(a) * W * 0.09;
      c.fillStyle = R() < 0.5 ? '#8a857e' : '#6e6961';
      c.beginPath();
      c.ellipse(sx, sy, W * 0.055, W * 0.04, 0, 0, 7); c.fill();
      c.fillStyle = 'rgba(255,248,225,0.2)';
      c.beginPath();
      c.ellipse(sx - W * 0.012, sy - W * 0.012, W * 0.022, W * 0.014, 0, 0, 7); c.fill();
    }
    // поленья с корой
    c.strokeStyle = '#5a4433'; c.lineWidth = Math.max(2, W * 0.035);
    for (const a of [0.4, 1.6, 2.6]) {
      c.beginPath();
      c.moveTo(W / 2 - Math.cos(a) * W * 0.13, groundY - W * 0.05 - Math.sin(a) * W * 0.03);
      c.lineTo(W / 2 + Math.cos(a) * W * 0.13, groundY - W * 0.05 + Math.sin(a) * W * 0.03);
      c.stroke();
    }
    c.strokeStyle = 'rgba(30,20,12,0.5)'; c.lineWidth = 1;
    for (const a of [0.4, 1.6, 2.6]) {
      c.beginPath();
      c.moveTo(W / 2 - Math.cos(a) * W * 0.1, groundY - W * 0.058 - Math.sin(a) * W * 0.024);
      c.lineTo(W / 2 + Math.cos(a) * W * 0.1, groundY - W * 0.042 + Math.sin(a) * W * 0.024);
      c.stroke();
    }
    // зарево и пламя — в мягкий слой, обводить нельзя
    const fx = W / 2, fy = groundY - W * 0.14;
    const fg = soft.createRadialGradient(fx, fy, 0, fx, fy, W * 0.26);
    fg.addColorStop(0, 'rgba(255,246,190,0.95)');
    fg.addColorStop(0.3, 'rgba(250,170,60,0.75)');
    fg.addColorStop(0.7, 'rgba(226,96,28,0.32)');
    fg.addColorStop(1, 'rgba(200,60,20,0)');
    soft.fillStyle = fg;
    soft.beginPath(); soft.ellipse(fx, fy, W * 0.22, W * 0.26, 0, 0, 7); soft.fill();
    soft.fillStyle = 'rgba(255,214,110,0.92)';
    soft.beginPath();
    soft.moveTo(fx - W * 0.07, groundY - W * 0.04);
    soft.quadraticCurveTo(fx - W * 0.04, fy, fx, groundY - W * 0.32);
    soft.quadraticCurveTo(fx + W * 0.05, fy, fx + W * 0.07, groundY - W * 0.04);
    soft.closePath(); soft.fill();
    soft.fillStyle = 'rgba(255,252,226,0.9)';
    soft.beginPath();
    soft.moveTo(fx - W * 0.032, groundY - W * 0.05);
    soft.quadraticCurveTo(fx, fy, fx, groundY - W * 0.21);
    soft.quadraticCurveTo(fx + W * 0.02, fy, fx + W * 0.032, groundY - W * 0.05);
    soft.closePath(); soft.fill();
    gc.fillStyle = '#ff9430';
    gc.beginPath(); gc.ellipse(fx, fy, W * 0.14, W * 0.18, 0, 0, 7); gc.fill();
    // искры-угольки в карте свечения
    if (detail >= 1) {
      for (let i = 0; i < 4; i++) {
        gc.fillStyle = 'rgba(255,200,120,0.8)';
        gc.fillRect(fx + (R() - 0.5) * W * 0.16, fy - W * (0.1 + R() * 0.14), 1.6, 1.6);
      }
    }
  },

  // Дровяник: торцы брёвен с кольцами и корой, навес соломой/металлом.
  woodpile(ctx) {
    const { c, W, groundY, pal, era, detail, seed } = ctx;
    const R = rng(seed, 331);
    const w = W * 0.78, x = (W - w) / 2, d = W * 0.14;
    const postH = W * 0.34, y = groundY - postH;
    // штабель: торцы брёвен с годовыми кольцами, ряды вразбежку
    const rows = 3, cols = 4;
    const lw = w * 0.19, lh = W * 0.085;
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < cols; i++) {
        const bx = x + w * 0.05 + i * lw * 1.02 + (r % 2) * lw * 0.12;
        const by = groundY - (r + 1) * lh;
        const tone = 0.5 + hash2(r * 7 + i, i * 3 + r) * 0.5;
        // тёмный зазор за торцом
        c.fillStyle = 'rgba(30,20,10,0.5)';
        c.fillRect(bx, by, lw, lh);
        // кора по окружности торца
        c.fillStyle = shade('#6b4f30', -0.08 + tone * 0.14);
        c.beginPath(); c.ellipse(bx + lw / 2, by + lh / 2, lw * 0.48, lh * 0.46, 0, 0, 7); c.fill();
        // светлый спил
        c.fillStyle = shade('#a8825a', -0.1 + tone * 0.18);
        c.beginPath(); c.ellipse(bx + lw / 2, by + lh / 2, lw * 0.4, lh * 0.38, 0, 0, 7); c.fill();
        if (detail >= 1) {
          // годовые кольца
          c.strokeStyle = 'rgba(70,46,24,0.55)';
          c.lineWidth = Math.max(1, W * 0.006);
          c.beginPath(); c.ellipse(bx + lw / 2, by + lh / 2, lw * 0.24, lh * 0.22, 0, 0, 7); c.stroke();
          c.beginPath(); c.ellipse(bx + lw / 2, by + lh / 2, lw * 0.11, lh * 0.1, 0, 0, 7); c.stroke();
          // трещина усушки
          if (R() < 0.4) {
            c.beginPath();
            c.moveTo(bx + lw / 2, by + lh / 2);
            c.lineTo(bx + lw / 2 + lw * (R() - 0.5) * 0.5, by + lh * (0.1 + R() * 0.2)); c.stroke();
          }
        }
      }
    }
    // столбы
    for (const k of [0, 1]) {
      const px = x + k * (w - w * 0.06);
      c.fillStyle = shade(pal.trim, -0.25);
      c.fillRect(px, y - W * 0.02, w * 0.06, postH + W * 0.02);
      c.fillStyle = 'rgba(255,246,220,0.12)';
      c.fillRect(px, y - W * 0.02, Math.max(1, w * 0.015), postH + W * 0.02);
    }
    // односкатный навес материалом эпохи
    const A = P(x - w * 0.07, y), B = P(x + w + w * 0.07, y - W * 0.05);
    const C = P(B[0] + d, B[1] - d * 0.55), D = P(A[0] + d, A[1] - d * 0.55);
    c.fillStyle = shade(pal.roof, 0.06);
    c.beginPath();
    c.moveTo(A[0], A[1]); c.lineTo(B[0], B[1]); c.lineTo(C[0], C[1]); c.lineTo(D[0], D[1]);
    c.closePath(); c.fill();
    roofSkin(c, A, B, C, D, Math.min(era, 5), pal.roof, rng(seed, 333), detail);
    if (era <= 1) thatchFringe(c, A, B, pal.roof, rng(seed, 335));
    aoDown(c, A[0], y, w * 1.14, W * 0.05, 0.3);
    if (detail >= 1) {
      // колода с топором
      c.fillStyle = '#6b4f35';
      c.fillRect(x + w * 0.86, groundY - W * 0.1, w * 0.14, W * 0.1);
      c.fillStyle = '#a8825a';
      c.beginPath(); c.ellipse(x + w * 0.93, groundY - W * 0.1, w * 0.07, W * 0.018, 0, 0, 7); c.fill();
      c.strokeStyle = '#5a4433'; c.lineWidth = Math.max(1.5, W * 0.018);
      c.beginPath(); c.moveTo(x + w * 0.93, groundY - W * 0.1); c.lineTo(x + w * 0.99, groundY - W * 0.26); c.stroke();
      c.fillStyle = '#c3cad2';
      c.beginPath();
      c.moveTo(x + w * 0.97, groundY - W * 0.24); c.lineTo(x + w * 1.06, groundY - W * 0.3);
      c.lineTo(x + w * 1.0, groundY - W * 0.18); c.closePath(); c.fill();
    }
  },

  // Каменный склад: блоки с фаской-рустом, стрела крана с гнётом.
  stonepile(ctx) {
    const { c, W, groundY, pal, detail, seed } = ctx;
    const bw = W * 0.19, bh = W * 0.1;
    for (let r = 0; r < 3; r++) {
      const n = 3 - r;
      for (let i = 0; i < n; i++) {
        const bx = W * 0.16 + (r * bw * 0.5) + i * bw * 1.04;
        const by = groundY - (r + 1) * bh * 1.05;
        const tone = hash2(r * 11 + i, i * 5 + r);
        box(c, bx, by, bw, bh, W * 0.06, shade('#9a9690', -0.08 + tone * 0.16));
        // руст: снятая фаска по периметру лицевой стороны
        c.strokeStyle = 'rgba(255,255,255,0.22)';
        c.lineWidth = 1;
        c.strokeRect(bx + 1, by + 1, bw - 2, bh - 2);
        c.strokeStyle = 'rgba(40,38,34,0.4)';
        c.strokeRect(bx + 2.5, by + 2.5, bw - 5, bh - 5);
        // точечная выбоина
        if (detail >= 1 && hash2(r * 3 + i, i + r) < 0.4) {
          c.fillStyle = 'rgba(50,46,42,0.5)';
          c.beginPath();
          c.arc(bx + bw * (0.2 + tone * 0.6), by + bh * 0.5, Math.max(1, W * 0.008), 0, 7);
          c.fill();
        }
      }
    }
    // стрела крана: мачта, гусёк, вант-оттяжка, гнёт на верёвке
    c.strokeStyle = shade(pal.trim, -0.2); c.lineWidth = Math.max(2, W * 0.028);
    c.beginPath(); c.moveTo(W * 0.82, groundY); c.lineTo(W * 0.8, groundY - W * 0.52); c.stroke();
    c.lineWidth = Math.max(1.5, W * 0.022);
    c.beginPath(); c.moveTo(W * 0.8, groundY - W * 0.52); c.lineTo(W * 0.52, groundY - W * 0.6); c.stroke();
    c.lineWidth = Math.max(1, W * 0.01);
    c.beginPath(); c.moveTo(W * 0.8, groundY - W * 0.4); c.lineTo(W * 0.62, groundY - W * 0.575); c.stroke();
    if (detail >= 1) {
      c.strokeStyle = 'rgba(40,34,28,0.7)'; c.lineWidth = Math.max(1, W * 0.008);
      c.beginPath(); c.moveTo(W * 0.55, groundY - W * 0.59); c.lineTo(W * 0.55, groundY - W * 0.44); c.stroke();
      box(c, W * 0.48, groundY - W * 0.44, W * 0.14, W * 0.08, W * 0.05, '#9a9690');
      c.strokeStyle = 'rgba(255,255,255,0.2)';
      c.strokeRect(W * 0.481, groundY - W * 0.439, W * 0.138, W * 0.078);
    }
  },

  // Депо: ангар с дугой швами, ворота-купе, пандус и лампа со конусом света.
  warehouse(ctx) {
    const { c, gc, W, groundY, pal, era, detail, seed } = ctx;
    const w = W * 0.88, x = (W - w) / 2, d = W * 0.15, h = W * 0.38, y = groundY - h;
    box(c, x, y, w, h, d, pal.wall);
    wallMat(ctx, x, y, w, h, pal.wall, { force: era <= 5 ? 'plank' : 'brick', salt: 341 });
    // ангарная кровля-дуга
    const apex = y - W * 0.24;
    c.fillStyle = shade(pal.roof, 0.08);
    c.beginPath();
    c.moveTo(x, y); c.quadraticCurveTo(x + w / 2, apex, x + w, y);
    c.lineTo(x + w + d, y - d * 0.55);
    c.quadraticCurveTo(x + w / 2 + d, apex - d * 0.55, x + d, y - d * 0.55);
    c.closePath(); c.fill();
    // фальцевые швы по дуге: вертикальные линии до кривой (контрольная точка
    // посередине делает X(t) линейным, поэтому высота кривой считается точно)
    c.save();
    c.beginPath();
    c.moveTo(x, y); c.quadraticCurveTo(x + w / 2, apex, x + w, y);
    c.lineTo(x + w + d, y - d * 0.55);
    c.quadraticCurveTo(x + w / 2 + d, apex - d * 0.55, x + d, y - d * 0.55);
    c.closePath(); c.clip();
    for (let i = 1; i < 8; i++) {
      const t = i / 8;
      const px = x + w * t;
      const cy = y * ((1 - t) * (1 - t) + t * t) + apex * 2 * t * (1 - t);
      c.strokeStyle = 'rgba(10,14,18,0.28)';
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(px, y + 1); c.lineTo(px, cy); c.stroke();
      c.strokeStyle = 'rgba(255,255,255,0.12)';
      c.beginPath(); c.moveTo(px + 1.5, y + 1); c.lineTo(px + 1.5, cy); c.stroke();
    }
    c.restore();
    // световой фонарь под вершиной дуги
    c.fillStyle = pal.glass;
    c.fillRect(x + w * 0.3, y - W * 0.185, w * 0.4, W * 0.03);
    gc.fillStyle = pal.glow;
    gc.fillRect(x + w * 0.3, y - W * 0.185, w * 0.4, W * 0.03);
    // блик по дуге
    c.fillStyle = 'rgba(255,248,225,0.16)';
    c.beginPath();
    c.moveTo(x, y); c.quadraticCurveTo(x + w / 2, apex, x + w * 0.52, y - W * 0.19);
    c.lineTo(x + w * 0.3, y); c.closePath(); c.fill();
    // ворота-купе с рельсом и раскосами
    const gw = w * 0.32, gx = x + w * 0.34, gh = h * 0.74, gy = groundY - gh;
    c.fillStyle = shade(pal.trim, -0.3);
    c.fillRect(gx, gy, gw, gh);
    c.strokeStyle = shade(pal.trim, 0.1);
    c.lineWidth = Math.max(1.5, W * 0.012);
    c.strokeRect(gx, gy, gw, gh);
    c.beginPath();
    c.moveTo(gx, gy); c.lineTo(gx + gw, groundY);
    c.moveTo(gx + gw, gy); c.lineTo(gx, groundY); c.stroke();
    c.fillStyle = shade(pal.trim, -0.1);
    c.fillRect(gx - w * 0.02, gy - W * 0.012, gw + w * 0.04, W * 0.012);
    win(c, gc, x + w * 0.08, y + h * 0.22, w * 0.14, h * 0.2, pal);
    win(c, gc, x + w * 0.78, y + h * 0.22, w * 0.14, h * 0.2, pal);
    if (detail >= 1) {
      // пандус и ящики у стены
      c.fillStyle = shade(pal.trim, -0.2);
      c.beginPath();
      c.moveTo(x + w * 0.02, groundY); c.lineTo(x + w * 0.14, groundY);
      c.lineTo(x + w * 0.14, groundY - W * 0.05); c.lineTo(x + w * 0.02, groundY - W * 0.015);
      c.closePath(); c.fill();
      for (let i = 0; i < 3; i++) {
        box(c, x + w * (0.02 + i * 0.09), groundY - W * (0.09 + (i % 2) * 0.07), w * 0.085, W * 0.09, W * 0.04, '#9a7040');
        c.strokeStyle = 'rgba(60,44,24,0.5)';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(x + w * (0.02 + i * 0.09), groundY - W * (0.09 + (i % 2) * 0.07) + W * 0.045);
        c.lineTo(x + w * (0.02 + i * 0.09) + w * 0.085, groundY - W * (0.09 + (i % 2) * 0.07) + W * 0.045);
        c.stroke();
      }
      // лампа со световым конусом над воротами
      c.fillStyle = shade(pal.trim, -0.2);
      c.fillRect(gx + gw * 0.45, gy - W * 0.045, w * 0.02, W * 0.03);
      c.fillStyle = pal.glow;
      c.beginPath(); c.arc(gx + gw * 0.46, gy - W * 0.012, W * 0.012, 0, 7); c.fill();
      gc.fillStyle = pal.glow;
      gc.beginPath(); c.arc(gx + gw * 0.46, gy - W * 0.012, W * 0.022, 0, 7); gc.fill();
    }
  },

  // Костёр историй: сиденья-брёвна, шкура-навес со сшивкой, тотем с лицом.
  storyfire(ctx) {
    const { c, W, groundY, pal, detail, seed } = ctx;
    const R = rng(seed, 351);
    // сиденья по дуге: брёвна с торцами
    for (let i = 0; i < 5; i++) {
      const a = Math.PI * (0.15 + i * 0.175);
      const sx = W / 2 + Math.cos(a) * W * 0.34, sy = groundY - W * 0.02 + Math.sin(a) * W * 0.14;
      c.fillStyle = shade(pal.trim, -0.15 + (i % 2) * 0.06);
      c.beginPath(); c.ellipse(sx, sy, W * 0.07, W * 0.035, 0, 0, 7); c.fill();
      c.strokeStyle = 'rgba(40,28,14,0.4)';
      c.lineWidth = 1;
      c.beginPath(); c.ellipse(sx, sy, W * 0.05, W * 0.024, 0, 0, 7); c.stroke();
    }
    DRAW.campfire(ctx);
    // тотем с резным лицом: череп, глаза-дупла, насечки
    c.strokeStyle = shade(pal.trim, -0.3); c.lineWidth = Math.max(2, W * 0.035);
    c.beginPath(); c.moveTo(W * 0.8, groundY - W * 0.04); c.lineTo(W * 0.78, groundY - W * 0.46); c.stroke();
    c.fillStyle = '#ddd6c4';
    c.beginPath(); c.ellipse(W * 0.78, groundY - W * 0.5, W * 0.055, W * 0.045, 0, 0, 7); c.fill();
    c.fillStyle = 'rgba(40,32,26,0.8)';
    c.beginPath(); c.arc(W * 0.762, groundY - W * 0.505, W * 0.013, 0, 7); c.fill();
    c.beginPath(); c.arc(W * 0.8, groundY - W * 0.505, W * 0.013, 0, 7); c.fill();
    c.beginPath();
    c.moveTo(W * 0.765, groundY - W * 0.478);
    c.lineTo(W * 0.795, groundY - W * 0.478);
    c.lineTo(W * 0.78, groundY - W * 0.468);
    c.closePath(); c.fill();
    if (detail >= 1) {
      // насечки на столбе
      c.strokeStyle = 'rgba(40,32,22,0.5)';
      c.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        c.beginPath();
        c.moveTo(W * 0.772, groundY - W * (0.2 + i * 0.07));
        c.lineTo(W * 0.792, groundY - W * (0.19 + i * 0.07)); c.stroke();
      }
      // шкура-навес на жердях со сшивкой
      c.fillStyle = shade(pal.wall, -0.05);
      c.beginPath();
      c.moveTo(W * 0.1, groundY - W * 0.12); c.lineTo(W * 0.14, groundY - W * 0.42);
      c.lineTo(W * 0.34, groundY - W * 0.38); c.lineTo(W * 0.3, groundY - W * 0.1);
      c.closePath(); c.fill();
      c.strokeStyle = 'rgba(30,22,12,0.4)';
      c.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const t = i / 4;
        c.beginPath();
        c.moveTo(lerpP(P(W * 0.1, groundY - W * 0.12), P(W * 0.14, groundY - W * 0.42), t)[0],
          lerpP(P(W * 0.1, groundY - W * 0.12), P(W * 0.14, groundY - W * 0.42), t)[1]);
        c.lineTo(lerpP(P(W * 0.3, groundY - W * 0.1), P(W * 0.34, groundY - W * 0.38), t)[0],
          lerpP(P(W * 0.3, groundY - W * 0.1), P(W * 0.34, groundY - W * 0.38), t)[1]);
        c.stroke();
      }
      c.strokeStyle = shade(pal.trim, -0.3); c.lineWidth = Math.max(1, W * 0.016);
      c.beginPath(); c.moveTo(W * 0.12, groundY); c.lineTo(W * 0.14, groundY - W * 0.44); c.stroke();
      c.beginPath(); c.moveTo(W * 0.32, groundY); c.lineTo(W * 0.34, groundY - W * 0.4); c.stroke();
    }
  },

  // Верфь: стапель, корпус со шпангоутами, килевые блоки, стружка.
  shipyard(ctx) {
    const { c, gc, W, groundY, pal, detail, seed } = ctx;
    // стапель уходит в воду
    c.fillStyle = shade(pal.trim, -0.1);
    c.beginPath();
    c.moveTo(W * 0.06, groundY); c.lineTo(W * 0.94, groundY);
    c.lineTo(W * 0.84, groundY - W * 0.13); c.lineTo(W * 0.16, groundY - W * 0.13);
    c.closePath(); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.25)';
    c.lineWidth = 1;
    for (let i = 1; i < 7; i++) {
      const t = i / 7;
      c.beginPath();
      c.moveTo(W * (0.06 + 0.1 * t), groundY - W * 0.13 * t);
      c.lineTo(W * (0.94 - 0.1 * t), groundY - W * 0.13 * t); c.stroke();
    }
    // килевые блоки под корпусом
    c.fillStyle = '#4a3a28';
    for (const k of [0.32, 0.5, 0.68]) {
      c.fillRect(W * k, groundY - W * 0.155, W * 0.035, W * 0.03);
    }
    // корпус корабля на стапеле
    const hullY = groundY - W * 0.16;
    c.fillStyle = shade('#7a5433', 0.05);
    c.beginPath();
    c.moveTo(W * 0.18, hullY);
    c.quadraticCurveTo(W * 0.5, hullY + W * 0.14, W * 0.82, hullY);
    c.lineTo(W * 0.78, hullY - W * 0.2);
    c.quadraticCurveTo(W * 0.5, hullY - W * 0.1, W * 0.22, hullY - W * 0.2);
    c.closePath(); c.fill();
    // доски обшивки корпуса
    c.strokeStyle = 'rgba(40,28,16,0.5)'; c.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const t = i / 4;
      c.beginPath();
      c.moveTo(W * 0.2, hullY - W * 0.2 * (1 - t) + W * 0.02 * t);
      c.quadraticCurveTo(W * 0.5, hullY + W * 0.02 - W * 0.12 * (1 - t), W * 0.8, hullY - W * 0.2 * (1 - t) + W * 0.02 * t);
      c.stroke();
    }
    // рёбра шпангоутов: растут изнутри корпуса
    c.strokeStyle = shade('#7a5433', -0.25); c.lineWidth = Math.max(1, W * 0.022);
    for (let i = 0; i < 4; i++) {
      const t = i / 3;
      const px = W * (0.28 + i * 0.15);
      const top = hullY - W * (0.3 + Math.sin(t * Math.PI) * 0.12);
      c.beginPath();
      c.moveTo(px, hullY - W * 0.08);
      c.quadraticCurveTo(px - W * 0.02, hullY - W * 0.2, px, top);
      c.stroke();
    }
    // верхняя связь по бортам
    c.lineWidth = Math.max(1, W * 0.016);
    c.beginPath();
    c.moveTo(W * 0.26, hullY - W * 0.3);
    c.quadraticCurveTo(W * 0.5, hullY - W * 0.44, W * 0.75, hullY - W * 0.3);
    c.stroke();
    // кран-укосина
    c.strokeStyle = shade(pal.trim, -0.2); c.lineWidth = Math.max(2, W * 0.03);
    c.beginPath(); c.moveTo(W * 0.12, groundY - W * 0.14); c.lineTo(W * 0.16, groundY - W * 0.66); c.stroke();
    c.lineWidth = Math.max(1.5, W * 0.022);
    c.beginPath(); c.moveTo(W * 0.16, groundY - W * 0.66); c.lineTo(W * 0.48, groundY - W * 0.6); c.stroke();
    if (detail >= 1) {
      c.strokeStyle = 'rgba(30,26,20,0.7)'; c.lineWidth = Math.max(1, W * 0.01);
      c.beginPath(); c.moveTo(W * 0.44, groundY - W * 0.61); c.lineTo(W * 0.44, groundY - W * 0.5); c.stroke();
      gc.fillStyle = pal.glow;
      gc.fillRect(W * 0.6, hullY - W * 0.34, W * 0.05, W * 0.05); // сварка
      // стружка и обрезки досок
      c.strokeStyle = 'rgba(210,180,130,0.6)';
      c.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        c.beginPath();
        c.arc(W * (0.2 + i * 0.05), groundY - W * 0.015, W * 0.012, 0.5, 2.6);
        c.stroke();
      }
    }
  },

  // Коллектор: бетон с потёками, кирпичные отдушины, люк, ржавый выпуск.
  sewers(ctx) {
    const { c, gc, W, groundY, pal, detail, seed } = ctx;
    // бетонная плита с пятнами
    c.fillStyle = shade('#8a8880', -0.05);
    c.beginPath(); c.ellipse(W / 2, groundY - W * 0.06, W * 0.44, W * 0.19, 0, 0, 7); c.fill();
    c.fillStyle = shade('#8a8880', 0.12);
    c.beginPath(); c.ellipse(W / 2, groundY - W * 0.08, W * 0.44, W * 0.185, 0, 0, 7); c.fill();
    // пятна сырости на бетоне
    if (detail >= 1) {
      const R = rng(seed, 361);
      for (let i = 0; i < 6; i++) {
        c.fillStyle = R() < 0.5 ? 'rgba(70,90,60,0.16)' : 'rgba(50,50,46,0.16)';
        c.beginPath();
        c.ellipse(W * (0.15 + R() * 0.7), groundY - W * (0.04 + R() * 0.1), W * 0.06, W * 0.03, R() * 3, 0, 7);
        c.fill();
      }
    }
    // отстойник с зелёной дрянью и пузырями
    c.fillStyle = '#2f3a34';
    c.beginPath(); c.ellipse(W * 0.4, groundY - W * 0.12, W * 0.19, W * 0.09, 0, 0, 7); c.fill();
    c.fillStyle = 'rgba(96,132,110,0.55)';
    c.beginPath(); c.ellipse(W * 0.4, groundY - W * 0.13, W * 0.16, W * 0.07, 0, 0, 7); c.fill();
    if (detail >= 1) {
      c.fillStyle = 'rgba(160,200,170,0.4)';
      for (const [bx, by] of [[0.35, 0.135], [0.42, 0.12], [0.46, 0.14]]) {
        c.beginPath(); c.arc(W * bx, groundY - W * by, W * 0.006, 0, 7); c.fill();
      }
    }
    // люк с крестовиной
    c.fillStyle = shade(pal.trim, -0.15);
    c.beginPath(); c.ellipse(W * 0.68, groundY - W * 0.1, W * 0.1, W * 0.05, 0, 0, 7); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.4)'; c.lineWidth = Math.max(1, W * 0.01);
    c.beginPath(); c.ellipse(W * 0.68, groundY - W * 0.1, W * 0.06, W * 0.03, 0, 0, 7); c.stroke();
    c.lineWidth = Math.max(1, W * 0.008);
    c.beginPath();
    c.moveTo(W * 0.62, groundY - W * 0.1); c.lineTo(W * 0.74, groundY - W * 0.1);
    c.moveTo(W * 0.68, groundY - W * 0.128); c.lineTo(W * 0.68, groundY - W * 0.072);
    c.stroke();
    // выпускная труба с ржавыми кольцами: сидит НА плите, а не висит рядом
    box(c, W * 0.66, groundY - W * 0.3, W * 0.22, W * 0.16, W * 0.08, shade('#8a8880', -0.1));
    c.fillStyle = 'rgba(120,70,30,0.4)';
    for (const k of [0.3, 0.7]) {
      c.fillRect(W * 0.66 + W * 0.22 * k, groundY - W * 0.3, W * 0.014, W * 0.16);
    }
    c.fillStyle = '#20282a';
    c.beginPath(); c.ellipse(W * 0.66, groundY - W * 0.22, W * 0.045, W * 0.06, 0, 0, 7); c.fill();
    // подпорная стенка под трубой — она не может висеть в воздухе
    c.fillStyle = shade('#8a8880', -0.18);
    c.fillRect(W * 0.68, groundY - W * 0.15, W * 0.16, W * 0.08);
    if (detail >= 1) {
      c.strokeStyle = 'rgba(150,190,170,0.5)'; c.lineWidth = Math.max(1, W * 0.02);
      c.beginPath();
      c.moveTo(W * 0.62, groundY - W * 0.21);
      c.quadraticCurveTo(W * 0.54, groundY - W * 0.18, W * 0.5, groundY - W * 0.14);
      c.stroke();
      // кирпичные отдушины с шапками
      for (const k of [0.2, 0.3]) {
        c.fillStyle = shade(pal.trim, -0.2);
        c.fillRect(W * k, groundY - W * 0.3, W * 0.045, W * 0.24);
        c.strokeStyle = 'rgba(0,0,0,0.3)';
        c.lineWidth = 1;
        for (let s = 1; s < 4; s++) {
          c.beginPath();
          c.moveTo(W * k, groundY - W * 0.3 + W * 0.24 * s / 4);
          c.lineTo(W * k + W * 0.045, groundY - W * 0.3 + W * 0.24 * s / 4);
          c.stroke();
        }
        c.fillStyle = shade(pal.trim, 0.1);
        c.beginPath(); c.ellipse(W * k + W * 0.022, groundY - W * 0.3, W * 0.03, W * 0.014, 0, 0, 7); c.fill();
      }
    }
  },

  // Лаборатория: стеклянная лента с силуэтами оборудования, вытяжка.
  lab(ctx) {
    const { c, gc, W, groundY, pal, detail, seed } = ctx;
    const w = W * 0.72, x = (W - w) / 2, d = W * 0.15, h = W * 0.44, y = groundY - h;
    box(c, x, y, w, h, d, pal.wall);
    panelWall(c, x, y, w, h, pal.wall, rng(seed, 371), detail);
    // лента остекления: отражение + силуэты стоек и колб внутри
    const gx0 = x + w * 0.08, gy0 = y + h * 0.16, gw = w * 0.84, gh = h * 0.26;
    const g = c.createLinearGradient(gx0, gy0, gx0 + gw * 0.4, gy0 + gh);
    g.addColorStop(0, mixHex(pal.glass, '#d8ecf8', 0.5));
    g.addColorStop(1, shade(pal.glass, -0.2));
    c.fillStyle = g;
    c.fillRect(gx0, gy0, gw, gh);
    // силуэты оборудования за стеклом: стойки и колбы
    if (detail >= 1) {
      const R = rng(seed, 373);
      for (let i = 0; i < 4; i++) {
        const sx = gx0 + gw * (0.08 + i * 0.24);
        c.fillStyle = 'rgba(10,16,24,0.5)';
        c.fillRect(sx, gy0 + gh * 0.35, gw * 0.1, gh * 0.6);
        c.fillStyle = mixHex(pal.glass, '#7de3c8', 0.4);
        c.fillRect(sx + gw * 0.02, gy0 + gh * 0.2, gw * 0.05, gh * 0.18);
        if (R() < 0.6) {
          gc.fillStyle = pal.glow;
          gc.fillRect(sx + gw * 0.02, gy0 + gh * 0.2, gw * 0.05, gh * 0.18);
        }
      }
    }
    gc.fillStyle = pal.glow;
    gc.fillRect(gx0, gy0, gw, gh * 0.12);
    // переплёты
    c.strokeStyle = pal.trim; c.lineWidth = Math.max(1, W * 0.014);
    for (let i = 1; i < 4; i++) {
      c.beginPath();
      c.moveTo(gx0 + gw * i / 4, gy0); c.lineTo(gx0 + gw * i / 4, gy0 + gh); c.stroke();
    }
    c.strokeRect(gx0, gy0, gw, gh);
    // плоская кровля с парапетом и вытяжкой
    c.fillStyle = shade(pal.roof, 0.05);
    c.fillRect(x - w * 0.03, y - W * 0.035, w * 1.06 + d * 0.7, W * 0.04);
    c.fillStyle = 'rgba(255,255,255,0.16)';
    c.fillRect(x - w * 0.03, y - W * 0.035, w * 1.06 + d * 0.7, 1.2);
    box(c, x + w * 0.62, y - W * 0.22, w * 0.2, W * 0.2, W * 0.07, shade(pal.wall, -0.12));
    panelWall(c, x + w * 0.62, y - W * 0.22, w * 0.2, W * 0.2, shade(pal.wall, -0.12), rng(seed, 375), detail);
    c.fillStyle = shade(pal.trim, -0.1);
    c.fillRect(x + w * 0.66, y - W * 0.3, w * 0.05, W * 0.1);
    // сигнальная полоса-декаль у цоколя
    c.fillStyle = pal.accent;
    c.fillRect(x + w * 0.06, groundY - h * 0.08, w * 0.2, h * 0.035);
    c.fillStyle = 'rgba(20,16,10,0.6)';
    for (let i = 0; i < 4; i++) {
      c.fillRect(x + w * (0.08 + i * 0.045), groundY - h * 0.08, w * 0.02, h * 0.035);
    }
    // колба у входа
    if (detail >= 1) {
      c.fillStyle = 'rgba(180,240,220,0.85)';
      c.beginPath();
      c.moveTo(x + w * 0.16, groundY - W * 0.2);
      c.lineTo(x + w * 0.24, groundY - W * 0.2);
      c.lineTo(x + w * 0.28, groundY - W * 0.04);
      c.lineTo(x + w * 0.12, groundY - W * 0.04);
      c.closePath(); c.fill();
      c.strokeStyle = 'rgba(60,120,100,0.5)';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(x + w * 0.17, groundY - W * 0.16); c.lineTo(x + w * 0.23, groundY - W * 0.16);
      c.moveTo(x + w * 0.18, groundY - W * 0.1); c.lineTo(x + w * 0.22, groundY - W * 0.1);
      c.stroke();
      gc.fillStyle = '#7de3c8';
      gc.beginPath();
      gc.moveTo(x + w * 0.14, groundY - W * 0.12);
      gc.lineTo(x + w * 0.26, groundY - W * 0.12);
      gc.lineTo(x + w * 0.28, groundY - W * 0.04);
      gc.lineTo(x + w * 0.12, groundY - W * 0.04);
      gc.closePath(); gc.fill();
    }
    door(c, x + w * 0.44, groundY - h * 0.34, w * 0.16, h * 0.34, pal);
  },

  // Аэропорт: терминал со стеклянной стеной, диспетчерская, самолёт с рукавом.
  airport(ctx) {
    const { c, gc, W, groundY, pal, detail, seed } = ctx;
    const R = rng(seed, 381);
    // рулёжка
    c.fillStyle = 'rgba(60,62,66,0.55)';
    c.beginPath();
    c.moveTo(W * 0.02, groundY); c.lineTo(W * 0.98, groundY);
    c.lineTo(W * 0.88, groundY - W * 0.12); c.lineTo(W * 0.12, groundY - W * 0.12);
    c.closePath(); c.fill();
    c.strokeStyle = 'rgba(240,236,200,0.55)'; c.lineWidth = Math.max(1, W * 0.014);
    c.setLineDash([W * 0.06, W * 0.05]);
    c.beginPath(); c.moveTo(W * 0.08, groundY - W * 0.06); c.lineTo(W * 0.92, groundY - W * 0.06); c.stroke();
    c.setLineDash([]);
    // терминал
    const w = W * 0.62, x = W * 0.04, h = W * 0.24, y = groundY - W * 0.12 - h;
    box(c, x, y, w, h, W * 0.12, pal.wall);
    panelWall(c, x, y, w, h, pal.wall, rng(seed, 383), detail);
    // стеклянная стена с силуэтами людей внутри
    const gx0 = x + w * 0.06, gy0 = y + h * 0.28, gw = w * 0.88, gh = h * 0.4;
    const g = c.createLinearGradient(gx0, gy0, gx0 + gw * 0.4, gy0 + gh);
    g.addColorStop(0, mixHex(pal.glass, '#d8ecf8', 0.5));
    g.addColorStop(1, shade(pal.glass, -0.2));
    c.fillStyle = g;
    c.fillRect(gx0, gy0, gw, gh);
    if (detail >= 1) {
      c.fillStyle = 'rgba(10,16,24,0.45)';
      for (let i = 0; i < 4; i++) {
        const px = gx0 + gw * (0.1 + i * 0.22);
        c.fillRect(px, gy0 + gh * 0.4, gw * 0.03, gh * 0.55);
        c.beginPath(); c.arc(px + gw * 0.015, gy0 + gh * 0.32, gw * 0.016, 0, 7); c.fill();
      }
    }
    gc.fillStyle = pal.glow;
    gc.fillRect(gx0, gy0, gw, gh * 0.14);
    c.strokeStyle = pal.trim; c.lineWidth = 1;
    for (let i = 1; i < 6; i++) {
      c.beginPath();
      c.moveTo(gx0 + gw * i / 6, gy0); c.lineTo(gx0 + gw * i / 6, gy0 + gh); c.stroke();
    }
    c.fillStyle = shade(pal.roof, 0.05);
    c.fillRect(x - w * 0.03, y - W * 0.028, w * 1.06 + W * 0.08, W * 0.032);
    c.fillStyle = 'rgba(255,255,255,0.18)';
    c.fillRect(x - w * 0.03, y - W * 0.028, w * 1.06 + W * 0.08, 1.2);
    // вышка: ствол, кабина с лентой окон, радар
    const tx = W * 0.72, tw = W * 0.12, th = W * 0.62;
    box(c, tx, groundY - W * 0.12 - th, tw, th, W * 0.06, shade(pal.wall, -0.06));
    panelWall(c, tx, groundY - W * 0.12 - th, tw, th, shade(pal.wall, -0.06), rng(seed, 385), detail);
    c.fillStyle = shade(pal.trim, -0.1);
    c.fillRect(tx - tw * 0.22, groundY - W * 0.12 - th - W * 0.025, tw * 1.44, W * 0.025);
    c.fillStyle = pal.glass;
    c.fillRect(tx - tw * 0.16, groundY - W * 0.12 - th - W * 0.02, tw * 1.32, W * 0.1);
    gc.fillStyle = pal.glow;
    gc.fillRect(tx - tw * 0.16, groundY - W * 0.12 - th - W * 0.02, tw * 1.32, W * 0.1);
    c.fillStyle = shade(pal.roof, -0.1);
    c.fillRect(tx - tw * 0.2, groundY - W * 0.12 - th - W * 0.055, tw * 1.4, W * 0.04);
    // радар-планка
    c.strokeStyle = shade(pal.trim, -0.2);
    c.lineWidth = Math.max(1, W * 0.01);
    c.beginPath();
    c.moveTo(tx + tw / 2, groundY - W * 0.12 - th - W * 0.055);
    c.lineTo(tx + tw / 2, groundY - W * 0.12 - th - W * 0.09); c.stroke();
    c.fillStyle = '#c8d0d8';
    c.fillRect(tx + tw / 2 - W * 0.04, groundY - W * 0.12 - th - W * 0.105, W * 0.08, W * 0.016);
    c.fillStyle = '#ff5a4a';
    c.beginPath(); c.arc(tx + tw / 2, groundY - W * 0.12 - th - W * 0.12, W * 0.014, 0, 7); c.fill();
    gc.fillStyle = '#ff5a4a';
    gc.beginPath(); c.arc(tx + tw / 2, groundY - W * 0.12 - th - W * 0.12, W * 0.03, 0, 7); gc.fill();
    if (detail >= 1) {
      // самолёт: фюзеляж, хвост, окна-лента, крыло, телетрап
      const ax = W * 0.34, ay = groundY - W * 0.06;
      c.fillStyle = 'rgba(40,60,30,0.3)';
      c.beginPath(); c.ellipse(ax, ay + W * 0.028, W * 0.16, W * 0.012, 0, 0, 7); c.fill();
      c.fillStyle = '#e8eef4';
      c.beginPath(); c.ellipse(ax, ay, W * 0.16, W * 0.035, 0, 0, 7); c.fill();
      c.beginPath();
      c.moveTo(ax + W * 0.02, ay); c.lineTo(ax + W * 0.06, ay - W * 0.11);
      c.lineTo(ax + W * 0.1, ay - W * 0.11); c.lineTo(ax + W * 0.05, ay);
      c.closePath(); c.fill();
      c.fillStyle = pal.accent;
      c.fillRect(ax + W * 0.06, ay - W * 0.1, W * 0.035, W * 0.03);
      c.fillStyle = '#b8c2cc';
      c.beginPath();
      c.moveTo(ax - W * 0.13, ay); c.lineTo(ax - W * 0.16, ay - W * 0.07);
      c.lineTo(ax - W * 0.11, ay - W * 0.07); c.closePath(); c.fill();
      c.fillStyle = '#3a4a58';
      for (let i = 0; i < 5; i++) {
        c.beginPath();
        c.arc(ax - W * 0.08 + i * W * 0.035, ay - W * 0.012, W * 0.006, 0, 7); c.fill();
      }
      c.strokeStyle = '#c8d0d8';
      c.lineWidth = Math.max(1.5, W * 0.014);
      c.beginPath();
      c.moveTo(ax + W * 0.1, ay - W * 0.02); c.lineTo(ax + W * 0.2, ay - W * 0.05);
      c.lineTo(ax + W * 0.24, ay - W * 0.05); c.stroke();
    }
  },

  // Ядро ИИ: чёрный монолит, парящее кольцо, серверные стойки с огнями.
  aicore(ctx) {
    const { c, gc, W, groundY, pal, detail, seed } = ctx;
    const R = rng(seed, 391);
    // платформа с гравировкой
    c.fillStyle = shade(pal.wall, -0.2);
    c.beginPath(); c.ellipse(W / 2, groundY - W * 0.04, W * 0.4, W * 0.16, 0, 0, 7); c.fill();
    c.fillStyle = shade(pal.wall, 0.05);
    c.beginPath(); c.ellipse(W / 2, groundY - W * 0.07, W * 0.4, W * 0.16, 0, 0, 7); c.fill();
    c.strokeStyle = pal.trim; c.lineWidth = Math.max(1, W * 0.012);
    c.beginPath(); c.ellipse(W / 2, groundY - W * 0.07, W * 0.28, W * 0.11, 0, 0, 7); c.stroke();
    gc.strokeStyle = pal.glow; gc.lineWidth = Math.max(1, W * 0.02);
    gc.beginPath(); gc.ellipse(W / 2, groundY - W * 0.07, W * 0.28, W * 0.11, 0, 0, 7); gc.stroke();
    // серверные стойки у подножия: корпуса с огнями-диодами
    for (const k of [-0.34, 0.34]) {
      const rx = W / 2 + W * k - W * 0.05;
      c.fillStyle = '#1b2230';
      c.fillRect(rx, groundY - W * 0.16, W * 0.1, W * 0.13);
      c.strokeStyle = 'rgba(120,150,190,0.3)';
      c.lineWidth = 1;
      c.strokeRect(rx, groundY - W * 0.16, W * 0.1, W * 0.13);
      for (let i = 0; i < 3; i++) {
        const on = R() < 0.7;
        c.fillStyle = on ? mixHex(pal.glass, pal.glow, 0.7) : '#101620';
        c.fillRect(rx + W * 0.012, groundY - W * 0.15 + i * W * 0.032, W * 0.076, W * 0.018);
        if (on) {
          gc.fillStyle = pal.glow;
          gc.fillRect(rx + W * 0.012, groundY - W * 0.15 + i * W * 0.032, W * 0.076, W * 0.018);
        }
      }
    }
    // монолит: тёмный камень с гранями по свету
    const mw = W * 0.26, mx = (W - mw) / 2, mh = W * 0.62, my = groundY - W * 0.1 - mh;
    const g = c.createLinearGradient(mx, 0, mx + mw, 0);
    g.addColorStop(0, '#1b2230');
    g.addColorStop(0.4, '#2f3c50');
    g.addColorStop(1, '#141a24');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(mx + mw * 0.1, my); c.lineTo(mx + mw * 0.9, my);
    c.lineTo(mx + mw, groundY - W * 0.1); c.lineTo(mx, groundY - W * 0.1);
    c.closePath(); c.fill();
    // световая грань по левому ребру
    c.strokeStyle = 'rgba(200,230,255,0.25)';
    c.lineWidth = Math.max(1, W * 0.008);
    c.beginPath();
    c.moveTo(mx + mw * 0.1, my); c.lineTo(mx, groundY - W * 0.1); c.stroke();
    // дорожки данных
    c.strokeStyle = pal.trim; c.lineWidth = Math.max(1, W * 0.014);
    gc.strokeStyle = pal.glow; gc.lineWidth = Math.max(1, W * 0.022);
    for (let i = 0; i < 3; i++) {
      const yy = my + mh * (0.2 + i * 0.26);
      for (const t of [c, gc]) {
        t.beginPath();
        t.moveTo(mx + mw * 0.16, yy);
        t.lineTo(mx + mw * 0.5, yy - mh * 0.06);
        t.lineTo(mx + mw * 0.84, yy);
        t.stroke();
      }
    }
    // парящее кольцо
    c.strokeStyle = pal.accent; c.lineWidth = Math.max(2, W * 0.026);
    c.beginPath(); c.ellipse(W / 2, my - W * 0.05, W * 0.24, W * 0.08, 0, 0, 7); c.stroke();
    gc.strokeStyle = pal.glow; gc.lineWidth = Math.max(2, W * 0.045);
    gc.beginPath(); gc.ellipse(W / 2, my - W * 0.05, W * 0.24, W * 0.08, 0, 0, 7); gc.stroke();
    if (detail >= 1) {
      c.fillStyle = 'rgba(220,245,255,0.9)';
      c.beginPath(); c.arc(W / 2, my - W * 0.05, W * 0.045, 0, 7); c.fill();
      gc.fillStyle = pal.glow;
      gc.beginPath(); gc.arc(W / 2, my - W * 0.05, W * 0.08, 0, 7); gc.fill();
    }
  },

  spire() { /* Шпиль рисуется отдельно: он анимирован по стадиям постройки */ },
};

export { ARCH };
