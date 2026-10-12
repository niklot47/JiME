// Engine semantics on a tiny synthetic scenario (no FFG data needed, runs in CI)
import { test } from "node:test";
import assert from "node:assert/strict";
import { Game, type ContentSource } from "../src/game.ts";
import { keysOf, parseOrdered, valuesOf } from "../src/ojson.ts";
import { toInt, truthy, pyStr } from "../src/py.ts";

test("ordered JSON keeps file order of integer-like keys", () => {
  const o = parseOrdered('{"20": 1, "3": 2, "x": 3, "100": {"b": 1, "a": 2}}') as any;
  assert.deepEqual(Object.keys(o), ["3", "20", "100", "x"]); // what plain JS would do
  assert.deepEqual(keysOf(o), ["20", "3", "x", "100"]);
  assert.deepEqual(valuesOf(o).slice(0, 2), [1, 2]);
  assert.deepEqual(keysOf(o["100"]), ["b", "a"]);
  assert.equal((parseOrdered('"a\\u00abb\\n"') as string), "a«b\n");
});

test("python semantics helpers", () => {
  assert.equal(truthy([]), false);
  assert.equal(truthy({}), false);
  assert.equal(truthy("0"), true);
  assert.equal(toInt("2.9"), 2);
  assert.equal(toInt("abc", 7), 7);
  assert.equal(toInt(true), 1);
  assert.equal(pyStr(null), "None");
  assert.equal(pyStr(false), "False");
});

const st = (name: string, actions: any[], transitions: Record<string, string> = {}) => ({ name, transitions, actions });
const act = (action: string, params: any = {}) => ({ action, enabled: true, params });

function source(states: any[], extra: any = {}): ContentSource {
  const db = { models: { EnemyModel: {}, TileModel: {}, EncounterModel: {}, EncounterGroupModel: {}, LastStandModel: {} },
    standardTiles: {}, globals: { Gold: { type: "int", value: 0 } } };
  return {
    db: () => db,
    adventure: () => ({
      root: 1,
      model: { _id: 99, ThreatLimit: 100, ...extra },
      gameObjects: { "1": { name: "Adventure", parent: null, components: { Adventure: {} } } },
      fsms: [{ name: "FSM", start: "Start", go: 1, variables: { Count: 0 }, global: {}, states }],
    }),
    encounter: () => null,
  };
}

test("FSM: messages, variables, branching and victory", () => {
  const src = source([
    st("Start", [act("DisplayMessage", { Message: "«INTRO»" })], { FINISHED: "Loop" }),
    st("Loop", [
      act("IntAdd", { intVariable: "@Count", add: 1 }),
      act("IntAdd", { intVariable: "@Gold", add: 10 }),
      act("IntCompare", { integer1: "@Count", integer2: 3, lessThan: "AGAIN", equal: "DONE", greaterThan: "DONE" }),
    ], { AGAIN: "Loop", DONE: "Win" }),
    st("Win", [act("DisplayMessage", { Message: { key: "WIN_FMT", inserts: [{ VariableInt: "@Gold" }] } }), act("EndGame", { Success: 1 })]),
  ]);
  const g = new Game(src, 99, { seed: 1 }).run();
  assert.equal(g.result, "victory");
  assert.equal(g.ended, "end_signalled");
  assert.deepEqual(g.log.map((e) => [e[2], e[3]]), [["INTRO", []], ["WIN_FMT", ["30"]]]);
  assert.equal(g.globals.Gold, 30);
  assert.equal(g.unimpl.size, 0);
});

test("unknown actions are counted, unhandled events warned", () => {
  const src = source([st("Start", [act("SomethingNew"), act("Wait", { finishEvent: "NOPE" })])]);
  const g = new Game(src, 99, { seed: 1 }).run(2);
  assert.equal(g.unimpl.get("SomethingNew"), 1);
  assert.equal(g.warnings.get("unhandled event 'NOPE' in Adventure/Start"), 1);
  assert.equal(g.ended, "max_rounds");
});

test("threat limit ends the game in defeat", () => {
  const g = new Game(source([st("Start", [])], { ThreatLimit: 5 }), 99, { seed: 3 }).run();
  assert.equal(g.result, "defeat");
  assert.equal(g.round, 2); // 2 players -> +4 threat per round, limit 5 reached after round 2's shadow phase
});

test("same seed, same game", () => {
  const mk = () => new Game(source([st("Start", [act("RandomInt", { min: 0, max: 1000, storeResult: "@Count" })])]), 99, { seed: 42 });
  const a = mk(), b = mk();
  assert.equal(a.allFsms[0]!.vars.Count, 0);
  a.run(1); b.run(1);
  assert.equal(a.allFsms[0]!.vars.Count, b.allFsms[0]!.vars.Count);
});
