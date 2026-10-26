// Scenario graphs (graph.ts) on a small made-up campaign: no FFG content needed
import { test } from "node:test";
import assert from "node:assert/strict";
import { campaignGraph, fsmGraph, pathsTo, scenarioFsms } from "../src/graph.ts";

const adv = (id: number, states: any[], global: Record<string, string> = {}) => ({
  format: "jime-scenario", kind: "adventure", id, root: 1,
  gameObjects: { 1: { name: `${id}_Adv`, parent: null, components: { PlayMakerFSM: [0] } } },
  fsms: { 0: { name: "FSM", start: "Begin", global, states } },
});

// 1: victory -> a choice: 2 or 3; failure -> end of the campaign (lost)
const A1 = adv(1, [
  { name: "Begin", transitions: { FINISHED: "Idle" }, actions: [] },
  { name: "Idle", transitions: {}, actions: [] },
  { name: "Won", transitions: { TRUE: "Next 2", FALSE: "Next 3" }, actions: [{ action: "CheckBool", params: { boolVariable: "@Saved" } }] },
  { name: "Next 2", transitions: {}, actions: [{ action: "SetNextAdventure", params: { Adventure: { ref: "AdventureModel", id: 2 } } }] },
  { name: "Next 3", transitions: {}, actions: [{ action: "SetNextAdventure", params: { Adventure: { ref: "AdventureModel", id: 3 } } },
    { action: "AddAlternativeAdventure", params: { Adventure: { ref: "AdventureModel", id: 9 } } }] },
  { name: "Lost", transitions: {}, actions: [{ action: "EndCampaign", params: {} }] },
], { ADVENTURE_END_VICTORY: "Won", ADVENTURE_END_FAILURE: "Lost" });
const A2 = adv(2, [{ name: "Begin", transitions: {}, actions: [{ action: "EndCampaign", params: { Victory: 1 } }] }]);
const A3 = adv(3, [{ name: "Begin", transitions: {}, actions: [{ action: "SetNextAdventure", enabled: false, params: { Adventure: { id: 2 } } }] }]);
const A9 = adv(9, [{ name: "Begin", transitions: {}, actions: [] }]);
const D = { models: {
  CampaignModel: { 1: { _id: 1, m_Name: "1_Test", TitleKey: "T", Adventures: [{ id: 1 }, { id: 2 }, { id: 3 }] } },
  AdventureModel: Object.fromEntries([1, 2, 3, 9].map((i) => [i, { _id: i, m_Name: `${i}_Adv`, NameKey: `A${i}_TITLE` }])),
} };
const prefabs: Record<number, any> = { 1: A1, 2: A2, 3: A3, 9: A9 };

test("fsmGraph: states, edges, start and global entries", () => {
  const g = fsmGraph("0", A1.fsms[0]);
  assert.equal(g.states.length, 6);
  assert.equal(g.edges.length, 3);
  assert.equal(g.states.find((s) => s.start)?.name, "Begin");
  assert.deepEqual(g.states.find((s) => s.name === "Won")?.entries, ["ADVENTURE_END_VICTORY"]);
  assert.equal(scenarioFsms(A1)[0]!.owner, "1_Adv");
});

test("pathsTo: through the choice, from the global event", () => {
  const g = fsmGraph("0", A1.fsms[0]);
  assert.deepEqual(pathsTo(g, "Next 3"), [{ entry: "ADVENTURE_END_VICTORY", steps: [{ state: "Won", event: "FALSE" }] }]);
  assert.deepEqual(pathsTo(g, "Idle"), [{ entry: "start", steps: [{ state: "Begin", event: "FINISHED" }] }]);
});

test("campaignGraph: next / alternative / end links with their outcome; adventures reached from outside the list", () => {
  const c = campaignGraph(D, 1, (id) => prefabs[id] ?? null);
  assert.deepEqual(c.adventures.map((a) => [a.id, a.order]), [[1, 0], [2, 1], [3, 2], [9, -1]]);
  const l = c.links.map((x) => `${x.from}>${x.to ?? (x.campaignWon ? "won" : "lost")}:${x.kind}:${x.outcome}`);
  assert.deepEqual(l, ["1>2:next:victory", "1>3:next:victory", "1>9:alternative:victory", "1>lost:end:failure", "2>won:end:other"]);
  assert.deepEqual(c.missing, []);
});
