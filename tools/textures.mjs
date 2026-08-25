// tools/textures.mjs — конвейер фототекстур земли для «ФРОНТИРА».
// Запуск: node tools/textures.mjs [путь-к-сырью]
// Берёт вырезки из сырьевых PNG (assets/HF Texture, 2.1 ГБ, в git НЕ входят),
// даунскейлит через playwright-canvas до 384px по большей стороне, жмёт JPEG
// q0.78 и кладёт в art/tex/<роль>.jpg. Бюджет: сумма ≤ 1.6 МБ, иначе второй
// проход 320px/q0.72 — паттерн ложится с альфой ≤ 0.35, лёгкая замыленность
// ему не вредит, а вес бандла критичен.
//
// Почему кропы, а не целые картинки: сырьё — каттаты зданий на хромакее,
// бесшовной земли в наборе нет. Роли собираются из чистых областей (дворы,
// крыши, скалы, вода), проверенных вручную по превью; координаты — нормаль-
// зованные [x, y, w, h] от размера исходника, поэтому переживают пересохранение.
import { chromium } from 'playwright';
import { readdirSync, writeFileSync, mkdirSync, statSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'art', 'tex');

// Сырьё ищем в трёх местах: явный аргумент, папка рядом с worktree и путь
// основного репозитария. Сырьё в git не входит, поэтому на чистом клоне
// конвейер честно упадёт с подсказкой, а не молча сделает пустую папку.
const SRC_CANDIDATES = [
  process.argv[2],
  join(ROOT, 'assets', 'HF Texture'),
  'C:/Project-Evo-claude-unreal-rise-of-nations-game-vzzl9h/assets/HF Texture',
];
let SRC_DIR = null;
for (const c of SRC_CANDIDATES) {
  if (c && (() => { try { statSync(join(c, 'hf_20260730_175225_39569e71-fcfd-4d5c-af49-eb960cfbaff0.png')); return true; } catch { return false; } })()) { SRC_DIR = c; break; }
}
if (!SRC_DIR) {
  console.error('НЕТ СЫРЬЯ: передайте путь к папке «HF Texture» аргументом.');
  process.exit(1);
}

// Роль → [файл, кроп (доли 0..1)]. 12 ролей ровно под потребности рендера:
// земля (трава/лес/грязь/песок/снег/скалы/вода) и постройки (дерево, тес,
// черепица, камень, ткань). Дубли источников сознательны: шкура #051 даёт и
// дерево настила, и ткань — других чистых областей в сырье нет.
const ROLES = {
  grass:       ['hf_20260731_084246_237cb9bf-a8fd-4e39-819c-9860f300be5b.png', [0.30, 0.42, 0.16, 0.16]],
  forest_floor:['hf_20260731_085156_d58a36f5-a1e8-413b-9701-0e764750392b.png', [0.34, 0.685, 0.26, 0.105]],
  dirt:        ['hf_20260730_175432_263ba370-72b3-4e50-b2ed-98168401c4b9.png', [0.60, 0.66, 0.18, 0.10]],
  sand:        ['hf_20260730_175858_76674d03-cd02-4377-a6bf-ea9b8d2117d0.png', [0.72, 0.78, 0.22, 0.14]],
  snow:        ['hf_20260731_090207_32127256-1bca-4456-b8fc-321c1f0336e6.png', [0.14, 0.765, 0.16, 0.13]],
  hill_rock:   ['hf_20260730_175844_e11f273c-93f6-49fd-a165-6dd6a7370a99.png', [0.19, 0.33, 0.12, 0.09]],
  water:       ['hf_20260730_181354_0461ead7-f092-4591-bb09-36b33c07697e.png', [0.15, 0.685, 0.20, 0.09]],
  wood_wall:   ['hf_20260731_082137_d8f987ec-8f1c-4129-b190-769a8e89377a.png', [0.14, 0.66, 0.34, 0.125]],
  thatch_roof: ['hf_20260730_181520_60e0695d-0613-4198-9f36-b2c69259b7af.png', [0.117, 0.28, 0.527, 0.36]],
  tile_roof:   ['hf_20260730_180311_4b9668aa-3e8d-4e2b-959c-008138639f13.png', [0.26, 0.155, 0.54, 0.22]],
  stone_wall:  ['hf_20260730_180753_2f333194-5717-4046-b07d-85cb3e9b17d1.png', [0.57, 0.645, 0.41, 0.31]],
  cloth:       ['hf_20260731_082137_d8f987ec-8f1c-4129-b190-769a8e89377a.png', [0.46, 0.09, 0.27, 0.25]],
};

const BUDGET = 1.6 * 1024 * 1024; // суммарный вес art/tex, дальше — второй проход
const PASSES = [
  { side: 384, q: 0.78 },  // основной: читаемая фактура при альфе ≤ 0.35
  { side: 320, q: 0.72 },  // запасной: если первый не влез в бюджет
];

// Страница-помощник открывается по file://: canvas с заливкой file://-картинок
// иначе помечается tainted и toDataURL кидает SecurityError.
const HELPER = join(tmpdir(), 'frontier-tex-page.html');
writeFileSync(HELPER, '<!doctype html><canvas id="c"></canvas>', 'utf8');

const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const page = await browser.newPage();
await page.goto('file://' + HELPER.replace(/\\/g, '/'));

// Один проход: все роли → JPEG. Возвращает карту роль→размер файла.
async function bake(pass) {
  const sizes = {};
  for (const [role, [file, [nx, ny, nw, nh]]] of Object.entries(ROLES)) {
    const res = await page.evaluate(async (args) => {
      const { url, nx, ny, nw, nh, side, q } = args;
      const img = await new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => rej(new Error('не открылся ' + url));
        im.src = url;
      });
      const c = document.getElementById('c');
      const g = c.getContext('2d');
      // Кроп в пикселях исходника. Области в каттатах окружены хромакеем и
      // граничат с ним по диагонали, поэтому после первой отрисовки считаем
      // долю хромакея и при превышении подрезаем кроп на 5% с каждой стороны,
      // до 9 раз. Так чистые текстуры получаются детерминированно, без ручной
      // подгонки каждого пикселя.
      let cx = nx, cy = ny, cw = nw, ch = nh, frac = 1, tries = 0;
      let dataUrl = '';
      while (tries < 9) {
        const px = Math.round(cx * img.naturalWidth), py = Math.round(cy * img.naturalHeight);
        const pw = Math.max(1, Math.round(cw * img.naturalWidth)), ph = Math.max(1, Math.round(ch * img.naturalHeight));
        const s = side / Math.max(pw, ph);
        c.width = Math.max(1, Math.round(pw * s));
        c.height = Math.max(1, Math.round(ph * s));
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high'; // иначе при 10-кратном даунскейле алиасинг
        g.drawImage(img, px, py, pw, ph, 0, 0, c.width, c.height);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        // Хромакей в этом арт-сете двух видов: малиновый (≈245,0,119) и
        // фиолетово-маджентовый (≈200,60,220), плюс розовые полутони на их
        // границах. Общее у них — красный сильно перевешивает зелёный, а
        // синий не проваливается ниже (у оранжевого черепицы и коричневого
        // дерева синий как раз проваливается, поэтому они не ловятся).
        // Шаг 8 байт (каждый 2-й пиксель) — чтобы не пропустить тонкую кромку.
        // Порог — доля, а не факт: одиночные тёмно-бордовые тени внутри
        // легального материала не должны заставлять резать картинку.
        let hits = 0;
        for (let i = 0; i < d.length; i += 8) {
          const r = d[i], gr = d[i + 1], b = d[i + 2];
          if (r > 140 && r - gr > 80 && b - gr > 30) hits++;
        }
        frac = hits / (d.length / 8);
        if (frac <= 0.001) { dataUrl = c.toDataURL('image/jpeg', q); break; }
        cx += cw * 0.05; cy += ch * 0.05; cw -= cw * 0.10; ch -= ch * 0.10;
        tries++;
      }
      if (frac > 0.001) dataUrl = c.toDataURL('image/jpeg', q); // сдаёмся честно
      return { dataUrl, frac, tries };
    }, {
      url: 'file:///' + SRC_DIR.replace(/\\/g, '/') + '/' + encodeURIComponent(file),
      nx, ny, nw, nh, side: pass.side, q: pass.q,
    });
    if (res.frac > 0.02) console.log(`  ! ${role}: хромакей не вычистился подрезкой (${(res.frac * 100).toFixed(1)}%) — поправьте кроп`);
    else if (res.tries > 0) console.log(`  · ${role}: кроп подрезан на ${res.tries}×5% (хромакей вычищен)`);
    mkdirSync(OUT_DIR, { recursive: true });
    const dst = join(OUT_DIR, role + '.jpg');
    writeFileSync(dst, Buffer.from(res.dataUrl.split(',')[1], 'base64'));
    sizes[role] = statSync(dst).size;
  }
  return sizes;
}

let sizes = null, pass = PASSES[0];
for (const p of PASSES) {
  sizes = await bake(p);
  const total = Object.values(sizes).reduce((a, b) => a + b, 0);
  console.log(`\nПроход ${p.side}px/q${p.q}: суммарно ${(total / 1048576).toFixed(2)} МБ (бюджет 1.60 МБ)`);
  if (total <= BUDGET) { pass = p; break; }
  // Не влезли — стираем и перекатываем тем же составом, чтобы на диске
  // не осталось смеси двух проходов (тест сверяет сумму по факту).
  console.log('Бюджет превышен — перережем на 320px/q0.72.');
  for (const f of Object.keys(ROLES)) rmSync(join(OUT_DIR, f + '.jpg'), { force: true });
  pass = p;
}

const total = Object.values(sizes).reduce((a, b) => a + b, 0);
console.log('\nроль          КБ');
for (const [role, b] of Object.entries(sizes)) {
  console.log(role.padEnd(14) + (b / 1024).toFixed(1));
}
console.log('—'.repeat(22));
console.log('ИТОГО'.padEnd(14) + (total / 1024).toFixed(1) + ` КБ  (${pass.side}px/q${pass.q})`);
console.log(total <= BUDGET ? 'БЮДЖЕТ: ок (≤ 1.6 МБ)' : 'БЮДЖЕТ: ПРЕВЫШЕН');

await browser.close();
if (total > BUDGET) process.exit(2);
