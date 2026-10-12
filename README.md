# JiME Reborn (рабочее название)

Лицензия кода: MIT (`LICENSE`). Контент FFG под неё не подпадает.

Фанатский движок-компаньон для «Властелин колец: Путешествия по Средиземью» (Journeys in Middle-earth, FFG).
Цель: исполнять **оригинальные кампании FFG** без конвертации, максимально близко к оригиналу,
плюс встроенный редактор, озвучка, локализация всех DLC, ИИ-генерация сценариев и кастомизация через паки.

> Контент FFG (тексты, графика, звук, сценарии) в репозиторий и в приложение **не входит**.
> Он извлекается импортёром из копии игры, установленной у пользователя. `data/` в git не попадает.

Репозиторий: https://github.com/niklot47/JiME

## С чего начинать новую сессию с Claude

1. Прочитать `docs/WORKFLOW.md` (кто что делает, где что лежит) и `docs/ROADMAP.md` (текущий этап).
2. Подробности разбора форматов FFG — `docs/NOTES.md`.
3. Подготовить окружение на ПК (Linux-VM рабочей среды Claude):
   ```bash
   source "$HOME/mnt/JiME_Claude/tools/env.sh"
   ```

## Структура

| Путь | Что это |
|---|---|
| `packages/schema/` | JSON Schema + типы TS: пак, сценарий, база (`docs/PACKS.md`) |
| `packages/engine/` | Движок без UI (TS). Пока: ГСЧ с сидом; перенос `engine-py` — Этап 2 |
| `packages/content-tools/` | Загрузка паков, зависимости, слои, CSV-локализация, CLI проверки |
| `apps/app/` | Приложение: Tauri 2 + React + Vite |
| `scripts/` | Мелкие кроссплатформенные обёртки для `pnpm` |
| `tools/importer/` | Python: чтение ассетов Unity из установленной игры → нейтральный JSON (`export_all.py`), локализация (`extract_loc.py`), 3D-ассеты (`proto_extract.py`) |
| `engine-py/` | Прототип интерпретатора сценариев на Python + бот, фаззер, сверка с реальным логом |
| `prototype_3d/` | 3D-прототип поля на Three.js (`jime3d.html`) и его исходники |
| `docs/` | Решения, план, заметки по форматам |
| `data/` (не в git) | Результаты импорта: `export/` (72 приключения, 680 встреч, `db.json`), `out/loc.json`, `packs/core-ffg/`, эталонные логи |
| `Декомпилированые файлы/` (не в git) | ILSpy-декомпиляция FFG (справочник, код не копируем) |

## Быстрые команды: Windows (PowerShell)

Нужны Node ≥ 22.18, pnpm 10 (`npm install -g pnpm@10.34.7`; `corepack enable` без прав администратора падает с EPERM), Python 3; для окна приложения — Rust и [зависимости Tauri](https://tauri.app/start/prerequisites/).

```powershell
pnpm install
pnpm test                 # тесты пакетов (node --test, TS без сборки)
pnpm packs:build          # data/export → data/packs/core-ffg
pnpm packs:validate       # проверка всех паков по схемам
pnpm fuzz                 # бот по всем приключениям (пока engine-py)
pnpm dev                  # интерфейс в браузере, http://localhost:1420
pnpm tauri dev            # то же в окне Tauri
pnpm tauri build          # установщик Windows
```

## Быстрые команды: Linux-VM Claude

```bash
source "$HOME/mnt/JiME_Claude/tools/env.sh"
python3 tools/importer/export_all.py              # пересобрать data/export из игры (~20 с)
python3 engine-py/run.py 1 7 > /tmp/a1.log        # одна партия бота в «Bandit Hunt», лог формата LogA
python3 engine-py/fuzz.py 1 300 data/ref/LogA_slot2.txt   # 300 партий + сверка с реальной
python3 engine-py/fuzz_all.py 10                  # все 72 приключения
python3 engine-py/story.py 1 7 ru > story.md      # читаемая история партии
python3 tools/importer/make_pack.py               # собрать пак core-ffg
bash tools/vm-node.sh test                        # JS: зеркало в $HOME/jime_build, pnpm install, тесты
bash tools/vm-node.sh packs:validate
```
