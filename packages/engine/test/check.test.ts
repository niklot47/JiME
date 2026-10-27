// Static scenario checks (check.ts) on a made-up adventure
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkScenario, newIssues } from "../src/check.ts";

const prefab = (states: any[], global: Record<string, string> = {}, start = "Begin") => ({
  root: 1, gameObjects: { 1: { name: "Adv", parent: null, components: { PlayMakerFSM: [0] } } },
  fsms: { 0: { name: "FSM", start, global, states } },
});

test("a clean scenario has no issues", () => {
  const p = prefab([
    { name: "Begin", transitions: { FINISHED: "Ask" }, actions: [{ action: "DisplayMessage", params: { Message: "«K1»" } }] },
    { name: "Ask", transitions: { TRUE: "End", NOPE: "End" }, actions: [{ action: "CheckBool", params: { isFalse: "NOPE" } }] },
    { name: "End", transitions: {}, actions: [] },
    { name: "Won", transitions: { "0": "End", "1": "End" }, actions: [] },
  ], { ADVENTURE_END_VICTORY: "Won" });
  assert.deepEqual(checkScenario(p, { actions: ["DisplayMessage", "CheckBool"], hasText: { ru: () => true } }), []);
});

test("broken and suspicious parts are found", () => {
  const p = prefab([
    { name: "Begin", transitions: { FINISHED: "Gone", WHO: "Begin" }, actions: [{ action: "Mystery", params: {} }] },
    { name: "Lost", transitions: {}, actions: [{ action: "DisplayMessage", params: { Message: "«NEW_KEY»" } }] },
    { name: "Lost", transitions: {}, actions: [] },
  ]);
  const got = checkScenario(p, { actions: ["DisplayMessage"], hasText: { ru: (k) => k !== "NEW_KEY", it: () => false } })
    .map((i) => `${i.level}:${i.kind}:${i.state ?? ""}:${i.detail ?? ""}${i.langs ? ":" + i.langs.join("+") : ""}`);
  assert.deepEqual(got.sort(), [
    "error:missing-state:Begin:FINISHED → Gone",
    "warning:duplicate-state:Lost:",
    "warning:missing-text:Lost:NEW_KEY:ru+it",
    "warning:unknown-action:Begin:Mystery",
    "warning:unreachable:Lost:",
    "warning:unreachable:Lost:",
    "warning:unsent-event:Begin:WHO",
  ].sort());
  assert.equal(checkScenario(prefab([{ name: "A", transitions: {}, actions: [] }], {}, "Nowhere")).filter((i) => i.kind === "no-start").length, 1);
});

test("newIssues: only what the edit brought in", () => {
  const before = checkScenario(prefab([{ name: "Begin", transitions: {}, actions: [] }, { name: "Old", transitions: {}, actions: [] }]));
  const now = checkScenario(prefab([{ name: "Begin", transitions: {}, actions: [] }, { name: "Old", transitions: {}, actions: [] }, { name: "Mine", transitions: {}, actions: [] }]));
  assert.deepEqual(newIssues(now, before).map((i) => i.state), ["Mine"]);
});
