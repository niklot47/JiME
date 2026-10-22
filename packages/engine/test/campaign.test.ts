// Campaign layer: adventure chain, carried globals / lore / XP / items / titles, alternatives, saves
// (synthetic scenario, no FFG data)
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ContentSource } from "../src/game.ts";
import {
  adventureChoices, beginAdventure, chooseAdventure, finishAdventure, isCampaignSave, newCampaignSave, openAdventure, resetAdventure, syncAdventure,
} from "../src/campaign.ts";

const st = (name: string, actions: any[], transitions: Record<string, string> = {}) => ({ name, transitions, actions });
const act = (action: string, params: any = {}) => ({ action, enabled: true, params });
const adv = (id: number) => ({ ref: "AdventureModel", id });

// 1: sets a campaign global, lore, XP, an item and a title, then goes to 2 (or 3 instead)
// 2: asks a question only when the global was carried over, then ends the campaign with a victory
// 3: replays itself (no SetNextAdventure)
const scripts: Record<number, any[]> = {
  1: [st("Go", [
    act("SetIntValue", { intVariable: "@Adventure/Test/Clues", intValue: 5 }),
    act("SetIntValue", { intVariable: "@Round", intValue: 9 }),
    act("AddLore", { Lore: 3 }),
    act("AwardXP", { XP: 2 }),
    act("AddItemToInventory", { Item: { id: 7 } }),
    act("AddItemToInventory", { Item: { id: 7 } }),
    act("AwardTitle", { Title: { id: 4 }, PlayerIndex: 1 }),
    act("SetNextAdventure", { Adventure: adv(2) }),
    act("AddAlternativeAdventure", { Adventure: adv(3) }),
    act("AddAlternativeAdventure", { Adventure: adv(3) }),
    act("SetRestEpilogue", { Message: "«REST_1»" }),
    act("ProceedToNextGame"),
  ])],
  2: [
    st("Check", [act("IntCompare", { integer1: "@Adventure/Test/Clues", integer2: 5, equal: "EQ", lessThan: "NE", greaterThan: "NE" })],
      { EQ: "Ask", NE: "Lose" }),
    st("Ask", [act("DisplayMessageMultipleChoice", { Message: "«Q»", Choices: [{ Localization: "«A»", Event: "A" }], CancelChoice: {} })],
      { A: "Win" }),
    st("Win", [act("AwardXP", { XP: 1 }), act("EndCampaign", { Victory: 1 })]),
    st("Lose", [act("EndCampaign", { Victory: 0 })]),
  ],
  3: [st("Again", [act("AddLore", { Lore: 1 }), act("ProceedToNextGame")])],
};

const src: ContentSource = {
  db: () => ({
    models: {
      EnemyModel: {}, TileModel: {}, EncounterModel: {}, EncounterGroupModel: {}, LastStandModel: {},
      CampaignModel: { "9": { _id: 9, Adventures: [adv(1), adv(2), adv(3)] } },
      HeroModel: {
        "1": { _id: 1, DefaultWeapon: { id: 21 }, DefaultArmor: { id: 43 }, StartingSkills: [{ Skill: { id: 108 }, Quantity: 2 }] },
        "2": { _id: 2 },
      },
      ItemModel: { "7": { _id: 7, NameKey: "ITEM_X", Type: 2 } },
      TitleModel: { "4": { _id: 4, NameKey: "TITLE_X" } },
    },
    standardTiles: {}, globals: { "Adventure/Test/Clues": { value: 0 }, Round: { value: 1 } },
  }),
  adventure: (id) => ({
    root: 1,
    model: { _id: Number(id), ThreatLimit: 100 },
    gameObjects: { "1": { name: "Adventure", parent: null, components: { Adventure: {} } } },
    fsms: [{ name: "FSM", start: scripts[Number(id)]![0].name, go: 1, variables: {}, global: {}, states: scripts[Number(id)] }],
  }),
  encounter: () => null,
};

test("a new campaign starts at the first adventure with the heroes' starting gear", () => {
  const s = newCampaignSave(src, { campaign: 9, heroes: [1, 2], partyName: "Fellowship" });
  assert.equal(s.current, 1);
  assert.equal(s.status, "rest");
  assert.deepEqual(s.heroes[0]!.items, [21, 43]);
  assert.deepEqual(s.heroes[0]!.skills, [108, 108]);
  assert.ok(isCampaignSave(JSON.parse(JSON.stringify(s))));
});

test("state is carried from one adventure to the next; the campaign ends with EndCampaign", () => {
  const s = newCampaignSave(src, { campaign: 9, heroes: [1, 2] });
  beginAdventure(s, 5);
  const a = openAdventure(src, s);
  assert.equal(a.status, "ended");
  assert.equal(a.game.proceeded, true);
  finishAdventure(s, a.game);
  assert.equal(s.status, "rest");
  assert.deepEqual(s.completed, [1]);
  assert.equal(s.current, 2);
  assert.deepEqual(s.alternatives, [3], "alternatives are added once");
  assert.equal(s.state.lore, 3);
  assert.deepEqual(s.state.items, [7], "an item is added once");
  assert.deepEqual(s.heroes.map((h) => h.xp["-1"]), [2, 2], "AwardXP goes to every hero");
  assert.deepEqual(s.heroes[1]!.titles, [4]);
  assert.equal(s.heroes[1]!.title, 4);
  assert.equal(s.state.flags["Adventure/Test/Clues"], 5);
  assert.equal(s.state.flags.Round, undefined, "scene globals are reset");
  assert.deepEqual(s.restText, { key: "REST_1", inserts: [] });

  beginAdventure(s, 6);
  const b = openAdventure(src, s);
  assert.equal(b.status, "waiting", "the carried global opens the question");
  syncAdventure(s, b);
  const reloaded = JSON.parse(JSON.stringify(s));
  const b2 = openAdventure(src, reloaded);
  b2.answer(0);
  syncAdventure(reloaded, b2);
  finishAdventure(reloaded, b2.game);
  assert.equal(reloaded.status, "victory");
  assert.deepEqual(reloaded.heroes.map((h: any) => h.xp["-1"]), [3, 3]);
  assert.equal(reloaded.game, null);
  assert.deepEqual(reloaded.history.map((h: any) => h.adv), [1, 2]);
});

test("an alternative adventure swaps with the next one; an adventure without SetNextAdventure comes again", () => {
  const s = newCampaignSave(src, { campaign: 9, heroes: [1] });
  beginAdventure(s, 1);
  finishAdventure(s, openAdventure(src, s).game);
  assert.deepEqual(adventureChoices(s), [2, 3]);
  chooseAdventure(s, 3);
  assert.equal(s.current, 3);
  assert.deepEqual(s.alternatives, [2]);
  beginAdventure(s, 2);
  assert.deepEqual(s.alternatives, [], "alternatives are dropped once an adventure starts");
  finishAdventure(s, openAdventure(src, s).game);
  assert.equal(s.current, 3);
  assert.equal(s.state.lore, 4);
  assert.deepEqual(s.completed, [1, 3]);
});

test("reset adventure drops the adventure in progress and keeps the party as before it", () => {
  const s = newCampaignSave(src, { campaign: 9, heroes: [1, 2], heroItems: [[21], [43]] });
  assert.deepEqual(s.heroes.map((h) => h.items), [[21], [43]], "starting items chosen per hero");
  beginAdventure(s, 3);
  const a = openAdventure(src, s);
  syncAdventure(s, a);
  resetAdventure(s);
  assert.equal(s.status, "rest");
  assert.equal(s.game, null);
  assert.equal(s.current, 1);
  assert.equal(s.state.lore, 0);
});

test("the rest: roles, XP per role, skills, item upgrades, embark", async () => {
  const { canTakeRole, setRole, embark, availableXP, roleSkills, toggleSkill, canUpgrade, upgradeOptions, upgradeItem } = await import("../src/campaign.ts");
  const D = {
    models: {
      CampaignModel: { "9": { Adventures: [adv(1)] } },
      HeroModel: { "1": {}, "2": {} },
      RoleModel: { "5": { UpgradeSkills: [{ id: 50 }, { id: 51 }] }, "6": { UpgradeSkills: [{ id: 60 }] } },
      SkillModel: { "50": {}, "51": { Cost: 3 }, "60": {} },
      ItemModel: { "21": { Level: 1, Upgrades: [{ id: 22 }], UpgradeCost: 5 }, "22": { Level: 2 } },
      ProductModel: { "0": { Items: [{ Item: { id: 21 }, Quantity: 1 }, { Item: { id: 22 }, Quantity: 1 }] } },
    },
  };
  const s = newCampaignSave({ db: () => D } as any, { campaign: 9, heroes: [1, 2], heroItems: [[21], []] });
  setRole(s, 0, 5);
  assert.equal(canTakeRole(D, s, 1, 5), false, "another hero's role");
  assert.throws(() => embark(s), /role/);
  setRole(s, 1, 6);
  embark(s);
  assert.equal(availableXP(s, 0, 5), 0);
  assert.equal(availableXP(s, 0, 6), -1, "a role never played");
  s.heroes[0]!.xp["5"] = 2;
  assert.deepEqual(roleSkills(D, s, 0, 5).map((x) => [x.id, x.cost, x.canLearn]), [[50, 1, true], [51, 3, false]]);
  assert.ok(toggleSkill(D, s, 0, 5, 50));
  assert.equal(availableXP(s, 0, 5), 1);
  assert.equal(toggleSkill(D, s, 0, 5, 51), false, "not enough XP");
  assert.ok(toggleSkill(D, s, 0, 5, 50), "unlearn refunds");
  assert.equal(availableXP(s, 0, 5), 2);
  assert.equal(canUpgrade(D, s, { hero: 0, slot: 0 }), false, "not enough lore");
  s.state.lore = 5;
  assert.deepEqual(upgradeOptions(D, s, { hero: 0, slot: 0 }), [22]);
  assert.ok(upgradeItem(D, s, { hero: 0, slot: 0 }, 22));
  assert.deepEqual(s.heroes[0]!.items, [22]);
  assert.equal(s.state.lore, 5, "lore is a threshold, not spent");
});
