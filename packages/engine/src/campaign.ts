// Campaign layer: a chain of adventures with state carried between them.
// Port of FFG's SerializedGame / SerializedHero handling (GameController.ProceedToNextGame / EndCampaign,
// LevelLoader scene changes, UIMapScene adventure choice, GlobalVariablesSerializer).
//
// The original keeps one SerializedGame per save slot:
//   - CurrentAdventureId: the adventure being played or coming next (SetNextAdventure changes it;
//     when an adventure does not set it, the same adventure comes again)
//   - CompletedAdventureIds: one entry per ProceedToNextGame (the chapter number is its length + 1)
//   - AlternativeAdventureIds: adventures the party may pick instead on the map (cleared once the next one starts)
//   - GlobalVarData: ALL PlayMaker globals; only the game-scene ones (Round, Threat, EnemyPoints, IsDarkness,
//     DarknessMessageOverride) are reset when an adventure ends (GameFsmVariables.ResetGameSceneVariables)
//   - heroes: role, XP per role, title, items, skills, corruption, last stand difficulty
// Here the engine's Campaign struct carries what the scripts read and write (lore, party items, titles,
// flags = globals, chain encounters, used encounters); CampaignSave adds the slot, the party and the chain.

import { Game, newCampaign, type Campaign, type ContentSource, type Difficulty } from "./game.ts";
import { ENGINE_SAVE_VERSION, Session, type Answer, type SessionOptions, type SessionSetup } from "./session.ts";
import { gd, or } from "./py.ts";

/** Globals reset by GameFsmVariables.ResetGameSceneVariables (not carried to the next adventure) */
export const SCENE_GLOBALS = ["PlayerCount", "Round", "Threat", "EnemyPoints", "IsDarkness", "DarknessMessageOverride"];
/** Globals the campaign layer owns itself (lore and the party name have their own fields) */
const OWN_GLOBALS = ["Campaign/Lore", "PartyName", "IsTutorial", "CorruptionPresence"];

/** SerializedHero */
export interface HeroState {
  /** HeroModel id */
  hero: number;
  /** RoleModel id (-1 = none chosen yet) */
  role: number;
  /** TitleModel id worn (-1 = none) and all titles the hero earned */
  title: number;
  titles: number[];
  /** equipped items (HeroItemIds: weapon, armor, second weapon / item, mount) */
  items: number[];
  /** SkillModel ids in the hero's deck (EquippedSkillIds) */
  skills: number[];
  /** unspent XP per role id (SerializedRole list) */
  xp: Record<string, number>;
  corruption: number;
  /** Hero.LastStandDifficulty (starts at 1) */
  lastStand: number;
}

export type CampaignStatus = "rest" | "adventure" | "victory" | "defeat";

export interface CampaignHistory {
  adv: number;
  result: string | null;
  ended: string | null;
  rounds: number;
  lore: number;
  xp: number;
}

export interface CampaignSave {
  format: "jime-campaign";
  formatVersion: 1;
  engine: string;
  /** SerializedGame.SlotGUID */
  slot: string;
  createdAt: string;
  savedAt: string;
  pack?: { id: string; version: string };
  /** CampaignModel id */
  campaign: number;
  partyName: string;
  difficulty: Difficulty;
  hardcore: boolean;
  players: number;
  products?: number[];
  language?: string;
  heroes: HeroState[];
  /** SerializedGame.CurrentAdventureId / CompletedAdventureIds / AlternativeAdventureIds / LastStandsFailed */
  current: number;
  completed: number[];
  alternatives: number[];
  lastStandsFailed: number;
  /** what the scripts read and write, carried between adventures */
  state: Campaign;
  /** SerializedGame.RestTextOverride (SetRestEpilogue) for the coming rest scene */
  restText: { key: string; inserts: string[] } | null;
  /** GameData.OverrideCutsceneId for the end of the campaign (-1 = default) */
  cutscene: number;
  status: CampaignStatus;
  /** the adventure in progress (IsMidGameSave): its setup is rebuilt from the save, so only seeds and answers */
  game: { adv: number; seed: number; mapSeed: number; answers: Answer[] } | null;
  history: CampaignHistory[];
}

export interface NewCampaignOptions {
  campaign: number;
  /** HeroModel id per player */
  heroes: number[];
  difficulty?: Difficulty;
  hardcore?: boolean;
  partyName?: string;
  products?: number[];
  language?: string;
  /** each hero's starting items (StartingItemController: armor, weapon, second weapon); default: HeroModel defaults */
  heroItems?: number[][];
  pack?: { id: string; version: string };
  slot?: string;
}

const now = () => new Date().toISOString();
const randomSlot = () => Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
const ref = (v: any): number | null => { const id = gd(or(v, {}), "id", null); return id === null ? null : Number(id); };

/** CampaignModel.Adventures ids in order */
export function campaignAdventures(D: any, campaign: number): number[] {
  const m = D.models.CampaignModel?.[String(campaign)];
  return or(gd(m, "Adventures"), []).map(ref).filter((x: number | null): x is number => x !== null);
}

/** SerializedHero(heroId) with the hero's starting gear and skills (HeroModel defaults) */
export function newHero(D: any, hero: number): HeroState {
  const m = D.models.HeroModel?.[String(hero)] ?? {};
  const items = [m.DefaultWeapon, m.DefaultArmor, m.DefaultSecondWeapon].map(ref).filter((x): x is number => x !== null);
  const skills: number[] = [];
  for (const s of or(m.StartingSkills, [])) {
    const id = ref(gd(s, "Skill"));
    if (id !== null) for (let i = 0; i < Number(gd(s, "Quantity", 1)); i++) skills.push(id);
  }
  return { hero, role: -1, title: -1, titles: [], items, skills, xp: {}, corruption: 0, lastStand: 1 };
}

/** GameSetupController: a new campaign, the first adventure next */
export function newCampaignSave(src: ContentSource, o: NewCampaignOptions): CampaignSave {
  const D = src.db();
  const advs = campaignAdventures(D, o.campaign);
  if (!advs.length) throw new Error(`campaign ${o.campaign} has no adventures`);
  if (!o.heroes.length) throw new Error("a party needs at least one hero");
  const state = newCampaign();
  const t = now();
  return {
    format: "jime-campaign", formatVersion: 1, engine: ENGINE_SAVE_VERSION, slot: o.slot ?? randomSlot(), createdAt: t, savedAt: t,
    ...(o.pack ? { pack: o.pack } : {}),
    campaign: o.campaign, partyName: o.partyName ?? "", difficulty: o.difficulty ?? "adventure", hardcore: !!o.hardcore,
    players: o.heroes.length, ...(o.products ? { products: [...o.products] } : {}), ...(o.language ? { language: o.language } : {}),
    heroes: o.heroes.map((h, i) => {
      const hero = newHero(D, h);
      if (o.heroItems?.[i]) hero.items = [...o.heroItems[i]!];
      return hero;
    }),
    current: advs[0]!, completed: [], alternatives: [], lastStandsFailed: 0,
    state, restText: null, cutscene: -1, status: "rest", game: null, history: [],
  };
}

/** UIMapScene: chapter label (UI_CHAPTER_<roman>) */
export const chapterOf = (s: CampaignSave): number => s.completed.length + 1;

/** UIMapScene.GetAdventureChoices: the next adventure first, then the alternatives */
export const adventureChoices = (s: CampaignSave): number[] => [s.current, ...s.alternatives.filter((a) => a !== s.current)];

/** UIMapScene: picking an alternative swaps it with the current next adventure */
export function chooseAdventure(s: CampaignSave, adv: number): void {
  if (s.status !== "rest") throw new Error("not between adventures");
  if (adv === s.current) return;
  const i = s.alternatives.indexOf(adv);
  if (i < 0) throw new Error(`adventure ${adv} is not a choice`);
  s.alternatives[i] = s.current;
  s.current = adv;
}

/** The engine state a game of this campaign starts with (party skills and corruption from the heroes) */
export function campaignState(s: CampaignSave): Campaign {
  const c = structuredClone(s.state);
  c.party_skills = [...new Set(s.heroes.flatMap((h) => h.skills))];
  c.corruption = s.heroes.map((h) => h.corruption);
  c.awards = [];
  c.next_adventure = null;
  c.alternatives = [];
  c.result = null;
  return c;
}

/** SessionSetup of the adventure in progress (or about to start with these seeds) */
export function adventureSetup(s: CampaignSave, seed: number, mapSeed = seed): SessionSetup {
  return {
    adv: s.game?.adv ?? s.current, seed, mapSeed, players: s.players, difficulty: s.difficulty, campaign: campaignState(s),
    mapMode: "ffg", heroes: s.heroes.map((h) => h.hero),
    ...(s.products ? { products: [...s.products] } : {}), ...(s.language ? { language: s.language } : {}),
  };
}

/** LevelLoader.RestSceneToGame: start the current adventure (the alternatives are dropped once it starts) */
export function beginAdventure(s: CampaignSave, seed = Math.floor(Math.random() * 2 ** 31), mapSeed = seed): void {
  if (s.status !== "rest") throw new Error("an adventure is already in progress or the campaign is over");
  s.status = "adventure";
  s.alternatives = [];
  s.restText = null;
  s.game = { adv: s.current, seed, mapSeed, answers: [] };
  s.savedAt = now();
}

/** The Session of the adventure in progress (replays its answers) */
export function openAdventure(src: ContentSource, s: CampaignSave, opts: SessionOptions = {}): Session {
  if (!s.game) throw new Error("no adventure in progress");
  return new Session(src, adventureSetup(s, s.game.seed, s.game.mapSeed), s.game.answers, opts);
}

/** Store the answers of the adventure in progress (the mid-game autosave) */
export function syncAdventure(s: CampaignSave, session: Session): void {
  if (!s.game) throw new Error("no adventure in progress");
  s.game.answers = structuredClone(session.answers);
  s.savedAt = now();
}

/** Globals carried to the next adventure (GlobalVariablesSerializer.Save minus the reset ones) */
export function carriedGlobals(g: Game): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(g.globals)) {
    if (SCENE_GLOBALS.includes(k) || OWN_GLOBALS.includes(k)) continue;
    out[k] = structuredClone(v);
  }
  return out;
}

/**
 * An adventure ended: GameController.ProceedToNextGame (rest scene, next adventure) or EndCampaign.
 * AwardXP gives each hero the XP for their current role; titles and skills go to their hero.
 */
export function finishAdventure(s: CampaignSave, g: Game): void {
  if (s.status !== "adventure" || !s.game) throw new Error("no adventure in progress");
  if (g.ended === null) throw new Error("the adventure has not ended");
  const c = g.campaign;
  const xp = c.xp - s.state.xp;
  const lore = c.lore - s.state.lore;
  for (const h of s.heroes) h.xp[String(h.role)] = Math.max(0, h.xp[String(h.role)] ?? 0) + xp;
  for (const a of c.awards ?? []) {
    const h = s.heroes[a.player];
    if (!h) continue;
    if (a.kind === "title") { if (!h.titles.includes(a.id)) h.titles.push(a.id); if (h.title < 0) h.title = a.id; }
    else h.skills.push(a.id);
  }
  (c.corruption ?? []).forEach((v, i) => { if (s.heroes[i]) s.heroes[i]!.corruption = v; });
  s.history.push({ adv: s.game.adv, result: g.result, ended: g.ended, rounds: g.round, lore, xp });
  if (c.rest_text) s.restText = c.rest_text;
  if (c.cutscene !== undefined) s.cutscene = c.cutscene;
  // the carried state: what scripts changed, minus the per-game parts
  const st: Campaign = structuredClone(c);
  st.flags = carriedGlobals(g);
  delete st.party_skills; delete st.corruption; delete st.awards; delete st.rest_text; delete st.cutscene;
  const next = c.next_adventure;
  s.alternatives = [...new Set<number>((c.alternatives ?? []).map(Number))];
  st.next_adventure = null; st.alternatives = []; st.result = null;
  s.state = st;
  if (g.ended === "campaign_end") {
    s.status = c.result === "campaign_victory" ? "victory" : "defeat";
  } else {
    // ProceedToNextGame (an adventure that ends without it is treated the same: the original would hang)
    s.completed.push(s.game.adv);
    if (next !== null && next !== undefined) s.current = Number(next);
    s.status = "rest";
  }
  s.game = null;
  s.savedAt = now();
}

/**
 * SaveSlot "reset adventure" (the backup written when the rest scene was entered): the adventure in progress is
 * dropped, the party is back before it (nothing it did is kept: the state is only applied when an adventure ends)
 */
export function resetAdventure(s: CampaignSave): void {
  if (!s.game) return;
  s.current = s.game.adv;
  s.game = null;
  s.status = "rest";
  s.savedAt = now();
}

/** UIStartingItems: items a hero can start with in place of `item` (same level and kind, one-handed for hobbits,
 *  copies left in the owned products) - StartingItemController.LoadItemSubstitutes */
export function itemSubstitutes(D: any, heroes: number[][], hero: number, kind: "armor" | "weapon", replacing: number | null, products?: number[]): number[] {
  const I = D.models.ItemModel ?? {};
  const H = D.models.HeroModel?.[String(hero)] ?? {};
  const hobbit = (Number(H.Traits ?? 0) & 8) !== 0;
  const cur = replacing !== null ? I[String(replacing)] : null;
  const level = cur ? Number(cur.Level ?? 0) : 1;
  const type = cur ? Number(cur.Type ?? 0) : kind === "armor" ? 1 : 0;
  const max = itemCounts(D, products);
  const used = new Map<number, number>();
  for (const h of heroes) for (const i of h) used.set(i, (used.get(i) ?? 0) + 1);
  return Object.keys(I).map(Number).filter((id) => {
    const m = I[String(id)];
    return Number(m.Level ?? 0) === level && Number(m.Type ?? 0) === type && id !== replacing && !(Number(m.Is2Handed ?? 0) && hobbit)
      && (used.get(id) ?? 0) < (max.get(id) ?? 0);
  });
}

/** UserCollectionManager.GetItemMaxCount: copies of each item card in the (owned) products */
export function itemCounts(D: any, products?: number[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const [pid, p] of Object.entries<any>(D.models.ProductModel ?? {})) {
    if (products && !products.includes(Number(pid))) continue;
    for (const q of p.Items ?? []) {
      const id = ref(q.Item);
      if (id !== null) out.set(id, (out.get(id) ?? 0) + Number(q.Quantity ?? 1));
    }
  }
  return out;
}

// ---------------------------------------------------------------- the rest (UIRestScene)

/** RoleModel ids of the owned products (UserCollectionManager.GetRoles(ownedOnly)); all roles without product data */
export function ownedRoles(D: any, products?: number[]): number[] {
  const ids = new Set<number>();
  for (const [pid, p] of Object.entries<any>(D.models.ProductModel ?? {})) {
    if (products && !products.includes(Number(pid))) continue;
    for (const r of p.Roles ?? []) { const id = ref(r); if (id !== null) ids.add(id); }
  }
  const all = Object.keys(D.models.RoleModel ?? {}).map(Number);
  return ids.size ? all.filter((r) => ids.has(r)) : all;
}

/** UIRestScene.DisplayRoleSelection: a role the hero may take now (not restricted for the hero, not another hero's) */
export function canTakeRole(D: any, s: CampaignSave, player: number, role: number): boolean {
  const m = D.models.RoleModel?.[String(role)];
  if (!m) return false;
  const hero = s.heroes[player]?.hero;
  if ((m.RestrictedHeroes ?? []).some((h: any) => ref(h) === hero)) return false;
  return !s.heroes.some((h, i) => i !== player && h.role === role);
}

/** UIRestScene.OnRoleSelected: the hero takes the role (a hero holding it loses it); XP is kept per role */
export function setRole(s: CampaignSave, player: number, role: number): void {
  const h = s.heroes[player];
  if (!h) throw new Error(`no hero ${player}`);
  for (const o of s.heroes) if (o.role === role) o.role = -1;
  h.role = role;
  s.savedAt = now();
}

/** GameData.GetAvailableXP: unspent XP of a hero for a role, -1 = the hero never played that role */
export const availableXP = (s: CampaignSave, player: number, role: number): number => s.heroes[player]?.xp[String(role)] ?? -1;

/** Roles the hero has XP in (UIRestScene.DisplaySkillPage lists those) */
export const xpRoles = (s: CampaignSave, player: number): number[] =>
  Object.entries(s.heroes[player]?.xp ?? {}).filter(([r, v]) => v >= 0 && Number(r) >= 0).map(([r]) => Number(r));

/** SkillModel.Cost (1 when the model leaves it at its default) */
export const skillCost = (D: any, skill: number): number => Number(D.models.SkillModel?.[String(skill)]?.Cost ?? 1);

export interface SkillState {
  id: number;
  cost: number;
  learned: boolean;
  /** not learned by another hero of the party */
  available: boolean;
  /** enough XP in the role */
  canLearn: boolean;
}

/** UIRestScene.LoadSkills: the role's upgrade skills for a hero */
export function roleSkills(D: any, s: CampaignSave, player: number, role: number): SkillState[] {
  const m = D.models.RoleModel?.[String(role)];
  const xp = availableXP(s, player, role);
  const own = s.heroes[player]?.skills ?? [];
  return (m?.UpgradeSkills ?? []).map((r: any) => {
    const id = ref(r)!;
    const learned = own.includes(id);
    const cost = skillCost(D, id);
    return { id, cost, learned, available: learned || !s.heroes.some((h, i) => i !== player && h.skills.includes(id)), canLearn: xp >= cost };
  });
}

/** UIRestScene.OnSkillSelected: learn a skill with the role's XP, or unlearn it for a refund; false when not allowed */
export function toggleSkill(D: any, s: CampaignSave, player: number, role: number, skill: number): boolean {
  const h = s.heroes[player];
  const st = roleSkills(D, s, player, role).find((x) => x.id === skill);
  if (!h || !st) return false;
  const xp = availableXP(s, player, role);
  if (st.learned) {
    const i = h.skills.indexOf(skill);
    if (i >= 0) h.skills.splice(i, 1);
    h.xp[String(role)] = xp + st.cost;
  } else {
    if (!st.canLearn || !st.available) return false;
    if (!h.skills.includes(skill)) h.skills.push(skill);
    h.xp[String(role)] = xp - st.cost;
  }
  s.savedAt = now();
  return true;
}

/** GameData.IsItemAvailable: copies of an item left (party items and every hero's items count) */
export function itemAvailable(D: any, s: CampaignSave, item: number): boolean {
  let n = s.state.items.filter((x) => Number(x) === item).length;
  for (const h of s.heroes) if (h.items.includes(item)) n++;
  return n < (itemCounts(D, s.products).get(item) ?? 0);
}

const LEVEL_III = 3, LEVEL_IV = 4;

/** Where an item is: a hero's slot or the party inventory */
export type ItemPlace = { hero: number; slot: number } | { group: number };

const itemAt = (s: CampaignSave, at: ItemPlace): number | null =>
  "group" in at ? Number(s.state.items[at.group] ?? NaN) || null : s.heroes[at.hero]?.items[at.slot] ?? null;

/**
 * UIRestScene.OnInventoryItemSelected: can the item be upgraded now (enough lore, it has upgrades, a level III item only
 * when its hero has no level IV item; mounts in the party inventory never)
 */
export function canUpgrade(D: any, s: CampaignSave, at: ItemPlace): boolean {
  const id = itemAt(s, at);
  const m = id !== null ? D.models.ItemModel?.[String(id)] : null;
  if (!m || !(m.Upgrades ?? []).length || Number(m.UpgradeCost ?? 0) > s.state.lore) return false;
  if ("group" in at) return Number(m.Type ?? 0) !== 3;
  if (Number(m.Level ?? 0) === LEVEL_III) {
    const hasIV = (s.heroes[at.hero]?.items ?? []).some((i) => Number(D.models.ItemModel?.[String(i)]?.Level ?? 0) === LEVEL_IV);
    if (hasIV) return false;
  }
  return upgradeOptions(D, s, at).length > 0;
}

/** UIRestScene.LoadUpgradesForItem: the upgrades with copies left */
export function upgradeOptions(D: any, s: CampaignSave, at: ItemPlace): number[] {
  const id = itemAt(s, at);
  const m = id !== null ? D.models.ItemModel?.[String(id)] : null;
  return (m?.Upgrades ?? []).map(ref).filter((u: number | null): u is number => u !== null && itemAvailable(D, s, u));
}

/** UIRestScene.OnUpgradeItemConfirmed: the item is swapped for its upgrade (the lore is a threshold, not spent) */
export function upgradeItem(D: any, s: CampaignSave, at: ItemPlace, to: number): boolean {
  if (!canUpgrade(D, s, at) || !upgradeOptions(D, s, at).includes(to)) return false;
  if ("group" in at) s.state.items[at.group] = to;
  else s.heroes[at.hero]!.items[at.slot] = to;
  s.savedAt = now();
  return true;
}

/** Title "Word Wielder" (5): UIRestScene.GetWorldWielderPlayerIndex - four of the five word skills */
const WORD_SKILLS = [20, 30, 41, 52, 63];
const WORD_WIELDER = 5;

/**
 * UIRestScene.CoroutineEmbark: every hero needs a role; each role in play gets its XP entry (at least 0); a hero with
 * four word skills earns Word Wielder. Returns [player, title] when a title was awarded. Then beginAdventure.
 */
export function embark(s: CampaignSave): [number, number] | null {
  if (s.heroes.some((h) => h.role < 0)) throw new Error("every hero needs a role");
  for (const h of s.heroes) h.xp[String(h.role)] = Math.max(0, h.xp[String(h.role)] ?? -1);
  let award: [number, number] | null = null;
  if (!s.heroes.some((h) => h.titles.includes(WORD_WIELDER))) {
    s.heroes.forEach((h, i) => { if (WORD_SKILLS.filter((k) => h.skills.includes(k)).length >= 4) award = [i, WORD_WIELDER]; });
  }
  if (award) {
    const h = s.heroes[award[0]]!;
    h.titles.push(WORD_WIELDER);
    if (!s.state.titles.includes(WORD_WIELDER)) s.state.titles.push(WORD_WIELDER);
  }
  return award;
}

/** The rest scene opens on role selection before the campaign's first adventure (UIRestScene.ResetScene) */
export const firstRest = (s: CampaignSave): boolean => s.completed.length === 0;

export function isCampaignSave(x: any): x is CampaignSave {
  return !!x && x.format === "jime-campaign" && x.formatVersion === 1;
}
