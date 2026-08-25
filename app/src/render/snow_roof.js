// render/snow_roof.js — снежные шапки на печёных спрайтах построек.
//
// ЗАЧЕМ. Зимой земля, кусты и хвоя белеют (TERRAIN[3], vegetation.js), а
// постройки оставались летними: SpriteCache печёт спрайт по ключу
// «id|эпоха|размер|детализация», сезона в ключе нет. Посреди снега стоял
// город с летними крышами — сразу видно, что снег «наклеен» на землю, а не
// лежит в мире.
//
// КАК. Снег не перерисовывает спрайт и ничего не знает про его архетип: он
// берёт готовый чёрный силуэт (spr.sil, его печёт sprites.js) и вырезает из
// него ВЕРХНЮЮ КРОМКУ — область «силуэт минус тот же силуэт, сдвинутый вниз».
// Получается белый кант ровно по обращённым вверх граням: конёк, скаты, верх
// трубы, зубцы башни. Никакого getImageData и ни одного градиента —
// две операции композитинга на выпечку.
//
// ЦЕНА. Выпечка одна на (id, эпоха, детализация) и живёт в кэше на 32 записи;
// в кадре — один drawImage поверх спрайта. Пустой холст (снег не на что
// класть) не кэшируется как канвас: возвращается null, и вызывающий код
// просто рисует спрайт как летом.

const CAP = new Map();
const CAP_MAX = 32;

// Для тестов дисциплины кэша.
export function snowCacheSize() { return CAP.size; }
export function clearSnowCache() { CAP.clear(); }

// Верхняя кромка силуэта толщиной d, залитая цветом col.
// Геометрия: «силуэт МИНУС тот же силуэт, сдвинутый вниз на d» — остаются
// ровно обращённые вверх грани, то есть скаты, коньки и верх трубы.
function rim(sil, d, col) {
  const W = sil.width, H = sil.height;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  c.drawImage(sil, 0, 0);
  c.globalCompositeOperation = 'destination-out';
  c.drawImage(sil, 0, d);
  c.globalCompositeOperation = 'source-in';
  c.fillStyle = col;
  c.fillRect(0, 0, W, H);
  return cv;
}

// Возвращает канвас со снежной кромкой спрайта либо null, если среда не умеет
// печь (headless без document) или у спрайта нет силуэта.
export function snowRim(spr, key) {
  if (!spr || !spr.sil) return null;
  if (typeof document === 'undefined' || !document.createElement) return null;
  const hit = CAP.get(key);
  if (hit !== undefined) return hit;

  let out = null;
  try {
    const W = spr.sil.width | 0, H = spr.sil.height | 0;
    if (W > 0 && H > 0) {
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const c = cv.getContext('2d');
      // Два слоя, а не один: широкий и полупрозрачный — это сам сугроб на
      // скате, узкий и яркий — освещённый гребень. Один плоский кант читается
      // как случайная белая полоска, два дают объём.
      c.drawImage(rim(spr.sil, Math.max(2, Math.round(H * 0.085)), 'rgba(228,238,244,0.72)'), 0, 0);
      c.drawImage(rim(spr.sil, Math.max(1, Math.round(H * 0.032)), 'rgba(252,254,255,0.95)'), 0, 0);
      out = cv;
    }
  } catch { out = null; }

  if (CAP.size >= CAP_MAX) CAP.delete(CAP.keys().next().value);
  CAP.set(key, out);
  return out;
}
