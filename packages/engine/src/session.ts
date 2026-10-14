// Interactive play on top of the synchronous interpreter, by deterministic replay.
//
// A game is fully defined by its setup (adventure, seed, players, difficulty, campaign) plus the list of
// answers the players gave. When the interpreter needs a decision that is not in the list yet, the
// ScriptedPlayer throws NeedInput; the Session keeps that decision as `pending`. After the answer is
// appended, the game is replayed from scratch (~10-20 ms). Save = setup + answers; undo = drop answers.
import { Bot, Game, generateBoard, keyOf, newCampaign, type Campaign, type ContentSource, type Difficulty, type EnemyGroup, type EnemyUnit,
  type LogEntry, type Option, type Player } from "./game.ts";
import { gd } from "./py.ts";
import type { GeneratedMap } from "./map/mapgen.ts";
import { PyRandom } from "./pyrandom.ts";

// ---------------------------------------------------------------- decisions (plain JSON, for UI)
export type ActionOption =
  | { type: "node"; uid: number; name: string; kind: string; token: number; encounter: number | null; tile: string | null; tileId: number | null; space: number }
  | { type: "explore"; tile: string; tileId: number }
  | { type: "attack"; uid: number; enemy: string; size: number; damage: number; unitHp: number }
  | { type: "provoke"; uid: number }
  | { type: "lastStand"; hero: number };

export type Decision =
  | { kind: "test"; key: string | null; inserts: string[]; top: number }
  /** yes / no: button label keys (DisplayMessageCancelConfirm.ConfirmLabel / CancelLabel) */
  | { kind: "confirm"; key: string | null; inserts: string[]; yes: string; no: string; enemy?: number }
  /** enemy: uid of the activating group (the enemy activation popup) */
  | { kind: "choice"; key: string | null; inserts: string[]; choices: { key: string | null; inserts: string[] }[]; canCancel: boolean; enemy?: number }
  | { kind: "hero"; key: string | null; inserts: string[]; players: number; canSkip: boolean }
  | { kind: "lastStand"; hero: number; physical: boolean; key: string | null; inserts: string[] }
  /** FFG flow: last stand against physical damage (true) or fear (false) */
  | { kind: "lastStandType"; hero: number }
  /** hero = -1: FFG free hero phase, answering null ends the round */
  | { kind: "action"; hero: number; options: ActionOption[] }
  | { kind: "attack"; uid: number; enemy: string; size: number; damage: number; unitHp: number };

/**
 * Answers, by decision kind:
 * test -> integer >= 0; attack -> hits + 100 x AttackAbilityType flags (see attackHits / attackAbilities); confirm/lastStand/lastStandType -> boolean; choice -> index or null (cancel);
 * hero -> { player, skip }; action -> option index or null (end hero turn)
 */
export type Answer = number | boolean | null | { player: number; skip: boolean };

export class NeedInput extends Error {
  readonly decision: Decision;
  constructor(decision: Decision) {
    super(`input needed: ${decision.kind}`);
    this.decision = decision;
  }
}

export class AnswerError extends Error {}

const describeOption = (g: Game, [kind, x]: Option): ActionOption => {
  if (kind === "node") return {
    type: "node", uid: x.uid, name: x.obj.name, kind: x.kind, token: x.token, encounter: x.encId,
    tile: x.tile ? x.tile.code : null, tileId: x.tile ? x.tile.id : null, space: x.space,
  };
  if (kind === "explore") return { type: "explore", tile: x.code, tileId: x.id };
  if (kind === "lastStand") return { type: "lastStand", hero: x };
  if (kind === "provoke") return { type: "provoke", uid: x.uid };
  return { type: "attack", uid: x.uid, enemy: String(g.enemyName(x.model, x.size)), size: x.size, damage: x.damage, unitHp: x.unitHp };
};

const isInt = (a: unknown, min = 0, max = Infinity): a is number => Number.isInteger(a) && (a as number) >= min && (a as number) <= max;

/** Throws AnswerError if `a` is not a valid answer to `d` */
export function validateAnswer(d: Decision, a: Answer): void {
  const bad = (why: string) => { throw new AnswerError(`${d.kind}: ${why} (${JSON.stringify(a)})`); };
  switch (d.kind) {
    case "test":
    case "attack":
      if (!isInt(a)) bad("expected integer >= 0");
      break;
    case "confirm":
    case "lastStand":
    case "lastStandType":
      if (typeof a !== "boolean") bad("expected boolean");
      break;
    case "choice":
      if (a === null ? !d.canCancel : !isInt(a, 0, d.choices.length - 1)) bad("expected choice index or null");
      break;
    case "action":
      if (a !== null && !isInt(a, 0, d.options.length - 1)) bad("expected option index or null");
      break;
    case "hero":
      if (typeof a !== "object" || a === null || !isInt(a.player, 0, d.players - 1) || typeof a.skip !== "boolean" || (a.skip && !d.canSkip))
        bad("expected { player, skip }");
      break;
  }
}

/** Answers decisions from a list; throws NeedInput when the list runs out */
export class ScriptedPlayer implements Player {
  private i = 0;
  readonly answers: readonly Answer[];
  constructor(answers: readonly Answer[]) {
    this.answers = answers;
  }

  get used(): number {
    return this.i;
  }

  private next(d: Decision): any {
    if (this.i >= this.answers.length) throw new NeedInput(d);
    const a = this.answers[this.i]!;
    validateAnswer(d, a);
    this.i++;
    return a;
  }

  successes(g: Game, top: number, key: any): number {
    return this.next({ kind: "test", key, inserts: g.promptInserts(), top });
  }

  confirm(g: Game, key: any, yes?: string | null, no?: string | null): boolean {
    return this.next({ kind: "confirm", key, inserts: g.promptInserts(), yes: yes || "UI_CONFIRM", no: no || "UI_CANCEL", ...(g.activating ? { enemy: g.activating.uid } : {}) });
  }

  choose(g: Game, key: any, choices: any[], canCancel: boolean): any {
    if (!choices.length) return null; // nothing to choose (all options gated): no question, like the bot
    const a = this.next({
      kind: "choice", key, inserts: g.promptInserts(), canCancel, ...(g.activating ? { enemy: g.activating.uid } : {}),
      choices: choices.map((c) => ({ key: keyOf(gd(c, "Localization")), inserts: g.promptInserts(gd(c, "Localization")) })),
    });
    return a === null ? null : choices[a];
  }

  playerChoice(g: Game, key: any, canSkip: boolean): { player: number; skip: boolean } {
    return this.next({ kind: "hero", key, inserts: g.promptInserts(), players: g.players, canSkip });
  }

  lastStand(g: Game, hero: number, physical: boolean): boolean {
    const p = g.prompt && !("fsm" in g.prompt) ? g.prompt : null;
    return this.next({ kind: "lastStand", hero, physical, key: p?.key ?? null, inserts: p ? [...p.inserts] : [] });
  }

  lastStandType(_g: Game, hero: number): boolean {
    return this.next({ kind: "lastStandType", hero });
  }

  pickAction(g: Game, hero: number, opts: Option[]): Option | null {
    const a = this.next({ kind: "action", hero, options: opts.map((o) => describeOption(g, o)) });
    return a === null ? null : opts[a]!;
  }

  attackDamage(g: Game, x: EnemyGroup): number {
    return this.next({ kind: "attack", uid: x.uid, enemy: String(g.enemyName(x.model, x.size)), size: x.size, damage: x.damage, unitHp: x.unitHp });
  }
}

/** Wraps another player (normally the Bot) and records its decisions as Answers */
export class RecordingPlayer implements Player {
  readonly answers: Answer[] = [];
  readonly inner: Player;
  constructor(inner: Player) {
    this.inner = inner;
  }

  private rec<T>(a: Answer, v: T): T {
    this.answers.push(a);
    return v;
  }

  successes(g: Game, top: number, key: any): number {
    const v = this.inner.successes(g, top, key);
    return this.rec(v, v);
  }

  confirm(g: Game, key: any, yes?: string | null, no?: string | null): boolean {
    const v = this.inner.confirm(g, key, yes, no);
    return this.rec(v, v);
  }

  choose(g: Game, key: any, choices: any[], canCancel: boolean): any {
    const v = this.inner.choose(g, key, choices, canCancel);
    if (!choices.length) return v; // not a question (see ScriptedPlayer.choose)
    return this.rec(v === null ? null : choices.indexOf(v), v);
  }

  playerChoice(g: Game, key: any, canSkip: boolean): { player: number; skip: boolean } {
    const v = this.inner.playerChoice(g, key, canSkip);
    return this.rec({ ...v }, v);
  }

  lastStand(g: Game, hero: number, physical: boolean): boolean {
    const v = this.inner.lastStand(g, hero, physical);
    return this.rec(v, v);
  }

  lastStandType(g: Game, hero: number): boolean {
    const v = this.inner.lastStandType(g, hero);
    return this.rec(v, v);
  }

  pickAction(g: Game, hero: number, opts: Option[]): Option | null {
    const v = this.inner.pickAction(g, hero, opts);
    return this.rec(v === null ? null : opts.indexOf(v), v);
  }

  attackDamage(g: Game, x: EnemyGroup): number {
    const v = this.inner.attackDamage(g, x);
    return this.rec(v, v);
  }
}

// ---------------------------------------------------------------- session
export interface SessionSetup {
  adv: number;
  seed: number;
  players?: number;
  difficulty?: Difficulty;
  campaign?: Campaign;
  maxRounds?: number;
  mapMode?: "ffg" | "legacy";
  mapSeed?: number;
  products?: number[];
  language?: string;
  /** HeroModel id per player (the party; the engine does not use them, the UI shows names and portraits) */
  heroes?: number[];
}

const gameOpts = (s: SessionSetup) => ({
  seed: s.seed, players: s.players, difficulty: s.difficulty, maxRounds: s.maxRounds,
  mapMode: s.mapMode, mapSeed: s.mapSeed, products: s.products, language: s.language,
  campaign: structuredClone(s.campaign ?? newCampaign()),
});

export interface SaveData {
  format: "jime-save";
  formatVersion: 1;
  engine: string;
  savedAt: string;
  pack?: { id: string; version: string };
  setup: SessionSetup;
  answers: Answer[];
}

export interface NodeView {
  uid: number;
  name: string;
  /** NODE_KINDS value (may change at runtime: SetGameNodeType) */
  kind: string;
  /** TOKEN_TYPES id, see tokenFamily() */
  token: number;
  encounter: number | null;
  /** Tile hash id and space index; null tile = adventure-level node (position not modelled yet) */
  tileId: number | null;
  space: number;
  visible: boolean;
}

/** Plain snapshot of the visible game state for UI */
export interface GameView {
  adv: number;
  round: number;
  threat: number;
  threatMax: number;
  /** Thresholds of the threat events still waiting on the threat bar (ascending) */
  threatEvents: number[];
  /** The same events with ThreatEvent.InfoKey (what happens; the threat meter's info dialog) */
  threatInfo: { threshold: number; info: string | null }[];
  /** Darkness in effect now (FFG shows the darkness token next to the threat bar) */
  darkness: boolean;
  objective: string | null;
  objectiveInserts: string[];
  ended: string | null;
  result: string | null;
  /** damage/fear: bot simulation only; lastStand: next last stand difficulty */
  heroes: { damage: number; fear: number; defeated: boolean; lastStand: number }[];
  /** token = the tile still has its exploration token */
  tiles: { id: number; code: string; section: number; visible: boolean; explored: boolean; token: boolean }[];
  /** All game nodes; a node is shown when visible and (no tile or its tile is visible) */
  nodes: NodeView[];
  startTile: number;
  /** model = EnemyModel id (icon), armor = EnemyModel.Armor */
  enemies: {
    uid: number; model: number; name: string; size: number; damage: number; unitHp: number; armor: number; exhausted: boolean;
    /** FFG EnemyGroup.UnitStartCount, EnemyModel.Sorcery, KeySingular, Traits has Range (0x400) */
    startSize: number; sorcery: number; nameOne: string; ranged: boolean;
    /** per unit (UnitStartCount entries): health (0 = defeated), armor (Sunder lowers it) and sorcery */
    units: EnemyUnit[];
    /** EnemyModel.IsNamed (a unique, named foe). FFG shows the elite frame for groups with bonuses; bonuses are not modelled yet */
    named: boolean;
  }[];
  campaign: { lore: number; xp: number; items: any[]; titles: any[]; next: any };
}

export function viewOf(g: Game): GameView {
  return {
    adv: g.advId, round: g.round, threat: g.globals.Threat, threatMax: g.threatMax,
    threatEvents: g.activeThreatEvents.map((o) => Number(o.threatThreshold ?? o.components.ThreatEvent?.Threshold ?? 0)).sort((a, b) => a - b),
    threatInfo: g.activeThreatEvents
      .map((o) => ({ threshold: Number(o.threatThreshold ?? o.components.ThreatEvent?.Threshold ?? 0), info: (keyOf(o.components.ThreatEvent?.InfoKey) ?? o.components.ThreatEvent?.InfoKey ?? null) as string | null }))
      .sort((a, b) => a.threshold - b.threshold),
    darkness: g.isDarknessNow(), objective: g.objective,
    objectiveInserts: [...g.objectiveInserts],
    ended: g.ended, result: g.result,
    heroes: g.heroes.map((h) => ({ ...h })),
    tiles: [...g.tiles.values()].map((t) => ({ id: t.id, code: t.code, section: t.section, visible: t.visible, explored: t.explored, token: t.exploreToken })),
    nodes: [...g.nodes, ...g.advNodes].sort((a, b) => a.uid - b.uid).map((n) => ({
      uid: n.uid, name: n.obj.name, kind: n.kind, token: n.token, encounter: n.encId,
      tileId: n.tile ? n.tile.id : null, space: n.space, visible: n.visible && (n.tile === null || n.tile.visible),
    })),
    startTile: g.startTileId,
    enemies: g.enemies.map((e) => ({
      uid: e.uid, model: Number(e.model?._id ?? -1), name: String(g.enemyName(e.model, e.size)), size: e.size,
      damage: e.damage, unitHp: e.unitHp, armor: e.maxArmor, exhausted: e.exhausted,
      named: !!Number(e.model?.IsNamed ?? 0),
      startSize: e.startSize, sorcery: e.maxSorcery, nameOne: String(g.enemyName(e.model, 1)), units: e.units(),
      ranged: (Number(e.model?.Traits ?? 0) & 0x400) !== 0,
    })),
    campaign: { lore: g.campaign.lore, xp: g.campaign.xp, items: [...g.campaign.items], titles: [...g.campaign.titles], next: g.campaign.next_adventure },
  };
}

export interface SessionOptions {
  board?: GeneratedMap | null;
}

/** The board a Session with this setup will play on (null: no generated map), see Session opts.board */
export function sessionBoard(src: ContentSource, setup: SessionSetup): GeneratedMap | null {
  return generateBoard(src, setup.adv, gameOpts(setup));
}

export const ENGINE_SAVE_VERSION = "0.3.0";

export class Session {
  readonly src: ContentSource;
  readonly setup: SessionSetup;
  readonly answers: Answer[] = [];
  game!: Game;
  pending: Decision | null = null;
  /** Board of the first replay, reused by later replays (map generation can take up to seconds) */
  private board: GeneratedMap | undefined;

  /**
   * opts.board: a board from sessionBoard() for the same setup. Then the source only needs the encounters
   * of that board (boardEncounters) - a browser client can preload them and stay synchronous.
   */
  constructor(src: ContentSource, setup: SessionSetup, answers: Answer[] = [], opts: SessionOptions = {}) {
    this.src = src;
    this.setup = structuredClone(setup);
    this.answers.push(...answers);
    this.board = opts.board ?? undefined;
    this.replay();
  }

  /** Re-run the game from scratch with the current answers */
  private replay(): void {
    const s = this.setup;
    const player = new ScriptedPlayer(this.answers);
    const g = new Game(this.src, s.adv, { ...gameOpts(s), player, board: this.board });
    this.board ??= g.board ?? undefined;
    this.pending = null;
    try {
      g.run();
    } catch (e) {
      if (!(e instanceof NeedInput)) throw e;
      this.pending = e.decision;
    }
    if (player.used !== this.answers.length && this.pending === null)
      throw new AnswerError(`game ended after ${player.used} of ${this.answers.length} answers`);
    this.game = g;
  }

  get status(): "waiting" | "ended" {
    return this.pending ? "waiting" : "ended";
  }

  get log(): readonly LogEntry[] {
    return this.game.log;
  }

  view(): GameView {
    return viewOf(this.game);
  }

  answer(a: Answer): void {
    if (!this.pending) throw new AnswerError("game is over");
    validateAnswer(this.pending, a);
    this.answers.push(a);
    this.replay();
  }

  /** Take back the last n answers */
  undo(n = 1): void {
    this.answers.splice(Math.max(0, this.answers.length - n));
    this.replay();
  }

  save(pack?: { id: string; version: string }): SaveData {
    return {
      format: "jime-save", formatVersion: 1, engine: ENGINE_SAVE_VERSION, savedAt: new Date().toISOString(),
      ...(pack ? { pack } : {}), setup: structuredClone(this.setup), answers: structuredClone(this.answers),
    };
  }

  static load(src: ContentSource, data: SaveData, opts: SessionOptions = {}): Session {
    if (data.format !== "jime-save" || data.formatVersion !== 1) throw new Error("not a JiME save (format/version)");
    return new Session(src, data.setup, data.answers, opts);
  }
}

/**
 * Play a whole game with a bot while recording its answers (tests, tooling).
 * The bot gets its own RNG: a default Bot shares the game RNG (needed for engine-py parity), and then
 * its random draws would be missing when the recorded answers are replayed.
 */
export function recordBotGame(src: ContentSource, setup: SessionSetup, botSeed = setup.seed + 1_000_003): { game: Game; answers: Answer[] } {
  const rec = new RecordingPlayer(new Bot(new PyRandom(botSeed)));
  const g = new Game(src, setup.adv, { ...gameOpts(setup), player: rec });
  g.run();
  return { game: g, answers: rec.answers };
}
