// orderLayers: browser-side layering with per-pack problems instead of exceptions
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkManifest, layerLangs, orderLayers, type PackRef } from "../src/layers.ts";

const pack = (dir: string, priority = 0, deps: Record<string, string> = {}, extra: any = {}): PackRef => ({
  dir,
  manifest: { formatVersion: 1, id: dir, version: "1.0.0", priority, dependencies: deps, contents: [{ type: "lang", lang: "ru", path: "lang/ru.csv" }], ...extra },
});
const ids = (r: { layers: PackRef[] }) => r.layers.map((p) => p.dir);

test("dependencies first, then priority, then id", () => {
  const r = orderLayers([pack("addon", -5, { base: "^1.0.0" }), pack("base", 10), pack("zz", 0), pack("aa", 0)]);
  assert.deepEqual(ids(r), ["aa", "zz", "base", "addon"]);
  assert.deepEqual(r.problems, []);
});

test("disabled pack drops its dependents with a reason, others still load", () => {
  const r = orderLayers([pack("base"), pack("addon", 0, { base: "*" }), pack("other", 1)], ["base"]);
  assert.deepEqual(ids(r), ["other"]);
  assert.deepEqual(r.disabled, ["base"]);
  assert.match(r.problems[0]!.error, /нужен пак base/);
});

test("version mismatch, duplicate id, bad manifest and cycles are reported", () => {
  const r = orderLayers([
    pack("base", 0, {}, { version: "2.0.0" }),
    pack("needs1", 0, { base: "^1.0.0" }),
    { dir: "copy", manifest: { ...pack("base").manifest } },
    { dir: "broken", manifest: null },
    pack("aa", 0, { bb: "*" }), pack("bb", 0, { aa: "*" }),
  ]);
  assert.deepEqual(ids(r), ["base"]);
  const by = Object.fromEntries(r.problems.map((p) => [p.dir, p.error]));
  assert.match(by.needs1!, /base@\^1\.0\.0/);
  assert.match(by.copy!, /уже занят/);
  assert.match(by.broken!, /нет pack\.json/);
  assert.match(by.aa!, /цикл/);
  assert.match(by.bb!, /цикл/);
});

test("manifest checks and languages", () => {
  assert.equal(checkManifest(pack("ok").manifest), null);
  assert.match(checkManifest({ ...pack("xx").manifest, contents: [{ type: "lang", path: "../x.csv", lang: "ru" }] })!, /path/);
  assert.match(checkManifest({ ...pack("xx").manifest, contents: [{ type: "lang", path: "l.csv" }] })!, /без lang/);
  assert.deepEqual(layerLangs([pack("aa"), pack("bb", 0, {}, { contents: [{ type: "lang", lang: "it", path: "x" }, { type: "lang", lang: "ru", path: "y" }] })]), ["ru", "it"]);
});
