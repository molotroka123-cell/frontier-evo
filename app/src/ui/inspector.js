// ui/inspector.js — контекстная карточка «Инспектор» (W20) в правом нижнем углу.
//
// ЗАЧЕМ. У игры уже есть два способа узнать о постройке: подсказка по наведению
// (только для зданий и только из панелей) и модальная карточка по клику/долгому
// тапу (hud.showBuildingCard), которая закрывает пол-экрана и не знает ни
// жителей, ни чужих городов. Инспектор — лёгкая карточка на месте: ткнул в дом,
// жителя или поселение фракции — справа внизу встала компактная сводка, ткнул
// мимо — исчезла.
//
// ПРАВИЛА СЛОЯ. Инспектор — ЧИСТЫЙ ПОТРЕБИТЕЛЬ: он читает sim и renderer, но не
// пишет в симуляцию ни одного поля (все изменения мира делают только команды
// ядра из core/systems/build2.js — upgrade/repair, те же, что у панелей).
// Попадание по объекту берётся из СУЩЕСТВУЮЩЕГО конвейера выбора:
// renderer.select.pick (render/select.js) — тот же хит-тест, что рисует кольцо
// выделения, с его приоритетом «житель важнее здания». Поселения фракций в pick
// не входят (слой их не знает), поэтому после него добирается свой поиск по
// sim.factions[*].settlements — тоже только чтение. Данные чужого города — из
// производного вида settlementView (core/systems/settlement_view.js): он сам
// кэшируется и симуляцию не мутирует.
//
// КНОПКИ. Ровно те действия, которые уже существуют в ядре/hud:
//   • «Улучшить …»  — build2.upgrade (integrate.buildUpgrade), когда canUpgrade ок;
//   • «Починить»    — build2.repair, когда прочность ниже максимума;
//   • «Дипломатия»  — hud.showFaction(fid), готовая карточка фракции.
// СНОСА И НАЗНАЧЕНИЯ В ИГРЕ НЕТ: ни один обработчик игрока не удаляет здания
// (b.destroyed ставят только события/рейды) и не назначает жителя вручную
// (распределение — assignJob ядра). Нет действия — нет кнопки; выдумывать
// команды этот слой права не имеет.
//
// ГРАНИЦЫ КАДРА. bottom ≥ DOCK_FREE_PX (76 px) + safe-area: Command Dock снизу
// не перекрывается никогда; на телефоне (≤820px) карточка поднята ещё выше —
// над нижним шитом, доком и миникартой, чей угол посчитан в minimap.js.
// z-index 26: выше карты и боковой панели (15), ниже дока (30), консоли (35),
// модалок (70) и подсказок (80).
//
// DOM-ЧАСТЬ спрятана за маркером ниже: чистые функции (модели карточек, HTML,
// поиск целей) тестируются под node без document/window — тем же способом,
// что ui/dock.js. Повторный запуск в браузере гасится флагом window.

// ===== ЧИСТАЯ ЧАСТЬ (без DOM; тесты сканируют границу по маркеру) =====

import { BUILDINGS, RES } from '../core/data.js';
import { settlementView } from '../core/systems/settlement_view.js';
import {
  canUpgrade, upgrade as upgradeBuilding,
  repair as repairBuilding, repairCost, wearWorkMult,
} from '../core/systems/build2.js';

// Сколько клеток от якоря поселения ещё считается «попал по городу». Силуэт
// поселения шириной до 3.2 клетки (faction_town.js), то есть радиус 1.6 от
// центра; запас взят на промах пальцем, но не настолько, чтобы цеплять соседний
// лес. Экспорт для теста: число участвует в контракте «куда попадает клик».
export const SETTLEMENT_HIT_R = 1.8;

// Период пересчёта открытой карточки, мс. Темп выбран как у Command Dock
// (300 мс) с запасом: числа прочности меняются раз в игровой день, а не каждый
// кадр, и дороже 4 обновлений в секунду здесь ничего не нужно.
export const INSPECTOR_POLL_MS = 400;

// Нижняя зона Command Dock, которую карточка обязана держать свободной.
// Значение продиктовано задачей и совпадает с высотой дока с его отступами.
export const DOCK_FREE_PX = 76;

// Русские подписи занятий жителя. Ключи — ровно те значения v.job, которые
// ставит ядро (simulation.js: assignJob/tickVillagers); незнакомое значение
// падает в «Занят», а не в undefined — карточка не должна собираться пустой.
const JOB_RU = {
  idle: 'Без дела',
  work: 'Работает',
  build: 'На стройке',
  hunt: 'Охотится',
  forage: 'Собирает еду',
  deadfall: 'Носит валежник',
};

// Эмодзи ступеней города для превью (спрайтов у поселений нет — их силуэт
// рисуется вектором прямо в кадре). Индекс = tier из settlement_view, 0..4.
const TOWN_EMOJI = ['🏕️', '🛖', '🏘️', '🏙️', '🏛️'];

// Слово для уровня стен. Значения повторяют шкалу wallsByTier/wallsByDefense
// из settlement_view.js: 0 — стен нет, 1 — дерево, 2 — камень.
const WALLS_RU = ['нет', 'частокол', 'каменные'];

function esc(s) {
  // Экранирование имён и значений: имена жителей приходят из генератора, но
  // карточка строится innerHTML'ом, и любая случайная «<» сломала бы разметку.
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function resIcon(id) {
  const meta = RES.find(r => r.id === id);
  return meta ? meta.icon : '';
}

// Резервное превью здания, когда спрайта нет (узкий экран, канвас недоступен).
// Никакой собственной «иконки на вкус автора»: эмодзи выводится из данных
// самого здания — первый ресурс выработки, иначе жильё, иначе оборона.
export function emojiForBuilding(def) {
  if (!def) return '🏗️';
  const out = def.out || {};
  for (const r of Object.keys(out)) { const ic = resIcon(r); if (ic) return ic; }
  if (def.housing) return '🏠';
  if (def.defense || def.wall) return '🛡️';
  if (def.happy) return '😊';
  return '🏗️';
}

// Штат здания: сколько жителей стоят на местах сейчас. Тот же подсчёт, что в
// hud.workerStats (v.target.kind === 'work'), только для одного здания — чтение
// villagers, без единой записи.
export function staffOf(sim, b) {
  let n = 0;
  const vs = (sim && sim.villagers) || [];
  for (let i = 0; i < vs.length; i++) {
    const t = vs[i].target;
    if (t && t.kind === 'work' && t.b === b) n++;
  }
  return n;
}

// Занятие жителя одной строкой. Для работы и стройки добавляем место — без него
// «Работает» не отвечает на вопрос «где и кем».
export function jobRu(v) {
  const base = JOB_RU[v.job] || 'Занят';
  if (v.job === 'work' && v.target && v.target.b) {
    const def = BUILDINGS[v.target.b.id];
    return `${base}: ${def ? def.name : 'здание'}`;
  }
  if (v.job === 'build' && v.target && v.target.b) {
    const def = BUILDINGS[v.target.b.id];
    return `${base}: ${def ? def.name : 'здание'}`;
  }
  return base;
}

// Доля прочности, ниже которой строка желтеет. Ниже трети — краснеет (порог
// вполсилы из build2.REPAIR_CRITICAL); предупреждение держим на тех же 70%, где
// ядро начинает считать здание требующим ремонта (build2.REPAIR_THRESHOLD).
const REPAIR_WARN_SHARE = 0.7;

// Модель карточки здания. Возвращает null для снесённого — вызывающий код
// обязан молча закрыть карточку, а не показывать руину, которой нет на карте.
export function buildingCard(sim, b) {
  const def = BUILDINGS[b.id];
  if (!def || b.destroyed) return null;
  const rows = [];
  const actions = [];

  if (!b.done) {
    // Стройплощадка: прогресс и бригада. Проценты считаются как в карточке HUD
    // (progress/buildDays), с защитой от нулевой сметы времени.
    const pct = b.buildDays > 0 ? Math.round((b.progress / b.buildDays) * 100) : 0;
    rows.push({ k: 'Статус', v: `Строится ${Math.min(100, pct)}%` });
    rows.push({ k: 'Стройителей', v: String((b.workers || []).length) });
    actions.push(...actionsForBuilding(sim, b, def));
    return { kind: 'b', title: def.name, emoji: emojiForBuilding(def), sprite: true, rows, actions };
  }

  rows.push({ k: 'Статус', v: 'Работает', cls: 'good' });

  // Прочность. Максимум — def.wall (как в build2.wearPerDay), а не «100 на глаз»:
  // у частокола потолок 200, у каменных стен 500.
  const maxHp = def.wall || 100;
  const hp = Math.round(b.hp ?? maxHp);
  const cls = hp <= maxHp * 0.3 ? 'bad' : hp < maxHp * REPAIR_WARN_SHARE ? 'warn' : '';
  rows.push({ k: 'Прочность', v: `${hp} / ${maxHp}`, cls });

  if (def.workers > 0) {
    // Штат и эффективность. Эффективность = заполненность штата × множитель
    // ветхости из ядра (wearWorkMult): именно произведение этих двух чисел
    // решает, сколько здание реально даёт за день.
    const n = staffOf(sim, b);
    rows.push({ k: 'Работники', v: `${n} из ${def.workers}` });
    const eff = Math.round(Math.min(1, n / def.workers) * wearWorkMult(sim, b) * 100);
    rows.push({ k: 'Эффективность', v: `${eff}%`, cls: eff < 50 ? 'bad' : eff < 75 ? 'warn' : '' });
  } else {
    // Здания без рабочих мест (Робозавод, passive-сокровищница) всё равно
    // зависят от ветхости — покажем её одну, чтобы строка не пропадала.
    const eff = Math.round(wearWorkMult(sim, b) * 100);
    rows.push({ k: 'Эффективность', v: `${eff}%`, cls: eff < 50 ? 'bad' : eff < 75 ? 'warn' : '' });
  }

  if (def.out) {
    const gives = Object.entries(def.out)
      .map(([r, v]) => `${resIcon(r)}${Number.isInteger(v) ? v : +v.toFixed(1)}`)
      .join(' ');
    rows.push({ k: 'Даёт', v: gives });
  }
  if (def.housing) rows.push({ k: 'Жильё', v: `${def.housing} чел.` });

  actions.push(...actionsForBuilding(sim, b, def));
  return { kind: 'b', title: def.name, emoji: emojiForBuilding(def), sprite: true, rows, actions };
}

// Кнопки здания — только существующие команды ядра. Обе проверяются теми же
// функциями, которыми игрок и выполнит действие: расхождений «кнопка есть,
// а делать нельзя» не бывает.
function actionsForBuilding(sim, b, def) {
  const out = [];
  if (b.done) {
    const up = canUpgrade(sim, b);
    if (up.ok) out.push({ id: 'upgrade', ru: `Улучшить: ${up.name}`, primary: true });
    else if (up.to && !up.ok) {
      // Улучшение существует, но сейчас нельзя (технология, место, ресурсы):
      // кнопку НЕ рисуем — причина уже видна числами карточки, а мёртвая
      // кнопка научила бы игрока их не читать.
    }
    const maxHp = def.wall || 100;
    if ((b.hp ?? maxHp) < maxHp) {
      const cost = repairCost(b);
      const parts = Object.entries(cost)
        .map(([r, v]) => `${resIcon(r)}${v}`).join(' ') || 'бесплатно';
      out.push({ id: 'repair', ru: `Починить (${parts})` });
    }
  }
  return out;
}

// Модель карточки жителя. Действий у жителя в игре нет (переназначение делает
// только assignJob ядра), поэтому actions всегда пуст — это контракт, а не
// упущение, и тест его фиксирует.
export function villagerCard(sim, v) {
  if (!v || !(v.hp > 0)) return null;
  const rows = [
    { k: 'Занят', v: jobRu(v) },
    { k: 'Здоровье', v: `${Math.max(0, Math.round(v.hp))}%`, cls: v.hp < 30 ? 'bad' : v.hp < 60 ? 'warn' : '' },
  ];
  return { kind: 'v', title: v.name || 'Житель', emoji: '🧍', sprite: false, rows, actions: [] };
}

// Модель карточки чужого города. Все числа — производный вид settlement_view:
// тир, стены, война, свежий ущерб, население под знаменем. Флаг hasFactionCard
// говорит, что до карточки фракции можно добраться штатным hud.showFaction;
// без него действий нет вообще.
export function enemyCityCard(sim, f, s, opts = {}) {
  const view = settlementView(sim, f, s);
  if (!view) return null;
  const name = (f.def && f.def.name) || f.id || 'Соседи';
  const rows = [
    { k: 'Ступень', v: `${view.tier}` },
    { k: 'Стены', v: WALLS_RU[view.walls] || 'нет' },
    { k: 'Война', v: view.atWar ? 'Да' : 'Нет', cls: view.atWar ? 'bad' : '' },
  ];
  if (view.damaged) rows.push({ k: 'Свежий ущерб', v: 'Есть', cls: 'warn' });
  rows.push({ k: 'Население', v: String(view.pop) });
  rows.push({ k: 'Столица', v: s.capital ? 'Да' : 'Нет' });
  const emoji = TOWN_EMOJI[Math.max(0, Math.min(TOWN_EMOJI.length - 1, view.tier))];
  const actions = opts.hasFactionCard
    ? [{ id: 'faction', ru: 'Открыть дипломатию' }]
    : [];
  return { kind: 's', title: name, emoji, sprite: false, rows, actions };
}

// Поиск поселения под точкой. Живые фракции, все их города; при пересечении зон
// побеждает первый по порядку массива — порядок стабилен внутри дня, а зоны
// городов не перекрываются (города дальше 8 клеток друг от друга ставит сам мир).
export function settlementAt(sim, wx, wy) {
  const fs = (sim && Array.isArray(sim.factions)) ? sim.factions : [];
  for (const f of fs) {
    if (!f || f.alive === false || !Array.isArray(f.settlements)) continue;
    for (const s of f.settlements) {
      if (!s) continue;
      const dx = (wx - 0.5) - s.x, dy = (wy - 0.5) - s.y;
      if (dx * dx + dy * dy <= SETTLEMENT_HIT_R * SETTLEMENT_HIT_R) return { f, s };
    }
  }
  return null;
}

// Сведение результата renderer.select.pick и поиска городов в одну цель.
// Приоритет наследуется от pick: житель → здание → (наш добавка) город.
export function resolveTarget(sim, hit, wx, wy) {
  if (hit && hit.kind === 'v' && hit.v) return { kind: 'v', v: hit.v };
  if (hit && hit.kind === 'b' && hit.b) return { kind: 'b', b: hit.b };
  const town = settlementAt(sim, wx, wy);
  if (town) return { kind: 's', f: town.f, s: town.s };
  return null;
}

// Жива ли ещё цель. Дом могли снести рейдом между кадрами, житель — умереть,
// фракция — потерять город. Проверка стоит линейный проход, зато карточка не
// висит над пустым местом до следующего клика.
export function aliveTarget(sim, t) {
  if (!t) return false;
  if (t.kind === 'b') return !!t.b && !t.b.destroyed &&
    Array.isArray(sim.buildings) && sim.buildings.indexOf(t.b) >= 0;
  if (t.kind === 'v') return !!t.v && t.v.hp > 0 &&
    Array.isArray(sim.villagers) && sim.villagers.indexOf(t.v) >= 0;
  if (t.kind === 's') {
    return !!t.f && t.f.alive !== false &&
      Array.isArray(sim.factions) && sim.factions.indexOf(t.f) >= 0 &&
      Array.isArray(t.f.settlements) && t.f.settlements.indexOf(t.s) >= 0;
  }
  return false;
}

// Разметка карточки одной детерминированной строкой. Контракт с DOM-частью —
// data-ft-act/data-ft-close; никаких id и случайных чисел внутри, поэтому два
// вызова на одном состоянии обязаны дать байт-в-байт равный HTML (тест ниже).
export function cardHtml(card) {
  const rows = card.rows.map(r =>
    `<div class="ft-insp-row"><span>${esc(r.k)}</span><b${r.cls ? ` class="${r.cls}"` : ''}>${esc(r.v)}</b></div>`
  ).join('');
  const btns = card.actions.map(a =>
    `<button class="ft-insp-btn${a.primary ? ' primary' : ''}" type="button" data-ft-act="${a.id}">${esc(a.ru)}</button>`
  ).join('');
  return `<div class="ft-insp-head">
    <span class="ft-insp-prev" aria-hidden="true">${card.emoji}</span>
    <span class="ft-insp-ttl">${esc(card.title)}</span>
    <button class="ft-insp-x" type="button" data-ft-close aria-label="Закрыть">×</button>
  </div>
  <div class="ft-insp-body">${rows}</div>
  ${btns ? `<div class="ft-insp-btns">${btns}</div>` : ''}`;
}

// ===== DOM-ЧАСТЬ (браузер; в node не исполняется) =====

function ensureCss() {
  // Инжект по образцу dock.ensureCss/topbar: стилю нечего делать в отдельном
  // файле сборки, идемпотентность — через id тега. Цвета — только переменные
  // theme.css, чтобы карточка пережила смену палитры.
  if (document.getElementById('ft-inspector-css')) return;
  const st = document.createElement('style');
  st.id = 'ft-inspector-css';
  st.textContent = `
#ftInspector {
  position: fixed;
  /* 84px > DOCK_FREE_PX(76): Command Dock внизу остаётся кликабельным целиком */
  right: 10px;
  bottom: calc(${DOCK_FREE_PX + 8}px + var(--safe-bottom, 0px));
  z-index: 26; /* карта и боковая панель 15 · док 30 · модалки 70 */
  width: min(264px, calc(100vw - 20px));
  background: var(--panel, rgba(20,18,16,0.92));
  border: 1px solid var(--panel-border, rgba(201,162,39,0.35));
  border-radius: var(--radius, 12px);
  color: var(--text, #ece5d3);
  font-size: 12px; line-height: 1.45;
  box-shadow: 0 10px 30px rgba(0,0,0,0.45), inset 0 1px 0 rgba(201,162,39,0.14);
  display: none; padding: 10px 12px;
}
#ftInspector.show { display: block; }
.ft-insp-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.ft-insp-prev {
  flex: 0 0 auto; width: 34px; height: 34px; border-radius: 8px;
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.07);
  display: flex; align-items: center; justify-content: center; font-size: 19px;
  overflow: hidden;
}
.ft-insp-prev canvas { width: 100%; height: 100%; object-fit: contain; image-rendering: auto; }
.ft-insp-ttl {
  flex: 1 1 auto; min-width: 0; font-family: var(--serif, Georgia, serif);
  font-weight: 700; letter-spacing: 0.3px; font-size: 13px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ft-insp-x {
  flex: 0 0 auto; width: 24px; height: 24px; border-radius: 7px;
  border: 1px solid rgba(255,255,255,0.12); background: transparent;
  color: var(--dim, #a89f8e); font-size: 14px; line-height: 1; cursor: pointer;
}
.ft-insp-x:hover { color: var(--text); border-color: var(--accent, #c9a227); }
.ft-insp-row {
  display: flex; justify-content: space-between; gap: 10px;
  padding: 3px 0; border-bottom: 1px solid rgba(255,255,255,0.05);
}
.ft-insp-row span { color: var(--dim, #a89f8e); }
.ft-insp-row b { font-family: var(--mono, monospace); font-weight: 600; text-align: right; }
.ft-insp-row b.good { color: var(--good, #93de93); }
.ft-insp-row b.warn { color: var(--warn, #e8c886); }
.ft-insp-row b.bad { color: var(--bad, #ef9a9a); }
.ft-insp-btns { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.ft-insp-btn {
  padding: 8px 10px; min-height: 36px; border-radius: 9px; cursor: pointer;
  border: 1px solid var(--panel-border, rgba(201,162,39,0.35));
  background: rgba(201,162,39,0.12); color: var(--text, #ece5d3); font-size: 12px;
}
.ft-insp-btn:hover { background: rgba(201,162,39,0.2); }
.ft-insp-btn.primary { background: var(--accent, #c9a227); border-color: var(--accent, #c9a227); color: #14100a; font-weight: 700; }
/* Телефон: поднимаем карточку над связкой «нижний шит (56) → док (от 64) →
   миникарта (~92+10)»: её правый нижний угол занят minimap.js, и перекрывать
   его значило бы отрезать тап-прыжок камеры. */
@media (max-width: 820px) {
  #ftInspector { right: 8px; bottom: calc(168px + var(--safe-bottom, 0px)); }
}`;
  document.head.appendChild(st);
}

// Спрайт в превью: берём ту же выпечку, что рисует рендер
// (renderer.sprites.building → {cv,...}), и вписываем в квадрат превью.
// Любая неудача — тихий выход: в разметке уже лежит эмодзи-фолбэк.
function paintPreview(root, target) {
  if (!target || target.kind !== 'b') return;
  try {
    const F = window.__frontier;
    const cache = F && F.renderer && F.renderer.sprites;
    const def = BUILDINGS[target.b.id];
    const sim = F.sim;
    if (!cache || !def || !sim) return;
    const spr = cache.building(target.b.id, def, sim.eraIndex, target.b.size || 1);
    if (!spr || !spr.cv) return;
    const cell = root.querySelector('.ft-insp-prev');
    if (!cell) return;
    const cv = document.createElement('canvas');
    cv.width = 56; cv.height = 56;
    const c = cv.getContext('2d');
    const k = Math.min(cv.width / spr.cv.width, cv.height / spr.cv.height);
    const w = spr.cv.width * k, h = spr.cv.height * k;
    c.drawImage(spr.cv, (cv.width - w) / 2, (cv.height - h) / 2, w, h);
    cell.textContent = '';
    cell.appendChild(cv);
  } catch { /* нет канваса/кэша — остаётся эмодзи */ }
}

let root = null;
let target = null;     // текущая цель {kind,b|v|f,s} — ссылки на живые объекты sim
let lastHtml = '';

function ensureRoot() {
  if (root) return root;
  root = document.createElement('div');
  root.id = 'ftInspector';
  document.body.appendChild(root);
  // Один делегированный слушатель на всю жизнь карточки: крестик и кнопки
  // действий перечитываются после каждой перерисовки innerHTML.
  root.addEventListener('click', e => {
    const close = e.target.closest && e.target.closest('[data-ft-close]');
    if (close) { hide(); return; }
    const btn = e.target.closest && e.target.closest('[data-ft-act]');
    if (btn) runAction(btn.dataset.ftAct);
  });
  return root;
}

// Команда карточки. Каждый вызов — уже существующий обработчик игры: команды
// ядра build2.upgrade/build2.repair и штатная карточка фракции hud.showFaction.
function runAction(act) {
  const F = window.__frontier;
  if (!F || !F.sim || !target) return;
  const sim = F.sim;
  if (act === 'upgrade' && target.b) {
    const r = upgradeBuilding(sim, target.b);
    if (F.audio) F.audio.play(r.ok ? 'build' : 'deny');
    if (!r.ok && F.hud) F.hud.toast(r.reason || 'Не получилось', 'warn');
    refresh(true);
  } else if (act === 'repair' && target.b) {
    const r = repairBuilding(sim, target.b);
    if (F.audio) F.audio.play(r.ok ? 'coin' : 'deny');
    if (!r.ok && F.hud) F.hud.toast(r.reason || 'Не получилось', 'warn');
    refresh(true);
  } else if (act === 'faction' && target.f) {
    if (F.hud && typeof F.hud.showFaction === 'function') {
      hide(); // карточка фракции — модалка на весь экран: своя тут не нужна
      F.hud.showFaction(target.f.id);
    }
  }
}

// Пересборка модели по живым ссылкам. force — сразу после действия: ждать
// следующего тика опроса значит показать старую прочность под свежим тостом.
function refresh(force) {
  const F = window.__frontier;
  if (!root || !target) return;
  const sim = F && F.sim;
  if (!sim || !aliveTarget(sim, target)) { hide(); return; }
  const card = modelOf(sim, target, F);
  if (!card) { hide(); return; }
  const html = cardHtml(card);
  if (!force && html === lastHtml) return;
  lastHtml = html;
  root.innerHTML = html;
  paintPreview(root, target);
  root.classList.add('show');
}

function modelOf(sim, t, F) {
  if (t.kind === 'b') return buildingCard(sim, t.b);
  if (t.kind === 'v') return villagerCard(sim, t.v);
  if (t.kind === 's') return enemyCityCard(sim, t.f, t.s, {
    hasFactionCard: !!(F && F.hud && typeof F.hud.showFaction === 'function'),
  });
  return null;
}

function hide() {
  target = null;
  lastHtml = '';
  if (root) root.classList.remove('show');
}

function openTarget(t) {
  target = t;
  refresh(true);
}

// --- ввод: та же схема, что у main.js (pointerdown/up + порог перетаскивания) ---

let downPos = null, downMaxPointers = 0;

function bindInput() {
  const canvas = document.getElementById('game');
  if (!canvas) return;

  canvas.addEventListener('pointerdown', e => {
    downPos = { x: e.clientX, y: e.clientY };
    downMaxPointers = 1;
  }, { passive: true });
  canvas.addEventListener('pointermove', e => {
    if (!downPos) return;
    // Второй палец (щипок зума) — жест камеры, не выбор: запоминаем максимум,
    // чтобы click после щипка не открыл карточку в точке «среднего пальца».
    if (e.pointerType === 'touch') downMaxPointers = Math.max(downMaxPointers, 1);
  }, { passive: true });
  canvas.addEventListener('pointerup', () => { /* решение принимает click */ }, { passive: true });
  canvas.addEventListener('pointercancel', () => { downPos = null; }, { passive: true });

  canvas.addEventListener('click', e => {
    const F = window.__frontier;
    if (!F || !F.sim || !F.renderer) return;
    const sim = F.sim;
    // Пока игрок ставит здание, кликом владеет призрак стройки (main.js):
    // карточка в этот момент была бы третьей точкой на экране.
    if (sim.placing) { hide(); return; }
    // Щипок двумя пальцами — это зум, а не выбор объекта.
    if (downMaxPointers > 1) { downPos = null; downMaxPointers = 0; return; }
    // Перетащили карту — клика не было.
    if (downPos && Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 6) {
      downPos = null; return;
    }
    downPos = null;
    // Миникарта обрабатывается своим обработчиком main.js (тап-прыжок камеры):
    // открывать поверх неё карточку значило бы закрывать цель прыжка.
    const m = F.renderer.minimapRect;
    if (m && e.clientX >= m.x && e.clientX <= m.x + m.w && e.clientY >= m.y && e.clientY <= m.y + m.h) {
      hide(); return;
    }
    const w = F.renderer.screenToWorld(e.clientX, e.clientY);
    // Хит-тест — из существующего конвейера выбора: тот же pick, что рисует
    // кольцо выделения, с его приоритетом «житель важнее здания».
    const hit = F.renderer.select
      ? F.renderer.select.pick(sim, w.x, w.y)
      : { kind: 't', b: null, v: null };
    const t = resolveTarget(sim, hit, w.x, w.y);
    if (!t) { hide(); return; }
    // Повторный клик по той же цели закрывает карточку — как кольцо выделения
    // в select.selectAt снимается повторным тапом.
    if (target && t.kind === target.kind &&
        ((t.b && t.b === target.b) || (t.v && t.v === target.v) || (t.s && t.s === target.s))) {
      hide(); return;
    }
    openTarget(t);
  });

  // «Клик вне» — любое нажатие вне карточки гасит её. Слушаем на стадии
  // захвата ДО чужих обработчиков: закрытие не должно зависеть от того,
  // остановит ли кто-то всплытие. Клик по карте после этого спокойно откроет
  // новую карточку в собственном обработчике click.
  document.addEventListener('pointerdown', e => {
    if (root && root.classList.contains('show') && !root.contains(e.target)) hide();
  }, true);

  // Пересчёт чисел открытой карточки: прочность тает днями, работники ходят
  // туда-обратно. innerHTML переставляется только при изменении строки.
  setInterval(() => {
    try { refresh(false); } catch { /* кадр без данных не повод ронять таймер */ }
  }, INSPECTOR_POLL_MS);
}

function start() {
  ensureCss();
  ensureRoot();
  bindInput();
}

if (typeof document !== 'undefined' && typeof window !== 'undefined' && !window.__frontierInspector) {
  window.__frontierInspector = { version: 1 };
  start();
}
