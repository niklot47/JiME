// Scenario interpreter: PlayMaker FSM semantics over FFG prefab data + simplified board and enemies.
// Faithful port of engine-py/engine.py (Stage 2.1). Behaviour must stay identical run-for-run:
// cli/parity.ts diffs both engines on the same seeds. Change semantics only together with engine-py
// or after engine-py is retired.
import { PyRandom } from "./pyrandom.ts";
import { keysOf, valuesOf } from "./ojson.ts";
import { Counter, gd, isDict, or, pyStr, toInt, truthy } from "./py.ts";
import { ACTIONS } from "./actions.ts";
import { generateMap, LANG, type GeneratedMap, type MapGenOptions } from "./map/mapgen.ts";

/** Supplies scenario data (pack on disk, in-memory, network ...) */
export interface ContentSource {
  db(): any;
  /** A fresh (mutable) copy of the adventure prefab */
  adventure(id: number | string): any;
  /** Encounter prefab or null; may be shared between games (engine-py caches it too) */
  encounter(id: number): any | null;
}

export type Difficulty = "normal" | "hard" | "adventure";
/**
 * enemy: uid of the group activating / attacking when it was written (the original shows those in its enemy popup);
 * log: chronicle only (MasterMessageCache.AddMessage / Adventure.LogMessage), the players saw it as a question already
 */
/** banner: PopupOptions.ExtraSpriteId (Banner{n:D2}) of a spawned group's message */
export interface LogMeta { enemy?: number; log?: true; at?: SpaceRef; banner?: number }
/** A tile space on the board (the location highlight where enemies are to be placed) */
export interface SpaceRef { tile: number; space: number; pos?: [number, number] }
export type LogEntry = [advIndex: number, round: number, key: string, inserts: string[], meta?: LogMeta];

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
/** The players gave up (UIMenuPageController.OnSurrenderConfirmation): the adventure ends as a defeat */
export class Surrender extends Error {}

export const NODE_KINDS = ["Encounter", "Explore", "Threat", "Terrain", "Darkness", "Difficult", "Fortified"];

/** FFG Token3DManager.TokenTypes: which token a GameNode shows on the board (0 = none) */
export const TOKEN_TYPES: Record<number, string> = {
  0: "None", 1: "Circle_Explore", 2: "Circle_Search", 3: "Circle_Threat",
  4: "Circle_Dwarf", 5: "Circle_Elf", 6: "Circle_Hobbit", 7: "Circle_Human",
  31: "Hexagon_Darkness", 32: "Hexagon_Difficult", 33: "Hexagon_Fortified",
  50: "Terrain_Bushes", 51: "Terrain_Rocks", 100: "Terrain_Fog", 101: "Terrain_Pit", 102: "Terrain_Fire",
  103: "Terrain_Statue", 104: "Terrain_Rubble", 105: "Terrain_Web", 106: "Terrain_Fountain", 107: "Terrain_Pond",
  150: "Terrain_Barrel", 151: "Terrain_Table", 152: "Terrain_Log", 153: "Terrain_Elevation", 154: "Terrain_Chest",
  155: "Terrain_Barricade", 200: "Terrain_Stream", 201: "Terrain_Wall", 202: "Terrain_Trench", 203: "Terrain_Fence",
};

/** Token family for UI: person (Circle_Dwarf..Circle_Human), search, threat, explore, hexagon, terrain, none */
export function tokenFamily(t: number): "none" | "explore" | "search" | "threat" | "person" | "hexagon" | "terrain" {
  if (t === 1) return "explore";
  if (t === 2) return "search";
  if (t === 3) return "threat";
  if (t >= 4 && t <= 7) return "person";
  if (t >= 31 && t <= 33) return "hexagon";
  if (t >= 50) return "terrain";
  return "none";
}

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

  /** Translate actions applied to this object (Unity units, world space) */
  moved: [number, number, number] = [0, 0, 0];

  /** World position (Unity) and rotation about z (deg) from the prefab's local transforms ("tr") up to its root */
  world(): { p: [number, number, number]; angle: number } {
    let p: [number, number, number] = [0, 0, 0];
    let q: [number, number, number, number] = [0, 0, 0, 1];
    const chain: any[] = [];
    for (let go = this.go, guard = 0; go && guard < 64; go = this.prefab.gameObjects[String(go.parent)], guard++) chain.push(go);
    for (const go of chain.reverse()) {
      const t = go.tr ?? {};
      const lp: number[] = t.p ?? [0, 0, 0], lq: number[] = t.r ?? [0, 0, 0, 1], ls: number[] = t.s ?? [1, 1, 1];
      const r = rotate(q, [lp[0]! * 1, lp[1]! * 1, lp[2]! * 1]);
      p = [p[0] + r[0], p[1] + r[1], p[2] + r[2]];
      q = qmul(q, lq as [number, number, number, number]);
      void ls; // nested scales are not used by the node layouts
    }
    const angle = (Math.atan2(2 * (q[3] * q[2] + q[0] * q[1]), 1 - 2 * (q[1] * q[1] + q[2] * q[2])) * 180) / Math.PI;
    // (an object moved by Translate carries its children along)
    for (let go = this.go, guard = 0; go && guard < 64; go = this.prefab.gameObjects[String(go.parent)], guard++) {
      const o = this.game.objs.get(`${this.src}|${go === this.go ? this.pid : this.findPid(go)}`);
      if (o) { p[0] += o.moved[0]; p[1] += o.moved[1]; p[2] += o.moved[2]; }
    }
    return { p, angle };
  }

  private findPid(go: any): number {
    for (const k of Object.keys(this.prefab.gameObjects)) if (this.prefab.gameObjects[k] === go) return Number(k);
    return -1;
  }
}

function qmul(a: [number, number, number, number], b: [number, number, number, number]): [number, number, number, number] {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}
function rotate(q: [number, number, number, number], v: [number, number, number]): [number, number, number] {
  const [x, y, z, w] = q;
  const r = qmul(qmul(q, [v[0], v[1], v[2], 0]), [-x, -y, -z, w]);
  return [r[0], r[1], r[2]];
}

export interface Space {
  traits: number;
  encounter: number | null;
  node: GameNode | null;
  /** TileSpace.HasDarkness (FFG mode tile geometry) */
  darkness: boolean;
}

/** Length of the running game's log (set by Game): when tiles and nodes appear, for the UI to show them with their message */
export const LOG_CLOCK = { now: (): number => 0 };

export class Tile {
  readonly spaces: Space[];
  private shown = false;
  /** log index from which the tile is shown (the message placing it); -1 = never */
  shownAt = -1;
  /** log index of the message placing its exploration token */
  tokenAt = -1;
  get visible(): boolean { return this.shown; }
  set visible(v: boolean) {
    if (v && !this.shown) { this.shownAt = LOG_CLOCK.now(); this.tokenAt = this.shownAt; }
    this.shown = v;
  }
  get hasDarkness(): boolean {
    return this.spaces.some((s) => s.darkness);
  }
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
    this.spaces = spaces.map((s) => ({ traits: s.traits, encounter: null, node: null, darkness: !!s.darkness }));
  }
}

export class GameNode {
  private shown = false;
  /** log index from which the token is shown (see Tile.shownAt) */
  shownAt = -1;
  get visible(): boolean { return this.shown; }
  set visible(v: boolean) {
    if (v && !this.shown) this.shownAt = LOG_CLOCK.now();
    this.shown = v;
  }
  /** Id within one game in creation order (stable across replays of the same setup), for UI */
  readonly uid: number;
  /** Token3DType of the object's GameNode component (TOKEN_TYPES; 0 = no token) */
  readonly token: number;
  readonly game: Game;
  readonly obj: Obj;
  readonly tile: Tile | null;
  readonly space: number;
  kind: string;
  readonly encId: number | null;
  /** battleboard: position on the boards (Unity world x, y; boards 10 wide from x = -5) and rotation about z (deg) */
  pos: [number, number] | null = null;
  angle = 0;
  /** terrain node: TerrainNodeModel id (random terrain: chosen when revealed), -1 = none */
  terrain = -1;
  /** token type: the GameNode's Token3DType, a random terrain's model's TokenType once chosen */
  tokenType = 0;
  /** GameNode.IsUnique (SetTerrainIsUnique): the unique terrain glow */
  unique = false;
  /** log index of the message after which the terrain token turns into its 3D piece (SetTerrainTokenMode) */
  pieceAt = -1;

  constructor(game: Game, obj: Obj, tile: Tile | null = null, space = 0, kind = "Encounter", encId: number | null = null) {
    this.game = game;
    this.obj = obj;
    this.tile = tile;
    this.space = space;
    this.kind = kind;
    this.encId = encId;
    this.uid = game.nodeSeq++;
    const gn = obj.components.GameNode;
    this.token = gn && typeof gn.Token3DType === "number" ? gn.Token3DType : 0;
    this.tokenType = this.token;
    this.terrain = gn?.TerrainModel ? Number(gn.TerrainModel.id ?? -1) : -1;
    this.unique = !!gn?.IsUnique;
    obj.node = this;
    if (game.battleboard) { const w = obj.world(); this.pos = [w.p[0], w.p[1]]; this.angle = w.angle; }
  }
}

/** FFG AttackAbilityType flags (the combat card's modifiers) */
export const ATTACK_ABILITIES = { Pierce: 1, Smite: 2, Lethal: 4, Sunder: 8, Stun: 16, Cleave: 32 } as const;
/** EnemyBonusTraits.Ranged */
const BONUS_RANGED = 0x800;
/** EnemyBonusModel.GetCost(num): -1 when the bonus has no cost for that group size */
export function bonusCost(b: any, n: number): number {
  for (const c of or(gd(b, "Costs"), [])) { if (gd(c, "Num", 1) === n) return toInt(gd(c, "Cost", 0)); }
  return -1;
}
export type AttackAbility = keyof typeof ATTACK_ABILITIES;
/** One unit of an enemy group: health 0 = defeated */
export interface EnemyUnit { hp: number; armor: number; sorcery: number }

/**
 * EnemyInfoDialog.CalculateHealth: the hits go to the first living unit (each unit with Cleave): armor absorbs them
 * (not with Pierce), then sorcery (not with Smite), then health (Lethal: at most half the health rounded up, and a
 * unit brought to half or less dies); Sunder takes 1 armor first. Returns the units after the attack, as shown.
 */
export function calculateHealth(start: readonly EnemyUnit[], damage: number, abilities: number): EnemyUnit[] {
  const on = (a: AttackAbility) => (abilities & ATTACK_ABILITIES[a]) !== 0;
  const u = start.map((x) => ({ ...x }));
  let num = damage;
  for (let i = 0; i < u.length; i++) {
    const x = u[i]!;
    if (on("Cleave")) num = damage;
    if (on("Sunder") && (on("Cleave") || i === 0 || u[i - 1]!.hp <= 0)) x.armor = Math.max(0, x.armor - 1);
    if (num <= 0) continue;
    if (!on("Pierce")) { const a = Math.min(num, x.armor); x.armor -= a; num -= a; }
    if (!on("Smite")) { const s = Math.min(num, x.sorcery); x.sorcery -= s; num -= s; }
    const h = on("Lethal") ? Math.min(num, Math.floor(x.hp / 2 + 0.5)) : Math.min(num, x.hp);
    if (on("Lethal") && x.hp <= 2 * h) x.hp = 0;
    else x.hp -= h;
    num -= h;
  }
  return u;
}

/** The attack answer: hits (0..99) + 100 x AttackAbilityType flags */
export const attackHits = (a: number) => a % 100;
export const attackAbilities = (a: number) => Math.floor(a / 100);

export class EnemyGroup {
  readonly uid: number;
  /** FFG EnemyGroup._unitHealth / _unitArmor / _unitSorcery, one entry per unit the group started with */
  hp: number[];
  armor: number[];
  sorcery: number[];
  /** GetMaxUnitHealth / Armor / Sorcery (includeBonuses: true) */
  maxHp: number;
  maxArmor: number;
  maxSorcery: number;
  /** EnemyGroup._activeBonuses (EnemyBonusModel), at most 3; a group with any is elite */
  readonly bonuses: any[] = [];
  /** EnemyGroup.UniqueTokenId: the banner (Banner{id + 1:D2}) telling apart groups of one kind; -1 = none */
  uniqueId = -1;
  /** log index of the message placing the group (the UI adds it to the tracker then); -1 = from the start */
  shownAt = -1;
  exhausted = false;
  /** FFG EnemyGroup.AttackReduction: each further attack in a round deals 1 less (reset on refresh) */
  attackReduction = 0;
  activationOverride: any = null;
  obj: Obj | null = null;
  readonly model: any;
  readonly logic: Obj | null;

  constructor(uid: number, model: any, size: number, logic: Obj | null = null) {
    this.uid = uid;
    this.model = model;
    this.logic = logic;
    this.maxHp = toInt(or(gd(model, "Health"), 3));
    this.maxArmor = toInt(or(gd(model, "Armor"), 0));
    this.maxSorcery = toInt(or(gd(model, "Sorcery"), 0));
    this.hp = Array.from({ length: size }, () => this.maxHp);
    this.armor = Array.from({ length: size }, () => this.maxArmor);
    this.sorcery = Array.from({ length: size }, () => this.maxSorcery);
  }

  /** UnitsRemaining */
  get size(): number { return this.hp.filter((h) => h > 0).length; }
  /** UnitStartCount */
  get startSize(): number { return this.hp.length; }
  get unitHp(): number { return this.maxHp; }
  /** CurrentHealth */
  get health(): number { return this.hp.reduce((s, h) => s + h, 0); }
  /** damage on the first living unit */
  get damage(): number { const i = this.hp.findIndex((h) => h > 0); return i < 0 ? 0 : this.maxHp - this.hp[i]!; }
  units(): EnemyUnit[] { return this.hp.map((hp, i) => ({ hp, armor: this.armor[i]!, sorcery: this.sorcery[i]! })); }

  /** IsElite */
  get elite(): boolean { return this.bonuses.length > 0; }
  /** IsRanged: the Range trait (0x400) or a bonus with the Ranged trait */
  get ranged(): boolean {
    return (toInt(or(gd(this.model, "Traits"), 0)) & 0x400) !== 0 || this.bonuses.some((b) => (toInt(or(gd(b, "Traits"), 0)) & BONUS_RANGED) !== 0);
  }
  /** GetBonusDamage(Physical / Fear) */
  bonusDamage(physical: boolean): number { return this.bonuses.reduce((s, b) => s + toInt(or(gd(b, physical ? "Physical" : "Fear"), 0)), 0); }
  /** EnemyInfoDialog._blockedAbilities: AttackAbilityType flags the players may not use against this group */
  get blockedAbilities(): number { return this.bonuses.reduce((s, b) => s | toInt(or(gd(b, "BlocksModifiers"), 0)), 0); }
  /** ContainsWithTraits */
  hasBonusTraits(traits: number): boolean { return this.bonuses.some((b) => (toInt(or(gd(b, "Traits"), 0)) & traits) !== 0); }

  /** Add(bonus, applyBonus): the bonus raises the maxima, applied also to every unit */
  addBonus(b: any, apply: boolean): void {
    if (this.bonuses.includes(b)) return;
    this.bonuses.push(b);
    const h = toInt(or(gd(b, "Health"), 0)), a = toInt(or(gd(b, "Armor"), 0)), so = toInt(or(gd(b, "Sorcery"), 0));
    this.maxHp += h; this.maxArmor += a; this.maxSorcery += so;
    if (!apply) return;
    for (let i = 0; i < this.hp.length; i++) {
      if (this.hp[i]! <= 0) continue;
      this.hp[i] = this.hp[i]! + h; this.armor[i] = this.armor[i]! + a; this.sorcery[i] = this.sorcery[i]! + so;
    }
  }

  /** TryAddFigure: one more unit, every unit like the first one */
  grow(): void {
    this.hp.push(this.hp[0]!); this.armor.push(this.armor[0]!); this.sorcery.push(this.sorcery[0]!);
    for (let i = 1; i < this.hp.length; i++) { this.hp[i] = this.hp[0]!; this.armor[i] = this.armor[0]!; this.sorcery[i] = this.sorcery[0]!; }
  }

  /** HealGroup: one health at a time to each damaged living unit, in order */
  heal(amount: number): void {
    while (amount > 0) {
      let any = false;
      for (let i = 0; i < this.hp.length && amount > 0; i++) {
        if (this.hp[i]! > 0 && this.hp[i]! < this.maxHp) { this.hp[i]!++; amount--; any = true; }
      }
      if (!any) break;
    }
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
  /** ffg flow (set by the campaign layer): the party's skills (SkillModel ids) with effects in play:
   *  229 Collector (+2 lore per new item), 232 Chronicling (+2 lore when an adventure ends) */
  party_skills?: number[];
  /** ffg flow: corruption per player (SerializedHero.Corruption, ModifyCorruption) */
  corruption?: number[];
  /** ffg flow: hero rewards for the campaign layer (AwardTitle / AddSkill go to one hero) */
  awards?: { kind: "title" | "skill"; player: number; id: number }[];
  /** SetRestEpilogue: SerializedGame.RestTextOverride for the next rest scene */
  rest_text?: { key: string; inserts: string[] } | null;
  /** SetNextCutsceneId: GameData.OverrideCutsceneId (-1 = the campaign's victory / defeat cutscene) */
  cutscene?: number;
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
  /**
   * Round rules: "ffg" = as GameController/Adventure (free hero phase ended by the players, enemy activation
   * choices, attack reduction, last stand from the hero menu, darkness from tiles); "legacy" = engine-py's
   * simplified loop (Python parity). Default: same as mapMode.
   */
  flow?: "ffg" | "legacy";
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

/** MapBuilder options for a game setup (shared by Game and generateBoard) */
export function mapGenOptions(D: any, opts: GameOptions, campaign: Campaign): MapGenOptions {
  const c = campaign;
  const products = opts.products ?? (D.productOrder ?? keysOf(D.models.ProductModel).map(Number));
  return {
    seed: opts.mapSeed ?? opts.seed ?? 0, players: opts.players ?? 2, products, language: opts.language ?? "English",
    unlockedChain: c.unlocked_chain, usedEncounters: c.used_encounters, usedGroups: c.used_groups ?? [],
    groupItems: opts.groupItems ?? c.items,
  };
}

/** True if the adventure prefab has a MapBuilder (generated board, not a battle map or a fixed one) */
export const hasMapBuilder = (adv: any): boolean =>
  Object.values<any>(adv.gameObjects).some((o) => Object.hasOwn(o.components ?? {}, "MapBuilder"));

/**
 * The board a Game with these options would generate, without running it (null: legacy map mode or no MapBuilder).
 * Lets a client generate first, fetch only the encounters in `spawnOrder`, then start the game with `board`.
 * Pass a copy of the campaign: generation reads it, the game later mutates it.
 */
export function generateBoard(src: ContentSource, advId: number, opts: GameOptions = {}): GeneratedMap | null {
  const D = src.db();
  if ((opts.mapMode ?? (D.tiles ? "ffg" : "legacy")) !== "ffg") return null;
  const adv = src.adventure(advId);
  if (!hasMapBuilder(adv)) return null;
  return generateMap(D, adv, mapGenOptions(D, opts, opts.campaign ?? newCampaign()));
}

/** Encounter ids a board spawns (what a client must preload before starting the game) */
export const boardEncounters = (m: GeneratedMap): number[] => [...new Set(m.spawnOrder.map(([, , e]) => e))];

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
  /** Adventure._uniqueNormalEnemyIds / _uniqueEliteIds: free banners (normal groups of a kind already in play, elites) */
  readonly uniqueNormal = [1, 4, 5, 8, 10, 11];
  readonly uniqueElite = [0, 2, 3, 6, 7, 9];
  /** Adventure.CurrentReservedEliteBannerIdList (AdventureModel.NumberReservedEliteBanners, for scripted elites) */
  readonly reservedElite: number[] = [];
  /** Adventure.PendingEnemiesToAdd: groups being bought by a random spawn */
  pendingEnemies: EnemyGroup[] = [];
  /** FFG language name (EnemyBonusModel.UnsupportedLanguage) */
  readonly language: string;
  /** AdventureModel.Type = Battleboard: one or two 3 x 3 boards instead of tiles */
  readonly battleboard: boolean;
  /** battleboard: BBVisuals.SetBoardVisibility per board, WeatherEffect per board (0 none, 1 light rain, 2 heavy rain) */
  boardVisible = [true, true];
  weather = [0, 0];
  ended: string | null = null;
  result: "victory" | "defeat" | null = null;
  /** ProceedToNextGame ran: the campaign goes on (to SerializedGame.CurrentAdventureId) */
  proceeded = false;
  objective: any = null;
  /** Inserts of the objective message at the time it was set (for UI) */
  objectiveInserts: string[] = [];
  /** AddAdventureRule / RemoveAdventureRule: the adventure's special rules in force (UI_Game.LabelAdventureRules) */
  adventureRules: { key: string; inserts: string[] }[] = [];
  /** The dialog a Player is being asked about (set by dialog actions just before the call; UI only) */
  prompt: { fsm: Fsm; msg: any } | { key?: string; inserts: string[] } | null = null;
  /** Adventure._activatingEnemy: the group whose activation / attack is being resolved */
  activating: EnemyGroup | null = null;
  /**
   * Heroes. damage/fear are the bot's simulation only (the real app does not track them: players use cards);
   * lastStand = next last stand difficulty (FFG Hero.LastStandDifficulty, starts at 1)
   */
  readonly heroes: { damage: number; fear: number; defeated: boolean; lastStand: number }[];
  readonly flow: "ffg" | "legacy";
  /** FFG flow: hero actions taken this round (the bot ends the hero phase after 2 per hero) */
  actionsTaken = 0;
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
  /** GameNode.uid counter */
  nodeSeq = 0;
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
    LOG_CLOCK.now = () => this.log.length;
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
    this.flow = opts.flow ?? this.mapMode;
    // (the legacy flow keeps engine-py's behaviour for the parity checks)
    this.battleboard = toInt(or(gd(this.model, "Type"), 0)) === 1 && this.flow === "ffg";
    this.language = LANG[opts.language ?? "English"] ?? opts.language ?? "English";
    this.campaign = opts.campaign ?? newCampaign();
    for (const k of keysOf(this.D.globals)) this.globals[k] = structuredClone(this.D.globals[k].value);
    for (const [k, v] of Object.entries(this.campaign.flags)) this.globals[k] = v;
    if (this.flow === "ffg") {
      // GameFsmVariables.Lore is the global "Campaign/Lore"; CorruptionPresence follows the heroes' corruption
      this.globals["Campaign/Lore"] = this.campaign.lore;
      this.globals.CorruptionPresence = (this.campaign.corruption ?? []).some((c) => c > 0);
    }
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
    for (let k = 0; k < toInt(or(gd(this.model, "NumberReservedEliteBanners"), 0)) && this.uniqueElite.length; k++) this.reservedElite.push(this.uniqueElite.pop()!);
    this.heroes = Array.from({ length: this.players }, () => ({ damage: 0, fear: 0, defeated: false, lastStand: 1 }));
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

  /** Inserts of a message in the context of the current prompt's FSM (UI only: no warnings, no side effects) */
  promptInserts(msg?: any): string[] {
    const p = this.prompt;
    if (!p) return [];
    if (!("fsm" in p)) return msg === undefined ? [...p.inserts] : [];
    return this.quietly(() => this.msgKey(p.fsm, msg === undefined ? p.msg : msg, true)[1].map(String));
  }

  /** Run f without recording warnings (UI-only evaluations must not change traces) */
  quietly<T>(f: () => T): T {
    const saved = new Map(this.warnings);
    try {
      return f();
    } finally {
      this.warnings.clear();
      for (const [k, v] of saved) this.warnings.set(k, v);
    }
  }

  /** GameVariables.Lore += n (ffg flow keeps the "Campaign/Lore" global in step) */
  addLore(n: number): void {
    this.campaign.lore += n;
    if (this.flow === "ffg") this.globals["Campaign/Lore"] = this.campaign.lore;
  }

  emit(key: any, ...inserts: unknown[]): void {
    this.write(key, inserts, false);
  }

  /** A chronicle-only entry (see LogMeta.log) */
  note(key: any, ...inserts: unknown[]): void {
    this.write(key, inserts, true);
  }

  /** the location of the next written entry (SpawnEnemyGroup / SpawnRandomEnemyGroups highlight) */
  private nextAt: SpaceRef | null = null;
  /** the banner of the next written entry (0 = none) */
  private nextBanner = 0;

  private write(key: any, inserts: unknown[], logOnly: boolean): void {
    if (key === null || key === undefined) return;
    const e: LogEntry = [this.advIndex, this.round, key, inserts.map(pyStr)];
    const at = logOnly ? null : this.nextAt;
    const banner = logOnly ? 0 : this.nextBanner;
    if (!logOnly) { this.nextAt = null; this.nextBanner = 0; }
    if (this.activating || logOnly || at || banner > 0) {
      e.push({ ...(this.activating ? { enemy: this.activating.uid } : {}), ...(logOnly ? { log: true as const } : {}), ...(at ? { at } : {}),
        ...(banner > 0 ? { banner } : {}) });
    }
    this.log.push(e);
  }

  /** The next shown message points at this space */
  pointAt(at: SpaceRef | null): void { this.nextAt = at; }
  /** The next shown message carries this banner (PopupOptions.ExtraSpriteId, 0 = none) */
  bannerNext(id: number): void { this.nextBanner = id; }
  /** The game node of a scene object (a spawn position on a tile) */
  nodeOf(o: Obj | null): GameNode | undefined { return o ? [...this.nodes, ...this.advNodes].find((x) => x.obj === o) : undefined; }

  /**
   * Where a spawned group goes: the space of the SpawnPosition object (a node on a tile), else a space of an explored
   * visible tile (the original picks one at random with Unity's RNG: here a fixed pick that leaves the game's RNG alone)
   */
  spawnSpot(o: Obj | null): SpaceRef | null {
    if (this.battleboard) {
      // battleboards: the position object, else a square of a shown board (a fixed pick, the game's RNG left alone)
      if (o) { const w = o.node?.pos ?? o.world().p; return { tile: -1, space: 0, pos: [w[0]!, w[1]!] }; }
      const boards = toInt(or(gd(this.model, "BoardSettings"), [{}]).length) || 1;
      const k = (this.log.length * 7919 + this.enemies.length * 31) % (9 * boards);
      const b = Math.floor(k / 9), sq = k % 9;
      if (!this.boardVisible[b]) return { tile: -1, space: 0, pos: [((sq % 3) - 1) * (10 / 3), (1 - Math.floor(sq / 3)) * (10 / 3)] };
      return { tile: -1 - b, space: sq, pos: [b * 10 + ((sq % 3) - 1) * (10 / 3), (1 - Math.floor(sq / 3)) * (10 / 3)] };
    }
    const n = o ? [...this.nodes, ...this.advNodes].find((x) => x.obj === o) : undefined;
    if (n?.tile) return { tile: n.tile.id, space: n.space };
    const spaces: SpaceRef[] = [];
    for (const t of this.tiles.values()) if (t.visible && t.explored) t.spaces.forEach((_, i) => spaces.push({ tile: t.id, space: i }));
    return spaces.length ? spaces[(this.log.length * 7919 + this.enemies.length * 31) % spaces.length]! : null;
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
    const m = this.opts.board ?? generateMap(this.D, this.adv, mapGenOptions(this.D, { ...this.opts, seed: this.seed, players: this.players }, c));
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

  /**
   * Key and inserts of a message. ui = true also resolves inserts engine-py leaves empty (the log must stay
   * identical to it): PlayerIndex -> "@hero:<index>", RandomHero -> "@hero:?" (the UI turns them into hero names)
   */
  msgKey(fsm: Fsm, msg: any, ui = false): [any, unknown[]] {
    const k = keyOf(msg);
    if (isDict(msg) && truthy(gd(msg, "inserts"))) {
      const ins = msg.inserts.map((i: any) => {
        if (ui && gd(i, "filter") === 5) return `@hero:${toInt(this.get(fsm, gd(i, "PlayerIndex", 0)))}`;
        if (ui && gd(i, "filter") === 3) return "@hero:?";
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

  /** logOnly: the message was the text of a question (challenge, confirm, choice): chronicle only */
  show(fsm: Fsm, msg: any, logOnly = false): any {
    const [k, ins] = this.msgKey(fsm, msg);
    if (truthy(k)) this.write(k, ins, logOnly);
    return k;
  }

  signalEnd(victory: boolean): void {
    if (this.ending) return;
    this.ending = true;
    this.result = victory ? "victory" : "defeat";
    // GameController.SignalEndGame: skill 232 (Chronicling) gives 2 lore
    if (this.flow === "ffg" && this.campaign.party_skills?.includes(232)) this.addLore(2);
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
    // the tokens found here come with their own messages (REVEALED), after the explore message is confirmed
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

  /** announce: show "Place N enemies as indicated" at a space (false: the action's own message said it, chronicle only) */
  spawnGroup(m: any, size: number, logic: Obj | null = null, announce = true): EnemyGroup {
    const g = new EnemyGroup(this.nextId(), m, size, logic);
    this.enemies.push(g);
    this.announceGroup(g, announce);
    if (logic !== null) logic.enemyGroup = g;
    return g;
  }

  /** UI_SPAWN_GROUP_FORMAT at a space with the group's banner (false: chronicle only) */
  announceGroup(g: EnemyGroup, announce: boolean, at: SpaceRef | null = null): void {
    const n = g.startSize;
    if (announce) {
      g.shownAt = this.log.length;
      this.pointAt(at ?? this.spawnSpot(null));
      this.nextBanner = g.uniqueId + 1;
      this.emit("UI_SPAWN_GROUP_FORMAT", n, this.enemyName(g.model, n));
    } else this.note("UI_SPAWN_GROUP_FORMAT", n, this.enemyName(g.model, n));
  }

  // ------------------------------------------------------------ FFG spawning (Adventure, SpawnRandomEnemyGroups, ...)
  /** EnemyModel.GetCost: -1 when the model has no cost for that size */
  modelCost(m: any, n: number): number {
    for (const c of or(gd(m, "Costs"), [])) { if (gd(c, "Num", 1) === n) return toInt(gd(c, "Cost", 0)); }
    return -1;
  }

  /** EnemyModel.AreLinked (or the same model) */
  sameKind(a: any, b: any): boolean {
    if (!a || !b) return false;
    return a === b || a._id === gd(b, "LinkedEnemyId", 0) || b._id === gd(a, "LinkedEnemyId", 0);
  }

  /** GetUnitsInPlayCount + GetUnitsPendingCount + GetUnitsReservedCount */
  unitsOfKind(m: any): number {
    let n = 0;
    for (const g of this.enemies) if (this.sameKind(g.model, m)) n += g.size;
    for (const g of this.pendingEnemies) if (this.sameKind(g.model, m)) n += g.size;
    for (const id of this.reserve) if (this.sameKind(this.enemyModel(id), m)) n++;
    return n;
  }

  /** Adventure.IsEnemyEligibleForSpawn */
  canSpawn(m: any, pts: number): boolean {
    if (!truthy(m) || this.modelCost(m, 1) > pts) return false;
    let max = toInt(or(gd(m, "MaxUnitsInPlay"), 0));
    const linked = toInt(or(gd(m, "LinkedEnemyId"), 0));
    if (linked > 0) { const l = this.enemyModel(linked); if (truthy(l)) max = Math.max(max, toInt(or(gd(l, "MaxUnitsInPlay"), 0))); }
    return this.unitsOfKind(m) < max;
  }

  /** Adventure.GetEligibleEnemyModels: not unique, passes the adventure's and the action's filters, affordable */
  eligibleFfg(pts: number, flt: any = null): any[] {
    const meets = (f: any, m: any) => {
      if (!truthy(f)) return true;
      const tr = toInt(or(gd(m, "Traits"), 0));
      const ex = toInt(or(gd(f, "ExcludeIfAny"), 0)), all = toInt(or(gd(f, "MustHaveAll"), 0)), any = toInt(or(gd(f, "MustHaveAny"), 0));
      return !(ex && tr & ex) && !(all && (tr & all) !== all) && !(any && !(tr & any));
    };
    const gflt = gd(this.model, "GlobalEnemyFilter");
    return valuesOf(this.D.models.EnemyModel).filter((m: any) => !truthy(gd(m, "IsUnique")) && meets(gflt, m) && meets(flt, m) && this.canSpawn(m, pts));
  }

  /** EnemyGroup.GetEligibleBonuses: the model's bonuses this group can still take for these points */
  eligibleBonuses(g: EnemyGroup, pts: number): any[] {
    if (g.bonuses.length >= 3) return [];
    const out: any[] = [];
    for (const ref of or(gd(g.model, "Bonuses"), [])) {
      const b = this.modelBy("EnemyBonusModel", ref);
      if (!truthy(b) || truthy(gd(gd(b, "UnsupportedLanguage"), this.language))) continue;
      const c = bonusCost(b, g.startSize);
      if (c >= 0 && c <= pts && !g.bonuses.includes(b) && !g.hasBonusTraits(toInt(or(gd(b, "Traits"), 0)))) out.push(b);
    }
    return out;
  }

  // ------------------------------------------------------------ battleboard terrain (Adventure.CoroutineRevealTerrains)
  /** TerrainNodeCounts: revealed terrain nodes by TerrainNodeModel id */
  terrainCount(id: number): number {
    return [...this.nodes, ...this.advNodes].filter((n) => n.visible && n.terrain === id).length;
  }

  /** GameNode.GetRandomTerrainType: an eligible model with fewer than MaxCountInPlay of it and its other side in play */
  randomTerrain(): any {
    const TM = this.D.models.TerrainNodeModel ?? {};
    const ok = valuesOf(TM).filter((m: any) => truthy(gd(m, "RandomEligible"))
      && this.terrainCount(m._id) + (gd(m, "OtherSideId") != null ? this.terrainCount(toInt(m.OtherSideId)) : 0) < toInt(or(gd(m, "MaxCountInPlay"), 0)));
    return ok.length ? this.rng.choice(ok) : null;
  }

  /**
   * RevealTerrainNodes: random terrains get their model, the tokens drop, the message lists them by kind; after it the
   * tokens turn into their 3D pieces (SetTerrainTokenMode)
   */
  revealTerrains(nodes: GameNode[]): void {
    const TM = this.D.models.TerrainNodeModel ?? {};
    const counts = new Map<number, number>();
    for (const n of nodes) {
      if (truthy(gd(n.obj.components.GameNode, "IsRandomTerrain")) && n.terrain < 0) {
        const m = this.randomTerrain();
        if (!m) { this.warn("no eligible random terrain"); continue; }
        n.terrain = toInt(m._id);
        n.tokenType = toInt(or(gd(m, "TokenType"), 0));
        // PlayMakerFSM.SetFsmTemplate: the terrain's own FSM replaces the placeholder (rules reminder on click ...)
        const tf = gd(m, "TemplateFsm");
        if (tf) {
          for (const old of n.obj.fsms) { old.finished = true; const i = this.allFsms.indexOf(old); if (i >= 0) this.allFsms.splice(i, 1); }
          n.obj.fsms.length = 0;
          const f = new Fsm(this, tf, n.obj);
          n.obj.fsms.push(f);
          this.allFsms.push(f);
          f.start();
        }
      }
      if (n.terrain < 0) continue;
      counts.set(n.terrain, (counts.get(n.terrain) ?? 0) + 1);
      n.obj.visible = true;
      n.visible = true;
    }
    if (!counts.size) return;
    const lines: string[] = [];
    for (const [id, c] of counts) {
      const m = gd(TM, String(id), {});
      const key = c > 1 ? gd(m, "NameKeyPlural") : gd(m, "NameKey");
      this.note("UI_REVEAL_TERRAIN_LOG_FORMATTED", c, key);
      lines.push(`${c}|${key}`);
    }
    this.emit("UI_TERRAIN_NODES_REVEAL_FORMATTED", `@lines:${lines.join(";")}`);
    const at = this.log.length - 1;
    for (const n of nodes) if (n.visible && n.terrain >= 0) n.pieceAt = at;
  }

  /** MaxNumberOfElitesInPlay */
  get maxElites(): number { return 6 - this.reservedElite.length; }

  /** Adventure.GetUniqueId: elites always get a banner, a normal group only when its kind is already in play */
  takeUniqueId(g: EnemyGroup): number {
    if (!g.elite && !this.enemies.some((e) => e.model === g.model && !e.elite)) return -1;
    const l = g.elite ? this.uniqueElite : this.uniqueNormal;
    return l.length ? l.shift()! : -1;
  }

  /** Adventure.ReturnUniqueId */
  returnUniqueId(g: EnemyGroup): void {
    if (g.uniqueId < 0) return;
    const l = g.elite ? this.uniqueElite : this.uniqueNormal;
    if (!l.includes(g.uniqueId)) l.unshift(g.uniqueId);
    g.uniqueId = -1;
  }

  /** Adds the group to the tracker with its banner (EnemiesInPlay.Add after GetUniqueId) */
  enterPlay(g: EnemyGroup): void {
    g.uniqueId = this.takeUniqueId(g);
    this.enemies.push(g);
  }

  private tryAddBonus(pending: EnemyGroup[], st: { pts: number }): boolean {
    const room = this.enemies.filter((e) => e.elite).length + this.pendingEnemies.filter((e) => e.elite).length < this.maxElites;
    for (const g of pending) {
      if (!g.elite && !room) continue;
      const el = this.eligibleBonuses(g, st.pts);
      if (!el.length) continue;
      const b = this.rng.choice(el);
      g.addBonus(b, true);
      st.pts -= bonusCost(b, g.size);
      return true;
    }
    return false;
  }

  private tryAddFigure(pending: EnemyGroup[], st: { pts: number }): boolean {
    for (const g of pending) {
      const n = g.startSize;
      if (n >= toInt(or(gd(g.model, "MaxUnitCount"), 1)) || this.unitsOfKind(g.model) >= toInt(or(gd(g.model, "MaxUnitsInPlay"), 0))) continue;
      let cost = this.modelCost(g.model, n + 1) - this.modelCost(g.model, n);
      for (const b of g.bonuses) cost += bonusCost(b, n + 1) - bonusCost(b, n);
      if (cost > st.pts) continue;
      g.grow();
      st.pts -= cost;
      return true;
    }
    return false;
  }

  /**
   * One step of buying with enemy points (SpawnRandomEnemyGroups / SpawnEnemyGroupsFromSpawnPoints): weights for a new
   * group, a bonus and a figure; returns true when a new group should be bought
   */
  private spendStep(pending: EnemyGroup[], st: { pts: number }, eligible: boolean, inPlay: number, inPlayElite: number): boolean {
    const P = this.players, p2 = P * P;
    const bonusPref = Number(or(gd(this.model, "BonusPref"), 1)), figurePref = Number(or(gd(this.model, "FigurePref"), 1));
    let a = eligible ? p2 / (pending.length + inPlay) : 0;
    const b = (p2 / (P + inPlayElite + pending.filter((g) => g.elite).length)) * bonusPref;
    const c = (P + 3) * figurePref;
    const r = this.rng.random() * (a + b + c);
    this.rng.shuffle(pending);
    if (r < a) return true;
    if (r < a + b) {
      if (this.tryAddBonus(pending, st)) return false;
      a = eligible ? a + b / 2 : 0;
      return r < a || !this.tryAddFigure(pending, st);
    }
    if (this.tryAddFigure(pending, st)) return false;
    a = eligible ? a + c / 2 : 0;
    return r < a || !this.tryAddBonus(pending, st);
  }

  /** SpawnRandomEnemyGroups.SpawnGroups: groups bought with the points until a share depending on threat is spent */
  buyRandomGroups(points: number, flt: any): { groups: EnemyGroup[]; pts: number } {
    const st = { pts: points };
    const start = points;
    const pending: EnemyGroup[] = (this.pendingEnemies = []);
    try {
      const t = this.threatMax > 0 ? Math.min(1, Math.max(0, toInt(or(gd(this.globals, "Threat"), 0)) / this.threatMax)) : 1;
      const share = 0.7 + 0.3 * t;
      const inPlay = this.enemies.length, inPlayElite = this.enemies.filter((e) => e.elite).length;
      let el = this.eligibleFfg(st.pts, flt);
      if (!el.length) return { groups: [], pts: st.pts };
      const buy = () => { const m = this.rng.choice(el); pending.push(new EnemyGroup(this.nextId(), m, 1)); st.pts -= this.modelCost(m, 1); };
      buy();
      el = this.eligibleFfg(st.pts, flt);
      while (st.pts > 0) {
        if (this.spendStep(pending, st, el.length > 0, inPlay, inPlayElite)) {
          if (!el.length) break;
          buy();
        }
        el = this.eligibleFfg(st.pts, flt);
        if (1 - st.pts / start > share) break;
      }
      return { groups: [...pending], pts: st.pts };
    } finally { this.pendingEnemies = []; }
  }

  /** SpawnEnemyGroupsFromSpawnPoints.SpawnGroups: per spawn point, the points spent the same way; groups by point */
  buySpawnPointGroups(points: number[], filters: any[]): EnemyGroup[][] {
    const st = points.map((p) => ({ pts: p }));
    const done = points.map(() => false);
    const groups: EnemyGroup[][] = points.map(() => []);
    this.pendingEnemies = [];
    try {
      const inPlay = this.enemies.length, inPlayElite = this.enemies.filter((e) => e.elite).length;
      const open = () => st.map((s, i) => (s.pts > 0 && !done[i] ? i : -1)).filter((i) => i >= 0);
      for (let idx = open(); idx.length; idx = open()) {
        const i = this.rng.choice(idx);
        const el = this.eligibleFfg(st[i]!.pts, filters[i]);
        const pending = groups[i]!;
        const fresh = !pending.length || this.spendStep(pending, st[i]!, el.length > 0, inPlay, inPlayElite);
        if (!fresh) continue;
        if (!el.length) { done[i] = true; continue; }
        const m = this.rng.choice(el);
        const g = new EnemyGroup(this.nextId(), m, 1);
        st[i]!.pts -= this.modelCost(m, 1);
        pending.push(g);
        this.pendingEnemies.push(g);
      }
      return groups;
    } finally { this.pendingEnemies = []; }
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
    if (i >= 0) { this.enemies.splice(i, 1); this.returnUniqueId(g!); }
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
        if (this.flow === "ffg") {
          this.heroPhaseFfg();
          this.endRoundFfg();
          continue;
        }
        if (this.round > 1) this.emit("UI_PHASE_HERO");
        this.heroPhase();
        this.endRound();
      }
      this.ended = this.ended || "max_rounds";
    } catch (e) {
      if (e instanceof Surrender) {
        // GameController.SignalEndGame(isVictory: false): the adventure's failure path runs (it may still ask things)
        try { this.ended = "surrender"; this.signalEnd(false); } catch (e2) { if (!(e2 instanceof EndGame)) throw e2; }
      } else if (!(e instanceof EndGame)) throw e;
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
        this.performAction(pick);
      }
    }
  }

  /** One hero action (both flows) */
  performAction(pick: Option): void {
    const [kind, x] = pick;
    if (kind === "lastStand") {
      this.lastStandFfg(x as number);
    } else if (kind === "node") {
      for (const fs of (x as GameNode).obj.fsms) if (fs.canHandle("NODE CLICKED")) { fs.send("NODE CLICKED"); break; }
    } else if (kind === "explore") {
      this.note("UI_CONFIRM_EXPLORE");
      this.note("UI_CONFIRM");
      const flav = this.flavor(x as Tile);
      this.emit("UI_EXPLORE_TILE_WITH_INTRO_FORMATTED", flav,
        this.difficulty !== "hard" ? "UI_DISCARD_EXPLORE_TOKEN_WITH_INSPIRATION" : "UI_DISCARD_EXPLORE_TOKEN");
      this.explore(x as Tile);
    } else if (kind === "provoke") this.provoke(x as EnemyGroup);
    else this.playerAttack(x as EnemyGroup);
  }

  /** EnemyMenu provoke click: CoroutinePerformEnemyAttack(group, requirePrompt: false, performAttackReduction: false); stays ready */
  provoke(g: EnemyGroup): void {
    if (g.exhausted) return;
    const a = this.randomActivation(g);
    if (!a) return;
    this.activating = g;
    try { this.enemyAttack(g, a, false); } finally { this.activating = null; }
  }

  /** EnemyInfoDialog.CoroutineDisplayDamage + Adventure.CoroutinePerformPlayerAttackFinish */
  playerAttack(g: EnemyGroup): void {
    const a = this.player.attackDamage(this, g);
    if (this.flow === "legacy") return this.legacyAttack(g, attackHits(a));
    // EnemyInfoDialog hides the abilities the group's bonuses block
    const ab = attackAbilities(a) & ~g.blockedAbilities;
    const on = (k: AttackAbility) => (ab & ATTACK_ABILITIES[k]) !== 0;
    const before = g.size;
    const res = calculateHealth(g.units(), attackHits(a), ab);
    // armor and sorcery only absorb hits; Sunder takes one armor for good, a defeated unit keeps nothing
    for (let i = 0; i < res.length; i++) {
      if (on("Sunder") && (on("Cleave") || i === 0 || res[i - 1]!.hp <= 0)) g.armor[i] = Math.max(0, g.armor[i]! - 1);
      g.hp[i] = res[i]!.hp;
      if (g.hp[i]! <= 0) { g.armor[i] = 0; g.sorcery[i] = 0; }
    }
    if (!g.exhausted && on("Stun")) g.exhausted = true;
    // an elite counter-attacks even when exhausted
    const counter = g.health > 0 && !on("Stun") && (g.elite || !g.exhausted);
    const removed = before - g.size;
    if (removed > 0) {
      const unique = truthy(gd(g.model, "IsUnique")) || truthy(gd(g.model, "IsNamed"));
      this.emit(unique ? "UI_ENEMY_REMOVAL_UNIQUE_REMINDER_FORMATTED" : "UI_ENEMY_REMOVAL_REMINDER_FORMATTED",
        truthy(gd(g.model, "IsNamed")) ? "" : removed, this.enemyName(g.model, removed),
        g.health <= 0 ? "UI_ENEMY_DEFEATED_INSPIRATION_REMINDER" : "");
    }
    if (counter) this.enemyCounterAttack(g);
    if (g.health <= 0) this.defeatGroup(g);
  }

  /** legacy flow (engine-py parity): the hits go to the units' health in order, no armor, no counter-attack */
  private legacyAttack(g: EnemyGroup, hits: number): void {
    for (let i = 0; i < g.hp.length && hits > 0; i++) {
      const h = Math.min(hits, g.hp[i]!);
      g.hp[i]! -= h;
      hits -= h;
    }
    if (g.health <= 0) this.defeatGroup(g);
  }

  /** CoroutinePerformEnemyAttack(group, requirePrompt: true, performAttackReduction: IsElite) */
  enemyCounterAttack(g: EnemyGroup): void {
    const a = this.randomActivation(g);
    if (!a) return;
    this.activating = g;
    try {
      if (this.player.confirm(this, "UI_PROMPT_CAN_ATTACK", "UI_YES", "UI_NO")) {
        this.enemyAttack(g, a, g.elite);
        g.exhausted = true;
      }
    } finally { this.activating = null; }
  }

  // ------------------------------------------------------------ FFG round flow (GameController.CoroutineEndRound, Adventure)
  /** Hero phase: actions in any order until the players end the round (pickAction answers null) */
  heroPhaseFfg(): void {
    for (;;) {
      const opts: Option[] = [
        ...this.clickableNodes().map((nd): Option => ["node", nd]),
        ...this.explorableTiles().map((t): Option => ["explore", t]),
        ...this.enemies.map((g): Option => ["attack", g]),
        ...this.heroes.flatMap((h, i): Option[] => (h.defeated ? [] : [["lastStand", i]])),
        // UI_Game provoke mode: a group that is not exhausted attacks (a hero's provoke ability)
        ...this.enemies.filter((g) => !g.exhausted).map((g): Option => ["provoke", g]),
      ];
      const pick = this.player.pickAction(this, -1, opts);
      if (pick === null) return;
      this.actionsTaken++;
      this.performAction(pick);
    }
  }

  randomHealthyHero(): number {
    const ok = this.heroes.map((h, i) => (h.defeated ? -1 : i)).filter((i) => i >= 0);
    return ok.length ? this.rng.choice(ok) : this.rng.randrange(this.players);
  }

  /** Adventure.GetRandomEnemyActivation: eligible by remaining units, no fallback */
  randomActivation(g: EnemyGroup): any {
    const EAM = this.D.models.EnemyActivationModel;
    const acts = or(gd(g.model, "Activations"), []).map((a: any) => gd(EAM, pyStr(gd(a, "id")), null))
      .filter((a: any) => truthy(a) && gd(a, "MinGroupSize", 1) <= g.size && g.size <= gd(a, "MaxGroupSize", 3));
    return acts.length ? this.rng.choice(acts) : null;
  }

  /** Adventure.CoroutinePerformEnemyActivation + CoroutineDisplayActivationChoice */
  activateFfg(g: EnemyGroup): void {
    this.activating = g;
    try { this.activationFfg(g); } finally { this.activating = null; }
  }

  private activationFfg(g: EnemyGroup): void {
    let a: any = null;
    if (truthy(g.activationOverride)) a = gd(this.D.models.EnemyActivationModel, pyStr(g.activationOverride), null);
    if (!truthy(a)) a = this.randomActivation(g);
    if (!truthy(a)) { this.warn(`no activation for ${gd(g.model, "m_Name")} x${g.size}`); return; }
    // the activation text names a random healthy hero (LocalizationFilterType.RandomHero)
    this.prompt = { key: gd(a, "KeyActivation"), inserts: [`@hero:${this.randomHealthyHero()}`] };
    // primary decisions: attack, no target, end the activation (a battleboard with streams in play), stop movement
    // (a battleboard with fences, else fortified spaces / tokens)
    const fortified = this.nodes.concat(this.advNodes).some((n) => n.visible && n.kind === "Fortified");
    const river = this.battleboard && this.terrainCount(7) > 0;
    const stop = (this.battleboard && this.terrainCount(16) > 0) || (!this.battleboard && fortified) || (this.battleboard && fortified);
    const opts: [string, any][] = [["attack", { Localization: "«UI_ATTACK»" }], ["none", { Localization: "«UI_NO_TARGET»" }]];
    if (river) opts.push(["end", { Localization: "«UI_END_ENEMY_ACTIVATION»" }]);
    if (stop) opts.push(["stop", { Localization: "«UI_STOP_MOVEMENT»" }]);
    const choices = opts.map(([, c]) => c);
    const c = this.player.choose(this, gd(a, "KeyActivation"), choices, false);
    const kind = opts[choices.indexOf(c)]?.[0] ?? "none";
    this.prompt = null;
    if (kind === "attack") this.enemyAttack(g, a, true);
    else if (kind === "end") g.exhausted = true;
    else if (kind === "stop") {
      // stopped by a fortified space: may it still attack? (attack reduction for elites)
      // the activation is drawn before the players are asked
      const r = this.randomActivation(g);
      if (r && this.player.confirm(this, "UI_PROMPT_CAN_ATTACK", "UI_YES", "UI_NO")) this.enemyAttack(g, r, g.elite);
    } else this.emit(gd(a, "KeyAltActivation"));
  }

  /** Adventure.CoroutinePerformEnemyAttack: the activation's damage for the group size plus the bonuses' */
  enemyAttack(g: EnemyGroup, a: any, reduce: boolean): void {
    const d = or(gd(a, "Damage"), []).find((x: any) => gd(x, "Size") === g.size);
    let ph = (d ? gd(d, "Physical", 0) : 0) + g.bonusDamage(true);
    let fe = (d ? gd(d, "Fear", 0) : 0) + g.bonusDamage(false);
    if (reduce) {
      for (let n = g.attackReduction; n > 0 && ph + fe > 1; n--) {
        if (ph === 0) fe--;
        else if (fe === 0) ph--;
        else if (this.rng.random() < 0.5) ph--;
        else fe--;
      }
      g.attackReduction++;
    }
    this.emit(gd(a, "KeyAttackFlavor"));
    if (truthy(gd(a, "KeyAttackAdditionalEffect"))) this.note("UI_DAMAGE_LOG_WITH_EFFECT_FORMATTED", ph, fe, a.KeyAttackAdditionalEffect);
    else this.note("UI_DAMAGE_LOG_FORMATTED", ph, fe);
    // bot simulation of the hero's cards
    const h = this.heroes[this.randomHealthyHero()]!;
    h.damage += Math.max(0, ph - this.rng.randint(0, 2));
    h.fear += Math.max(0, fe - this.rng.randint(0, 2));
  }

  /** UIHeroMenuDialog.PerformLastStand: the players start it from the hero menu */
  lastStandFfg(hero: number): void {
    const h = this.heroes[hero]!;
    if (h.defeated) return;
    const physical = this.player.lastStandType(this, hero);
    const LM = this.D.models.LastStandModel;
    const lm = keysOf(LM).map((k) => LM[k]).find((m: any) => gd(m, "Type", 10) === (physical ? 10 : 20));
    const keys: any[] = or(gd(lm, "MessageKeys"), []);
    const key = keys.length ? this.rng.choice(keys) : null;
    this.prompt = { key: key ?? undefined, inserts: [String(h.lastStand)] };
    const ok = this.player.lastStand(this, hero, physical);
    this.prompt = null;
    this.note(key, h.lastStand);
    this.note(ok ? "UI_PASS" : "UI_FAIL");
    if (ok) {
      h.lastStand++;
      this.emit(physical ? "UI_LAST_STAND_PASSED_PHYSICAL" : "UI_LAST_STAND_PASSED_FEAR");
      h.damage = h.fear = 4; // bot simulation: the hero recovers some cards
    } else {
      h.defeated = true;
      this.emit("UI_LAST_STAND_FAILED");
    }
  }

  /** Darkness at the end of the shadow phase: global flag, an explored visible tile with darkness, or a darkness token */
  isDarknessNow(): boolean {
    if (truthy(gd(this.globals, "IsDarkness"))) return true;
    if ([...this.tiles.values()].some((t) => t.visible && t.explored && t.hasDarkness)) return true;
    return this.nodes.concat(this.advNodes).some((n) => n.visible && n.kind === "Darkness");
  }

  endRoundFfg(): void {
    for (const h of this.heroes) if (h.defeated) return this.signalEnd(false);
    if (this.globals.Threat >= this.threatMax && this.threatMax > 0) return this.signalEnd(false);
    this.emit("UI_PHASE_SHADOW");
    if (this.difficulty === "hard") this.globals.EnemyPoints = or(gd(this.globals, "EnemyPoints"), 0) + this.players;
    if (this.difficulty === "adventure") this.emit("ADVENTURE_MODE_INSPIRATION_MESSAGE");
    // groups activate in tracker order until every group is exhausted (groups can appear/leave meanwhile)
    for (let guard = 0; guard < 1000; guard++) {
      const g = this.enemies.find((e) => !e.exhausted);
      if (!g) break;
      this.activateFfg(g);
      g.exhausted = true;
    }
    if (!truthy(gd(this.model, "DisableDarkness")) && this.isDarknessNow()) {
      this.emit(or(gd(this.globals, "DarknessMessageOverride"), "UI_DARKNESS_FEAR"));
    }
    for (const t of this.timers) if (t) for (const fs of t.fsms) if (fs.usesEvent("ROUND_END")) fs.send("ROUND_END");
    this.processRoot("ROUND_END");
    let delta = 2 * this.players + this.nodes.filter((n) => n.visible && n.kind === "Threat").length;
    if (this.board && this.difficulty !== "adventure") delta += [...this.tiles.values()].filter((t) => t.visible && !t.explored).length;
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
    // EnemyGroup.CoroutineRefresh
    for (const g of [...this.enemies]) {
      if (g.logic) for (const fs of g.logic.fsms) if (fs.usesEvent("BEFORE_UNEXHAUST")) fs.send("BEFORE_UNEXHAUST");
      g.exhausted = false;
      g.attackReduction = 0;
    }
    this.emit("UI_RALLY_PHASE");
    this.emit("UI_RALLY_PHASE_INSTRUCTIONS");
    this.round++;
    this.globals.Round = this.round;
    this.actionsTaken = 0;
    this.emit("UI_PHASE_HERO");
    this.processRoot("ROUND_START");
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

export type Option = ["node", GameNode] | ["explore", Tile] | ["attack", EnemyGroup] | ["provoke", EnemyGroup] | ["lastStand", number];

/**
 * Everything the players decide. Called synchronously from deep inside the interpreter;
 * an interactive implementation throws NeedInput (see session.ts) and the game is replayed later.
 */
export interface Player {
  /** Skill test: how many successes the players rolled (top = highest threshold of interest) */
  successes(g: Game, top: number, key: any): number;
  /** Confirm/cancel dialog (button labels: localization keys, default UI_CONFIRM / UI_CANCEL) */
  confirm(g: Game, key: any, yes?: string | null, no?: string | null): boolean;
  /** Multiple choice: one of `choices`, or null = cancel (only if canCancel) */
  choose(g: Game, key: any, choices: any[], canCancel: boolean): any;
  /** "Choose a hero" dialog */
  playerChoice(g: Game, key: any, canSkip: boolean): { player: number; skip: boolean };
  /** Last stand test result */
  lastStand(g: Game, hero: number, physical: boolean): boolean;
  /** FFG flow: which last stand the hero takes - true = physical damage, false = fear */
  lastStandType(g: Game, hero: number): boolean;
  /** Hero action, or null to end this hero's turn (hero = -1: FFG free hero phase, null ends the round) */
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

  lastStandType(g: Game, hero: number): boolean {
    const h = g.heroes[hero]!;
    return h.damage >= h.fear;
  }

  confirm(_g: Game, _key: any): boolean {
    return this.rng.random() < 0.9;
  }

  choose(_g: Game, _key: any, choices: any[], canCancel: boolean): any {
    if (!choices.length || (canCancel && this.rng.random() < 0.05)) return null;
    return this.rng.choice(choices);
  }

  pickAction(g: Game, hero: number, opts: Option[]): Option | null {
    const W = { node: 5, explore: 3, attack: 4, provoke: 0, lastStand: 0 } as const;
    if (hero >= 0) return this.rng.choices(opts, opts.map(([k]) => W[k]));
    // FFG free hero phase: a hero "out of cards" takes a last stand; 2 actions per hero, then end the round
    const ls = opts.find(([k, x]) => k === "lastStand" && g.heroes[x as number]!.damage + g.heroes[x as number]!.fear >= 10);
    if (ls) return ls;
    const pool = opts.filter(([k]) => k !== "lastStand" && k !== "provoke");
    if (g.actionsTaken >= 2 * g.players || !pool.length) return null;
    return this.rng.choices(pool, pool.map(([k]) => W[k]));
  }

  attackDamage(_g: Game, _group: EnemyGroup): number {
    return this.rng.randint(1, 4); // hits, no abilities
  }
}
