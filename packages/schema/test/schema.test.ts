import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePack, validateScenario } from "../src/index.ts";

test("valid pack manifest passes", () => {
  const r = validatePack({
    formatVersion: 1, id: "core-ffg", version: "1.0.0", priority: 0,
    contents: [{ type: "scenario", path: "scenario" }, { type: "lang", lang: "ru", path: "lang/ru.csv" }],
  });
  assert.deepEqual(r.errors, []);
});

test("lang content without lang code is rejected", () => {
  const r = validatePack({ formatVersion: 1, id: "x-pack", version: "1.0.0", priority: 0, contents: [{ type: "lang", path: "a.csv" }] });
  assert.equal(r.ok, false);
});

test("path escaping the pack root is rejected", () => {
  const r = validatePack({ formatVersion: 1, id: "x-pack", version: "1.0.0", priority: 0, contents: [{ type: "rules", path: "../evil" }] });
  assert.equal(r.ok, false);
});

test("minimal scenario passes, missing state fields fail", () => {
  const base = {
    format: "jime-scenario", formatVersion: 1, kind: "encounter", id: 10, root: 1, model: {},
    gameObjects: { "1": { name: "Chest", parent: null, components: {} } },
    fsms: [{ name: "FSM", start: "A", go: 1, variables: {}, global: {},
      states: [{ name: "A", transitions: { FINISHED: "A" }, actions: [{ action: "DisplayMessage", enabled: true, params: {} }] }] }],
  };
  assert.deepEqual(validateScenario(base).errors, []);
  const bad = structuredClone(base);
  delete (bad.fsms[0]!.states[0] as Record<string, unknown>).actions;
  assert.equal(validateScenario(bad).ok, false);
});
