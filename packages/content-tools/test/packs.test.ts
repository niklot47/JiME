import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverPacks, loadLang, parseCsv, resolvePacks, satisfies, writeCsv, type LoadedPack } from "../src/index.ts";

const fixtures = new URL("./fixtures/", import.meta.url).pathname;

test("csv round trip with quotes, commas and newlines", () => {
  const rows = [["key", "text"], ["a", 'he said "hi", ok'], ["b", "x\ny"]];
  assert.deepEqual(parseCsv(writeCsv(rows)).slice(0, 3), rows);
});

test("semver ranges", () => {
  assert.ok(satisfies("1.2.0", "^1.0.0"));
  assert.ok(!satisfies("2.0.0", "^1.0.0"));
  assert.ok(satisfies("1.2.9", "~1.2.0"));
  assert.ok(!satisfies("1.3.0", "~1.2.0"));
  assert.ok(satisfies("1.2.3", "1.2.3"));
});

test("dependency goes first even with higher priority; dependent overrides", () => {
  const layers = resolvePacks(discoverPacks(fixtures));
  assert.deepEqual(layers.map((p) => p.manifest.id), ["base", "addon"]);
  const ru = loadLang(layers, "ru");
  assert.equal(ru.get("A|HELLO"), "Привет, мир");
  assert.equal(ru.get("A|BYE"), "До встречи");
  assert.equal(ru.get("A|MULTI"), "строка1\nстрока2");
});

const fake = (id: string, priority: number, deps: Record<string, string> = {}, version = "1.0.0"): LoadedPack =>
  ({ dir: "/", manifest: { formatVersion: 1, id, version, priority, dependencies: deps, contents: [{ type: "rules", path: "r" }] } });

test("independent packs sorted by priority", () => {
  const l = resolvePacks([fake("zz", 10), fake("aa", 5), fake("mm", 5)]);
  assert.deepEqual(l.map((p) => p.manifest.id), ["aa", "mm", "zz"]);
});

test("missing, incompatible and cyclic dependencies throw", () => {
  assert.throws(() => resolvePacks([fake("aa", 0, { bb: "*" })]), /missing/);
  assert.throws(() => resolvePacks([fake("aa", 0, { bb: "^2.0.0" }), fake("bb", 0)]), /needs/);
  assert.throws(() => resolvePacks([fake("aa", 0, { bb: "*" }), fake("bb", 0, { aa: "*" })]), /cycle/);
});
