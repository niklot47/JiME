// FSM action handlers (PlayMaker action name -> behaviour). Port of the a_* methods of engine-py Game.
// A handler returns an event name to fire on the current state, or nothing.
import type { Fsm, Game } from "./game.ts";
import { EndGame, GameNode, NODE_KINDS, keyOf } from "./game.ts";
import { gd, or, pyFloat, removeFirst, truthy } from "./py.ts";

export type ActionHandler = (g: Game, f: Fsm, p: any) => any;

const noop: ActionHandler = () => null;
const idOf = (v: any): any => gd(or(v, {}), "id");

const otherFsm = (g: Game, f: Fsm, p: any): Fsm | null => {
  const o = g.ownerTarget(f, gd(p, "gameObject"));
  if (o === null) return null;
  for (const x of o.fsms) if (!truthy(gd(p, "fsmName")) || x.name === gd(p, "fsmName")) return x;
  return null;
};

const bools = (g: Game, f: Fsm, p: any): boolean[] => or(gd(p, "boolVariables"), []).map((v: any) => g.boolean(f, v));

const tileBy = (g: Game, f: Fsm, p: any) => {
  if (truthy(gd(p, "SpecifyGameObject"))) {
    const o = g.objRef(f.owner.src, gd(p, "Tile"));
    if (o === null) return null;
    for (const t of g.tiles.values()) if (t.custom === o) return t;
    const code = gd(or(gd(or(gd(o.components, "Tile"), {}), "Model"), {}), "id");
    for (const t of g.tiles.values()) if (t.code === code) return t;
    return null;
  }
  return g.tiles.get(g.num(f, gd(p, "TileId"), -1)) ?? null;
};

const nodeTarget = (g: Game, f: Fsm, p: any) => g.ownerTarget(f, gd(p, "Node"));

const boolTest: ActionHandler = (g, f, p) => (g.boolean(f, gd(p, "boolVariable")) ? gd(p, "isTrue") : gd(p, "isFalse"));

const setBoolValue: ActionHandler = (g, f, p) => g.set(f, gd(p, "boolVariable"), g.boolean(f, gd(p, "boolValue")));

const allTrue: ActionHandler = (g, f, p) => {
  const r = bools(g, f, p).every(Boolean);
  g.set(f, gd(p, "storeResult"), r);
  return r ? gd(p, "sendEvent") : null;
};

const anyTrue: ActionHandler = (g, f, p) => {
  const r = bools(g, f, p).some(Boolean);
  g.set(f, gd(p, "storeResult"), r);
  return r ? gd(p, "sendEvent") : null;
};

const sendEventByName: ActionHandler = (g, f, p) => g.sendEventTarget(f, gd(p, "eventTarget"), g.get(f, gd(p, "sendEvent")));

const setBool: ActionHandler = (g, f, p) => {
  const x = otherFsm(g, f, p);
  if (x) x.vars[gd(p, "variableName")] = truthy(gd(p, "setValue"));
};

const showKey = (p: any) => keyOf(gd(p, "Message"));

const COSMETIC = [
  "FocusCameraOnObjects", "FocusCameraOnWorldPositions", "HighlightLocations", "ClearLocationHighlights", "HighlightTileSpace",
  "Translate", "SetPosition", "GetPosition", "SetVector3XYZ", "TransformPoint", "SetGameObject", "SetTerrainIsUnique",
  "SetWeatherEffect", "SetBoardVisibility", "SetTokenType", "SaveGame", "SetNextCutsceneId", "SetTileSepiaValue",
  "ClearHeroHighlights", "SetHeroHighlights", "ShowTutorialArrow", "HideTutorialArrows", "SetLockedUI", "SetForcedUI", "ClearForcedUI",
];

export const ACTIONS: Record<string, ActionHandler> = {
  ...Object.fromEntries(COSMETIC.map((n) => [n, noop])),

  // --- messages / dialogs
  DisplayMessage: (g, f, p) => { if (!truthy(gd(p, "IgnoreLog"))) g.show(f, gd(p, "Message")); },
  DisplayMessageAndReveal: (g, f, p) => {
    const o = g.objRef(f.owner.src, gd(p, "MessageSource"));
    if (o !== null) {
      o.visible = true;
      if (o.node) o.node.visible = true;
    }
    if (!truthy(gd(p, "IgnoreLog"))) g.show(f, gd(p, "Message"));
  },
  DisplayTutorialMessage: noop,
  DisplayMessageChallenge: (g, f, p) => {
    g.show(f, gd(p, "Message"));
    const pairs: any[] = or(gd(p, "ResultPairs"), []);
    const top = Math.max(...pairs.map((x) => g.num(f, gd(x, "Sum", 0))), 0);
    const s = g.player.successes(g, top, showKey(p));
    g.set(f, gd(p, "Sum"), s);
    for (const x of pairs) if (s <= g.num(f, gd(x, "Sum", 0))) return gd(x, "Event");
    return pairs.length ? gd(pairs[pairs.length - 1], "Event") : null;
  },
  DisplayMessageCancelConfirm: (g, f, p) => {
    if (g.player.confirm(g, showKey(p))) {
      g.show(f, gd(p, "Message"));
      g.emit(or(keyOf(gd(p, "ConfirmLabel")), "UI_CONFIRM"));
      return "CONFIRM";
    }
    return "CANCEL";
  },
  DisplayMessageMultipleChoice: (g, f, p) => {
    const choices = or(gd(p, "Choices"), []).filter((c: any) => !truthy(gd(c, "HasDependencies")) || g.boolean(f, gd(c, "Requirement")));
    const cancel = or(gd(p, "CancelChoice"), {});
    const c = g.player.choose(g, showKey(p), choices, truthy(gd(cancel, "Event")));
    if (c === null) return gd(cancel, "Event");
    g.show(f, gd(p, "Message"));
    g.emit(keyOf(gd(c, "Localization")));
    return gd(c, "Event");
  },
  DisplayMessagePlayerChoice: (g, f, p) => {
    g.show(f, gd(p, "Message"));
    const r = g.player.playerChoice(g, showKey(p), truthy(gd(p, "CanSkip")));
    g.set(f, gd(p, "PlayerIndex"), r.player);
    if (r.skip) return gd(p, "SkipEvent");
  },
  DisplayMessageSelectHighlight: (g, f, p) => { g.show(f, gd(p, "Message")); },
  SetObjective: (g, f, p) => {
    g.objective = keyOf(gd(p, "Message"));
    // inserts resolved now, like FFG (MasterMessageCache.CompressMessage); UI only, so no warnings (engine-py parity)
    g.objectiveInserts = g.quietly(() => g.msgKey(f, gd(p, "Message"))[1].map(String));
  },
  StoreKey: (g, f, p) => g.set(f, gd(p, "StoreResult"), keyOf(gd(p, "Key"))),
  AddAdventureRule: (g, _f, p) => g.emit("RULE:" + String(keyOf(gd(p, "AdventureRule")) ?? "None")),
  RemoveAdventureRule: noop,
  SetDarknessMessageOverride: (g, _f, p) => { g.globals.DarknessMessageOverride = keyOf(gd(p, "Message")); },

  // --- flow / variables
  FinishProcessingEvent: (_g, f) => { f.processing = false; },
  FinishFSM: (_g, f) => { f.finished = true; },
  SetBoolValue: setBoolValue,
  SetFlag: setBoolValue,
  SetIntValue: (g, f, p) => g.set(f, gd(p, "intVariable"), g.num(f, gd(p, "intValue"))),
  SetStringValue: (g, f, p) => g.set(f, gd(p, "stringVariable"), g.get(f, gd(p, "stringValue"))),
  IntAdd: (g, f, p) => g.set(f, gd(p, "intVariable"), g.num(f, gd(p, "intVariable")) + g.num(f, gd(p, "add"))),
  IntClamp: (g, f, p) => {
    let v = g.num(f, gd(p, "intVariable"));
    const lo = g.num(f, gd(p, "minValue"));
    v = Math.max(lo, Math.min(v, g.num(f, gd(p, "maxValue"), v)));
    g.set(f, gd(p, "intVariable"), v);
  },
  IntOperator: (g, f, p) => {
    const a = g.num(f, gd(p, "integer1"));
    const b = g.num(f, gd(p, "integer2"));
    const op = gd(p, "operation", 0);
    const r = op < 6 ? [a + b, a - b, a * b, b ? Math.floor(a / b) : 0, Math.max(a, b), Math.min(a, b)][op] : a;
    g.set(f, gd(p, "storeResult"), r);
  },
  FloatMultiply: (g, f, p) => g.set(f, gd(p, "floatVariable"), or(g.get(f, gd(p, "floatVariable")), 0) * or(gd(p, "multiplyBy"), 0)),
  FloatDivide: (g, f, p) => g.set(f, gd(p, "floatVariable"), or(g.get(f, gd(p, "floatVariable")), 0) / or(gd(p, "divideBy"), 1)),
  BoolFlip: (g, f, p) => g.set(f, gd(p, "boolVariable"), !g.boolean(f, gd(p, "boolVariable"))),
  BoolTest: boolTest,
  CheckBool: boolTest,
  GetFlag: boolTest,
  IntSwitch: (g, f, p) => {
    const v = g.num(f, gd(p, "intVariable"));
    const cmp: any[] = or(gd(p, "compareTo"), []);
    const evs: any[] = or(gd(p, "sendEvent"), []);
    for (let i = 0; i < Math.min(cmp.length, evs.length); i++) if (v === g.num(f, cmp[i])) return evs[i];
  },
  IntCompare: (g, f, p) => {
    const a = g.num(f, gd(p, "integer1"));
    const b = g.num(f, gd(p, "integer2"));
    return a === b ? gd(p, "equal") : a < b ? gd(p, "lessThan") : gd(p, "greaterThan");
  },
  BoolAllTrue: allTrue,
  CheckAllTrue: allTrue,
  BoolAnyTrue: anyTrue,
  CheckAnyTrue: anyTrue,
  BoolNoneTrue: (g, f, p) => {
    const r = !bools(g, f, p).some(Boolean);
    g.set(f, gd(p, "storeResult"), r);
    return r ? gd(p, "sendEvent") : null;
  },
  RandomInt: (g, f, p) => {
    const lo = g.num(f, gd(p, "min"));
    let hi = g.num(f, gd(p, "max"));
    if (truthy(gd(p, "inclusiveMax"))) hi += 1;
    g.set(f, gd(p, "storeResult"), g.rng.randrange(lo, Math.max(lo + 1, hi)));
  },
  SendRandomEvent: (g, f, p) => {
    const evs: any[] = or(gd(p, "events"), []);
    if (!evs.length) return null;
    const w = or(gd(p, "weights"), evs.map(() => 1)).map((x: any) => pyFloat(or(g.get(f, x), 0)));
    return g.rng.choices(evs, w.reduce((s: number, x: number) => s + x, 0) > 0 ? w : null);
  },
  SendRandomEventGrabbag: (g, _f, p) => {
    const evs: any[] = or(gd(p, "Events"), []);
    return evs.length ? g.rng.choice(evs) : null;
  },
  SendEventByName: sendEventByName,
  SendEvent: sendEventByName,
  DifficultySwitch: (g, _f, p) => gd(p, { normal: "Normal", hard: "Hard", adventure: "Adventure" }[g.difficulty]),
  OwnsProducts: (_g, _f, p) => gd(p, "EventOwnAll"),
  Wait: (_g, _f, p) => gd(p, "finishEvent"),
  Delay: noop,
  WaitForFSM: noop,
  WaitForFlag: (g, f, p) => {
    if (g.boolean(f, gd(p, "boolVariable")) === truthy(gd(p, "Value"))) return gd(p, "EventToFire");
  },
  GetFsmInt: (g, f, p) => {
    const x = otherFsm(g, f, p);
    if (x) g.set(f, gd(p, "storeValue"), gd(x.vars, gd(p, "variableName"), 0));
  },
  SetBool: setBool,
  SetFsmBool: setBool,
  ArrayGet: noop,
  ArraySet: noop,

  // --- campaign / rewards
  AddLore: (g, f, p) => { g.campaign.lore += g.num(f, gd(p, "Lore")); },
  AwardXP: (g, f, p) => { g.campaign.xp += g.num(f, gd(p, "XP")); },
  AwardTitle: (g, _f, p) => { g.campaign.titles.push(idOf(gd(p, "Title"))); },
  IsTitleEarned: (g, _f, p) => (g.campaign.titles.includes(idOf(gd(p, "Title"))) ? gd(p, "AlreadyEarned") : gd(p, "NotEarned")),
  AddItemToInventory: (g, _f, p) => { g.campaign.items.push(idOf(gd(p, "Item"))); },
  IsItemInInventory: (g, _f, p) => (g.campaign.items.includes(idOf(gd(p, "Item"))) ? gd(p, "InInventory") : gd(p, "NotInInventory")),
  RemoveItemFromInventory: (g, _f, p) => {
    const i = idOf(gd(p, "Item"));
    if (g.campaign.items.includes(i)) removeFirst(g.campaign.items, i);
  },
  ModifyCorruption: noop,
  CheckHero: (_g, _f, p) => gd(p, "HeroNotInPlayEvent"),
  StoreRandomHero: (g, f, p) => g.set(f, gd(p, "PlayerIndexVariable"), g.rng.randrange(g.players)),
  LockUnlockEncounter: (g, _f, p) => {
    const e = idOf(gd(p, "Encounter"));
    const chain = g.campaign.unlocked_chain;
    if (truthy(gd(p, "Unlock"))) { if (!chain.includes(e)) chain.push(e); }
    else if (chain.includes(e)) removeFirst(chain, e);
  },
  SetNextAdventure: (g, _f, p) => { g.campaign.next_adventure = idOf(gd(p, "Adventure")); },
  AddAlternativeAdventure: (g, _f, p) => { (g.campaign.alternatives ??= []).push(idOf(gd(p, "Adventure"))); },
  ProceedToNextGame: (g) => {
    g.ended = g.ended || "proceed";
    throw new EndGame();
  },
  EndCampaign: (g, _f, p) => {
    g.campaign.result = truthy(gd(p, "Victory")) ? "campaign_victory" : "campaign_defeat";
    g.ended = "campaign_end";
    throw new EndGame();
  },
  EndGame: (g, _f, p) => g.signalEnd(truthy(gd(p, "Success"))),

  // --- threat
  AddThreatEvent: (g, f, p) => {
    const o = g.objRef(f.owner.src, gd(p, "ThreatEvent"));
    if (o === null) return;
    if (truthy(gd(p, "OverrideDefaultThreat"))) o.threatThreshold = g.num(f, gd(p, "ThreatValue"));
    if (!g.activeThreatEvents.includes(o)) g.activeThreatEvents.push(o);
  },
  RemoveThreatEvent: (g, f, p) => {
    const o = g.objRef(f.owner.src, gd(p, "ThreatEvent"));
    if (o !== null && g.activeThreatEvents.includes(o)) removeFirst(g.activeThreatEvents, o);
  },
  SetMaxThreat: (g, f, p) => { g.threatMax = g.num(f, gd(p, "MaxThreat")); },

  // --- tiles / map
  GetStartTileId: (g, f, p) => g.set(f, gd(p, "storeValue"), g.startTileId),
  GetTileId: (g, f, p) => {
    const nd = truthy(gd(p, "Self")) ? f.owner.node : (g.objRef(f.owner.src, gd(p, "Node")) ?? f.owner).node;
    if (nd === null) {
      // explore node of a custom tile or object placed on a tile
      for (const t of g.tiles.values()) {
        if (t.custom !== null && gd(f.owner.go, "parent") === t.custom.pid) { g.set(f, gd(p, "storeValue"), t.id); return; }
      }
      g.warn("GetTileId without node");
      return;
    }
    g.set(f, gd(p, "storeValue"), nd.tile ? nd.tile.id : -1);
  },
  GetTileSpaceIndex: (g, f, p) => g.set(f, gd(p, "storeValue"), f.owner.node ? f.owner.node.space : 0),
  RevealTile: (g, f, p) => {
    const t = tileBy(g, f, p);
    if (t && !t.visible) t.visible = true;
  },
  HideTile: (g, f, p) => {
    const t = tileBy(g, f, p);
    if (t) t.visible = false;
  },
  SetTileState: (g, f, p) => {
    const t = tileBy(g, f, { SpecifyGameObject: 1, Tile: gd(p, "Tile") });
    if (t) { t.visible = truthy(gd(p, "IsVisible")); t.explored = truthy(gd(p, "IsExplored")); }
  },
  IsTileExplored: (g, f, p) => {
    const t = tileBy(g, f, p);
    return t && t.explored ? gd(p, "TrueEvent") : gd(p, "FalseEvent");
  },
  IsTileRevealed: (g, f, p) => {
    const t = tileBy(g, f, p);
    return t && t.visible ? gd(p, "TrueEvent") : gd(p, "FalseEvent");
  },
  SetSectionVisibility: (g, f, p) => {
    const sid = g.num(f, gd(p, "SectionId"));
    if (sid >= g.sections.length) { g.warn(`no section ${sid}`); return; }
    const s = g.sections.at(sid); // negative index wraps like Python
    if (!s) throw new RangeError("IndexError: list index out of range");
    const ignore = new Set(or(gd(p, "TileIdsToIgnore"), []).map((x: any) => g.num(f, x)));
    if (!truthy(gd(p, "IsVisible"))) {
      for (const t of s.tiles) t.visible = false;
      return;
    }
    const fresh = s.tiles.filter((t) => !t.visible && !ignore.has(t.id));
    for (const t of fresh) {
      t.visible = true;
      g.emit("UI_SECTION_REVEAL_PLACE_TILE_FORMATTED", t.code);
    }
    const tokens = fresh.filter((t) => !t.explored).length;
    if (tokens === 1) g.emit("UI_PLACE_EXPLORE_TOKEN");
    else if (tokens > 1) g.emit("UI_PLACE_EXPLORE_TOKENS");
  },
  ExploreTile: (g, f, p) => {
    const t = g.tiles.get(g.num(f, gd(p, "TileId"), -1));
    if (!t) { g.warn("ExploreTile: no tile"); return; }
    if (!truthy(gd(p, "SkipIntro"))) {
      const flav = truthy(gd(p, "OverrideDefaultIntro")) ? keyOf(gd(p, "MessageOverride")) : g.flavor(t);
      const noInsp = g.difficulty === "hard" || truthy(gd(p, "NoInspiration"));
      g.emit("UI_EXPLORE_TILE_WITH_INTRO_FORMATTED", flav, noInsp ? "UI_DISCARD_EXPLORE_TOKEN" : "UI_DISCARD_EXPLORE_TOKEN_WITH_INSPIRATION");
    }
    g.explore(t, gd(p, "SkipAdjacentSectionEvent"));
  },

  // --- nodes
  HideThisNode: (_g, f) => {
    if (f.owner.node) f.owner.node.visible = false;
    f.owner.visible = false;
  },
  HideNode: (g, f, p) => {
    const o = nodeTarget(g, f, p);
    if (o) {
      o.visible = false;
      if (o.node) o.node.visible = false;
    }
  },
  RevealNode: (g, f, p) => {
    const o = nodeTarget(g, f, p);
    if (o) {
      o.visible = true;
      if (o.node) o.node.visible = true;
      else if (o.fsms.length) new GameNode(g, o, null, 0, "Scripted").visible = true;
    }
  },
  IsNodeVisible: (g, f, p) => {
    const o = nodeTarget(g, f, p);
    const vis = !!o && (o.node ? o.node.visible : o.visible);
    return vis ? gd(p, "TrueEvent") : gd(p, "FalseEvent");
  },
  MoveNode: noop,
  SetGameNodeType: (g, f, p) => {
    const o = nodeTarget(g, f, p);
    if (o && o.node) o.node.kind = NODE_KINDS[gd(p, "Type", 0)]!;
  },
  MoveGameObjectToRandomSpace: noop,
  RevealTerrainNodes: (g, _f, p) => {
    const n = or(gd(p, "TerrainNodes"), []).length;
    if (n) g.emit("UI_REVEAL_TERRAIN", n);
  },
  RevealRandomEncounters: (g) => g.warn("RevealRandomEncounters simplified"),

  // --- enemies
  SpawnEnemyGroup: (g, f, p) => {
    const m = g.enemyModel(gd(p, "GroupToSpawn"));
    if (m === null) return gd(p, "Failed");
    const size = truthy(gd(p, "SpecifySize"))
      ? Math.max(1, g.num(f, gd(p, "GroupSize"), 1))
      : g.groupSize(m, g.num(f, gd(p, "AdditionalPoints")));
    g.show(f, gd(p, "Message"));
    g.spawnGroup(m, size, g.objRef(f.owner.src, gd(p, "Logic")));
    return gd(p, "Succeeded");
  },
  SpawnRandomEnemyGroups: (g, f, p) => {
    let pts = g.num(f, gd(p, "Points")) + (truthy(gd(p, "ExcludeGameEnemyPts")) ? 0 : g.num(f, "@EnemyPoints"));
    g.show(f, gd(p, "Message"));
    const reserve = g.reserve.map((e) => g.enemyModel(e));
    let guard = 0;
    while (pts > 0 && guard < 10) {
      guard++;
      let cands = reserve.filter((m) => truthy(m) && g.unitCost(m, 1) <= pts);
      if (!cands.length) cands = g.eligibleEnemies(pts, gd(p, "Filter"));
      if (!cands.length) break;
      const m = g.rng.choice(cands);
      const size = g.groupSize(m, pts);
      pts -= g.unitCost(m, size);
      g.spawnGroup(m, size);
    }
    g.globals.EnemyPoints = 0;
  },
  SpawnEnemyGroupsFromSpawnPoints: (g, f, p) => {
    const sps: any[] = or(gd(p, "SpawnPoints"), []);
    const per: any[] = or(gd(p, "SpawnPointsEnemyPoints"), []);
    const total = g.num(f, gd(p, "EnemyPoints"));
    sps.forEach((sp, i) => {
      const o = g.objRef(f.owner.src, sp);
      const flt = gd(or(o ? gd(o.components, "EnemySpawnPoint") : null, {}), "Filter");
      const pts = i < per.length ? g.num(f, per[i]) : Math.floor(total / Math.max(1, sps.length));
      if (pts <= 0) return;
      const c = g.eligibleEnemies(pts, flt);
      if (!c.length) return;
      const m = g.rng.choice(c);
      g.spawnGroup(m, g.groupSize(m, pts));
    });
  },
  EnemyGroupRemoveFromReserve: (g, f, p) => {
    const m = g.enemyModel(gd(p, "Enemy"));
    const n = g.num(f, gd(p, "Quantity"), 1);
    for (let i = 0; i < n; i++) if (truthy(m) && g.reserve.includes(m._id)) removeFirst(g.reserve, m._id);
  },
  EnemyBannerRemoveFromReserve: noop,
  EnemyGroupAddToTracker: (g, f, p) => {
    const o = g.objRef(f.owner.src, or(gd(p, "Group"), gd(p, "Logic")));
    const eg = or(o ? gd(o.components, "EnemyGroup") : null, {});
    const m = g.enemyModel(gd(eg, "Model"));
    if (!truthy(m)) { g.warn("EnemyGroupAddToTracker: unknown group"); return; }
    const logic = g.objRef(f.owner.src, gd(eg, "Logic")) ?? o;
    const grp = g.spawnGroup(m, or(gd(eg, "_unitStartCount", 1), 1), logic);
    grp.obj = o;
    const hp: number[] = or(gd(eg, "_unitHealth"), []);
    if (hp.length) grp.unitHp = Math.max(...hp);
  },
  EnemyGroupRemoveAll: (g) => { g.enemies.length = 0; },
  EnemyGroupRemove: (g, f, p) => g.removeEnemy(g.groupByLogic(f, p)),
  EnemyGroupDefeat: (g, f, p) => {
    const grp = g.groupByLogic(f, p);
    if (grp) g.defeatGroup(grp);
  },
  EnemyGroupExhaust: (g, f, p) => {
    const grp = g.groupByLogic(f, p);
    if (grp) grp.exhausted = true;
  },
  EnemyGroupActivate: (g, f, p) => {
    const grp = g.groupByLogic(f, p);
    if (grp) g.activate(grp);
  },
  EnemyGroupHeal: (g, f, p) => {
    const grp = g.groupByLogic(f, p);
    if (grp) grp.damage = Math.max(0, grp.damage - g.num(f, gd(p, "HealingAmount")));
  },
  EnemyGroupHealAll: (g, f, p) => {
    for (const grp of g.enemies) grp.damage = Math.max(0, grp.damage - g.num(f, gd(p, "HealingAmount")));
  },
  EnemyGroupResetStats: noop,
  SetEnemyActivationOverride: (g, f, p) => {
    const grp = g.groupByLogic(f, p);
    if (grp) grp.activationOverride = idOf(gd(p, "Override"));
  },
  IsEnemyTrackerEmpty: (g, _f, p) => (g.enemies.length ? gd(p, "NotEmpty") : gd(p, "IsEmpty")),
  IsEnemyTypeOnTracker: (g, _f, p) => {
    const m = g.enemyModel(gd(p, "EnemyType"));
    return g.enemies.some((grp) => grp.model === m) ? gd(p, "OnTracker") : gd(p, "NotOnTracker");
  },
  GetEnemyReadyState: (g, f, p) => {
    const grp = g.groupByLogic(f, p);
    g.set(f, gd(p, "storeValue"), grp && grp.exhausted ? 0 : 1);
  },
  SetNamedEnemy: noop,
};
