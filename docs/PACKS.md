# Формат паков (formatVersion 1)

Всё содержимое игры — паки. Пак — папка с `pack.json` в корне. Схемы: `packages/schema/schemas/`.
Типы TS — `packages/schema/src/types.ts` (держать в синхроне со схемами).

## pack.json

```json
{
  "formatVersion": 1,
  "id": "core-ffg",
  "name": { "ru": "…", "en": "…" },
  "version": "1.0.0",
  "priority": 0,
  "origin": "ffg-import",
  "dependencies": { "other-pack": "^1.0.0" },
  "contents": [
    { "type": "scenario", "path": "scenario" },
    { "type": "lang", "lang": "ru", "path": "lang/ru.csv" }
  ]
}
```

- `id` — `[a-z0-9-]`, 2–64 символа.
- `version` — semver. Зависимости: точная версия, `^`, `~`, `>=`, `*`.
- `priority` — от −1000 до 1000.
- `origin`:
  - `ffg-import` — пак собран у пользователя из его копии игры, **не распространяется**;
  - `community`, `generated`, `user` — остальные.
- `path` — относительный, без `..`.

### Порядок слоёв

1. Сначала зависимости, потом зависимые паки (зависимость всегда ниже, даже при большем приоритете).
2. Среди независимых — по возрастанию `priority`, затем по `id`.
3. Последующий слой перекрывает предыдущий: ключи локализации, id сценариев и т.д.

Ошибки: дубликат `id`, отсутствующая или несовместимая зависимость, цикл.

### Слои в приложении

Менеджер паков приложения — `apps/app/src/data/pack.ts` (порядок — `orderLayers()` из `@jime/content-tools/layers`, без доступа к файлам):

- берутся все папки паков (`/__list.json`), выключенные пользователем пропускаются (экран «Паки», хранится в localStorage);
- пак с ошибкой (нет или битый `pack.json`, дубликат `id`, нет зависимости или не та версия, цикл) не загружается, остальные работают; причина видна на экране «Паки»;
- файлы адресуются виртуальным путём (`scenario/adventures/1.json`, `images/tiles/100A.jpg`, `fonts/fonts.json` …); берётся файл верхнего слоя. Папка содержимого `scenario` может называться как угодно (`contents[].path`) — она монтируется в `scenario/`;
- `scenario/db.json` всех слоёв сливается: `models.<тип>`, `standardTiles`, `globals` — по id (верхний слой заменяет запись), остальные поля заменяются целиком;
- тексты (`lang`) всех слоёв сливаются по ключу.

Списки файлов отдают и dev-сервер Vite, и схема `jime-pack` в Tauri: `/__list.json` — `[{ dir, manifest }]`, `/<папка>/__index.json` — все файлы пака.

Пример пака-надстройки: свой перевод и переименование приключения.

```
my-tweaks/
  pack.json   { "formatVersion": 1, "id": "my-tweaks", "version": "0.1.0", "priority": 10, "origin": "user",
                "dependencies": { "core-ffg": "^1.0.0" },
                "contents": [ { "type": "lang", "lang": "ru", "path": "lang/ru.csv" }, { "type": "scenario", "path": "data" } ] }
  lang/ru.csv key,text / BonesOfArnor|A1_M1_OBJECTIVE_0,{0}Свой текст задачи.
  data/db.json { "models": { "AdventureModel": { "1": { …запись целиком, с новым NameKey… } } } }
```

## Типы содержимого

| type | Что | Статус |
|---|---|---|
| `scenario` | Папка: `db.json`, `adventures/*.json`, `encounters/*.json` | ✅ схема, валидация |
| `lang` | CSV `key,text` (UTF-8, RFC 4180), нужен `lang` | ✅ чтение, слияние |
| `voice` | mp3 по ключу локализации, нужен `lang` | ⏳ |
| `theme` | CSS-переменные, картинки, шрифты | ⏳ |
| `models` | glTF | ⏳ |
| `rules` | Константы и таблицы правил | ⏳ |

Ключ локализации — `Лист|КЛЮЧ`, как в `data/out/loc.json` (например `BonesOfArnor|A10_BONES_FAIL`).

## Сценарий (`jime-scenario`)

Конверт поверх формата экспорта FFG (prefab + PlayMaker FSM), без преобразования содержимого:

```
{ format: "jime-scenario", formatVersion: 1, kind: "adventure" | "encounter",
  id, source: "ffg" | "custom",
  root, model, gameObjects: { "<id>": { name, parent, components } },
  fsms: [ { name, start, go, variables, global, states: [ { name, transitions, actions: [ { action, enabled, params } ] } ] } ],
  ext: { … } }
```

- `ext` — наши расширения, по имени фичи.
- Свои действия FSM — с префиксом `X` (например `XPlayVoice`), чтобы не путать с действиями FFG.
- `components` и `params` в схеме не детализированы: их проверяет движок (Этап 2).

## База (`jime-db`)

`scenario/db.json` содержит:

- модели FFG (16 типов);
- стандартные тайлы;
- 350 глобальных переменных;
- `tiles` — геометрия стандартных тайлов для генератора карты, в порядке корзины StandardTiles;
- `productOrder` — порядок продуктов в базе FFG.

Кастомные тайлы приключения лежат в `ext.customTiles` файла приключения (id объекта → геометрия).

Арт для доски (только `core-ffg`, только локально):

- `images/tiles/<код>.jpg` — текстуры тайлов, 1024 px;
- `scenario/tileart.json` — меши гексов каждого тайла в его системе координат: центр, вершины, UV, треугольники. Порядок гексов тот же, что в геометрии.

## Версии формата

- `formatVersion` — в каждом файле.
- Несовместимое изменение → +1 и миграция в `content-tools`.
- Новое необязательное поле — без смены версии.

## Сборка и проверка

```bash
python3 tools/importer/export_tiles.py  # геометрия тайлов из игры → data/export/tiles.json
python3 tools/importer/make_pack.py   # data/export + data/out/loc.json → data/packs/core-ffg
python3 tools/importer/export_tile_art.py  # текстуры и меши тайлов для доски
pnpm packs:validate                  # все паки в data/packs (или $JIME_PACKS)
```
