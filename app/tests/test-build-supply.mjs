// Тесты подвоза материалов (build_supply.js). Запуск: node app/tests/test-build-supply.mjs
//
// Модуль — отчётник: он обязан быть чистым (ни одной мутации sim),
// детерминированным (один сид — один отчёт), уметь приоритет столицы,
// держать потолок одновременных доставок и не падать от мусорных записей.
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/core/simulation.js';
import { BUILDINGS } from '../src/core/data.js';
import {
  supplyNewDay,
  SUPPLY_SEED_SALT, DELIVERIES_MAX, CAPITAL_RADIUS,
  PORTER_BASE_SPEED, SPEED_CAP_FLOOR, EVENT_EVERY_DAYS,
} from '../src/core/systems/build_supply.js';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('OK ', name); } catch (e) { fail++; console.log('FAIL', name, '—', e.message); } };
const ok = (c, m) => { if (!c) throw new Error(m || 'проверка не прошла'); };
const inRange = (v, lo, hi, m) => ok(typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi, `${m}: ${v} вне [${lo}..${hi}]`);

// Настоящая партия: модуль читает buildings/villagers/world ядра, подделывать
// их значило бы проверять не то.
function game(seed = 4242) {
  const s = new Simulation(seed, {});
  s.execCommand('godmode');
  s.execCommand('unlockall');
  for (const r of ['wood', 'stone', 'gold', 'steel', 'food']) s.execCommand(`give ${r} 99999`);
  s.godmode = false;                 // цены снова настоящие, технологии открыты
  return s;
}

const centerOf = (sim) => ({ x: Math.round(sim.world.startX), y: Math.round(sim.world.startY) });

// Свободная клетка возле цели: кольца от ближних к дальним, поиск детерминирован.
function spotNear(sim, id, tx, ty, rMin = 0, rMax = 5) {
  for (let r = rMin; r <= rMax; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (sim.canPlace(id, tx + dx, ty + dy).ok) return { x: tx + dx, y: ty + dy };
      }
    }
  }
  return null;
}

// Ставим недострой (placeBuilding оставляет done=false — это ровно недострой)
// и возвращаем объект здания.
function addSite(sim, id, tx, ty, rMin = 0, rMax = 5) {
  const p = spotNear(sim, id, tx, ty, rMin, rMax);
  ok(p, `нет места для ${id} возле (${tx},${ty})`);
  ok(sim.placeBuilding(id, p.x, p.y), `${id} не поставился в (${p.x},${p.y})`);
  return sim.buildings[sim.buildings.length - 1];
}

function finish(b) { b.done = true; b.progress = b.buildDays; }

const reports = [];   // все отчёты прогона — для общей проверки причин в конце

console.log('--- Чистота и форма ---');
{
  const sim = game();
  const c = centerOf(sim);
  addSite(sim, 'hut', c.x + 3, c.y + 2);
  const before = JSON.stringify(sim.serialize());
  supplyNewDay(sim);
  supplyNewDay(sim);
  t('подвоз не трогает мир: serialize() бит-в-бит до и после',
    () => ok(before === JSON.stringify(sim.serialize()), 'мир изменился'));

  const out = supplyNewDay(sim);
  reports.push(out);
  t('отчёт имеет форму {mods, reasons, events, flags}', () => {
    for (const k of ['mods', 'reasons', 'events', 'flags']) ok(k in out, `нет поля ${k}`);
    ok(typeof out.mods.buildSpeedCap === 'number', 'потолок скорости не число');
  });
}

console.log('\n--- Детерминизм ---');
{
  const mk = () => {
    const sim = game(909);
    const c = centerOf(sim);
    addSite(sim, 'hut', c.x + 4, c.y - 3);
    addSite(sim, 'hut', c.x + 8, c.y + 5);
    return sim;
  };
  const ra = supplyNewDay(mk());
  const rb = supplyNewDay(mk());
  reports.push(ra, rb);
  t('два одинаковых сида дают одинаковый отчёт',
    () => ok(JSON.stringify(ra) === JSON.stringify(rb), 'отчёты разошлись'));
}

console.log('\n--- Очередь доставки ---');
{
  const sim = game();
  const out = supplyNewDay(sim);
  reports.push(out);
  t('нет недостроев — очередь пуста', () => ok(out.flags.deliveries.length === 0, `${out.flags.deliveries.length}`));
  t('нет недостроев — потолок скорости полный', () => ok(out.mods.buildSpeedCap === 1, `${out.mods.buildSpeedCap}`));

  const c = centerOf(sim);
  addSite(sim, 'hut', c.x + 3, c.y + 3);
  const out2 = supplyNewDay(sim);
  reports.push(out2);
  t('доставка знает куда, что, откуда и когда', () => {
    ok(out2.flags.deliveries.length >= 1, 'доставок нет');
    for (const d of out2.flags.deliveries) {
      ok(Number.isFinite(d.bx) && Number.isFinite(d.by), `битые координаты площадки: ${d.bx},${d.by}`);
      ok(Number.isInteger(d.etaDays) && d.etaDays >= 1, `срок прихода ${d.etaDays}`);
      const units = Object.values(d.need || {}).reduce((s, q) => s + (Number(q) || 0), 0);
      ok(units > 0, 'нужда пустая');
      ok(d.from && Number.isFinite(d.from.x) && Number.isFinite(d.from.y), 'склад-источник не указан');
    }
  });
}

console.log('\n--- Откуда везут ---');
{
  const sim = game();
  const c = centerOf(sim);
  const g = addSite(sim, 'granary', c.x + 15, c.y + 4, 0, 4); finish(g);   // амбар готов
  const site = addSite(sim, 'hut', g.x + 1, g.y + 1, 1, 3);                // стройка у амбара
  const out = supplyNewDay(sim);
  reports.push(out);
  t('везут от ближайшего склада, а не от столицы', () => {
    const d = out.flags.deliveries.find(z => z.bx === site.x && z.by === site.y);
    ok(d, 'доставка на эту стройку не найдена');
    ok(Math.hypot(d.from.x - g.x, d.from.y - g.y) < Math.hypot(d.from.x - c.x, d.from.y - c.y),
      `источник дальше столицы: ${JSON.stringify(d.from)}`);
  });
}

console.log('\n--- Приоритет столицы ---');
{
  const sim = game();
  const c = centerOf(sim);
  const g = addSite(sim, 'granary', c.x + 16, c.y + 5, 0, 4); finish(g);
  const nearCap = addSite(sim, 'hut', c.x + 5, c.y - 4, 0, 3);   // в радиусе столицы
  const byStore = addSite(sim, 'hut', g.x + 1, g.y, 1, 3);       // вплотную к складу
  const out = supplyNewDay(sim);
  reports.push(out);
  t('столичная стройка идёт первой, хотя до склада дальше', () => {
    ok(Math.hypot(nearCap.x - c.x, nearCap.y - c.y) <= CAPITAL_RADIUS,
      'фикстура разъехалась: первая стройка вне радиуса столицы');
    ok(Math.hypot(byStore.x - g.x, byStore.y - g.y) < Math.hypot(nearCap.x - g.x, nearCap.y - g.y),
      'фикстура не та: вторая обязана быть ближе к складу');
    ok(out.flags.deliveries.length >= 2, 'доставки не раздались');
    ok(out.flags.deliveries[0].bx === nearCap.x && out.flags.deliveries[0].by === nearCap.y,
      `первой поехала окраина (${out.flags.deliveries[0].bx},${out.flags.deliveries[0].by})`);
  });
}

console.log('\n--- Потолок обоза ---');
{
  const sim = game();
  const c = centerOf(sim);
  let placed = 0;
  for (let ring = 2; ring <= 12 && placed < DELIVERIES_MAX + 3; ring++) {
    for (let dy = -ring; dy <= ring && placed < DELIVERIES_MAX + 3; dy++) {
      for (let dx = -ring; dx <= ring && placed < DELIVERIES_MAX + 3; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        if (!sim.canPlace('hut', c.x + dx, c.y + dy).ok) continue;
        if (sim.placeBuilding('hut', c.x + dx, c.y + dy)) placed++;
      }
    }
  }
  const out = supplyNewDay(sim);
  reports.push(out);
  t(`одновременных доставок не больше ${DELIVERIES_MAX}`,
    () => ok(out.flags.deliveries.length === DELIVERIES_MAX, `в пути ${out.flags.deliveries.length} (строек ${placed})`));
  t('ожидающие посчитаны и сказаны словами', () => {
    ok(out.flags.starved === placed - DELIVERIES_MAX, `ждут ${out.flags.starved} из ${placed}`);
    ok(out.reasons.some(r => /Потолок обоза/.test(r)), JSON.stringify(out.reasons));
  });
  t('когда обоз не успевает — потолок скорости падает',
    () => ok(out.mods.buildSpeedCap < 1 && out.mods.buildSpeedCap >= SPEED_CAP_FLOOR, `${out.mods.buildSpeedCap}`));
}

console.log('\n--- Время ---');
{
  const sim = game();
  const c = centerOf(sim);
  const b = addSite(sim, 'castle', c.x + 6, c.y + 2, 0, 4);   // замок: длинная смета
  const etas = [];
  for (let f = 0; f <= 0.9 + 1e-9; f += 0.05) {
    b.progress = b.buildDays * Math.min(f, 1);
    const out = supplyNewDay(sim);
    reports.push(out);
    const d = out.flags.deliveries.find(z => z.bx === b.x && z.by === b.y);
    if (!d) break;                     // смета исчерпана — очередь кончилась
    etas.push(d.etaDays);
  }
  t('eta монотонно убывает по мере готовности стройки', () => {
    ok(etas.length >= 3, `точек замера мало: ${etas.length}`);
    for (let i = 1; i < etas.length; i++) ok(etas[i] <= etas[i - 1], `eta выросла: ${etas[i - 1]} → ${etas[i]}`);
    ok(etas[etas.length - 1] < etas[0], 'за всю готовность срок ни разу не сократился');
  });

  const sim2 = game();
  const c2 = centerOf(sim2);
  addSite(sim2, 'hut', c2.x + 3, c2.y - 2);
  addSite(sim2, 'hut', c2.x - 4, c2.y + 3);
  const eventDays = [];
  for (let day = 0; day <= 29; day++) {
    sim2.day = day;
    const out = supplyNewDay(sim2);
    if (out.events.length > 0) {
      ok(out.events.length === 1, `за день ${day} событий ${out.events.length}`);
      eventDays.push(day);
    }
  }
  reports.push(supplyNewDay(sim2));
  t(`события не чаще одного за ${EVENT_EVERY_DAYS} дней при спокойном ходе`, () => {
    ok(eventDays.length > 0, 'ход вообще молчит — ворота событий сломаны');
    ok(eventDays.length <= Math.ceil(30 / EVENT_EVERY_DAYS), `событий ${eventDays.length} за 30 дней`);
    for (let i = 1; i < eventDays.length; i++) {
      ok(eventDays[i] - eventDays[i - 1] >= EVENT_EVERY_DAYS,
        `слишком часто: дни ${eventDays[i - 1]} и ${eventDays[i]}`);
    }
  });
}

console.log('\n--- Крепость ---');
{
  const sim = game();
  const c = centerOf(sim);
  const saved = sim.buildings;
  sim.buildings = [
    null,
    {},
    { id: 'hut' },                                                  // без size и координат
    { id: 'hut', x: -30, y: -9, progress: -5 },                     // отрицательные координаты
    { id: 'такого-здания-нет', x: 2, y: 2 },
    { id: 'hut', x: c.x + 2, y: c.y + 2, progress: 99, buildDays: 0 }, // деление на ноль
    saved.find(b => b.id === 'campfire'),
  ];
  let out;
  try { out = supplyNewDay(sim); } finally { sim.buildings = saved; }
  reports.push(out);
  t('мусорные входы не роняют модуль', () => {
    ok(out && Array.isArray(out.flags.deliveries), 'отчёт сломан');
    inRange(out.mods.buildSpeedCap, 0, 1, 'потолок скорости на мусоре');
    for (const d of out.flags.deliveries) {
      ok(Number.isFinite(d.bx) && Number.isFinite(d.by), `координаты не числа: ${d.bx},${d.by}`);
    }
  });
}

{
  // Долгий ход: стройки достраиваются, новые закладываются, отчёт живёт.
  const sim = game();
  const c = centerOf(sim);
  const sites = [];
  for (const off of [[3, 2], [5, -4], [-4, 3], [6, 5]]) {
    try { sites.push(addSite(sim, 'hut', c.x + off[0], c.y + off[1], 0, 4)); } catch { /* места может не быть */ }
  }
  try { const g = addSite(sim, 'granary', c.x + 14, c.y + 6, 0, 5); finish(g); } catch { /* без амбара тоже проживём */ }
  ok(sites.length >= 2, `строек в фикстуре мало: ${sites.length}`);
  let errors = 0;
  for (let day = 1; day <= 300 && !errors; day++) {
    try {
      sim.day = day;
      for (const b of sites) {
        if (b.done) continue;
        b.progress = Math.min(b.buildDays, (b.progress || 0) + 0.35);
        if (b.progress >= b.buildDays) b.done = true;
      }
      if (day % 25 === 0) { try { sites.push(addSite(sim, 'hut', c.x + ((day / 25) % 9) + 2, c.y - 5, 0, 4)); } catch { /* плотно — и ладно */ } }
      const out = supplyNewDay(sim);
      inRange(out.mods.buildSpeedCap, 0, 1, `день ${day}: потолок скорости`);
      for (const d of out.flags.deliveries) ok(d.etaDays >= 1, `день ${day}: срок меньше суток`);
    } catch { errors = 1; }
  }
  t('300 дней прогона фикстуры без исключений', () => ok(errors === 0, 'исключение в ходе прогона'));

  const snap = JSON.stringify(sim.serialize());
  supplyNewDay(sim);
  t('чистота не потеряна после 300 дней',
    () => ok(snap === JSON.stringify(sim.serialize()), 'мир изменился'));
}

console.log('\n--- Гигиена и слова ---');
{
  t('в модуле нет Math.random, sim.rng и обращений к экрану', () => {
    const src = readFileSync(new URL('../src/core/systems/build_supply.js', import.meta.url), 'utf8');
    ok(!/Math\.random\s*\(/.test(src), 'найден вызов Math.random');
    const code = src.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '');
    ok(!/\b(document|window|canvas)\b/.test(code), 'найдено обращение к DOM');
    ok(!/sim\.rng\b/.test(code), 'используется общий поток sim.rng');
  });

  t('константы устава сходятся', () => {
    ok((SUPPLY_SEED_SALT >>> 0) === SUPPLY_SEED_SALT, 'соль потока не uint32');
    ok(DELIVERIES_MAX >= 1, 'потолок доставок меньше одного');
    inRange(SPEED_CAP_FLOOR, 0, 1, 'нижняя граница потолка скорости');
    ok(EVENT_EVERY_DAYS >= 1, 'ворота событий шире одного дня');
    ok(PORTER_BASE_SPEED > 0, 'обоз стоит намертво');
  });

  t('склады ищутся по данным: у чего cap, то хранит', () => {
    const ids = Object.keys(BUILDINGS).filter(id => BUILDINGS[id].cap);
    ok(ids.includes('granary') && ids.includes('depot'), `странный список складов: ${ids.join(', ')}`);
  });

  t('причины всегда названы непустыми строками', () => {
    ok(reports.length >= 5, `отчётов собрано подозрительно мало: ${reports.length}`);
    for (const o of reports) {
      ok(Array.isArray(o.reasons) && o.reasons.length > 0, 'причин нет вовсе');
      for (const r of o.reasons) ok(typeof r === 'string' && r.trim().length > 0, `пустая причина: ${JSON.stringify(r)}`);
    }
  });
}

console.log(`\n=== ${pass} OK / ${fail} FAIL ===`);
if (fail) process.exit(1);
