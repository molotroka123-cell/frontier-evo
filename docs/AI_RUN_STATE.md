# AI RUN STATE — ФРОНТИР (ветка ai/alpha-safe-improvement)

Обновлено: сессия ox-alpha, 22.08.2026. Читай ЭТОТ файл первым в новой сессии.

## Инцидент (важно!)
Параллельный агент сделал `git stash` («wip2») и удалил незакоммиченный
`app/src/core/systems/link_dynasty.js` (1246 строк). Stash поднят обратно
(pop): восстановлены civ_ai.js / integrate.js / hud.js. МОДУЛЬ ПОТЕРЯН —
нужно пересоздать. Правило: пока идёт волна династии, другие агенты НЕ
трогают app/src/core/systems/ и app/src/ui/hud.js.

## Что проверено и зелёное (до потери файла)
- simtest.mjs: **18 OK / 0 FAIL** при полной проводке династии.
- Сейв-кругооборот идентичен (харнесс %TEMP%\opencode\save_diff.mjs).
- Причина прошлых падений найдена: род бросал общий sim.rng → сдвиг потока
  (fog[107] 10≠16, пропадал «кризис»). Фикс: собственный поток mulberry32
  от сида мира (прецедент link_ghost/water/weather).

## Контракт модуля link_dynasty.js (восстановить по нему + тесты как TDD)
Экспорты (требуют integrate.js / hud.js / app/tests/test-dynasty.mjs):
- dynastyInstall(sim) — создаёт st {day, house{name,motto,sigil?}, members[],
  legitimacy(0..100), court[], designated, heir, pretenders[], plots[],
  marriages[], interregnum:false, interregnumDays, nextId, plotSeq,
  lastDelta, lastReasons, flags{state}, _rng}
- dynastyNewDay(sim) → rep {mods:{happy,stab}, reasons[], events[],
  flags:{state}, lastDelta} — ЧИСТЫЙ, ставит integrate сам; без sim.rng,
  только dynastyRng(sim)=makeDynRng(sim.seed) (mulberry32 ^0xD19A5711).
- dynastyHappyMod(sim) → читает sim.sys.dynLinks.mods.happy (клампится)
- serializeDynasty(st)/restoreDynasty(blob) по явному SAVE_FIELDS (v, day,
  house, members, legitimacy, court, designated, heir, pretenders, plots,
  marriages, interregnum, interregnumDays, nextId, plotSeq, lastDelta,
  lastReasons); restore НЕ бросает rng.
- heirOf(st, govType) — семантика порядка наследования РАЗНАЯ по типам:
  monarchy/empire/federation → designated приоритетен (тест id===2),
  chiefdom → иначе (id===4/3); empire при пустом списке → null;
  точные случаи см. app/tests/test-dynasty.mjs (источник истины!).
- Константы: LEGIT_DECAY (распад законности в день), INTERREGNUM_STAB
  (потолок stab при междуцарствии), INTERREG_AUTO_DAYS (авто-наследование).
- renderDynastyPanel(sim) / bindDynastyPanel(sim) — DOM только тут;
  действия через handleDynastyAction(sim, 'court:<i>'|'designate:<id>'|
  'usurp'|'adopt:<id>'|'expose:<id>') со спеками-строками.
- Потолки: happyMod ≤ +8; courtGold платит integrate; stab-мод из rep.mods.

## Проводка (уже в дереве, восстановлена из stash)
integrate.js: импорт DYN; applyDynastyLinks (~строка 824) = ленивый
dynastyInstall + merge rep.mods в счастье/stab + courtGold; вызов из
systemsNewDay. hud.js: вкладка {id:'dynasty', ru:'Род', ic:'👑'} +
panel_dynasty() → renderDynastyPanel(this.sim).

## Порядок восстановления (TDD, маленькими шагами)
1. Прочитать app/tests/test-dynasty.mjs ЦЕЛИКОМ (это спецификация API).
2. Написать link_dynasty.js минимально до его зелёного статуса
   (`node app/tests/test-dynasty.mjs`), затем simtest 18/18,
   затем `node tools/test-all.mjs` всё зелёное.
3. Коммит: "feat(dynasty): royal house core (rebuild) + own RNG stream".
4. Только потом волны ниже.

## Волны улучшений (утверждены пользователем, 13 шт.)
Волна A (ядро рода): кастомизация дома (имя/девиз/герб — фундамент
геральдики), регентство, золотой век, фракции двора, тайная полиция.
Волна B (внешний контур, зависит от diplomacy_ext): браки-договоры,
заговоры против соседей, вендетта поколений, наследник-полководец.
Волна C (презентация): аудиенции, роскошь/аскетизм, геральдика в мире,
шрифты/CSS (Georgia/Palatino стек, офлайн 0 байт).
Правила агентов: каждый механика = ОТДЕЛЬНЫЙ файл dyn_<name>.js + свой
тест test-dyn_<name>.js; запрет sim.rng/Math.random; капы эффектов;
сериализация своим ключом; DOM только в своём рендере; НЕ трогать чужие
файлы. Интеграция в link_dynasty/integrate/hud — только главная сессия.

## Регламент пользователя
- Тесты зелёные → коммит после КАЖДОГО улучшения (маленькие коммиты).
- Push: remote НЕ настроен — попросить URL у пользователя, добавить
  `git remote add origin <URL>` и пушить после каждого коммита.
- Доки из мастер-промпта: этот файл + ALPHA_AUDIT.md/PLAN/REGRESSION
  (последние три ещё не созданы).

## Известные факты аудита (для будущих фич)
diplomacy_ext — мёртвый реестр (оживить для браков/вендетты); слабые
здания observatory/press/smithy/treasury; balance.md §7-A не применён
(ai_core workers 2→5 рекомендовано); Math.random в core отсутствует.
Графика уже сделана и закоммичена: city lights, ночной multiply-тон,
миникарта-слой (коммиты f24bec3, f5b44de, 5422a31). День high=29 FPS.
