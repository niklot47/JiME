// First-run wizard (Tauri): find the game -> check Python and the importer's packages -> import -> done.
// Opens by itself when the packs folder has no core-ffg; also reachable from the Packs screen.
import { useEffect, useRef, useState } from "react";
import { checkGame, detectGame, installRequirements, onImportDone, onImportLog, packsInfo, pythonInfo, runImport,
  type GameCandidate, type PacksInfo, type PythonInfo } from "../data/host.ts";
import { clearPackCache } from "../data/pack.ts";

type Step = "game" | "python" | "import" | "done";
const STEP_NAMES: Record<string, string> = {
  extract_loc: "тексты и переводы", export_all: "сценарии и встречи", export_tiles: "геометрия тайлов", make_pack: "сборка пака",
  export_tile_art: "картинки тайлов", export_fonts: "шрифты", export_tokens: "жетоны", export_fx: "эффекты", export_icons: "портреты врагов", export_ui: "оформление", export_atlas: "элементы интерфейса",
};

export function SetupScreen({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const [step, setStep] = useState<Step>("game");
  const [found, setFound] = useState<GameCandidate[] | null>(null);
  const [game, setGame] = useState("");
  const [gameOk, setGameOk] = useState<string | null>(null);
  const [py, setPy] = useState<PythonInfo | null>(null);
  const [packs, setPacks] = useState<PacksInfo | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ i: number; n: number; name: string } | null>(null);
  const [running, setRunning] = useState<null | "pip" | "import">(null);
  const [error, setError] = useState<string | null>(null);
  const logEnd = useRef<HTMLDivElement>(null);

  // background job output (pip / import)
  useEffect(() => {
    const offs = [
      onImportLog((line) => {
        const m = /^@@step (\d+) (\d+) (\S+)/.exec(line);
        if (m) setProgress({ i: Number(m[1]), n: Number(m[2]), name: m[3]! });
        setLog((l) => (l.length > 2000 ? [...l.slice(-1500), line] : [...l, line]));
      }),
      onImportDone(async (d) => {
        setRunning(null);
        if (!d.ok) { setError(d.task === "pip" ? "Не удалось установить пакеты (см. лог)." : "Импорт не удался (см. лог)."); return; }
        setError(null);
        if (d.task === "pip") void refreshPython();
        else { clearPackCache(); setPacks(await packsInfo()); setStep("done"); }
      }),
    ];
    return () => { for (const p of offs) void p.then((off) => off()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { logEnd.current?.scrollIntoView({ block: "end" }); }, [log.length]);

  useEffect(() => {
    detectGame().then((c) => { setFound(c); if (c[0]) { setGame(c[0].path); setGameOk(c[0].dataDir); } }).catch((e) => setError(String(e)));
    packsInfo().then(setPacks).catch(() => {});
  }, []);

  async function verifyGame() {
    try {
      setGameOk(await checkGame(game));
      setError(null);
    } catch (e) {
      setGameOk(null);
      setError(String(e));
    }
  }

  async function refreshPython() {
    try {
      setPy(await pythonInfo());
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function start(kind: "pip" | "import") {
    if (!py?.exe) return;
    setLog([]);
    setProgress(null);
    setError(null);
    try {
      setRunning(kind);
      if (kind === "pip") await installRequirements(py.exe);
      else await runImport(py.exe, game);
    } catch (e) {
      setRunning(null);
      setError(String(e));
    }
  }

  const stepper = (
    <ol className="steps">
      {(["game", "python", "import", "done"] as Step[]).map((s, i) => (
        <li key={s} className={s === step ? "on" : ""}>{i + 1}. {{ game: "Игра", python: "Python", import: "Импорт", done: "Готово" }[s]}</li>
      ))}
    </ol>
  );

  return (
    <div className="shell">
      <h2 className="title">Первый запуск</h2>
      {stepper}
      <div className="form wide">
        {step === "game" && (
          <>
            <p>JiME Reborn не содержит контента игры. Он берёт тексты, сценарии и графику из вашей установленной копии
              «Journeys in Middle-earth» и собирает из них локальный пак. Файлы игры не изменяются.</p>
            {found === null ? <p className="muted">Ищу игру…</p>
              : found.length ? <p className="muted">Найдено: {found.map((c) => c.path).join("; ")}</p>
              : <p className="muted">Игра в обычных папках Steam не найдена — укажите папку вручную.</p>}
            <label>Папка игры
              <input type="text" value={game} spellCheck={false} placeholder="…\steamapps\common\Journeys in Middle-earth"
                onChange={(e) => { setGame(e.target.value); setGameOk(null); }} />
            </label>
            <div className="row wrap">
              <button disabled={!game.trim()} onClick={verifyGame}>Проверить</button>
              <button className="primary" disabled={!gameOk} onClick={() => { setStep("python"); void refreshPython(); }}>Дальше</button>
            </div>
            {gameOk && <p className="muted">Данные игры: {gameOk}</p>}
          </>
        )}

        {step === "python" && (
          <>
            <p>Импортёр написан на Python: для чтения файлов Unity нет надёжной библиотеки на JavaScript.</p>
            {!py && <p className="muted">Проверяю Python…</p>}
            {py && !py.exe && (
              <p className="error">Python 3 не найден. Установите его с python.org (отметьте «Add python.exe to PATH»),
                затем нажмите «Проверить снова».</p>
            )}
            {py?.exe && <p>Python {py.version} (<code>{py.exe}</code>)</p>}
            {py && !py.importer && <p className="error">Не найдены скрипты импортёра в составе приложения.</p>}
            {py?.exe && py.missing.length > 0 && (
              <p>Не хватает пакетов: <b>{py.missing.join(", ")}</b>. Их можно установить командой{" "}
                <code>{py.exe} -m pip install --user -r requirements.txt</code> — или кнопкой ниже.</p>
            )}
            {py?.exe && py.missing.length === 0 && py.importer && <p>Все пакеты на месте.</p>}
            <div className="row wrap">
              <button onClick={refreshPython} disabled={!!running}>Проверить снова</button>
              {py?.exe && py.missing.length > 0 && (
                <button className="primary" disabled={!!running} onClick={() => start("pip")}>
                  {running === "pip" ? "Устанавливаю…" : "Установить пакеты"}
                </button>
              )}
              <button className="primary" disabled={!py?.exe || py.missing.length > 0 || !py.importer || !!running} onClick={() => setStep("import")}>Дальше</button>
              <button className="link" onClick={() => setStep("game")}>← Назад</button>
            </div>
          </>
        )}

        {step === "import" && (
          <>
            <p>Пак будет собран в папке <b className="path">{packs?.dir ?? "…"}</b>. Это займёт несколько минут.</p>
            {progress && (
              <div className="progress">
                <div className="bar"><div style={{ width: `${(100 * (progress.i - (running ? 1 : 0))) / progress.n}%` }} /></div>
                <span>Шаг {progress.i} из {progress.n}: {STEP_NAMES[progress.name] ?? progress.name}</span>
              </div>
            )}
            <div className="row wrap">
              <button className="primary" disabled={!!running} onClick={() => start("import")}>{running ? "Импорт идёт…" : log.length ? "Повторить импорт" : "Импортировать"}</button>
              <button className="link" disabled={!!running} onClick={() => setStep("python")}>← Назад</button>
            </div>
          </>
        )}

        {step === "done" && (
          <>
            <p>Готово. Пак «core-ffg» собран{packs ? <> в <b className="path">{packs.dir}</b></> : null}.</p>
            <button className="primary" onClick={onDone}>В меню</button>
          </>
        )}

        {error && <p className="error">{error}</p>}
        {log.length > 0 && (
          <pre className="joblog">{log.filter((l) => !l.startsWith("@@")).join("\n")}<div ref={logEnd} /></pre>
        )}
        {step !== "done" && <button className="link" disabled={!!running} onClick={onSkip}>Пропустить (паки уже есть или будут указаны вручную)</button>}
      </div>
    </div>
  );
}
