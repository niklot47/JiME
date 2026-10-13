// Map screen: generate a board exactly like the original app and show it with the game's tile art
import { useEffect, useMemo, useState } from "react";
import { keysOf } from "@jime/engine";
import { MapGenerator, cubeToWorld, layoutBoard, type GeneratedMap, type TileArtDb } from "@jime/engine/map";
import type { TextDb } from "@jime/content-tools/text";
import { loadAdventure, loadDb, loadText, loadTileArt } from "../data/pack.ts";
import { BoardView, type Token } from "../board/BoardView.tsx";

interface Result {
  map: GeneratedMap;
  adv: any;
  ms: number;
}

const NODE_COLORS: Record<number, string> = { 0: "#d9b45a", 1: "#7fb069", 2: "#c0392b", 3: "#8e7f6a", 4: "#5b4a7a" };
const shortName = (n: string) => n.replace(/^\d+_/, "");

export function MapScreen({ onBack }: { onBack: () => void }) {
  const [db, setDb] = useState<any>(null);
  const [art, setArt] = useState<TileArtDb | null>(null);
  const [text, setText] = useState<TextDb | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adv, setAdv] = useState(1);
  const [seed, setSeed] = useState(1870785907);
  const [players, setPlayers] = useState(3);
  const [coreOnly, setCoreOnly] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [labels, setLabels] = useState(true);
  const [tint, setTint] = useState(false);
  // the original app's camera shows the board rotated by 270° relative to our world axes (checked on a save)
  const [rotation, setRotation] = useState(270);
  const [codes, setCodes] = useState(false);
  const [onlySections, setOnlySections] = useState<number[] | null>(null);

  useEffect(() => {
    Promise.all([loadDb(), loadTileArt(), loadText("en")])
      .then(([d, a, t]) => { setDb(d); setArt(a); setText(t); })
      .catch((e) => setError(String(e)));
  }, []);

  const adventures = useMemo(() => {
    if (!db) return [];
    const AM = db.models.AdventureModel;
    return keysOf(AM).map(Number).sort((a, b) => a - b)
      .filter((k) => AM[k]?.Prefab?.Path)
      .map((k) => ({ id: k, name: (text && AM[k].NameKey && text.raw(AM[k].NameKey)) || shortName(AM[k].m_Name) }));
  }, [db, text]);

  async function generate(s = seed) {
    if (!db) return;
    setBusy(true);
    setError(null);
    try {
      const a = await loadAdventure(adv);
      if (!Object.values<any>(a.gameObjects).some((o) => o.components?.MapBuilder)) throw new Error("В этом приключении нет генерируемой карты (поле боя или готовая карта).");
      await new Promise((r) => setTimeout(r, 0)); // let the UI show "busy"
      const t0 = performance.now();
      const map = new MapGenerator(db, a, { seed: s, players, products: coreOnly ? [0] : db.productOrder, language: "English", maxAttempts: 6 }).generate();
      setResult({ map, adv: a, ms: performance.now() - t0 });
      setOnlySections(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { if (db) void generate(); }, [db]); // eslint-disable-line react-hooks/exhaustive-deps

  const meshes = useMemo(() => (result && art ? layoutBoard(result.map, adv, art) : []), [result, art]); // eslint-disable-line react-hooks/exhaustive-deps

  const tokens = useMemo<Token[]>(() => {
    if (!result || !db) return [];
    const E = db.models.EncounterModel;
    const out: Token[] = [];
    for (const s of result.map.sections) for (const t of s.tiles) {
      const geo = t.customPid !== null ? result.adv.ext?.customTiles?.[String(t.customPid)] : db.tiles.find((g: any) => g.code === t.code);
      t.encounters.forEach((id, si) => {
        if (id < 0 || !geo) return;
        const hs: number[] = geo.spaces[si].hexes;
        let x = 0, y = 0;
        for (const hi of hs) { const [wx, wy] = cubeToWorld(t.hexes[hi]!); x += wx / hs.length; y += wy / hs.length; }
        const m = E[String(id)] ?? {};
        out.push({ x, y, label: shortName(m.m_Name ?? String(id)), color: NODE_COLORS[m.NodeType ?? 0] ?? "#d9b45a", section: s.id });
      });
    }
    return out;
  }, [result, db]);

  const groupName = result?.map.encounterGroup != null ? shortName(db?.models.EncounterGroupModel[String(result.map.encounterGroup)]?.m_Name ?? "") : "—";

  return (
    <div className="map-screen">
      <aside className="panel">
        <button className="link" onClick={onBack}>← Меню</button>
        <h2>Карта</h2>
        {!db && !error && <p className="muted">Загрузка пака…</p>}
        <label>Приключение
          <select value={adv} onChange={(e) => setAdv(Number(e.target.value))}>
            {adventures.map((a) => <option key={a.id} value={a.id}>{a.id}. {a.name}</option>)}
          </select>
        </label>
        <label>Сид
          <div className="row">
            <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) | 0)} />
            <button onClick={() => { const s = (Math.random() * 2 ** 31) | 0; setSeed(s); void generate(s); }} title="Случайный сид">🎲</button>
          </div>
        </label>
        <label>Игроков
          <div className="row seg">
            {[1, 2, 3, 4, 5].map((n) => <button key={n} className={n === players ? "on" : ""} onClick={() => setPlayers(n)}>{n}</button>)}
          </div>
        </label>
        <label className="check"><input type="checkbox" checked={coreOnly} onChange={(e) => setCoreOnly(e.target.checked)} /> Только базовая коробка</label>
        <button className="primary" disabled={!db || busy} onClick={() => generate()}>{busy ? "Генерация…" : "Сгенерировать"}</button>
        <button className="link" onClick={() => { setAdv(1); setSeed(1870785907); setPlayers(3); setCoreOnly(true); }}>Сверка: A1, сид 1870785907, 3 игрока</button>
        <hr />
        <label className="check"><input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> Названия встреч</label>
        <label className="check"><input type="checkbox" checked={tint} onChange={(e) => setTint(e.target.checked)} /> Подсветить секции</label>
        <label className="check"><input type="checkbox" checked={codes} onChange={(e) => setCodes(e.target.checked)} /> Коды тайлов</label>
        {result && (
          <div className="row seg wrap">
            <button className={onlySections === null ? "on" : ""} onClick={() => setOnlySections(null)}>Все</button>
            {result.map.sections.map((s) => (
              <button key={s.id} className={onlySections?.includes(s.id) ? "on" : ""}
                onClick={() => setOnlySections((cur) => { const c = cur ?? []; const n = c.includes(s.id) ? c.filter((x) => x !== s.id) : [...c, s.id]; return n.length ? n : null; })}>S{s.id}</button>
            ))}
          </div>
        )}
        <button onClick={() => setRotation((r) => (r + 90) % 360)}>Повернуть вид на 90° ({rotation === 270 ? "как в оригинале" : `${rotation}°`})</button>
        {error && <p className="error">{error}</p>}
        {result && (
          <div className="info">
            <p>Сид карты: <b>{result.map.seed}</b>{result.map.attempts > 1 ? ` (попыток: ${result.map.attempts})` : ""}</p>
            <p>Группа встреч: <b>{groupName}</b> · {result.ms.toFixed(0)} мс</p>
            {result.map.sections.map((s) => (
              <p key={s.id} className="muted">Секция {s.id}: {s.tiles.map((t) => t.code).join(", ")}</p>
            ))}
          </div>
        )}
      </aside>
      <BoardView tiles={meshes} tokens={tokens} showLabels={labels} rotation={rotation} sectionTint={tint} showCodes={codes} sections={onlySections} />
    </div>
  );
}
