// Packs screen: where packs are read from (Tauri), which are on, and how they layer
import { useEffect, useState } from "react";
import { inTauri, packsInfo, setPacksDir, type PacksInfo } from "../data/host.ts";
import { sound } from "../audio/sound.ts";
import { PACK_ID, clearPackCache, loadPackSet, packConfig, setDisabledPacks, type PackSet } from "../data/pack.ts";

const SOURCE: Record<string, string> = {
  env: "переменная окружения JIME_PACKS",
  settings: "выбрана вручную",
  repo: "папка data/packs репозитория (сборка для разработки)",
  default: "папка по умолчанию",
};

const CONTENT: Record<string, string> = {
  scenario: "сценарии", lang: "язык", voice: "озвучка", theme: "тема", models: "модели", rules: "правила",
};

const ORIGIN: Record<string, string> = {
  "ffg-import": "импорт из игры", community: "сообщество", generated: "сгенерирован", user: "свой",
};

const packName = (m: any, lang = "ru"): string =>
  (m && (typeof m.name === "string" ? m.name : m.name?.[lang] ?? m.name?.en)) || "";

function contentsLabel(m: any): string {
  const parts: string[] = [];
  for (const c of m?.contents ?? []) {
    const t = CONTENT[c.type] ?? c.type;
    parts.push(c.lang ? `${t} ${c.lang}` : t);
  }
  return [...new Set(parts)].join(", ");
}

export function PacksScreen({ onBack, onImport }: { onBack: () => void; onImport: () => void }) {
  const [info, setInfo] = useState<PacksInfo | null>(null);
  const [set, setSet] = useState<PackSet | null>(null);
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reloadLayers() {
    clearPackCache();
    sound.reset();
    try {
      setSet(await loadPackSet());
      setError(null);
    } catch (e) {
      setSet(null);
      setError(String(e));
    }
  }

  async function run(f: () => Promise<PacksInfo>) {
    setBusy(true);
    try {
      const i = await f();
      setInfo(i);
      setPath(i.dir);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
    await reloadLayers();
  }

  useEffect(() => {
    if (inTauri()) void run(packsInfo);
    else void reloadLayers();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(dir: string, on: boolean) {
    const d = new Set(packConfig().disabled);
    if (on) d.delete(dir);
    else d.add(dir);
    setDisabledPacks([...d]);
    void reloadLayers();
  }

  // files each layer provides on top (owner of the virtual path)
  const wins = new Map<string, number>();
  for (const dir of set?.owner.values() ?? []) wins.set(dir, (wins.get(dir) ?? 0) + 1);
  const problem = new Map((set?.problems ?? []).map((p) => [p.dir, p.error]));
  const layerNo = new Map((set?.layers ?? []).map((p, i) => [p.dir, i + 1]));
  const disabled = new Set(packConfig().disabled);
  const hasCore = !!set?.layers.some((p) => p.manifest.id === PACK_ID);

  return (
    <div className="shell">
      <button className="link" onClick={onBack}>← Меню</button>
      <h2 className="title">Паки</h2>
      <div className="form wide">
        {inTauri() ? (
          <>
            {info && (
              <p>Папка паков: <b className="path">{info.dir}</b><br />
                <span className="muted">{SOURCE[info.source] ?? info.source}{info.exists ? "" : " — папка не найдена"}</span></p>
            )}
            <label>Другая папка
              <input type="text" value={path} spellCheck={false} onChange={(e) => setPath(e.target.value)}
                placeholder="например D:\JiME_Claude\data\packs" />
            </label>
            <div className="row wrap">
              <button className="primary" disabled={busy || !path.trim() || path === info?.dir} onClick={() => run(() => setPacksDir(path))}>Использовать эту папку</button>
              <button disabled={busy || info?.source !== "settings"} onClick={() => run(() => setPacksDir(null))}>По умолчанию</button>
              <button disabled={busy} onClick={() => run(packsInfo)}>Обновить</button>
              <button disabled={busy} onClick={onImport}>Импорт из игры…</button>
            </div>
            {info?.source === "env" && <p className="muted">Пока задана JIME_PACKS, она важнее выбранной папки.</p>}
          </>
        ) : (
          <p className="muted">В браузере паки отдаёт dev-сервер Vite из папки <code>data/packs</code> репозитория (или <code>$JIME_PACKS</code>).
            Выбор папки — в приложении (pnpm tauri dev).</p>
        )}
        {error && <p className="error">{error}</p>}

        {set && (
          <>
            <h3>Паки и слои</h3>
            <p className="muted">Слои идут снизу вверх: сначала зависимости, затем по приоритету. Верхний слой перекрывает нижние —
              файлы, тексты по ключу, записи базы по id.</p>
            {set.all.length === 0 && <p className="muted">Паков нет.</p>}
            <ul className="packs layers">
              {[...set.all].sort((a, b) => (layerNo.get(a.dir) ?? 1e9) - (layerNo.get(b.dir) ?? 1e9) || a.dir.localeCompare(b.dir)).map((p) => {
                const m = p.manifest;
                const n = layerNo.get(p.dir);
                const err = problem.get(p.dir);
                const off = disabled.has(p.dir);
                const deps = Object.entries<string>(m?.dependencies ?? {}).map(([k, v]) => `${k} ${v}`).join(", ");
                return (
                  <li key={p.dir} className={err ? "bad" : off ? "off" : ""}>
                    <label className="check">
                      <input type="checkbox" checked={!off} disabled={!m} onChange={(e) => toggle(p.dir, e.target.checked)} />
                      <span>
                        <b>{m?.id ?? p.dir}</b> {m?.version ? `v${m.version}` : ""} <span className="muted">{packName(m)}</span>
                        <br />
                        <span className="muted">
                          {n ? `слой ${n}` : off ? "выключен" : "не загружен"}
                          {m ? ` · приоритет ${m.priority}` : ""}
                          {m?.origin ? ` · ${ORIGIN[m.origin] ?? m.origin}` : ""}
                          {m && contentsLabel(m) ? ` · ${contentsLabel(m)}` : ""}
                          {deps ? ` · зависит от: ${deps}` : ""}
                          {n ? ` · файлов сверху: ${wins.get(p.dir) ?? 0}` : ""}
                          {m?.id !== p.dir && m?.id ? ` · папка ${p.dir}` : ""}
                        </span>
                        {err && <><br /><span className="error">{err}</span></>}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {set.langs.length > 0 && <p className="muted">Языки: {set.langs.join(", ")}</p>}
            {!hasCore && (
              <p className="error">
                Нет включённого пака «{PACK_ID}» с контентом игры. {inTauri() ? <>Нажмите «Импорт из игры…» или укажите папку, где он уже собран
                (например <code>data\packs</code> репозитория).</> : <>Соберите его: <code>pnpm import:game</code>.</>}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
