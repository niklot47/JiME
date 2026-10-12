// Scenario interpreter: PlayMaker FSM semantics over FFG prefab data + simplified board and enemies.
// Faithful port of engine-py/engine.py (Stage 2.1). Behaviour must stay identical run-for-run:
// cli/parity.ts diffs both engines on the same seeds. Change semantics only together with engine-py
// or after engine-py is retired.
import { PyRandom } from "./pyrandom.ts";
import { keysOf, valuesOf } from "./ojson.ts";
import { Counter, gd, isDict, or, pyStr, toInt, truthy } from "./py.ts";
import { ACTIONS } from "./actions.ts";
import { generateMap, type GeneratedMap } from "./map/mapgen.ts";

/** Supplies scenario data (pack on disk, in-memory, network ...) */
export interface ContentSource {
  db(): any;
  /** A fresh (mutable) copy of the adventure prefab */
  adventure(id: number | string): any;
  /** Encounter prefab or null; may be shared between games (engine-py caches it too) */
  encounter(id: number): any | null;
}

export type Difficulty = "normal" | "hard" | "adventure";
export type LogEntry = [advIndex: number, round: number, key: string, inserts: string[]];

const KEY_RE = /^«([^\n]+)»\n?$/;

/** Localization key from a compacted message value («KEY» or {key|options}) */
export function keyOf(v: unknown): any {
  if (typeof v === "string") {
    const m = KEY_RE.exec(v);
    return m ? m[1] : null;
  }
  if (isDict(v)) {
    if (Object.hasOwn(v, "key")) return v.key ?? null;
    if (truthy(v.options)) return v.options[0] ?? null;
  }
  return null;
}

export class EndGame extends Error {}

export const NODE_KINDS = ["Encounter", "Explore", "Threat", "Terrain", "Darkness", "Difficult", "Fortified"];

// ---------------------------------------------------------------- FSM instance
export class Fsm {
  readonly id: number;
  readonly name: string;
  vars: Record<string, any>;
  readonly states = new Map<string, any>();
  readonly glob: Record<string, string>;
  readonly events = new Set<string>();
  state: string | null = null;
  finished = false;
  started = false;
  processing = false;

  readonly game: Game;
  readonly data: any;
  readonly owner: Obj;

  constructor(game: Game, data: any, owner: Obj) {
    this.id = game.nextId();
    this.game = game;
    this.data = data;
    this.owner = owner;
    this.name = gd(data, "name", "FSM");
    this.vars = structuredClone(gd(data, "variables", {}));
    for (const s of data.states) this.states.set(s.name, s);
    this.glob = gd(data, "global", {});
    for (const k of Object.keys(this.glob)) this.events.add(k);
    for (const s of data.states) for (const k of Object.keys(s.transitions)) this.events.add(k);
  }

  usesEvent(ev: any): boolean {
    return this.events.has(ev);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.goto(this.data.start);
  }

  canHandle(ev: string): boolean {
    if (this.finished) return false;
    if (Object.hasOwn(this.glob, ev)) return true;
    const st = this.state === null ? undefined : this.states.get(this.state);
    return st !== undefined && Object.hasOwn(st.transitions, ev);
  }

  /** Deliver an event; true if a transition happened */
  send(ev: any): boolean {
    if (!this.started) this.start();
    if (this.finished || !truthy(ev)) return false;
    let tgt: string | null = null;
    if (Object.hasOwn(this.glob, ev)) tgt = this.glob[ev]!;
    else {
      const st = this.state === null ? undefined : this.states.get(this.state);
      if (st && Object.hasOwn(st.transitions, ev)) tgt = st.transitions[ev];
    }
    if (tgt === null) return false;
    this.goto(tgt);
    return true;
  }

  goto(name: string | null): void {
    const g = this.game;
    let hops = 0;
    while (name !== null && name !== undefined) {
      hops++;
      if (hops > 500) { g.warn(`loop guard in ${this.owner.name}/${this.name} at ${name}`); return; }
      if (!this.states.has(name)) { g.warn(`missing state ${pyStr(name)}`); return; }
      this.state = name;
      g.coverage.inc(`${this.owner.src}\u001f${this.name}\u001f${name}`);
      const st = this.states.get(name);
      let nxt: string | null = null;
      let broke = false;
      for (const a of st.actions) {
        if (!truthy(gd(a, "enabled", true))) continue;
        g.actionCount.inc(a.action);
        const beforeState: string | null = this.state;
        const beforeSerial = g.transitionSerial.get(this.id) ?? 0;
        const ev = g.execAction(this, a);
        if (this.finished) return;
        if (this.state !== beforeState || (g.transitionSerial.get(this.id) ?? 0) !== beforeSerial) return; // nested event moved us
        if (truthy(ev)) {
          if (Object.hasOwn(this.glob, ev)) nxt = this.glob[ev]!;
          else if (Object.hasOwn(st.transitions, ev)) nxt = st.transitions[ev];
          else { g.warn(`unhandled event '${pyStr(ev)}' in ${this.owner.name}/${name}`); return; }
          broke = true;
          break;
        }
      }
      if (!broke) nxt = gd(st.transitions, "FINISHED", null);
      g.transitionSerial.set(this.id, (g.transitionSerial.get(this.id) ?? 0) + 1);
      name = nxt;
    }
  }
}

// ---------------------------------------------------------------- scene objects
/** A GameObject from an exported prefab (adventure or encounter instance) */
export class Obj {
  readonly name: string;
  readonly components: Record<string, any>;
  readonly fsms: Fsm[] = [];
  visible = false;
  node: GameNode | null = null;
  enemyGroup: EnemyGroup | null = null;
  /** AddThreatEvent override; source prefab data is never mutated (replays reuse it) */
  threatThreshold: number | null = null;
  readonly game: Game;
  readonly src: string;
  readonly pid: number;
  readonly go: any;
  readonly prefab: any;

  constructor(game: Game, src: string, pid: number, go: any, prefab: any) {
    this.game = game;
    this.src = src;
    this.pid = pid;
    this.go = go;
    this.prefab = prefab;
    this.name = go.name;
    this.components = go.components;
  }
}

export interface Space {
  traits: number;
  encounter: number | null;
  node: GameNode | null;
}

export class Tile {
  readonly spaces: Space[];
  visible = false;
  explored = false;
  exploreToken = true;
  readonly adjacentSections = new Set<number>();
  /** FFG mode: adjacent section ids in FFG order (ConnectedSpaces discovery order) */
  adjacentOrdered: number[] | null = null;
  readonly code: string;
  readonly id: number;
  readonly section: number;
  readonly custom: Obj | null;

  constructor(code: string, id: number, spaces: any[], section: number, custom: Obj | null = null) {
    this.code = code;
    this.id = id;
    this.section = section;
    this.custom = custom;
    this.spaces = spaces.map((s) => ({ traits: s.traits, encounter: null, node: null }));
  }
}

export class GameNode {
  visible = false;
  readonly game: Game;
  readonly obj: Obj;
  readonly tile: Tile | null;
  readonly space: number;
  kind: string;
  readonly encId: number | null;

  constructor(game: Game, obj: Obj, tile: Tile | null = null, space = 0, kind = "Encounter", encId: number | null = null) {
    this.game = game;
    this.obj = obj;
    this.tile = tile;
    this.space = space;
    this.kind = kind;
    this.encId = encId;
    obj.node = this;
  }
}

export class EnemyGroup {
  readonly uid: number;
  unitHp: number;
  damage = 0;
  exhausted = false;
  activationOverride: any = null;
  obj: Obj | null = null;
  readonly model: any;
  size: number;
  readonly logic: Obj | null;

  constructor(uid: number, model: any, size: number, logic: Obj | null = null) {
    this.uid = uid;
    this.model = model;
    this.size = size;
    this.logic = logic;
    this.unitHp = toInt(or(gd(model, "Health"), 3));
  }
}

export interface Section {
  id: number;
  builder: any;
  tiles: Tile[];
  visible: boolean;
}

export interface Campaign {
  lore: number;
  xp: number;
  items: any[];
  titles: any[];
  flags: Record<string, any>;
  unlocked_chain: any[];
  used_encounters: any[];
  used_groups?: any[];
  next_adventure: any;
  alternatives?: any[];
  result: any;
}

export const newCampaign = (): Campaign => ({
  lore: 0, xp: 0, items: [], titles: [], flags: {}, unlocked_chain: [], used_encounters: [], next_adventure: null, result: null,
});

export interface GameOptions {
  seed?: number;
  players?: number;
  difficulty?: Difficulty;
  /** Who answers decisions: Bot (default), a human via Session, a recorder ... */
  player?: Player;
  /** Rounds before the game stops with ended = "max_rounds" */
  maxRounds?: number;
  /**
   * Map generation: "ffg" = exact port of FFG's MapBuilder (needs tile geometry in the pack; default when present),
   * "legacy" = simplified engine-py generator (kept for parity checks against Python)
   */
  mapMode?: "ffg" | "legacy";
  /** MapBuilder seed (FFG picks a random one per adventure); defaults to the game seed */
  mapSeed?: number;
  /** Owned product ids (affects tiles and encounters); default: all products in the pack */
  products?: number[];
  /** Game language for FFG's per-language encounter exclusions (English/Russian/... or en/ru/...) */
  language?: string;
  /** Party inventory (GroupItemIds) for item encounters */
  groupItems?: number[];
  /** A board generated earlier for the same setup (Session replays reuse it instead of regenerating) */
  board?: GeneratedMap;
  campaign?: Campaign;
  logRoundPrefix?: number;
}

// ---------------------------------------------------------------- game
export class Game {
  readonly rng: PyRandom;
  readonly seed: number;
  readonly D: any;
  readonly adv: any;
  readonly model: any;
  readonly players: number;
  readonly difficulty: Difficulty;
  readonly player: Player;
  private ids = 0;
  readonly log: LogEntry[] = [];
  readonly warnings = new Counter();
  readonly coverage = new Counter();
  readonly actionCount = new Counter();
  readonly unimpl = new Counter();
  readonly transitionSerial = new Map<number, number>();
  round = 1;
  readonly advIndex: number;
  readonly campaign: Campaign;
  readonly globals: Record<string, any> = {};
  threatMax: number;
  readonly activeThreatEvents: Obj[] = [];
  readonly enemies: EnemyGroup[] = [];
  readonly reserve: number[] = [];
  ended: string | null = null;
  result: "victory" | "defeat" | null = null;
  objective: any = null;
  readonly heroes: { damage: number; fear: number; defeated: boolean }[];
  readonly objs = new Map<string, Obj>();
  readonly allFsms: Fsm[] = [];
  advObjs!: Map<number, Obj>;
  root!: Obj;
  advFsm: Fsm | null = null;
  timers: (Obj | null)[] = [];
  sections: Section[] = [];
  tiles = new Map<number, Tile>();
  nodes: GameNode[] = [];
  advNodes: GameNode[] = [];
  startTileId = -1;
  encounterGroup: any = null;
  private ending = false;
  private depth = 0;
  private pending: [Fsm, any][] = [];

  readonly src: ContentSource;
  readonly advId: number;
  readonly maxRounds: number;
  readonly mapMode: "ffg" | "legacy";
  /** The generated board (FFG mode): sections, tile positions and rotations, encounters */
  board: GeneratedMap | null = null;
  private readonly opts: GameOptions;

  constructor(src: ContentSource, advId: number, opts: GameOptions = {}) {
    this.src = src;
    this.advId = advId;
    this.seed = opts.seed ?? 0;
    this.rng = new PyRandom(this.seed);
    this.D = src.db();
    this.adv = src.adventure(advId);
    this.model = this.adv.model;
    this.players = opts.players ?? 2;
    this.difficulty = opts.difficulty ?? "adventure";
    this.player = opts.player ?? new Bot(this.rng);
    this.advIndex = opts.logRoundPrefix ?? 1;
    this.maxRounds = opts.maxRounds ?? 40;
    this.opts = opts;
    this.mapMode = opts.mapMode ?? (this.D.tiles ? "ffg" : "legacy");
    this.campaign = opts.campaign ?? newCampaign();
    for (const k of keysOf(this.D.globals)) this.globals[k] = structuredClone(this.D.globals[k].value);
    for (const [k, v] of Object.entries(this.campaign.flags)) this.globals[k] = v;
    this.globals.PlayerCount = this.players;
    this.globals.Round = 1;
    this.globals.Threat = 0;
    this.globals.IsDarkness = false;
    this.threatMax = truthy(gd(this.model, "ThreatLimitScaledPerPlayer"))
      ? gd(this.model, "ThreatLimitPerPlayer", 0) * this.players
      : gd(this.model, "ThreatLimit", 0);
    for (const q of or(gd(this.model, "StartingEnemyReserveList"), [])) {
      const em = this.enemyModel(gd(q, "Enemy"));
      for (let i = 0; i < gd(q, "Quantity", 0); i++) if (truthy(em)) this.reserve.push(em._id);
    }
    this.heroes = Array.from({ length: this.players }, () => ({ damage: 0, fear: 0, defeated: false }));
    this.buildAdventureScene();
    if (this.mapMode === "ffg") this.buildMapFfg();
    else this.buildMap();
  }

  // ------------------------------------------------------------ helpers
  nextId(): number {
    return ++this.ids;
  }

  warn(msg: string): void {
    this.warnings.inc(msg);
  }

  emit(key: any, ...inserts: unknown[]): void {
    if (key === null || key === undefined) return;
    this.log.push([this.advIndex, this.round, key, inserts.map(pyStr)]);
  }

  enemyModel(ref: any): any {
    if (!truthy(ref)) return null;
    if (isDict(ref)) ref = gd(ref, "id");
    return gd(this.D.models.EnemyModel, pyStr(ref), null);
  }

  modelBy(typ: string, ref: any): any {
    if (!truthy(ref)) return null;
    if (isDict(ref)) ref = gd(ref, "id");
    return gd(gd(this.D.models, typ, {}), pyStr(ref), null);
  }

  instantiate(prefab: any, src: string): Map<number, Obj> {
    const objs = new Map<number, Obj>();
    for (const pid of keysOf(prefab.gameObjects)) {
      const o = new Obj(this, src, Number(pid), prefab.gameObjects[pid], prefab);
      objs.set(Number(pid), o);
      this.objs.set(`${src}|${pid}`, o);
    }
    for (const fd of prefab.fsms) {
      const o = objs.get(fd.go);
      if (!o) throw new Error(`KeyError: fsm owner ${fd.go}`);
      const f = new Fsm(this, fd, o);
      o.fsms.push(f);
      this.allFsms.push(f);
    }
    return objs;
  }

  objRef(src: string, ref: any): Obj | null {
    if (isDict(ref) && gd(ref, "ref") === "go") return this.objs.get(`${src}|${ref.go}`) ?? null;
    return null;
  }

  // ------------------------------------------------------------ variables
  get(fsm: Fsm, v: any): any {
    if (typeof v === "string" && v.startsWith("@")) {
      const n = v.slice(1);
      if (Object.hasOwn(fsm.vars, n)) return fsm.vars[n] ?? null;
      if (Object.hasOwn(this.globals, n)) return this.globals[n] ?? null;
      if (n === "Round") return this.round;
      this.warn(`unknown var ${n}`);
      return 0;
    }
    return v ?? null;
  }

  set(fsm: Fsm, v: any, value: any): void {
    if (!(typeof v === "string" && v.startsWith("@"))) return;
    const n = v.slice(1);
    if (Object.hasOwn(fsm.vars, n)) fsm.vars[n] = value;
    else if (Object.hasOwn(this.globals, n)) this.globals[n] = value;
    else fsm.vars[n] = value;
  }

  num(fsm: Fsm, v: any, d = 0): number {
    return toInt(this.get(fsm, v), d);
  }

  boolean(fsm: Fsm, v: any): boolean {
    return truthy(this.get(fsm, v));
  }

  // ------------------------------------------------------------ scene construction
  private buildAdventureScene(): void {
    this.advObjs = this.instantiate(this.adv, "adv");
    const root = this.advObjs.get(this.adv.root);
    if (!root) throw new Error(`KeyError: root ${this.adv.root}`);
    this.root = root;
    this.advFsm = root.fsms[0] ?? null;
    const comp = gd(root.components, "Adventure", {});
    this.timers = or(gd(comp, "Timers"), []).map((t: any) => this.objRef("adv", t));
  }

  tileModelByCode(code: any): any {
    return gd(this.D.models.TileModel, code, null);
  }

  private hashId(tm: any): number {
    // engine-py falls back to Python hash(code); every TileModel has HashId, so this is never hit
    if (!Object.hasOwn(or(tm, {}), "HashId")) throw new Error("TileModel without HashId");
    return tm.HashId;
  }

  /** Simplified map generation following SectionBuilder constraints (no hex geometry yet) */
  private buildMap(): void {
    let mb: any = null;
    for (const o of this.advObjs.values()) if (Object.hasOwn(o.components, "MapBuilder")) mb = o.components.MapBuilder;
    for (const o of this.advObjs.values()) {
      const gn = gd(o.components, "GameNode", null);
      if (gn !== null && o.node === null) {
        const kind = NODE_KINDS[or(gd(gn, "NodeType", 0), 0)]!;
        this.advNodes.push(new GameNode(this, o, null, 0, kind, gd(gn, "EncounterId")));
      }
    }
    if (mb === null) return;
    const secPids: number[] = or(gd(mb, "Sections"), []).map((s: any) => s.go);
    const custom = new Map<any, Obj>();
    for (const o of this.advObjs.values()) {
      if (Object.hasOwn(o.components, "Tile")) {
        const tm = or(gd(o.components.Tile, "Model"), {});
        custom.set(or(gd(tm, "id"), o.name), o);
      }
    }
    const used = new Set<any>();
    const stdCodes = keysOf(this.D.standardTiles);
    this.rng.shuffle(stdCodes);
    const extra = (this.players - 1) * 2;
    secPids.forEach((spid, idx) => {
      const sb = this.advObjs.get(spid)!.components.SectionBuilder;
      const minS = gd(sb, "MinimumSpaces", 1);
      let target = this.rng.randint(minS, Math.max(minS, gd(sb, "MaximumSpaces", 1)));
      if (!truthy(gd(sb, "IgnorePlayerScaling"))) {
        const n = Math.max(1, secPids.length);
        target += Math.floor(extra / n) + (idx < extra % n ? 1 : 0);
      }
      const tiles: Tile[] = [];
      const addTile = (code: any): Tile | null => {
        const tm = this.tileModelByCode(code);
        let t: Tile;
        if (custom.has(code)) {
          const co = custom.get(code)!;
          const spaces: any[] = [];
          for (const sp of or(gd(co.components.Tile, "Spaces"), [])) {
            const so = this.advObjs.get(sp.go) ?? null;
            spaces.push({ traits: so ? gd(or(gd(so.components, "TileSpace"), {}), "Traits", 0) : 0 });
          }
          t = new Tile(code, this.hashId(tm), spaces.length ? spaces : [{ traits: 0 }], idx, co);
        } else {
          const st = gd(this.D.standardTiles, code, null);
          if (st === null) return null;
          t = new Tile(code, this.hashId(tm), st.spaces, idx);
        }
        used.add(code);
        if (truthy(tm) && truthy(gd(tm, "OtherSideId"))) used.add(tm.OtherSideId);
        tiles.push(t);
        this.tiles.set(t.id, t);
        return t;
      };
      const countTrait = (tr: number) => tiles.reduce((n, t) => n + t.spaces.filter((s) => s.traits & tr).length, 0);
      const sti = or(gd(sb, "StartTileInfo"), {});
      if (truthy(gd(sti, "SpecifyStartTile")) && truthy(gd(or(gd(sti, "Tile"), {}), "TileCode"))) {
        const t = addTile(sti.Tile.TileCode);
        if (t === null) throw new Error("AttributeError: start tile not found");
        this.startTileId = t.id;
      }
      for (const rt of or(gd(sb, "RequiredTiles"), [])) {
        if (truthy(gd(rt, "TileCode")) && !used.has(rt.TileCode)) addTile(rt.TileCode);
      }
      const allowed = gd(sb, "AllowedTileSets", 0);
      for (const req of or(gd(sb, "SpaceTraitRequirements"), [])) {
        let have = countTrait(req.Trait);
        for (const code of stdCodes) {
          if (have >= gd(req, "Count", 1)) break;
          const tm = this.tileModelByCode(code);
          if (used.has(code) || !truthy(tm) || !(gd(tm, "Set", 0) & allowed)) continue;
          const st = this.D.standardTiles[code];
          if (st.spaces.some((s: any) => s.traits & req.Trait)) {
            addTile(code);
            have = countTrait(req.Trait);
          }
        }
      }
      for (const code of stdCodes) {
        if (tiles.reduce((n, t) => n + t.spaces.length, 0) >= target) break;
        const tm = this.tileModelByCode(code);
        if (used.has(code) || !truthy(tm) || !(gd(tm, "Set", 0) & allowed)) continue;
        addTile(code);
      }
      this.sections.push({ id: idx, builder: sb, tiles, visible: false });
    });
    // connections -> border tiles
    const pid2idx = new Map<number, number>();
    secPids.forEach((p, i) => pid2idx.set(p, i));
    for (const c of or(gd(mb, "RequiredConnections"), [])) {
      const a = pid2idx.get(c.Section1.go);
      const b = pid2idx.get(c.Section2.go);
      if (a === undefined || b === undefined) continue;
      if (this.sections[a]!.tiles.length) this.rng.choice(this.sections[a]!.tiles).adjacentSections.add(b);
      if (this.sections[b]!.tiles.length) this.rng.choice(this.sections[b]!.tiles).adjacentSections.add(a);
    }
    this.placeEncounters(mb);
  }

  /** Board from the FFG MapBuilder port; encounters are spawned in FFG order */
  private buildMapFfg(): void {
    for (const o of this.advObjs.values()) {
      const gn = gd(o.components, "GameNode", null);
      if (gn !== null && o.node === null) {
        const kind = NODE_KINDS[or(gd(gn, "NodeType", 0), 0)]!;
        this.advNodes.push(new GameNode(this, o, null, 0, kind, gd(gn, "EncounterId")));
      }
    }
    const hasBuilder = [...this.advObjs.values()].some((o) => Object.hasOwn(o.components, "MapBuilder"));
    if (!hasBuilder) return;
    const c = this.campaign;
    const products = this.opts.products ?? (this.D.productOrder ?? keysOf(this.D.models.ProductModel).map(Number));
    const m = this.opts.board ?? generateMap(this.D, this.adv, {
      seed: this.opts.mapSeed ?? this.seed, players: this.players, products, language: this.opts.language ?? "English",
      unlockedChain: c.unlocked_chain, usedEncounters: c.used_encounters, usedGroups: c.used_groups ?? [],
      groupItems: this.opts.groupItems ?? c.items,
    });
    this.board = m;
    const byHash = new Map<number, Tile>();
    for (const s of m.sections) {
      const tiles: Tile[] = [];
      for (const gt of s.tiles) {
        const custom = gt.customPid !== null ? this.advObjs.get(gt.customPid) ?? null : null;
        const geo = custom ? this.adv.ext.customTiles[String(gt.customPid)] : this.D.tiles.find((t: any) => t.code === gt.code);
        const t = new Tile(gt.code, gt.hashId, geo.spaces, s.id, custom);
        gt.encounters.forEach((e, i) => { t.spaces[i]!.encounter = e < 0 ? null : e; });
        tiles.push(t);
        this.tiles.set(t.id, t);
        byHash.set(t.id, t);
      }
      this.sections.push({ id: s.id, builder: null, tiles, visible: false });
    }
    // adjacency to other sections (Adventure.CoroutineExploreTile: ConnectedSpaces of each space, in order)
    for (const s of m.sections) {
      for (const gt of s.tiles) {
        const t = byHash.get(gt.hashId)!;
        const adj: number[] = [];
        for (const conn of gt.connected) {
          for (const [th] of conn) {
            const other = byHash.get(th);
            if (other && other.section !== t.section && !adj.includes(other.section)) adj.push(other.section);
          }
        }
        t.adjacentOrdered = adj;
        for (const a of adj) t.adjacentSections.add(a);
      }
    }
    const s0 = this.sections.find((s) => s.id === 0);
    this.startTileId = s0 && s0.tiles.length ? s0.tiles[0]!.id : -1;
    this.encounterGroup = m.encounterGroup !== null ? gd(this.D.models.EncounterGroupModel[String(m.encounterGroup)], "m_Name") : null;
    c.used_groups = m.usedGroups;
    // spawn encounter instances in FFG order
    this.nodes = [];
    for (const [th, si, encId] of m.spawnOrder) {
      const t = byHash.get(th)!;
      const sp = t.spaces[si]!;
      const pf = this.src.encounter(encId);
      if (pf === null) { this.warn(`no prefab for encounter ${encId}`); continue; }
      const objs = this.instantiate(pf, `enc${encId}`);
      const nd = new GameNode(this, objs.get(pf.root)!, t, si, "Encounter", encId);
      sp.node = nd;
      this.nodes.push(nd);
      if (!c.used_encounters.includes(encId)) c.used_encounters.push(encId);
    }
  }

  private usedCodes(): Set<string> {
    return new Set([...this.tiles.values()].map((t) => t.code));
  }

  private tileUsable(code: string, used: Set<string>, allowed: number): any {
    const tm = this.tileModelByCode(code);
    if (used.has(code) || !truthy(tm) || used.has(gd(tm, "OtherSideId")) || !(gd(tm, "Set", 0) & allowed)) return null;
    return tm;
  }

  /** Add a standard tile to section s if no free space can host the encounter */
  ensureSpaceFor(s: Section, encRef: any): void {
    const enc = this.modelBy("EncounterModel", encRef);
    if (enc === null || truthy(gd(enc, "SpecificTile"))) return;
    if (s.tiles.some((t) => t.spaces.some((_, i) => this.spaceOk(t, i, enc)))) return;
    const used = this.usedCodes();
    const allowed = gd(s.builder, "AllowedTileSets", 0);
    const codes = keysOf(this.D.standardTiles);
    this.rng.shuffle(codes);
    for (const code of codes) {
      const tm = this.tileUsable(code, used, allowed);
      if (tm === null) continue;
      const t = new Tile(code, this.hashId(tm), this.D.standardTiles[code].spaces, s.id);
      if (t.spaces.some((_, i) => this.spaceOk(t, i, enc))) {
        s.tiles.push(t);
        this.tiles.set(t.id, t);
        return;
      }
    }
  }

  addAnyTile(s: Section): Tile | null {
    const used = this.usedCodes();
    const allowed = gd(s.builder, "AllowedTileSets", 0);
    for (const code of keysOf(this.D.standardTiles)) {
      const tm = this.tileUsable(code, used, allowed);
      if (tm === null) continue;
      const t = new Tile(code, this.hashId(tm), this.D.standardTiles[code].spaces, s.id);
      s.tiles.push(t);
      this.tiles.set(t.id, t);
      return t;
    }
    return null;
  }

  spaceOk(tile: Tile, si: number, enc: any): boolean {
    const sp = tile.spaces[si]!;
    if (sp.encounter !== null) return false;
    const st = gd(enc, "SpecificTile");
    if (truthy(st)) return gd(st, "id") === tile.code && gd(enc, "SpecificSpaceIndex", 0) === si;
    const req = gd(enc, "RequiredTraits", 0);
    const exc = gd(enc, "ExcludedTraits", 0);
    if (truthy(req) && (sp.traits & req) !== req) return false;
    if (truthy(exc) && sp.traits & exc) return false;
    return true;
  }

  private cands(tiles: Tile[], ok: (t: Tile, i: number) => boolean): [Tile, number][] {
    const out: [Tile, number][] = [];
    for (const t of tiles) for (let i = 0; i < t.spaces.length; i++) if (ok(t, i)) out.push([t, i]);
    return out;
  }

  seedEncounter(encRef: any, tiles: Tile[], section: Section | null = null): boolean {
    const enc = this.modelBy("EncounterModel", encRef);
    if (enc === null) return false;
    const ok = (t: Tile, i: number) => this.spaceOk(t, i, enc);
    const free = (t: Tile, i: number) => t.spaces[i]!.encounter === null;
    let c = this.cands(tiles, ok);
    if (!c.length && section !== null) {
      this.ensureSpaceFor(section, encRef);
      tiles = section.tiles;
      c = this.cands(tiles, ok);
    }
    if (!c.length) {
      c = this.cands(tiles, free);
      if (!c.length && section !== null) {
        this.addAnyTile(section);
        c = this.cands(section.tiles, free);
      }
      if (!c.length) { this.warn(`could not place ${pyStr(gd(enc, "m_Name"))}`); return false; }
      this.warn(`trait mismatch placing ${pyStr(gd(enc, "m_Name"))}`);
    }
    const [t, i] = this.rng.choice(c);
    t.spaces[i]!.encounter = enc._id;
    return true;
  }

  traitsFilterOk(enc: any, flt: any): boolean {
    const tr = gd(enc, "Traits", 0);
    if (truthy(gd(flt, "ExcludeIfAny")) && tr & flt.ExcludeIfAny) return false;
    if (truthy(gd(flt, "MustHaveAll")) && (tr & flt.MustHaveAll) !== flt.MustHaveAll) return false;
    if (truthy(gd(flt, "MustHaveAny")) && !(tr & flt.MustHaveAny)) return false;
    return true;
  }

  private placeEncounters(mb: any): void {
    let allTiles = this.sections.flatMap((s) => s.tiles);
    const flt = or(gd(this.model, "EncounterTraitsFilter"), {});
    for (const s of this.sections) {
      const sb = s.builder;
      for (const se of or(gd(sb, "SectionEncounters"), [])) this.ensureSpaceFor(s, se);
      for (const te of or(gd(sb, "TileEncounters"), [])) {
        let tl = s.tiles.filter((t) => t.code === gd(te, "TileCode"));
        if (!tl.length) tl = s.tiles;
        this.seedEncounter(gd(te, "Encounter"), tl);
      }
      for (const se of or(gd(sb, "SectionEncounters"), [])) this.seedEncounter(se, s.tiles, s);
    }
    for (const ae of or(gd(mb, "AdventureEncounters"), [])) this.seedEncounter(ae, allTiles);
    // encounter group
    const free = allTiles.reduce((n, t) => n + t.spaces.filter((sp) => sp.encounter === null).length, 0);
    let groups: any[] = [];
    const spec = gd(mb, "SpecifiedEncounterGroup");
    if (truthy(spec)) {
      groups = [this.modelBy("EncounterGroupModel", spec)].filter(truthy);
    } else {
      for (const g of valuesOf(this.D.models.EncounterGroupModel)) {
        const req = or(gd(g, "RequiredEncounters"), []).map((r: any) => this.modelBy("EncounterModel", r));
        const opt = or(gd(g, "OptionalEncounters"), []).map((r: any) => this.modelBy("EncounterModel", r));
        const all = [...req, ...opt];
        if (all.some((e) => e === null)) continue;
        if (req.length + gd(g, "RequiredNumberOfOptionalEncounters", 0) > free) continue;
        if (all.every((e) => this.traitsFilterOk(e, flt))) groups.push(g);
      }
      const usedGroups = gd(this.campaign, "used_groups", []);
      const unused = groups.filter((g) => !usedGroups.includes(g._id));
      if (unused.length) groups = unused;
    }
    if (groups.length) {
      const g = this.rng.choice(groups);
      this.encounterGroup = gd(g, "m_Name");
      for (const r of or(gd(g, "RequiredEncounters"), [])) this.seedEncounter(r, allTiles);
      const opts = [...or(gd(g, "OptionalEncounters"), [])];
      this.rng.shuffle(opts);
      for (const r of opts.slice(0, gd(g, "RequiredNumberOfOptionalEncounters", 0))) this.seedEncounter(r, allTiles);
    }
    // one item encounter whose items the party does not own yet
    const encModels = valuesOf(this.D.models.EncounterModel);
    const items = encModels.filter((e) => gd(e, "Type") === 4
      && !or(gd(e, "Items"), []).some((it: any) => this.campaign.items.includes(gd(or(it, {}), "id"))));
    this.rng.shuffle(items);
    for (const e of items) {
      const c = this.cands(allTiles, (t, i) => this.spaceOk(t, i, e));
      if (c.length) {
        const [t, i] = this.rng.choice(c);
        t.spaces[i]!.encounter = e._id;
        break;
      }
    }
    // random fill
    const pool = encModels.filter((e) => or(gd(e, "Type"), 0) === 0 && this.traitsFilterOk(e, flt)
      && (truthy(gd(e, "IsRepeatable")) || !this.campaign.used_encounters.includes(e._id)));
    pool.push(...encModels.filter((e) => gd(e, "Type") === 2 && this.campaign.unlocked_chain.includes(e._id)));
    this.rng.shuffle(pool);
    const placed = new Set<any>(allTiles.flatMap((t) => t.spaces.map((sp) => sp.encounter)));
    for (const s of this.sections) {
      const spaces = s.tiles.reduce((n, t) => n + t.spaces.length, 0);
      const want = gd(s.builder, "RandomFillPercent", 0) * spaces;
      for (const e of [...pool]) {
        const have = s.tiles.reduce((n, t) => n + t.spaces.filter((sp) => sp.encounter !== null).length, 0);
        if (have >= want) break;
        if (placed.has(e._id)) continue;
        const c = this.cands(s.tiles, (t, i) => this.spaceOk(t, i, e));
        if (!c.length) continue;
        const [t, i] = this.rng.choice(c);
        t.spaces[i]!.encounter = e._id;
        placed.add(e._id);
        pool.splice(pool.indexOf(e), 1);
      }
    }
    // spawn encounter instances (tiles may have been added during placement)
    allTiles = this.sections.flatMap((s) => s.tiles);
    this.nodes = [];
    for (const t of allTiles) {
      t.spaces.forEach((sp, i) => {
        if (sp.encounter === null) return;
        const pf = this.src.encounter(sp.encounter);
        if (pf === null) { this.warn(`no prefab for encounter ${sp.encounter}`); return; }
        const objs = this.instantiate(pf, `enc${sp.encounter}`);
        const root = objs.get(pf.root)!;
        const nd = new GameNode(this, root, t, i, "Encounter", sp.encounter);
        sp.node = nd;
        this.nodes.push(nd);
        this.campaign.used_encounters.push(sp.encounter);
      });
    }
  }

  // ------------------------------------------------------------ event routing
  /** Resolve FsmOwnerDefault -> Obj */
  ownerTarget(fsm: Fsm, od: any): Obj | null {
    if (!truthy(od) || !truthy(gd(od, "ownerOption"))) return fsm.owner;
    return this.objRef(fsm.owner.src, gd(od, "gameObject"));
  }

  broadcast(ev: any, exclude: Fsm | null = null): void {
    for (const f of [...this.allFsms]) {
      if (f === exclude) continue;
      if (f.usesEvent(ev) && !f.finished) this.deliverGuarded(f, ev);
    }
  }

  /** Deliver synchronously like PlayMaker, but defer when nesting gets too deep (cyclic broadcasts) */
  deliverGuarded(f: Fsm, ev: any): void {
    if (this.depth > 30) {
      this.pending.push([f, ev]);
      this.warn("deferred deep event");
      return;
    }
    this.depth++;
    try { f.send(ev); } finally { this.depth--; }
    if (this.depth === 0) {
      while (this.pending.length) {
        const [pf, pe] = this.pending.shift()!;
        this.depth++;
        try { pf.send(pe); } finally { this.depth--; }
      }
    }
  }

  sendEventTarget(fsm: Fsm, et: any, ev: any): any {
    const e = or(et, {});
    const t = gd(e, "target", 0);
    if (t === 0) return ev;
    if (t === 4) {
      this.broadcast(ev, truthy(gd(e, "excludeSelf")) ? fsm : null);
      return null;
    }
    if (t === 1 || t === 2 || t === 3) {
      const o = this.ownerTarget(fsm, gd(e, "gameObject"));
      if (o === null) { this.warn("send target missing"); return null; }
      const fname = gd(e, "fsmName");
      for (const f of o.fsms) if (t !== 2 || !truthy(fname) || f.name === fname) this.deliverGuarded(f, ev);
      return null;
    }
    this.warn(`event target ${pyStr(t)} unsupported`);
    return null;
  }

  // ------------------------------------------------------------ action execution
  execAction(fsm: Fsm, a: any): any {
    const h = Object.hasOwn(ACTIONS, a.action) ? ACTIONS[a.action] : undefined;
    if (h === undefined) { this.unimpl.inc(a.action); return null; }
    return h(this, fsm, a.params) ?? null;
  }

  msgKey(fsm: Fsm, msg: any): [any, unknown[]] {
    const k = keyOf(msg);
    if (isDict(msg) && truthy(gd(msg, "inserts"))) {
      const ins = msg.inserts.map((i: any) => {
        // Python `a or b or c ...` is lazy: get() may warn, so evaluate step by step
        let v: any = keyOf(gd(i, "LocalizationKey"));
        if (!truthy(v)) v = gd(i, "RawText");
        if (!truthy(v)) v = this.get(fsm, gd(i, "VariableString"));
        if (!truthy(v)) v = this.get(fsm, gd(i, "VariableInt"));
        if (!truthy(v)) v = "";
        return v;
      });
      return [k, ins];
    }
    return [k, []];
  }

  show(fsm: Fsm, msg: any): any {
    const [k, ins] = this.msgKey(fsm, msg);
    if (truthy(k)) this.emit(k, ...ins);
    return k;
  }

  signalEnd(victory: boolean): void {
    if (this.ending) return;
    this.ending = true;
    this.result = victory ? "victory" : "defeat";
    if (this.advFsm) this.advFsm.send(victory ? "ADVENTURE_END_VICTORY" : "ADVENTURE_END_FAILURE");
    if (!truthy(this.ended)) this.ended = "end_signalled";
    throw new EndGame();
  }

  // ------------------------------------------------------------ tiles
  flavor(t: Tile): any {
    const opts: any[] = [];
    for (const sp of t.spaces) {
      if (sp.encounter !== null) {
        const e = or(gd(this.D.models.EncounterModel, pyStr(sp.encounter)), {});
        if (truthy(gd(e, "TileExploreOverrideKey"))) opts.push(e.TileExploreOverrideKey);
      }
    }
    if (opts.length) return this.rng.choice(opts);
    const tm = or(this.tileModelByCode(t.code), {});
    return this.rng.choice(or(gd(tm, "DefaultExploreKeys"), [`TILE_${t.code}`]));
  }

  explore(t: Tile, skipAdjacent: any = false): void {
    t.visible = true;
    t.explored = true;
    t.exploreToken = false;
    for (const sp of t.spaces) {
      const nd = sp.node;
      if (nd === null) continue;
      for (const fs of nd.obj.fsms) if (fs.usesEvent("PRE_REVEAL")) fs.send("PRE_REVEAL");
      nd.visible = true;
      for (const fs of nd.obj.fsms) if (fs.usesEvent("REVEALED")) fs.send("REVEALED");
    }
    if (!truthy(skipAdjacent) && t.adjacentSections.size && this.advFsm && this.advFsm.usesEvent("ADJACENT_TILE_EXPLORED")) {
      for (const sid of t.adjacentOrdered ?? [...t.adjacentSections].sort((a, b) => a - b)) {
        this.advFsm.vars.AdjacentSectionId = sid;
        this.advFsm.send("ADJACENT_TILE_EXPLORED");
      }
    }
  }

  // ------------------------------------------------------------ enemies
  enemyName(m: any, size: number): any {
    return or(gd(m, size > 1 ? "KeyPlural" : "KeySingular"), gd(m, "m_Name"));
  }

  unitCost(m: any, n: number): number {
    const costs = or(gd(m, "Costs"), [{ Num: 1, Cost: 1 }]);
    let best: any = null;
    for (const c of costs) if (gd(c, "Num", 1) === n) best = gd(c, "Cost", 0);
    if (best === null) best = gd(costs[0], "Cost", 1) * n;
    return best;
  }

  spawnGroup(m: any, size: number, logic: Obj | null = null): EnemyGroup {
    const g = new EnemyGroup(this.nextId(), m, size, logic);
    this.enemies.push(g);
    this.emit("UI_SPAWN_GROUP_FORMAT", size, this.enemyName(m, size));
    if (logic !== null) logic.enemyGroup = g;
    return g;
  }

  /** Grow the group while the next size is affordable */
  groupSize(m: any, pts: number): number {
    let size = 1;
    while (size < or(gd(m, "MaxUnitCount"), 3) && this.unitCost(m, size + 1) <= pts) size++;
    return size;
  }

  eligibleEnemies(pts: number, flt: any = null): any[] {
    const out: any[] = [];
    const gflt = or(gd(this.model, "GlobalEnemyFilter"), {});
    for (const m of valuesOf(this.D.models.EnemyModel)) {
      if (truthy(gd(m, "IsNamed")) || truthy(gd(m, "IsUnique"))) continue;
      if (this.unitCost(m, 1) > pts) continue;
      const tr = gd(m, "Traits", 0);
      if (truthy(flt)) {
        if (truthy(gd(flt, "ExcludeIfAny")) && tr & flt.ExcludeIfAny) continue;
        if (truthy(gd(flt, "MustHaveAll")) && (tr & flt.MustHaveAll) !== flt.MustHaveAll) continue;
        if (truthy(gd(flt, "MustHaveAny")) && !(tr & flt.MustHaveAny)) continue;
      }
      if (truthy(gd(gflt, "ExcludeIfAny")) && tr & gflt.ExcludeIfAny) continue;
      if (truthy(gd(gflt, "MustHaveAny")) && !(tr & gflt.MustHaveAny)) continue;
      out.push(m);
    }
    return out;
  }

  groupByLogic(f: Fsm, p: any): EnemyGroup | null {
    for (const key of ["Logic", "Group"]) {
      const o = this.objRef(f.owner.src, gd(p, key));
      if (o === null) continue;
      for (const g of this.enemies) if (g.logic === o || g.obj === o) return g;
    }
    return null;
  }

  removeEnemy(g: EnemyGroup | null): void {
    const i = g === null ? -1 : this.enemies.indexOf(g);
    if (i >= 0) this.enemies.splice(i, 1);
  }

  defeatGroup(g: EnemyGroup): void {
    if (g.logic !== null) {
      for (const fs of g.logic.fsms) {
        if (fs.usesEvent("TRY_DEFEAT")) { fs.send("TRY_DEFEAT"); return; }
      }
    }
    this.removeEnemy(g);
    if (g.logic !== null) for (const fs of g.logic.fsms) if (fs.usesEvent("DEFEATED")) fs.send("DEFEATED");
  }

  activate(g: EnemyGroup): void {
    const EAM = this.D.models.EnemyActivationModel;
    let acts: any[] = or(gd(g.model, "Activations"), []).map((a: any) => gd(EAM, pyStr(gd(a, "id")), null));
    const fit = acts.filter((a) => truthy(a) && gd(a, "MinGroupSize", 1) <= g.size && g.size <= gd(a, "MaxGroupSize", 99));
    acts = fit.length ? fit : acts.filter(truthy);
    if (truthy(g.activationOverride)) {
      const ov = gd(EAM, pyStr(g.activationOverride), null);
      if (truthy(ov)) acts = [ov];
    }
    if (!acts.length) return;
    const a = this.rng.choice(acts);
    // either a primary attack or an alternate activation, as decided by the bot answering prompts
    if (truthy(gd(a, "KeyAltActivation")) && this.rng.random() < 0.25) { this.emit(a.KeyAltActivation); return; }
    this.emit(gd(a, "KeyAttackFlavor"));
    const dmg = or(gd(a, "Damage"), [{}]);
    const d = dmg.find((x: any) => gd(x, "Size") === g.size) ?? dmg[dmg.length - 1];
    const hero = this.rng.randrange(this.players);
    const ph = gd(d, "Physical", 0);
    const fe = gd(d, "Fear", 0);
    if (truthy(gd(a, "KeyAttackAdditionalEffect"))) this.emit("UI_DAMAGE_LOG_WITH_EFFECT_FORMATTED", ph, fe, a.KeyAttackAdditionalEffect);
    else this.emit("UI_DAMAGE_LOG_FORMATTED", ph, fe);
    const h = this.heroes[hero]!;
    h.damage += Math.max(0, ph - this.rng.randint(0, 2));
    h.fear += Math.max(0, fe - this.rng.randint(0, 2));
  }

  // ------------------------------------------------------------ round loop
  processRoot(ev: string): void {
    if (this.advFsm && this.advFsm.usesEvent(ev)) this.advFsm.send(ev);
  }

  run(maxRounds = this.maxRounds): this {
    try {
      for (const f of this.allFsms) f.start();
      this.processRoot("SCENARIO_BEGIN");
      this.processRoot("ROUND_START");
      while (this.round <= maxRounds) {
        if (this.round > 1) this.emit("UI_PHASE_HERO");
        this.heroPhase();
        this.endRound();
      }
      this.ended = this.ended || "max_rounds";
    } catch (e) {
      if (!(e instanceof EndGame)) throw e;
    }
    return this;
  }

  clickableNodes(): GameNode[] {
    return [...this.nodes, ...this.advNodes].filter((nd) => nd.visible
      && (nd.tile === null || nd.tile.visible)
      && nd.obj.fsms.some((fs) => fs.canHandle("NODE CLICKED")));
  }

  explorableTiles(): Tile[] {
    return [...this.tiles.values()].filter((t) => t.visible && !t.explored && t.exploreToken);
  }

  heroPhase(): void {
    for (let hero = 0; hero < this.players; hero++) {
      if (this.heroes[hero]!.defeated) continue;
      for (let k = 0; k < 2; k++) {
        const opts: Option[] = [
          ...this.clickableNodes().map((nd): Option => ["node", nd]),
          ...this.explorableTiles().map((t): Option => ["explore", t]),
          ...this.enemies.map((g): Option => ["attack", g]),
        ];
        if (!opts.length) break;
        const pick = this.player.pickAction(this, hero, opts);
        if (pick === null) break; // hero ends their turn early (bot never does)
        const [kind, x] = pick;
        if (kind === "node") {
          for (const fs of (x as GameNode).obj.fsms) if (fs.canHandle("NODE CLICKED")) { fs.send("NODE CLICKED"); break; }
        } else if (kind === "explore") {
          this.emit("UI_CONFIRM_EXPLORE");
          this.emit("UI_CONFIRM");
          const flav = this.flavor(x as Tile);
          this.emit("UI_EXPLORE_TILE_WITH_INTRO_FORMATTED", flav,
            this.difficulty !== "hard" ? "UI_DISCARD_EXPLORE_TOKEN_WITH_INSPIRATION" : "UI_DISCARD_EXPLORE_TOKEN");
          this.explore(x as Tile);
        } else {
          const g = x as EnemyGroup;
          g.damage += this.player.attackDamage(this, g);
          if (g.damage >= g.unitHp) {
            const killed = Math.floor(g.damage / g.unitHp);
            g.size -= killed;
            g.damage -= killed * g.unitHp;
            if (g.size <= 0) this.defeatGroup(g);
          }
        }
      }
    }
  }

  endRound(): void {
    for (const h of this.heroes) if (h.defeated) return this.signalEnd(false);
    if (this.globals.Threat >= this.threatMax && this.threatMax > 0) return this.signalEnd(false);
    this.emit("UI_PHASE_SHADOW");
    if (this.difficulty === "hard") this.globals.EnemyPoints = or(gd(this.globals, "EnemyPoints"), 0) + this.players;
    for (const g of [...this.enemies]) g.exhausted = false;
    for (const g of [...this.enemies]) {
      if (this.enemies.includes(g) && !g.exhausted) { this.activate(g); g.exhausted = true; }
    }
    if (!truthy(gd(this.model, "DisableDarkness")) && truthy(gd(this.globals, "IsDarkness"))) {
      this.emit(or(gd(this.globals, "DarknessMessageOverride"), "UI_DARKNESS_FEAR"));
    }
    for (const t of this.timers) if (t) for (const fs of t.fsms) if (fs.usesEvent("ROUND_END")) fs.send("ROUND_END");
    this.processRoot("ROUND_END");
    let delta = 2 * this.players + this.nodes.filter((n) => n.visible && n.kind === "Threat").length;
    if (this.difficulty !== "adventure") delta += [...this.tiles.values()].filter((t) => t.visible && !t.explored).length;
    this.emit("UI_THREAT_INCREASE", delta);
    this.globals.Threat += delta;
    for (;;) {
      const thr = (o: Obj) => o.threatThreshold ?? o.components.ThreatEvent.Threshold;
      const due = this.activeThreatEvents.filter((o) => thr(o) <= this.globals.Threat).sort((a, b) => thr(a) - thr(b));
      if (!due.length) break;
      const o = due[0]!;
      this.activeThreatEvents.splice(this.activeThreatEvents.indexOf(o), 1);
      for (const fs of o.fsms) { fs.start(); fs.send("THREAT_EVENT_START"); }
    }
    if (this.globals.Threat >= this.threatMax && this.threatMax > 0) return this.signalEnd(false);
    // last stand checks (simplified: heroes with heavy damage roll a test)
    for (const h of this.heroes) {
      if (h.damage + h.fear >= 10 && !h.defeated) {
        const phys = h.damage >= h.fear;
        const lm = this.D.models.LastStandModel[phys ? "1" : "2"];
        const key = this.rng.choice(lm.MessageKeys);
        this.emit(key, this.rng.randint(1, 3));
        if (this.player.lastStand(this, this.heroes.indexOf(h), phys)) {
          this.emit("UI_PASS");
          this.emit(phys ? "UI_LAST_STAND_PASSED_PHYSICAL" : "UI_LAST_STAND_PASSED_FEAR");
          h.damage = h.fear = 4;
        } else {
          this.emit("UI_FAIL");
          this.emit("UI_LAST_STAND_FAILED");
          h.defeated = true;
        }
      }
    }
    this.emit("UI_RALLY_PHASE");
    this.emit("UI_RALLY_PHASE_INSTRUCTIONS");
    this.round++;
    this.globals.Round = this.round;
    this.processRoot("ROUND_START");
  }
}

export type Option = ["node", GameNode] | ["explore", Tile] | ["attack", EnemyGroup];

/**
 * Everything the players decide. Called synchronously from deep inside the interpreter;
 * an interactive implementation throws NeedInput (see session.ts) and the game is replayed later.
 */
export interface Player {
  /** Skill test: how many successes the players rolled (top = highest threshold of interest) */
  successes(g: Game, top: number, key: any): number;
  /** Confirm/cancel dialog */
  confirm(g: Game, key: any): boolean;
  /** Multiple choice: one of `choices`, or null = cancel (only if canCancel) */
  choose(g: Game, key: any, choices: any[], canCancel: boolean): any;
  /** "Choose a hero" dialog */
  playerChoice(g: Game, key: any, canSkip: boolean): { player: number; skip: boolean };
  /** Last stand test result */
  lastStand(g: Game, hero: number, physical: boolean): boolean;
  /** Hero action, or null to end this hero's turn */
  pickAction(g: Game, hero: number, opts: Option[]): Option | null;
  /** Damage dealt by an attack on an enemy group */
  attackDamage(g: Game, group: EnemyGroup): number;
}

// ---------------------------------------------------------------- bot
/** Random-but-sensible player: answers dialogs and chooses hero actions */
export class Bot implements Player {
  readonly rng: PyRandom;
  readonly passBias: number;

  constructor(rng: PyRandom, passBias = 0.65) {
    this.rng = rng;
    this.passBias = passBias;
  }

  successes(_g: Game, top: number, _key: any): number {
    if (top <= 0) return this.rng.randint(0, 2);
    return this.rng.random() < this.passBias ? this.rng.randint(top - 1, top + 1) : this.rng.randint(0, Math.max(0, top - 1));
  }

  playerChoice(g: Game, _key: any, canSkip: boolean): { player: number; skip: boolean } {
    const player = this.rng.randrange(g.players);
    return { player, skip: canSkip && this.rng.random() < 0.2 };
  }

  lastStand(_g: Game, _hero: number, _physical: boolean): boolean {
    return this.rng.random() < 0.6;
  }

  confirm(_g: Game, _key: any): boolean {
    return this.rng.random() < 0.9;
  }

  choose(_g: Game, _key: any, choices: any[], canCancel: boolean): any {
    if (!choices.length || (canCancel && this.rng.random() < 0.05)) return null;
    return this.rng.choice(choices);
  }

  pickAction(_g: Game, _hero: number, opts: Option[]): Option {
    const W = { node: 5, explore: 3, attack: 4 } as const;
    return this.rng.choices(opts, opts.map(([k]) => W[k]));
  }

  attackDamage(_g: Game, _group: EnemyGroup): number {
    return this.rng.randint(1, 4);
  }
}
