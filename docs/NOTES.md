# Заметки по формату FFG и найденные особенности

Справочник для разработки. План и статус — в `ROADMAP.md`, процесс работы — в `WORKFLOW.md`.

## Принципы
- Ядро — **интерпретатор модели FFG** (FSM-состояния, события, переменные, действия), без конвертации в чужие форматы.
- Свой редактор и генерация ИИ выдают тот же формат.
- Контент FFG не поставляется и не публикуется: импортёр берёт его из установленной у пользователя игры.
- Код FFG (декомпиляция) — только справочник. Реализацию пишем свою.
- Your Journey и JiMEditor (GPL-3.0) — тоже только справочник.

## Игра
- Unity 2022.3.62f2, Mono, 32 бит.
- `StreamingAssets/bundles`:
  - локализация — CSV `KEY,Lang` в TextAsset, по кампаниям, 13 языков;
  - mp3 пролога и эпилогов;
  - логотипы.
- Кампании: BonesOfArnor, EmberCrown, HauntingofDale, PoisonPromise, ShadowedPaths, SpreadingWar. У PoisonPromise нет русского (заглушка), итальянский полный у всех.

## Где что лежит
- **resources.assets**:
  - префабы приключений `Assets/Resources/Adventures_Runtime/Cam_N/<n>_<Name>.prefab`;
  - префабы встреч `Encounters_Runtime/<id>_<Name>.prefab`;
  - 2232 PlayMakerFSM.
  - Пути берутся из ResourceManager.m_Container (globalgamemanagers).
- **sharedassets0.assets**: модели Adventure, Encounter, EncounterGroup, Tile, Enemy, EnemyActivation, EnemyBonus, Item, Skill, Title, LastStand, Hero, Role, TerrainNode, Product, Campaign.
- **level4**: стандартные тайлы — Tile + TileSpace (трейты, связи клеток) + Hex (меш + HexUVMapping).
- **PlayMakerGlobals** (resources.assets): 350 глобальных переменных (Adventure/…, Campaign/…, PlayerCount, Threat, Round, IsDarkness, EnemyPoints…).
- **Текстуры** — в `*.resS` / `*.resource` (resources.assets.resS ≈165 МБ).
- **3D-модели**: на основной карте окружение — объёмные жетоны-диски (меши "Round"/"Statue" + текстуры 9_Fire, 0_Bushes, 8_Statue…). Настоящие модели — на боевых картах (level5/7/9; текстуры PropAtlas, rocks_atlas, Vegetation).
- **Частицы**: 261 ParticleSystem, модули читаются через read_typetree.

## Чтение ассетов (грабли)
- typetree в ассетах вырезан. Структуры MonoBehaviour генерируются TypeTreeGeneratorAPI по всей папке Managed.
- **Баг генератора:** массив строк помечен типом "string" → читаем своим ридером `ttread.py`, а не read_typetree UnityPy.
- **ActionData PlayMaker:**
  - параметры FsmEvent лежат в `stringParams[paramDataPos]`, а не в byteData;
  - Array и CustomClass разворачиваются рекурсивно;
  - ParamDataType берётся из PlayMaker.dll.
- **IA_LocalizationPacket:** флаг `Inserts[].IsUsed` чисто редакторский — вставки с содержимым используются всегда.
- **Компактор:** выбрасывает «пустые» значения (0/false/""), поэтому отсутствующий параметр = falsy. Например, Type у EncounterModel отсутствует → это 0 (Random).
- **Меши:** UnityPy Mesh.export() отражает X. У части мешей ось вверх — Z (жетоны, Wall06, Firelogs, кусты), у остальных — Y.
- **Геометрия тайлов:**
  - каждый Hex — свой меш из 6 вершин + HexUVMapping.UVs + имя `Hex_q,r`;
  - решётка a=(1.765, 0), b=(0.882, −1.528), радиус гекса ≈1.019;
  - мировые матрицы считаются по цепочке Transform.

## Рантайм FFG (по декомпиляции)
- **Семантика PlayMaker:**
  - действия выполняются по порядку;
  - событие, выданное действием, побеждает FINISHED;
  - глобальные переходы имеют приоритет;
  - вложенные события обрабатываются синхронно.
- **Начало приключения:** `SCENARIO_BEGIN` → `ROUND_START`. Конец: SignalEndGame → `ADVENTURE_END_VICTORY`/`FAILURE` главному FSM.
- **Исследование тайла** (Adventure.CoroutineExploreTile): каждому узлу клетки `PRE_REVEAL` → `REVEALED`; затем `ADJACENT_TILE_EXPLORED` (переменная AdjacentSectionId) по соседним секциям.
- **Конец раунда** (GameController.CoroutineEndRound):
  1. проверка поражения героев и лимита угрозы;
  2. фаза тьмы: активации неистощённых групп;
  3. тьма;
  4. `ROUND_END` таймерам и главному FSM;
  5. рост угрозы = 2·игроки + узлы-угрозы + (кроме режима Adventure) открытые неисследованные тайлы;
  6. события угрозы по порогу;
  7. сплочение, Round++, `ROUND_START`.
- **MapBuilder — порядок размещения встреч:** TileEncounters → SectionEncounters → AdventureEncounters → группа встреч (required + N optional, по фильтру трейтов) → 1 Item-встреча (предметы, которых нет у отряда) → случайные (Random + разблокированные Chain) до RandomFillPercent секции.
- **Враги:**
  - EnemyGroup.Logic получает `TRY_DEFEAT` / `DEFEATED`;
  - активации берутся из EnemyActivationModel по размеру группы;
  - рост угрозы — ThreatLimit или ThreatLimitPerPlayer·игроки.
- **Последний рубеж:** LastStandModel (D/F/C 1–5) → UI_LAST_STAND_PASSED_PHYSICAL/FEAR | FAILED.

## Результаты прототипов
- **Python-движок** (`engine-py`):
  - A1 против реального лога (слот 2): 107 из 108 ключей, итог SetNextAdventure → 2;
  - 72 приключения × 10 прогонов: 0 падений, 0 нереализованных действий, покрытие главных графов 23–95%.
- **Недочёты движка:**
  - нет гекс-геометрии и движения;
  - 'ExploreTile: no tile' — объекты, привязанные к позициям;
  - упрощены последний рубеж, условия активаций и бот.
- **3D-прототип** (`prototype_3d`): Three.js — тайлы, сепия, облака, жетоны, частицы, боевое поле. Проверен в headless Chromium.
- **Эталонные логи:** `data/ref/` — LogA слота 2 (полная A1 + начало B1), слот 0 (другая кампания).
