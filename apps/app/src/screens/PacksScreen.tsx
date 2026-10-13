// Packs screen: where the app reads content packs from (Tauri) and what is installed there
import { useEffect, useState } from "react";
import { inTauri, packsInfo, setPacksDir, type PacksInfo } from "../data/host.ts";
import { PACK_ID, clearPackCache } from "../data/pack.ts";

const SOURCE: Record<string, string> = {
  env: "переменная окружения JIME_PACKS",
  settings: "выбрана вручную",
  repo: "папка data/packs репозитория (сборка для разработки)",
  default: "папка по умолчанию",
};

const packName = (m: any, lang = "ru"): string =>
  (m && (typeof m.name === "string" ? m.name : m.name?.[lang] ?? m.name?.en)) || "";

export function PacksScreen({ onBack }: { onBack: () => void }) {
  const [info, setInfo] = useState<PacksInfo | null>(null);
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
  }

  useEffect(() => { if (inTauri()) void run(packsInfo); }, []);

  async function change(p: string | null) {
    await run(() => setPacksDir(p));
    clearPackCache(); // the next screen reloads everything from the new folder
  }

  if (!inTauri()) {
    return (
      <div className="shell">
        <button className="link" onClick={onBack}>← Меню</button>
        <h2 className="title">Паки</h2>
        <p>В браузере паки отдаёт dev-сервер Vite из папки <code>data/packs</code> репозитория (или <code>$JIME_PACKS</code>).</p>
        <p className="muted">Выбор папки доступен в приложении (pnpm tauri dev).</p>
      </div>
    );
  }

  const core = info?.packs.find((p) => p.dir === PACK_ID);
  return (
    <div className="shell">
      <button className="link" onClick={onBack}>← Меню</button>
      <h2 className="title">Паки</h2>
      <div className="form wide">
        {info && (
          <p>Папка паков: <b className="path">{info.dir}</b><br />
            <span className="muted">{SOURCE[info.source] ?? info.source}{info.exists ? "" : " — папка не найдена"}</span></p>
        )}
        <label>Другая папка
          <input type="text" value={path} spellCheck={false} onChange={(e) => setPath(e.target.value)}
            placeholder="например D:\JiME_Claude\data\packs" />
        </label>
        <div className="row wrap">
          <button className="primary" disabled={busy || !path.trim() || path === info?.dir} onClick={() => change(path)}>Использовать эту папку</button>
          <button disabled={busy || info?.source !== "settings"} onClick={() => change(null)}>По умолчанию</button>
          <button disabled={busy} onClick={() => run(packsInfo)}>Обновить</button>
        </div>
        {info?.source === "env" && <p className="muted">Пока задана JIME_PACKS, она важнее выбранной папки.</p>}
        {error && <p className="error">{error}</p>}
        {info && (
          <>
            <h3>Установлено</h3>
            {info.packs.length === 0 && <p className="muted">Паков нет.</p>}
            <ul className="packs">
              {info.packs.map((p) => (
                <li key={p.dir}>
                  <b>{p.manifest?.id ?? p.dir}</b> {p.manifest?.version ? `v${p.manifest.version}` : ""}
                  {" "}<span className="muted">{packName(p.manifest) || (p.manifest ? "" : "нет pack.json")}</span>
                </li>
              ))}
            </ul>
            {!core && (
              <p className="error">
                Нет пака «{PACK_ID}» с контентом игры. Соберите его импортёром (<code>pnpm packs:build</code> в репозитории)
                и укажите папку <code>data\packs</code> или скопируйте <code>core-ffg</code> в папку паков.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
