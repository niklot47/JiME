// Game screen (Stage 3.2): board with the HUD and dialogs of the original (screens/game/). The engine (map generation + Session replays)
// runs in a Web Worker (game/worker.ts); this thread only renders the state it sends back.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { keysOf, tokenFamily, type Answer, type LogEntry, type SaveData, type SessionSetup } from "@jime/engine";
import { cubeToWorld, layoutBoard, type GeneratedMap, type TileArtDb } from "@jime/engine/map";
import type { TextDb } from "@jime/content-tools/text";
import { BoardView, type Pick, type Token } from "../board/BoardView.tsx";
import { Board3D } from "../board/Board3D.tsx";
import { GameClient } from "../game/client.ts";
import type { GameState } from "../game/protocol.ts";
import { installFonts, loadAdventure, loadDb, loadText, loadTileArt, loadTokenArt, loadTokenMeshes, type TokenArt, type TokenMeshData, loadFx, loadEnemyArt, loadUiArt, loadUiAtlas, type AtlasSprite, themeChoice, loadPackSet, packConfig } from "../data/pack.ts";
import { textHtml } from "../text/markup.ts";
import { sound } from "../audio/sound.ts";
import { PHASE_KEYS, gameSounds } from "../audio/gameFx.ts";
import { BottomBar, GearButton, PhaseBanner, ThreatBar } from "./game/Hud.tsx";
import { DecisionDialog, EnemyInfoDialog, GameOverDialog, GreenButton, MessageDialog, PartyDialog, SettingsDialog } from "./game/Dialogs.tsx";

const AUTOSAVE = "jime.autosave";
const VIEW_KEY = "jime.board.view";

function readView(): "3d" | "2d" {
  try {
    return localStorage.getItem(VIEW_KEY) === "2d" ? "2d" : "3d";
  } catch {
    return "3d";
  }
}
const LANGS = ["ru", "en", "it"];

interface Game {
  state: GameState;
  board: GeneratedMap | null;
  adv: any;
}

const shortName = (n: string) => n.replace(/^\d+_/, "");

// fallback token look by Token3DType family when the pack has no token art
const TOKEN_LOOK: Record<string, { color: string; glyph: string }> = {
  explore: { color: "#9cc27a", glyph: "✦" },
  search: { color: "#e2c25b", glyph: "?" },
  threat: { color: "#c0392b", glyph: "!" },
  person: { color: "#6f9fd8", glyph: "☻" },
  hexagon: { color: "#7a6a9a", glyph: "◆" },
  terrain: { color: "#8e7f6a", glyph: "▪" },
  none: { color: "#b0a48a", glyph: "·" },
};

// UI names of token types (TOKEN_TYPES ids); TODO(3.5): move to UI localization
const TOKEN_NAMES: Record<number, string> = {
  1: "Исследование", 2: "Поиск", 3: "Угроза", 4: "Гном", 5: "Эльф", 6: "Хоббит", 7: "Человек",
  31: "Тьма", 32: "Труднопроходимая местность", 33: "Укреплённая позиция",
};
const tokenName = (t: number) => TOKEN_NAMES[t] ?? (tokenFamily(t) === "terrain" ? "Местность" : "Жетон");

function readAutosave(): SaveData | null {
  try {
    const s = localStorage.getItem(AUTOSAVE);
    return s ? (JSON.parse(s) as SaveData) : null;
  } catch {
    return null;
  }
}

function writeAutosave(save: SaveData): void {
  try {
    localStorage.setItem(AUTOSAVE, JSON.stringify(save));
  } catch {
    /* storage unavailable: the file save still works */
  }
}

function download(name: string, data: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type GenTile = GeneratedMap["sections"][number]["tiles"][number];

/** World position of a tile space: mean of its hex centers */
function spaceCenter(db: any, adv: any, t: GenTile, si: number): [number, number] | null {
  const geo = t.customPid !== null ? adv.ext?.customTiles?.[String(t.customPid)] : db.tiles.find((g: any) => g.code === t.code);
  const hs: number[] | undefined = geo?.spaces?.[si]?.hexes;
  if (!hs?.length) return null;
  let x = 0, y = 0;
  for (const hi of hs) { const [wx, wy] = cubeToWorld(t.hexes[hi]!); x += wx / hs.length; y += wy / hs.length; }
  return [x, y];
}

function tileCenter(t: GenTile): [number, number] {
  let x = 0, y = 0;
  for (const h of t.hexes) { const [wx, wy] = cubeToWorld(h); x += wx / t.hexes.length; y += wy / t.hexes.length; }
  return [x, y];
}

export function GameScreen({ onBack }: { onBack: () => void }) {
  const client = useRef<GameClient | null>(null);
  const [db, setDb] = useState<any>(null);
  const [art, setArt] = useState<TileArtDb | null>(null);
  const [tokenArt, setTokenArt] = useState<Record<string, TokenArt>>({});
  const [tokenMeshes, setTokenMeshes] = useState<Record<string, TokenMeshData>>({});
  const [fx, setFx] = useState<Record<string, string>>({});
  const [enemyArt, setEnemyArt] = useState<Record<string, string>>({});
  const [uiArt, setUiArt] = useState<Record<string, string>>({});
  const [atlas, setAtlas] = useState<Record<string, AtlasSprite>>({});
  const [lang, setLang] = useState("ru");
  const [langs, setLangs] = useState(LANGS);
  const [text, setText] = useState<TextDb | null>(null);
  const [english, setEnglish] = useState<TextDb | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [game, setGame] = useState<Game | null>(null);
  // setup form
  const [adv, setAdv] = useState(1);
  const [seed, setSeed] = useState(() => (Math.random() * 2 ** 31) | 0);
  const [players, setPlayers] = useState(2);
  const [coreOnly, setCoreOnly] = useState(true);
  const [labels, setLabels] = useState(false);
  const [view3d, setView3d] = useState(() => readView() === "3d");
  const toggleView = (v: boolean) => {
    setView3d(v);
    try { localStorage.setItem(VIEW_KEY, v ? "3d" : "2d"); } catch { /* per-session only */ }
  };
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    client.current = new GameClient();
    void installFonts();
    loadPackSet().then((s) => { if (s.langs.length) setLangs(s.langs); }).catch(() => {});
    Promise.all([loadDb(), loadTileArt(), loadTokenArt(), loadFx(), loadEnemyArt(), loadUiArt(), loadTokenMeshes(), loadUiAtlas()])
      .then(([d, a, t, f, e, u, tm, at]) => { setAtlas(at); setDb(d); setArt(a); setTokenArt(t); setTokenMeshes(tm); setFx(f); setEnemyArt(e); setUiArt(themeChoice() === "original" ? u : {}); })
      .catch((e) => setError(String(e)));
    return () => { client.current?.dispose(); client.current = null; };
  }, []);
  useEffect(() => { loadText(lang).then(setText).catch((e) => setError(String(e))); }, [lang]);
  useEffect(() => { loadText("en").then(setEnglish).catch(() => setEnglish(null)); }, []);

  const say = (key: string | null | undefined, ins: readonly string[] = []) => (key && text ? textHtml(text, key, ins, lang === "en" ? null : english) : "");

  const adventures = useMemo(() => {
    if (!db) return [];
    const AM = db.models.AdventureModel;
    return keysOf(AM).map(Number).sort((a, b) => a - b).filter((k) => AM[k]?.Prefab?.Path)
      .map((k) => ({ id: k, name: (text && AM[k].NameKey && text.raw(AM[k].NameKey)) || shortName(AM[k].m_Name) }));
  }, [db, text]);

  /** Send a request to the worker; the UI stays responsive, decisions are locked while busy */
  async function run(f: (c: GameClient) => Promise<void>) {
    if (!client.current || busy) return;
    setBusy(true);
    try {
      await f(client.current);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const start = (setup: SessionSetup, save?: SaveData) => run(async (c) => {
    const [r, a] = await Promise.all([c.request({ type: "start", setup, save, packConfig: packConfig() }), loadAdventure(setup.adv)]);
    setGame({ state: r.state, board: r.board ?? null, adv: a });
    writeAutosave(r.state.save);
  });

  const update = (req: { type: "answer"; answer: Answer } | { type: "undo" }) => run(async (c) => {
    const { state } = await c.request(req);
    setGame((g) => (g ? { ...g, state } : g));
    writeAutosave(state.save);
  });
  const answer = (a: Answer) => update({ type: "answer", answer: a });

  async function loadFile(f: File) {
    try {
      const data = JSON.parse(await f.text()) as SaveData;
      if (data.format !== "jime-save") throw new Error("Это не файл сохранения JiME");
      await start(data.setup, data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // music: setup screen -> new game theme; in a game -> adventure playlist with ambience
  const inGame = !!game;
  useEffect(() => {
    sound.music(inGame ? "AdventureMusic" : "NewGameMusic");
    sound.ambient(inGame ? "AmbientTracks" : null);
  }, [inGame]);
  useEffect(() => () => sound.ambient(null), []);
  // sounds and the phase banner from what one answer changed (not on undo or load)
  const prevState = useRef<GameState | null>(null);
  // log entries not seen yet, in log order: phase changes play as banners, messages wait in the message box for
  // Continue, like the original (ending a round passes shadow -> rally -> heroes phases in one answer)
  const [unread, setUnread] = useState<LogEntry[]>([]);
  const [modal, setModal] = useState<null | "party" | "settings">(null);
  const [enemyInfo, setEnemyInfo] = useState<number | null>(null);
  useEffect(() => {
    const prev = prevState.current;
    const next = game?.state ?? null;
    prevState.current = next;
    if (!next) { setUnread([]); return; }
    // a new game shows its opening messages; loading or undoing shows none
    if (!prev || next.save.setup.seed !== prev.save.setup.seed || next.answers <= prev.answers) {
      setUnread(!prev && next.answers === 0 ? [...next.log] : []);
      return;
    }
    const added = next.log.slice(prev.log.length);
    setUnread((u) => [...u, ...added]);
    gameSounds(prev.view, next.view, added);
  }, [game?.state]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- setup screen
  if (!game) {
    const auto = readAutosave();
    const ready = !!db && !busy;
    return (
      <div className="shell">
        <button className="link" onClick={onBack}>← Меню</button>
        <h2 className="title">Новая партия</h2>
        {!db && !error && <p className="muted">Загрузка пака…</p>}
        <div className="form">
          <label>Приключение
            <select value={adv} onChange={(e) => setAdv(Number(e.target.value))}>
              {adventures.map((a) => <option key={a.id} value={a.id}>{a.id}. {a.name}</option>)}
            </select>
          </label>
          <label>Игроков
            <div className="row seg">
              {[1, 2, 3, 4, 5].map((n) => <button key={n} className={n === players ? "on" : ""} onClick={() => setPlayers(n)}>{n}</button>)}
            </div>
          </label>
          <label>Язык
            <div className="row seg">
              {langs.map((l) => <button key={l} className={l === lang ? "on" : ""} onClick={() => setLang(l)}>{l}</button>)}
            </div>
          </label>
          <label>Сид
            <div className="row">
              <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) | 0)} />
              <button onClick={() => setSeed((Math.random() * 2 ** 31) | 0)} title="Случайный сид">🎲</button>
            </div>
          </label>
          <label className="check"><input type="checkbox" checked={coreOnly} onChange={(e) => setCoreOnly(e.target.checked)} /> Только базовая коробка</label>
          <button className="primary" disabled={!ready}
            onClick={() => start({ adv, seed, players, language: lang, ...(coreOnly ? { products: [0] } : {}) })}>
            {busy ? "Подготовка…" : "Начать"}
          </button>
          {auto && (
            <button disabled={!ready} onClick={() => start(auto.setup, auto)}>
              Продолжить: приключение {auto.setup.adv}, ходов {auto.answers.length}
            </button>
          )}
          <button disabled={!ready} onClick={() => fileInput.current?.click()}>Загрузить из файла…</button>
          <input ref={fileInput} type="file" accept=".json,application/json" hidden
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void loadFile(f); }} />
          {error && <p className="error">{error}</p>}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- game screen
  // Like the original there is no side panel: messages and decisions are dialogs over the board, the rest is in the
  // party menu (status, chronicle, items) and the settings menu (gear, top right).
  const { state } = game;
  const { view, pending } = state;
  const action = pending?.kind === "action" ? pending : null;
  (window as any).__jimeGame = { state, answer }; // dev checks over CDP (tools/dev)
  // queue head: a phase banner or a message (entries without text are skipped)
  const queue = unread.filter(([, , k, ins]) => PHASE_KEYS.has(k) || !!say(k, ins));
  const head = queue[0];
  const banner = head && PHASE_KEYS.has(head[2]) ? head : null;
  const messages = queue.filter(([, , k]) => !PHASE_KEYS.has(k));
  const talking = queue.length > 0;
  const drop = (e: LogEntry) => setUnread((u) => u.slice(u.indexOf(e) + 1));
  // hero actions: tokens and tiles are picked on the board, enemies in the tracker; the rest gets small buttons
  const attackable = new Map<number, number>();
  const others: { i: number; label: ReactNode }[] = [];
  const lastStands = new Map<number, number>(); // hero -> option index
  action?.options.forEach((o, i) => {
    if (o.type === "attack") attackable.set(o.uid, i);
    else if (o.type === "node") {
      const n = view.nodes.find((x) => x.uid === o.uid);
      if (!n || n.tileId === null || !n.visible || !game.board)
        others.push({ i, label: `${tokenName(o.token)}${o.tile ? ` · тайл ${o.tile}` : ""}${labels ? ` (${shortName(o.name)})` : ""}` });
    } else if (o.type === "explore") {
      if (!game.board) others.push({ i, label: `Исследовать тайл ${o.tile}` });
    } else lastStands.set(o.hero, i);
  });
  const items = (view.campaign.items as any[]).map((id) => {
    const m = db?.models?.ItemModel?.[String(id)];
    return { id: Number(id), key: m?.NameKey ?? null, name: m ? shortName(m.m_Name) : `#${id}` };
  });
  const enemy = enemyInfo !== null ? view.enemies.find((e) => e.uid === enemyInfo) ?? null : null;
  const dialog = banner ? null
    : talking ? <MessageDialog atlas={atlas} say={say} entry={head!} left={messages.length} onNext={() => drop(head!)} onSkipAll={() => setUnread([])} />
    : pending ? <DecisionDialog key={state.answers} d={pending} view={view} atlas={atlas} say={say} enemyArt={enemyArt} onAnswer={answer} />
    : <GameOverDialog view={view} atlas={atlas} onQuit={() => setGame(null)} />;
  return (
    <div className="game-screen hud">
      <div className="board-wrap">
        <GameBoard game={game} db={db} art={art} tokenArt={tokenArt} tokenMeshes={tokenMeshes} fx={fx} table={uiArt.leather} labels={labels} view3d={view3d}
          onAnswer={(a) => { if (!talking && !busy) answer(a); }} />
        <ThreatBar view={view} art={uiArt} atlas={atlas} say={say} />
        <GearButton atlas={atlas} onClick={() => setModal("settings")} />
        {banner && (
          <PhaseBanner key={unread.indexOf(banner) + ":" + unread.length} text={say(banner[2])}
            round={banner[2] === "UI_PHASE_HERO" ? banner[1] : null} atlas={atlas}
            short={queue.length > 1} onDone={() => drop(banner)} />
        )}
        <fieldset className={busy ? "dialogs busy" : "dialogs"} disabled={busy}>{dialog}</fieldset>
        {action && !talking && others.length > 0 && (
          <div className="other-actions">
            {others.map((o) => <GreenButton key={o.i} atlas={atlas} onClick={() => answer(o.i)}>{o.label}</GreenButton>)}
          </div>
        )}
        <BottomBar view={view} atlas={atlas} enemyArt={enemyArt} say={say} attackable={new Set(attackable.keys())}
          canEndRound={!!action && !talking} busy={busy}
          endTitle={action && action.hero >= 0 ? "Закончить ход героя" : "Завершить раунд"}
          onParty={() => setModal("party")} onEnemy={(uid) => setEnemyInfo(uid)} onEndRound={() => answer(null)} />
        {error && <div className="toast error" onClick={() => setError(null)}>{error}</div>}
        {modal === "party" && <PartyDialog view={view} atlas={atlas} say={say} log={state.log} items={items}
          lastStands={talking || busy ? new Map() : lastStands} onLastStand={(i) => { setModal(null); answer(i); }} onClose={() => setModal(null)} />}
        {modal === "settings" && (
          <SettingsDialog atlas={atlas} say={say} view3d={view3d} labels={labels} canUndo={!!state.answers && !busy}
            onView3d={toggleView} onLabels={setLabels} onUndo={() => { setModal(null); update({ type: "undo" }); }}
            onSave={() => download(`jime-${view.adv}-${state.save.setup.seed}.json`, state.save)}
            onQuit={() => { setModal(null); setGame(null); }} onClose={() => setModal(null)} />
        )}
        {enemy && (
          <EnemyInfoDialog atlas={atlas} say={say} art={enemyArt} enemy={enemy} canAttack={attackable.has(enemy.uid) && !talking && !busy}
            onAttack={() => { setEnemyInfo(null); answer(attackable.get(enemy.uid)!); }} onClose={() => setEnemyInfo(null)} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- board
function GameBoard({ game, db, art, tokenArt, tokenMeshes, fx, table, labels, view3d, onAnswer }: {
  game: Game; db: any; art: TileArtDb | null; tokenArt: Record<string, TokenArt>; tokenMeshes: Record<string, TokenMeshData>; fx: Record<string, string>; table?: string; labels: boolean; view3d: boolean;
  onAnswer: (a: Answer) => void;
}) {
  const { board, adv, state: { view, pending } } = game;
  const meshes = useMemo(() => (board && art ? layoutBoard(board, view.adv, art) : []), [board, art, view.adv]);
  const genTiles = useMemo(() => new Map((board?.sections ?? []).flatMap((s) => s.tiles).map((t) => [t.hashId, t])), [board]);

  // option index by pick target for the current hero action
  const targets = useMemo(() => {
    const m = new Map<string, number>();
    if (pending?.kind === "action") {
      pending.options.forEach((o, i) => {
        if (o.type === "node") m.set(`n:${o.uid}`, i);
        else if (o.type === "explore") m.set(`t:${o.tileId}`, i);
      });
    }
    return m;
  }, [pending]);

  const { tokens, shown, colors, sepia } = useMemo(() => {
    const tokens: Token[] = [];
    const shown = new Set<number>();
    const colors = new Map<number, number>();
    const sepia = new Set<number>();
    const shapeOf = (t: number): Token["shape"] => (t === 1 ? "square" : tokenFamily(t) === "hexagon" ? "hex" : "circle");
    const look = (t: number) => {
      const a = tokenArt[String(t)];
      const m = a?.mesh ? tokenMeshes[a.mesh] : undefined;
      return { ...TOKEN_LOOK[tokenFamily(t)]!, image: a?.top, shape: shapeOf(t), skin: a?.raw && m ? { texture: a.raw, mesh: a.mesh!, data: m } : undefined };
    };
    const meshById = new Map(meshes.map((m) => [m.tile.hashId, m]));
    for (const t of view.tiles) {
      if (!t.visible) continue;
      shown.add(t.id);
      if (!t.explored) { colors.set(t.id, 0x7a7a7a); sepia.add(t.id); }
      const gt = genTiles.get(t.id);
      if (gt && !t.explored && t.token) {
        // on the printed explore mark of the tile art, aligned with the tile
        const mesh = meshById.get(t.id);
        const [x, y] = mesh?.explore ?? tileCenter(gt);
        const id = `t:${t.id}`;
        tokens.push({ x, y, id, label: labels ? t.code : "", ...look(1), angle: mesh?.angle ?? 0, active: targets.has(id) });
      }
    }
    for (const n of view.nodes) {
      if (!n.visible || n.tileId === null) continue;
      const gt = genTiles.get(n.tileId);
      // the space's node position from the tile art (TileSpace.NodePosition), else the centre of its hexes
      const p = meshById.get(n.tileId)?.nodes[n.space] ?? (gt && db ? spaceCenter(db, adv, gt, n.space) : null);
      if (!p) continue;
      const id = `n:${n.uid}`;
      tokens.push({ x: p[0], y: p[1], id, label: labels ? shortName(n.name) : "", ...look(n.token), active: targets.has(id) });
    }
    return { tokens, shown, colors, sepia };
  }, [view, targets, labels, genTiles, db, adv, tokenArt, tokenMeshes, meshes]);

  function pick(p: Pick) {
    const i = targets.get(p.kind === "token" ? p.id : `t:${p.id}`);
    if (i !== undefined) onAnswer(i);
  }

  if (!board) return <div className="board empty"><p className="muted">В этом приключении нет генерируемой карты (поле боя или готовая карта). Решения — в диалогах поверх экрана.</p></div>;
  if (view3d) {
    return <Board3D tiles={meshes} tokens={tokens} showLabels={labels} rotation={270}
      shownTiles={shown} sepia={sepia} onPick={pick} fitKey={`${view.adv}:${shown.size}`} fx={fx} table={table} />;
  }
  return <BoardView tiles={meshes} tokens={tokens} showLabels={labels} rotation={270} sectionTint={false}
    shownTiles={shown} tileColors={colors} onPick={pick} fitKey={`${view.adv}:${shown.size}`} />;
}
