# JiME Reborn (рабочее название)

[![CI](https://github.com/niklot47/JiME/actions/workflows/ci.yml/badge.svg)](https://github.com/niklot47/JiME/actions/workflows/ci.yml)

Лицензия кода: MIT (`LICENSE`). Контент FFG под неё не подпадает.

Фанатский движок-компаньон для «Властелин колец: Путешествия по Средиземью» (Journeys in Middle-earth, FFG).
Цель: исполнять **оригинальные кампании FFG** без конвертации, максимально близко к оригиналу,
плюс встроенный редактор, озвучка, локализация всех DLC, ИИ-генерация сценариев и кастомизация через паки.

> Контент FFG (тексты, графика, звук, сценарии) в репозиторий и в приложение **не входит**.
> Он извлекается импортёром из копии игры, установленной у пользователя. `data/` в git не попадает.

Репозиторий: https://github.com/niklot47/JiME

## С чего начинать новую сессию с Claude

1. Прочитать `docs/WORKFLOW.md` (кто что делает, где что лежит) и `docs/ROADMAP.md` (текущий этап).
2. Подробности разбора форматов FFG — `docs/NOTES.md`. Справочники оригинала (декомпилированный код, скриншоты, записи экрана, выгрузка интерфейса) — `docs/WORKFLOW.md`, раздел «Справочники».
3. Подготовить окружение на ПК (Linux-VM рабочей среды Claude):
   ```bash
   source "$HOME/mnt/JiME_Claude/tools/env.sh"
   ```

## Структура

| Путь | Что это |
|---|---|
| `packages/schema/` | JSON Schema + типы TS: пак, сценарий, база (`docs/PACKS.md`) |
| `packages/engine/` | Движок без UI (TS): интерпретатор FSM, бот, фаззер, сверка с `engine-py` (`docs/ENGINE.md`) |
| `packages/content-tools/` | Загрузка паков, зависимости, слои, CSV-локализация, CLI проверки |
| `apps/app/` | Приложение: Tauri 2 + React + Vite. Экраны «Игра» (`screens/GameScreen.tsx`) и «Карта» |
| `scripts/` | Мелкие кроссплатформенные обёртки для `pnpm` |
| `tools/importer/` | Python: чтение ассетов Unity из установленной игры → нейтральный JSON (`export_all.py`), локализация (`extract_loc.py`), 3D-ассеты (`proto_extract.py`) |
| `engine-py/` | Прототип интерпретатора сценариев на Python + бот, фаззер, сверка с реальным логом |
| `prototype_3d/` | 3D-прототип поля на Three.js (`jime3d.html`) и его исходники |
| `docs/` | Решения, план, заметки по форматам |
| `data/` (не в git) | Результаты импорта: `export/` (72 приключения, 680 встреч, `db.json`), `out/loc.json`, `packs/core-ffg/`, эталонные логи |
| `Декомпилированые файлы/` (не в git) | ILSpy-декомпиляция FFG (справочник, код не копируем) |

## Быстрые команды: Windows (PowerShell)

Нужны Node ≥ 22.18, pnpm 10 (`npm install -g pnpm@10.34.7`; `corepack enable` без прав администратора падает с EPERM), Python 3; для окна приложения — Rust (`winget install Rustlang.Rustup`) и VS Build Tools с набором «Разработка классических приложений на C++» (иначе `link.exe not found`). Первая сборка Tauri — несколько минут.

```powershell
pnpm install
pnpm test                 # тесты пакетов (node --test, TS без сборки)
pnpm packs:build          # data/export → data/packs/core-ffg
pnpm packs:validate       # проверка всех паков по схемам
pnpm fuzz                 # бот по всем 72 приключениям (TS, ~10 с)
pnpm play 1 7             # сыграть A1 (сид 7) в терминале на русском
pnpm play:bot 1 7         # та же партия ботом
pnpm parity               # сверка TS-движка с engine-py
pnpm dev                  # интерфейс в браузере, http://localhost:1420 (экраны «Игра» и «Карта»)
pnpm tauri dev            # то же в окне Tauri (паки — из папки, см. ниже)
pnpm tauri build          # установщики Windows: target/release/bundle/{nsis,msi} (~2–3 МБ, без контента FFG)
```

### Релизы
Установщики Windows собирает GitHub Actions (`.github/workflows/release.yml`):
- тег `vX.Y.Z` (версия должна совпадать с `apps/app/src-tauri/tauri.conf.json`) → черновик релиза с `.exe` (NSIS) и `.msi`;
- «Run workflow» на вкладке Actions → установщики как артефакт сборки.

```powershell
git tag v0.1.0; git push origin v0.1.0
```

### Паки в приложении (Tauri)
Приложение читает паки из папки (первое найденное):
1. переменная `JIME_PACKS`;
2. папка, выбранная на экране «Паки» (`settings.json` в папке настроек приложения);
3. только dev-сборка: `data/packs` репозитория;
4. `%APPDATA%\io.github.niklot47.jime\packs` (создаётся сама).

Если пака `core-ffg` нет, приложение открывает мастер первого запуска: находит игру в папках Steam, проверяет Python 3 и пакеты импортёра (может поставить их через pip), запускает `tools/importer/import_all.py` с живым логом (~40 с). Установщик содержит только приложение и скрипты импортёра (`importer/` рядом с exe); нужен Python 3 в системе — мастер проверит его и поставит пакеты. Импорт из командной строки: `pnpm import:game -- --game "<папка игры>" --work data`.

Файлы отдаются через схему `jime-pack` (`src-tauri/src/lib.rs`); контент FFG в установщик не входит. Проверка окна без экрана: `tools/dev/cdp.mjs` (WebView2 + DevTools Protocol).

## Быстрые команды: Linux-VM Claude

```bash
source "$HOME/mnt/JiME_Claude/tools/env.sh"
python3 tools/importer/export_all.py              # пересобрать data/export из игры (~20 с)
python3 engine-py/run.py 1 7 > /tmp/a1.log        # одна партия бота в «Bandit Hunt», лог формата LogA
python3 engine-py/fuzz.py 1 300 data/ref/LogA_slot2.txt   # 300 партий + сверка с реальной
python3 engine-py/fuzz_all.py 10                  # все 72 приключения
python3 engine-py/story.py 1 7 ru > story.md      # читаемая история партии
python3 tools/importer/export_tiles.py            # геометрия тайлов (нужна папка игры)
python3 tools/importer/export_fonts.py            # шрифты игры с иконками → packs/core-ffg/fonts
python3 tools/importer/export_tokens.py           # картинки жетонов → packs/core-ffg/images/tokens
python3 tools/importer/make_pack.py               # собрать пак core-ffg
bash tools/vm-node.sh test                        # JS: зеркало в $HOME/jime_build, pnpm install, тесты
bash tools/vm-node.sh packs:validate
```
