// tools/build.mjs — сборка однофайлового билда frontier.html из app/.
// Запуск: node tools/build.mjs
// Результат: frontier.html в корне — самодостаточный файл, работает по file:// без сети.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML_IN = join(ROOT, 'app', 'index.html');
const ENTRY = join(ROOT, 'app', 'src', 'main.js');
const OUT = join(ROOT, 'frontier.html');
const MARKER = '<script type="module" src="src/main.js"></script>';

// --- перепись нарисованного арта -------------------------------------------
// Рендер обязан просить только те спрайты, которые физически есть: каждый
// недостающий файл — красная 404 в консоли, а приёмка требует нуля ошибок.
// Достаточно положить buildings_<id>.png в app/assets/sprites/ и пересобрать.
function refreshArtList() {
  let files = [];
  try { files = readdirSync(join(ROOT, 'app', 'assets', 'sprites')); } catch { /* папки нет — арта нет */ }
  const ids = files
    .filter(f => /^buildings_.+\.png$/i.test(f))
    .map(f => f.replace(/^buildings_/i, '').replace(/\.png$/i, ''))
    .sort();
  const path = join(ROOT, 'app', 'src', 'render', 'artpack_list.js');
  const src = readFileSync(path, 'utf8');

  // Пустая папка НЕ значит «арта нет в игре». Спрайты весят 23 МБ и лежат рядом
  // с опубликованной страницей, а не в репозитории. Если строить список строго
  // по диску, сборка на чистом клоне молча выключает весь нарисованный арт —
  // ровно это и случилось: собранный билд перестал грузить 42 картинки, хотя
  // на сайте они лежат и отдаются. Поэтому при пустой папке берём заявленный
  // MANIFEST: несуществующий файл рендер и так переживает (im.onerror оставляет
  // процедурную отрисовку), а вот молча потерять весь арт — нельзя.
  let list = ids;
  if (!ids.length) {
    const decl = readFileSync(join(ROOT, 'app', 'src', 'render', 'artpack.js'), 'utf8');
    const m = decl.match(/export const MANIFEST = \[([\s\S]*?)\]/);
    if (m) list = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
    if (list.length) console.log(`  арт: папка спрайтов пуста, беру MANIFEST — ${list.length} шт.`);
  }

  const line = `export const AVAILABLE = [${list.map(i => `'${i}'`).join(', ')}];`;
  const next = src.replace(/export const AVAILABLE = \[[^\]]*\];/, line);
  if (next !== src) writeFileSync(path, next, 'utf8');
  return list.length;
}
const artCount = refreshArtList();

const res = await build({
  entryPoints: [ENTRY],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  charset: 'utf8',
  legalComments: 'none',
  minify: false,
  write: false,
});

const js = res.outputFiles[0].text;

// --- вшивание арта в сам файл ------------------------------------------------
// Без этого frontier.html ищет картинки рядом с собой: на сайте они лежат и
// отдаются, а скачанный одиночный файл остаётся с процедурными зданиями.
// Ключ --embed-art печёт спрайты прямо в HTML — файл тяжелеет, зато работает
// офлайн ровно так же, как на сайте.
function embedArt() {
  if (!process.argv.includes('--embed-art')) return '';
  const dir = join(ROOT, 'app', 'assets', 'sprites');
  let files = [];
  try { files = readdirSync(dir); } catch { return ''; }
  const pics = files.filter(f => /^buildings_.+\.(png|webp)$/i.test(f)).sort();
  if (!pics.length) return '';

  const map = {};
  let bytes = 0;
  for (const f of pics) {
    const id = f.replace(/^buildings_/i, '').replace(/\.(png|webp)$/i, '');
    const buf = readFileSync(join(dir, f));
    bytes += buf.length;
    const mime = /\.webp$/i.test(f) ? 'image/webp' : 'image/png';
    map[id] = `data:${mime};base64,${buf.toString('base64')}`;
  }
  console.log(`  арт вшит в файл: ${pics.length} шт., ${(bytes / 1048576).toFixed(1)} МБ исходных`);
  // Рендер читает window.__FRONTIER_ART__ раньше, чем просит файл с диска.
  return `<script>window.__FRONTIER_ART__=${JSON.stringify(map)};</script>\n`;
}
const artTag = embedArt();

const html = readFileSync(HTML_IN, 'utf8');
if (!html.includes(MARKER)) {
  console.error('ОШИБКА: в app/index.html не найдена строка подключения модуля:', MARKER);
  process.exit(1);
}
// </script> внутри строк JS разорвал бы тег — экранируем на всякий случай.
const safeJs = js.replace(/<\/script>/gi, '<\\/script>');

// Тема подключена линком ради dev-режима, но frontier.html обязан остаться
// самодостаточным (file:// без сети) — поэтому в билде линк заменяется
// инлайн-стилем с тем же содержимым.
const THEME_LINK = '<link rel="stylesheet" href="src/ui/theme.css">';
let themed = html;
try {
  const css = readFileSync(join(ROOT, 'app', 'src', 'ui', 'theme.css'), 'utf8');
  if (!html.includes(THEME_LINK)) {
    console.error('ОШИБКА: в app/index.html не найдена ссылка на тему:', THEME_LINK);
    process.exit(1);
  }
  themed = html.replace(THEME_LINK, `<style>\n${css}\n</style>`);
} catch { /* файла темы нет — собираем как есть */ }

// --- скин меню-панели --------------------------------------------------------
// Запись добавлена по правилам esbuild-сборки этого проекта, ровно как у темы выше:
// 1) JS скина здесь НЕ перечисляется вручную — проект собирает bundle от
//    единственной точки входа ENTRY (app/src/main.js), и модуль попадает в код
//    через обычный import './menuskin.js' в ui/hud.js. Отдельного «списка
//    источников» build.mjs не ведёт: всё, что достижимо из ENTRY, esbuild
//    тянет сам, остальное в билде не нужно.
// 2) CSS скина инлайнится по той же причине, что theme.css: билд обязан
//    работать по file:// без сети и без соседних файлов. Линка на menuskin.css
//    в app/index.html нет и не будет (index.html — dev-режим), поэтому стиль
//    ставится здесь отдельным тегом <style id="msk-inline"> рядом с кодом игры.
//    Идентификатор msk-inline — договор с menuskin.js: его ensureCss() видит
//    этот стиль и НЕ создаёт <link> на файл, которого рядом с frontier.html
//    не существует (иначе каждый запуск был бы с тихой красной 404).
const MSK_CSS = join(ROOT, 'app', 'src', 'ui', 'menuskin.css');
let mskTag = '';
try {
  const mskCss = readFileSync(MSK_CSS, 'utf8');
  // Закрывающий </style> внутри CSS разорвал бы тег так же, как </script>
  // внутри JS выше, — экранируем тем же способом.
  const safeCss = mskCss.replace(/<\/style>/gi, '<\\/style>');
  mskTag = `<style id="msk-inline">\n${safeCss}\n</style>\n`;
} catch { /* файла скина нет — играем без него, как и в dev-режиме */ }

writeFileSync(OUT, themed.replace(MARKER, `${artTag}${mskTag}<script>\n${safeJs}\n</script>`), 'utf8');

const kb = (statSync(OUT).size / 1024).toFixed(0);
console.log(`frontier.html собран: ${kb} КБ (bundle ${(js.length / 1024).toFixed(0)} КБ) · нарисованных спрайтов: ${artCount} · скин меню: ${mskTag ? 'инлайн' : 'нет файла'}`);
