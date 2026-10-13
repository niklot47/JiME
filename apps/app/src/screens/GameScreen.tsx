// Game screen (Stage 3.2): board + log + decision panel. The engine (map generation + Session replays)
// runs in a Web Worker (game/worker.ts); this thread only renders the state it sends back.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { keysOf, tokenFamily, type Answer, type Decision, type GameView, type LogEntry, type SaveData, type SessionSetup } from "@jime/engine";
import { cubeToWorld, layoutBoard, type GeneratedMap, type TileArtDb } from "@jime/engine/map";
import type { TextDb } from "@jime/content-tools/text";
import { BoardView, type Pick, type Token } from "../board/BoardView.tsx";
import { Board3D } from "../board/Board3D.tsx";
import { GameClient } from "../game/client.ts";
import type { GameState } from "../game/protocol.ts";
import { installFonts, loadAdventure, loadDb, loadText, loadTileArt, loadTokenArt, loadFx, loadEnemyArt, assetUrl, loadPackSet, packConfig } from "../data/pack.ts";
import { textHtml } from "../text/markup.ts";

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
  const [tokenArt, setTokenArt] = useState<Record<string, string>>({});
  const [fx, setFx] = useState<Record<string, string>>({});
  const [enemyArt, setEnemyArt] = useState<Record<string, string>>({});
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
    Promise.all([loadDb(), loadTileArt(), loadTokenArt(), loadFx(), loadEnemyArt()])
      .then(([d, a, t, f, e]) => { setDb(d); setArt(a); setTokenArt(t); setFx(f); setEnemyArt(e); })
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
  const { state } = game;
  const { view, pending } = state;
  return (
    <div className="game-screen">
      <div className="board-wrap">
        <GameBoard game={game} db={db} art={art} tokenArt={tokenArt} fx={fx} labels={labels} view3d={view3d} onAnswer={answer} />
        <EnemyTracker view={view} pending={pending} art={enemyArt} say={say} disabled={busy} onAnswer={answer} />
      </div>
      <aside className={busy ? "game-panel busy" : "game-panel"}>
        <div className="row spread">
          <button className="link" onClick={() => setGame(null)}>← Партии</button>
          <div className="row">
            <button onClick={() => update({ type: "undo" })} disabled={!state.answers || busy} title="Отменить последний ответ">↶ Отмена</button>
            <button onClick={() => download(`jime-${view.adv}-${state.save.setup.seed}.json`, state.save)} title="Сохранить в файл">💾</button>
          </div>
        </div>
        <Status view={view} say={say} />
        <div className="row wrap">
          <label className="check"><input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> Названия жетонов</label>
          <label className="check"><input type="checkbox" checked={view3d} onChange={(e) => toggleView(e.target.checked)} /> 3D</label>
        </div>
        {error && <p className="error">{error}</p>}
        <DecisionPanel key={state.answers} d={pending} view={view} say={say} onAnswer={answer} disabled={busy} labels={labels} />
        <GameLog log={state.log} say={say} />
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------- board
function GameBoard({ game, db, art, tokenArt, fx, labels, view3d, onAnswer }: {
  game: Game; db: any; art: TileArtDb | null; tokenArt: Record<string, string>; fx: Record<string, string>; labels: boolean; view3d: boolean;
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
    const look = (t: number) => ({ ...TOKEN_LOOK[tokenFamily(t)]!, image: tokenArt[String(t)], shape: shapeOf(t) });
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
      const p = gt && db ? spaceCenter(db, adv, gt, n.space) : null;
      if (!p) continue;
      const id = `n:${n.uid}`;
      tokens.push({ x: p[0], y: p[1], id, label: labels ? shortName(n.name) : "", ...look(n.token), active: targets.has(id) });
    }
    return { tokens, shown, colors, sepia };
  }, [view, targets, labels, genTiles, db, adv, tokenArt, meshes]);

  function pick(p: Pick) {
    const i = targets.get(p.kind === "token" ? p.id : `t:${p.id}`);
    if (i !== undefined) onAnswer(i);
  }

  if (!board) return <div className="board empty"><p className="muted">В этом приключении нет генерируемой карты (поле боя или готовая карта). Играйте через панель справа.</p></div>;
  if (view3d) {
    return <Board3D tiles={meshes} tokens={tokens} showLabels={labels} rotation={270}
      shownTiles={shown} sepia={sepia} onPick={pick} fitKey={`${view.adv}:${shown.size}`} fx={fx} />;
  }
  return <BoardView tiles={meshes} tokens={tokens} showLabels={labels} rotation={270} sectionTint={false}
    shownTiles={shown} tileColors={colors} onPick={pick} fitKey={`${view.adv}:${shown.size}`} />;
}

// ---------------------------------------------------------------- status
type Say = (key: string | null | undefined, ins?: readonly string[]) => string;

function Status({ view, say }: { view: GameView; say: Say }) {
  const pct = view.threatMax > 0 ? Math.min(100, (100 * view.threat) / view.threatMax) : 0;
  return (
    <div className="status">
      <div className="row spread">
        <span>Раунд <b>{view.round}</b></span>
        <span>Угроза <b>{view.threat}</b>{view.threatMax > 0 ? ` / ${view.threatMax}` : ""}</span>
      </div>
      {view.threatMax > 0 && <div className="bar"><div style={{ width: `${pct}%` }} /></div>}
      {view.objective && <p className="objective" dangerouslySetInnerHTML={{ __html: say(view.objective, view.objectiveInserts) }} />}
      <div className="heroes">
        {view.heroes.map((h, i) => (
          <span key={i} className={h.defeated ? "hero down" : "hero"} title="Сложность следующего последнего рубежа">
            Герой {i + 1}{h.defeated ? " — повержен" : ` · рубеж ${h.lastStand}`}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- decision
function Stepper({ initial = 0, label, onOk }: { initial?: number; label: string; onOk: (n: number) => void }) {
  const [n, setN] = useState(initial);
  return (
    <div className="stepper">
      <span>{label}</span>
      <div className="row">
        <button onClick={() => setN((v) => Math.max(0, v - 1))}>−</button>
        <b className="num">{n}</b>
        <button onClick={() => setN((v) => v + 1)}>+</button>
        <button className="primary" onClick={() => onOk(n)}>Готово</button>
      </div>
    </div>
  );
}

function DecisionPanel({ d, view, say, onAnswer, disabled, labels }: {
  d: Decision | null; view: GameView; say: Say; onAnswer: (a: Answer) => void; disabled: boolean; labels: boolean;
}) {
  if (!d) {
    return (
      <div className="decision">
        <h3>Игра окончена</h3>
        <p>{view.result === "victory" ? "Победа" : view.result === "defeat" ? "Поражение" : view.ended}</p>
        <p className="muted">Раунд {view.round} · лор {view.campaign.lore} · опыт {view.campaign.xp}</p>
      </div>
    );
  }
  const prompt = "inserts" in d && d.key ? <p className="prompt" dangerouslySetInnerHTML={{ __html: say(d.key, d.inserts) }} /> : null;
  return <fieldset className="decision-wrap" disabled={disabled}>{body(d)}</fieldset>;

  function body(d: Decision) {
  switch (d.kind) {
    case "choice":
      return (
        <div className="decision">
          {prompt}
          {d.choices.map((c, i) => <button key={i} onClick={() => onAnswer(i)} dangerouslySetInnerHTML={{ __html: say(c.key, c.inserts) || `#${i + 1}` }} />)}
          {d.canCancel && <button className="link" onClick={() => onAnswer(null)}>Отмена</button>}
        </div>
      );
    case "test":
      return <div className="decision">{prompt}<Stepper label={`Сколько успехов? (важно до ${d.top})`} onOk={onAnswer} /></div>;
    case "attack":
      return (
        <div className="decision">
          <p className="prompt"><span dangerouslySetInnerHTML={{ __html: say(d.enemy) }} /> ×{d.size} · урон {d.damage}/{d.unitHp}</p>
          <Stepper label="Нанесённый урон" onOk={onAnswer} />
        </div>
      );
    case "confirm":
      return (
        <div className="decision">
          {prompt}
          <div className="row"><button className="primary" onClick={() => onAnswer(true)}>Да</button><button onClick={() => onAnswer(false)}>Нет</button></div>
        </div>
      );
    case "lastStand":
      return (
        <div className="decision">
          <h3>Последний рубеж: Герой {d.hero + 1} ({d.physical ? "урон" : "страх"})</h3>
          {d.key && <p className="prompt" dangerouslySetInnerHTML={{ __html: say(d.key, d.inserts) }} />}
          <div className="row"><button className="primary" onClick={() => onAnswer(true)}>Пройден</button><button onClick={() => onAnswer(false)}>Провален</button></div>
        </div>
      );
    case "lastStandType":
      return (
        <div className="decision">
          <h3>Последний рубеж: Герой {d.hero + 1}</h3>
          <p className="prompt">От чего герой повержен?</p>
          <div className="row">
            <button className="primary" onClick={() => onAnswer(true)} dangerouslySetInnerHTML={{ __html: say("UI_PHYSICAL") || "Урон" }} />
            <button className="primary" onClick={() => onAnswer(false)} dangerouslySetInnerHTML={{ __html: say("UI_FEAR") || "Страх" }} />
          </div>
        </div>
      );
    case "hero":
      return (
        <div className="decision">
          {prompt}
          <div className="row wrap">
            {Array.from({ length: d.players }, (_, i) => <button key={i} onClick={() => onAnswer({ player: i, skip: false })}>Герой {i + 1}</button>)}
          </div>
          {d.canSkip && <button className="link" onClick={() => onAnswer({ player: 0, skip: true })}>Пропустить</button>}
        </div>
      );
    case "action":
      return (
        <div className="decision">
          <h3>{d.hero >= 0 ? `Ход героя ${d.hero + 1}` : "Фаза героев"}</h3>
          <p className="muted">Нажмите на жетон или тайл на карте, или выберите действие:</p>
          {d.options.map((o, i) => (
            <button key={i} onClick={() => onAnswer(i)}>
              {o.type === "node" ? `${tokenName(o.token)}${o.tile ? ` · тайл ${o.tile}` : ""}${labels ? ` (${shortName(o.name)})` : ""}`
                : o.type === "explore" ? `Исследовать тайл ${o.tile}`
                : o.type === "lastStand" ? `Последний рубеж: Герой ${o.hero + 1}`
                : <>Атаковать: <span dangerouslySetInnerHTML={{ __html: say(o.enemy) }} /> ×{o.size}</>}
            </button>
          ))}
          <button className={d.hero >= 0 ? "link" : "primary"} onClick={() => onAnswer(null)}>{d.hero >= 0 ? "Закончить ход героя" : "Завершить раунд"}</button>
        </div>
      );
    }
  }
}

// ---------------------------------------------------------------- log
function GameLog({ log, say }: { log: readonly LogEntry[]; say: Say }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [log.length]);
  const items: ReactNode[] = [];
  let round = 0;
  log.forEach(([, r, key, ins], i) => {
    if (r !== round) { round = r; items.push(<div key={`r${i}`} className="round">Раунд {r}</div>); }
    const html = say(key, ins);
    if (html) items.push(<p key={i} dangerouslySetInnerHTML={{ __html: html }} />);
  });
  return <div className="log">{items}<div ref={end} /></div>;
}

// ---------------------------------------------------------------- enemy tracker
/** Enemy groups as cards over the board (like the original's tracker); a card is a button when it can be attacked */
function EnemyTracker({ view, pending, art, say, disabled, onAnswer }: {
  view: GameView; pending: Decision | null; art: Record<string, string>; say: Say; disabled: boolean; onAnswer: (a: Answer) => void;
}) {
  if (!view.enemies.length) return null;
  const attack = new Map<number, number>();
  if (pending?.kind === "action") pending.options.forEach((o, i) => { if (o.type === "attack") attack.set(o.uid, i); });
  return (
    <div className="tracker">
      {view.enemies.map((e) => {
        const i = attack.get(e.uid);
        const icon = art[String(e.model)];
        const hp = Math.max(0, e.unitHp - e.damage);
        const body = (
          <>
            {icon ? <img src={assetUrl(icon)} alt="" /> : <div className="noicon">?</div>}
            <div className="info">
              <b dangerouslySetInnerHTML={{ __html: say(e.name) }} />
              <span className="count">×{e.size}{e.armor ? <span title="Броня"> · 🛡{e.armor}</span> : null}</span>
              <div className="hp" title={`Здоровье текущего врага ${hp}/${e.unitHp}`}><div style={{ width: `${(100 * hp) / Math.max(1, e.unitHp)}%` }} /></div>
              {e.exhausted && <span className="muted">истощён</span>}
            </div>
          </>
        );
        return i !== undefined
          ? <button key={e.uid} className={`enemy can${e.exhausted ? " exhausted" : ""}`} disabled={disabled} title="Атаковать" onClick={() => onAnswer(i)}>{body}</button>
          : <div key={e.uid} className={`enemy${e.exhausted ? " exhausted" : ""}`}>{body}</div>;
      })}
    </div>
  );
}
