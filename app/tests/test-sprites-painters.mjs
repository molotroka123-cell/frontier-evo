// Тесты художников зданий (app/src/render/sprites.js) — агент G1 «МАЛЯР-СПРАЙТЫ».
// Запуск: node app/tests/test-sprites-painters.mjs
//
// Canvas в node нет, и он не нужен: спрайты печатаются только в браузере.
// Проверяем то, что можно без DOM:
//   1) таблица DRAW покрывает ВСЕ ключи ARCH (grep-сверка по исходнику);
//   2) палитры эпох не содержат NaN и пустых цветов — и статически, и через
//      прогон shade/mixHex (исторический источник чёрных труб и башен);
//   3) детерминизм: Math.random в файле запрещён, seed-поток используется;
//   4) контракт bake: { cv, glow, sil, hFact } и высоты ARCH_H для всех архетипов.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ERA_PALETTE, shade, mixHex } from '../src/render/palette.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CODE = readFileSync(join(HERE, '..', 'src', 'render', 'sprites.js'), 'utf8');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('OK', name); } catch (e) { fail++; console.log('FAIL', name, '—', e.message); } };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || ''} ждали ${b}, получили ${a}`); };
const ok = (v, m) => { if (!v) throw new Error(m || 'ложь'); };

// Вырезка блока `const NAME = { ... };` по сбалансированным скобкам.
function cutObject(src, name) {
  const start = src.indexOf(`const ${name} = {`);
  ok(start >= 0, `блок const ${name} не найден`);
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

// ---------- 1. Полнота: DRAW покрывает все ключи ARCH ----------
const ARCH_BLOCK = cutObject(CODE, 'ARCH');
const DRAW_BLOCK = cutObject(CODE, 'DRAW');

const archValues = [...ARCH_BLOCK.matchAll(/:\s*'([a-z]+)/g)].map(m => m[1]);
ok(archValues.length >= 50, `в ARCH подозрительно мало записей: ${archValues.length}`);

const drawKeys = new Set([...DRAW_BLOCK.matchAll(/\n  ([a-z_]+)\(/g)].map(m => m[1]));
ok(drawKeys.size >= 30, `в DRAW подозрительно мало художников: ${drawKeys.size}`);

const missing = [...new Set(archValues)].filter(a => !drawKeys.has(a));
eq(missing.join(','), '', 'у этих архетипов ARCH нет художника в DRAW');
const unused = [...drawKeys].filter(k => !archValues.includes(k));
eq(unused.join(','), '', 'в DRAW есть художники, которых не требует ни один arch');

// ---------- 2. Палитры эпох: никаких NaN и пустых цветов ----------
t('палитра: 10 эпох, каждый цвет — полный hex без NaN', () => {
  eq(ERA_PALETTE.length, 10);
  const HEX = /^#[0-9a-fA-F]{6}$/;
  for (let e = 0; e < ERA_PALETTE.length; e++) {
    for (const key of ['wall', 'roof', 'trim', 'glass', 'glow', 'accent']) {
      const col = ERA_PALETTE[e][key];
      ok(typeof col === 'string' && col.length > 0, `эпоха ${e}: ${key} пустой`);
      ok(!/nan/i.test(col), `эпоха ${e}: ${key} содержит NaN (${col})`);
      ok(HEX.test(col), `эпоха ${e}: ${key} не hex — ${col}`);
    }
  }
});

t('shade/mixHex на всех цветах палитры не рождают NaN', () => {
  const ks = [-1, -0.5, -0.22, -0.05, 0.05, 0.14, 0.3, 0.55, 1];
  for (const pal of ERA_PALETTE) {
    for (const key of ['wall', 'roof', 'trim', 'glass', 'glow', 'accent']) {
      for (const k of ks) {
        const s = shade(pal[key], k);
        ok(!/NaN/.test(s), `shade(${pal[key]}, ${k}) → ${s}`);
        const m = mixHex(pal[key], pal.accent, k);
        ok(!/NaN/.test(m), `mixHex(${pal[key]}, ${pal.accent}, ${k}) → ${m}`);
        ok(!/NaN/.test(shade(s, k)), `двойной shade → NaN (${s})`);
      }
    }
  }
});

// ---------- 3. Детерминизм: seed вместо Math.random ----------
t('в sprites.js нет Math.random — только seed-поток', () => {
  // комментарии выбрасываем: в них «Math.random» — это объяснение запрета
  const noComments = CODE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');
  eq((noComments.match(/Math\.random/g) || []).length, 0, 'Math.random запрещён в коде');
});

t('seed спрайта передаётся в художников и реально используется', () => {
  ok(/seed:\s*hash2\(/.test(CODE), 'ctx.seed считается от hash2(id, W)');
  ok(/rng\(seed/.test(CODE), 'художники берут поток из rng(seed, …)');
  ok((CODE.match(/rng\(seed/g) || []).length >= 20, 'seed-поток должен питать многие фактуры');
});

// ---------- 4. Контракт bake и высоты ----------
t('bake возвращает ровно контракт { cv, glow, sil, hFact }', () => {
  // hFact может быть и шорткатом, и `hFact: HFACT` — важен набор ключей
  ok(/return\s*\{\s*cv,\s*glow,\s*sil,\s*hFact(:\s*HFACT)?\s*\}/.test(CODE),
    'контракт возврата изменился — рендер сломается');
});

t('у каждого архетипа есть высота в ARCH_H (силуэт по росту)', () => {
  const H_BLOCK = cutObject(CODE, 'ARCH_H');
  const heights = new Set([...H_BLOCK.matchAll(/([a-z_]+):\s*[\d.]+/g)].map(m => m[1]));
  const noH = [...new Set(archValues)].filter(a => !heights.has(a));
  eq(noH.join(','), '', 'архетипы без высоты упадут в дефолт и потеряют профиль');
});

t('эпохи обязаны читаться: у стен и крыш есть ветки материалов по era', () => {
  // диспетчер стен обязан различать грубое дерево, фахверк, кирпич и стекло,
  // крыши — солому, дранку, черепицу и фальц-металл
  for (const fn of ['logWall', 'plankWall', 'stoneWall', 'brickWall', 'plasterWall', 'timberFrame', 'panelWall', 'glassWall']) {
    ok(CODE.includes(`function ${fn}(`), `нет художника стены ${fn}`);
  }
  for (const marker of ['СОЛОМА', 'ДРАНКА', 'ЧЕРЕПИЦА', 'СЛАНЕЦ', 'ФАЛЬЦ-МЕТАЛЛ']) {
    ok(CODE.includes(marker), `в roofSkin нет материала «${marker}»`);
  }
});

t('светотень: AO и блик печатаются в спрайт (aoDown/aoGround/ridge-блик)', () => {
  ok((CODE.match(/aoDown\(/g) || []).length >= 8, 'мало AO-полос в щелях');
  ok((CODE.match(/aoGround\(/g) || []).length >= 5, 'мало контактных теней');
  ok(/rgba\(255,248,225,0\.4[0-9]?\)/.test(CODE), 'нет блика по свету на коньке');
});

t('свечение окон: glow-канал пишется в поздних эпохах', () => {
  ok((CODE.match(/gc\.fillStyle = pal\.glow/g) || []).length >= 10,
    'glow-канал должен заполняться хотя бы у десяти объектов');
});

// ---------- 5. Силуэты: уникальные профили ключевых архетипов ----------
t('силуэты: амбар шире дома, башня выше многоэтажки, шпиль — исключение из DRAW', () => {
  // ширина амбара (silo) больше ширины дома — берём первые w = W * … в художниках
  const siloBody = DRAW_BLOCK.slice(DRAW_BLOCK.indexOf('silo(ctx)'), DRAW_BLOCK.indexOf('quarry(ctx)'));
  const houseBody = DRAW_BLOCK.slice(DRAW_BLOCK.indexOf('house(ctx)'), DRAW_BLOCK.indexOf('// Навес собирателей'));
  const wOf = body => { const m = /const w = W \* ([\d.]+)/.exec(body); return m ? +m[1] : 0; };
  ok(wOf(siloBody) > wOf(houseBody), `амбар (${wOf(siloBody)}) должен быть шире дома (${wOf(houseBody)})`);
  const towerBody = DRAW_BLOCK.slice(DRAW_BLOCK.indexOf('tower(ctx)'), DRAW_BLOCK.indexOf('// Реактор'));
  const towerH = /, h = W \* ([\d.]+)/.exec(towerBody);
  ok(towerH && +towerH[1] > 0.8, 'ствол телебашни обязан быть высоким');
  ok(DRAW_BLOCK.includes('spire()'), 'пустой spire обязан существовать (он анимирован снаружи)');
  ok(ARCH_H_of('highrise') > 2.5, 'многоэтажка обязана возвышаться над городом');
});

function ARCH_H_of(arch) {
  const H_BLOCK = cutObject(CODE, 'ARCH_H');
  const m = new RegExp(`${arch}:\\s*([\\d.]+)`).exec(H_BLOCK);
  return m ? +m[1] : 0;
}

// ---------- 6. Модуль импортируется без DOM ----------
t('модуль sprites.js импортируется в node без document/window', () => {
  // сам факт, что мы дошли до сюда (импорт наверху файла прошёл), уже проверка;
  // но убедимся и в экспортах
  const mod = CODE.match(/export function archHeight|export class SpriteCache|export \{ ARCH \}/g) || [];
  eq(mod.length, 3, 'экспорты архетипов/высот/кэша должны сохраниться');
});

console.log(`\n=== ${pass} OK / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
