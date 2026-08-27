// ui/tile_sprites.js — настоящий спрайт постройки в плитке меню вместо эмодзи.
//
// ЗАЧЕМ. Аудит назвал плитки построек главной причиной, по которой игра
// выглядит на десять долларов: 🔥, синий кран, розовая больница —
// системные эмодзи внутри графитовой рамки, при том что рядом лежат
// нарисованные спрайты зданий. Здесь они и подставляются.
//
// КАК. SpriteCache печёт спрайт в offscreen-canvas; canvas.toDataURL() даёт
// готовую картинку для <img> в плитке. Печём ОДИН раз на id (эпоха берётся
// стартовая для здания — плитка показывает «каким оно будет»), кэшируем
// строку data-URL. В кадре игры это не участвует: провайдер зовётся только
// при перерисовке панели, а панель перерисовывается по действию игрока.
//
// БЕЗОПАСНОСТЬ headless. В node canvas подставной, toDataURL может вернуть
// заглушку или бросить — тогда провайдер отдаёт null, и building_drawer
// молча оставляет эмодзи. Поэтому смена ничего не ломает в тестах: там
// провайдер вообще не регистрируется.

import { BUILDINGS, BUILDING_ERA_IDX } from '../core/data.js';

// id -> data-URL (или null, если спечь не удалось — второй раз не пытаемся).
const CACHE = new Map();

// Провайдер спрайтов задаёт hud, передавая свой SpriteCache. Пока не задан —
// плитки остаются на эмодзи (ровно как было).
let CACHEREF = null;
export function setTileSpriteCache(spriteCache) {
  CACHEREF = spriteCache || null;
  CACHE.clear();     // сменилось качество/кэш — старые data-URL протухли
}

// Data-URL спрайта постройки для плитки, либо null (эмодзи-фолбэк).
export function tileSpriteUrl(id) {
  if (!CACHEREF) return null;
  if (CACHE.has(id)) return CACHE.get(id);
  const def = BUILDINGS[id];
  if (!def) { CACHE.set(id, null); return null; }
  let url = null;
  try {
    const era = BUILDING_ERA_IDX[id] | 0;
    const spr = CACHEREF.building(id, def, era, 1);
    if (spr && spr.cv && typeof spr.cv.toDataURL === 'function') {
      const u = spr.cv.toDataURL('image/png');
      // Заглушка headless-канваса возвращает короткую фикцию — на неё
      // не полагаемся: реальная PNG data-URL всегда длиннее полусотни байт.
      if (typeof u === 'string' && u.startsWith('data:image') && u.length > 64) url = u;
    }
  } catch { url = null; }
  CACHE.set(id, url);
  return url;
}
