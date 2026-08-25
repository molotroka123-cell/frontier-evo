// tools/shot-town.mjs — крупный план ВРАЖЕСКОГО города в четырёх состояниях
// (день / ночь / зима / война). Отдельный инструмент и отдельный порт: общий
// tools/shot.mjs занимает 8791 и пишет в shots/, здесь порт 8317 и свой каталог,
// чтобы съёмка не сталкивалась с чужой.
//
// Запуск: node tools/shot-town.mjs [суффикс] — суффикс попадает в имя файла
// (before/after), чтобы кадры «до» и «после» правки лежали рядом.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TAG = process.argv[2] || 'now';
const OUTDIR = join(ROOT, 'shots', 'town-' + TAG);
const PORT = 8317;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.json': 'application/json',
};

// Сцена: наводим камеру на поселения чужой фракции и доводим мир до нужного
// состояния. Всё через прямую правку полей sim — это съёмочный стенд, а не игра.
const SETUP = (cfg) => {
  const F = window.__frontier;
  const s = F.sim;
  s.paused = true;
  // Панели HUD закрывают половину кадра — для приёмки арта нужен чистый холст.
  const st = document.createElement('style');
  st.textContent = 'body > *:not(#game):not(style){display:none !important}';
  document.head.appendChild(st);
  // Народ фракций растёт медленно; для картины города поднимаем P напрямую —
  // ступень (tier) в settlement_view считается именно от него.
  for (const f of s.factions) { if (f.alive) f.P = Math.max(f.P, cfg.P); }
  s.eraIndex = cfg.era | 0;
  s.seasonIdx = cfg.season | 0;
  s.dayTime = cfg.dayTime;
  s.weather = cfg.weather || 'sun';
  if (cfg.war) {
    // Открытая война с игроком: settlement_view читает реестр sim.wars.
    const f = s.factions.find(x => x.alive);
    s.wars = [{ fid: f.id, day: s.day }];
    // Свежий след набега рядом с поселением — дым над руиной.
    const st = f.settlements[0];
    s.log.push({ text: `⚔ Набег на (${st.x | 0},${st.y | 0})`, day: s.day });
  } else {
    s.wars = []; s.aiWars = [];
  }
  // Ищем живую фракцию с поселениями.
  const f = s.factions.find(x => x.alive && x.settlements && x.settlements.length);
  const list = f.settlements;
  const a = list[0];
  if (cfg.row) {
    // Ряд поселений ОДНОГО яруса (все не-столицы) в шахматном порядке: ровно
    // тот случай, ради которого затевалось разнообразие — соседи одного яруса
    // не должны быть копиями друг друга.
    const near = s.world.startX, ny = a.y;
    for (let i = 0; i < cfg.row; i++) {
      list.push({ x: (a.x | 0) + 5 + i * 5, y: (ny | 0) + (i % 2 ? 3 : 0), capital: false });
    }
    void near;
  }
  const b = list[list.length - 1];
  F.renderer.cam.x = (a.x + b.x) / 2 + 0.5;
  F.renderer.cam.y = (a.y + b.y) / 2 + 0.5;
  F.renderer.cam.zoom = cfg.zoom;
  return {
    seed: s.world.seed,
    fac: f.def.name,
    color: f.def.color,
    n: list.length,
    cam: [F.renderer.cam.x, F.renderer.cam.y],
    towns: list.slice(0, 8).map(t => [t.x, t.y]),
  };
};

const SHOTS = {
  // Полдень: видно материал, силуэт и знамя.
  day:    { season: 1, dayTime: 0.5,  weather: 'sun',  P: 120, era: 4, zoom: 3.2 },
  // Глубокая ночь: проверяем, не проваливается ли город в темноту.
  night:  { season: 1, dayTime: 0.02, weather: 'sun',  P: 120, era: 4, zoom: 3.2 },
  // Зима: снег на земле — белеют ли крыши.
  winter: { season: 3, dayTime: 0.5,  weather: 'snow', P: 120, era: 4, zoom: 3.2 },
  // Война: открытый реестр войн плюс свежий набег.
  war:    { season: 1, dayTime: 0.5,  weather: 'sun',  P: 120, era: 4, zoom: 3.2, war: 1 },
  // Ряд поселений одного яруса — видно, клоны или нет.
  row:    { season: 1, dayTime: 0.5,  weather: 'sun',  P: 130, era: 2, zoom: 2.0, row: 4 },
};

const server = createServer(async (req, res) => {
  try {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const path = join(ROOT, url === '/' ? '/app/index.html' : url);
    const buf = await readFile(path);
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(buf);
  } catch { res.writeHead(404); res.end('404'); }
});
await new Promise(r => server.listen(PORT, r));
await mkdir(OUTDIR, { recursive: true });

const EXE = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';
const browser = await chromium.launch({ executablePath: EXE, args: ['--enable-gpu', '--use-gl=swiftshader'] });

const want = process.argv.slice(3);
const names = want.length ? want : Object.keys(SHOTS);
for (const name of names) {
  const cfg = SHOTS[name];
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await page.goto(`http://127.0.0.1:${PORT}/app/index.html#autostart-seed=4242`, { waitUntil: 'load' });
  await page.waitForTimeout(2200);
  const info = await page.evaluate(SETUP, cfg);
  await page.waitForTimeout(1400);
  const file = join(OUTDIR, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`${name.padEnd(7)} → ${file}  сид=${info.seed} фракция=${info.fac} (${info.color}) поселений=${info.n} камера=${info.cam.map(v => v.toFixed(1))} ошибок=${errs.length}`);
  for (const e of errs.slice(0, 4)) console.log('   ! ' + e.slice(0, 200));
  await ctx.close();
}
await browser.close();
server.close();
