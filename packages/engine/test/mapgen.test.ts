// Map generator: .NET primitives against Mono-generated vectors, and a synthetic map (no FFG data in CI)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NetRandom } from "../src/map/netrandom.ts";
import { netSort, cmpNum } from "../src/map/netsort.ts";
import { generateMap } from "../src/map/mapgen.ts";
import { neighbor, eq } from "../src/map/hex.ts";

// Generated with Mono 6.8 (the runtime family Unity uses): see git history for the C# program
const V = JSON.parse(readFileSync(new URL("./netvectors.json", import.meta.url), "utf8"));

for (const [seed, v] of Object.entries<any>(V.random)) {
  test(`System.Random(${seed}) matches Mono`, () => {
    const r = new NetRandom(Number(seed));
    assert.deepEqual(v.next.map((_: number, i: number) => r.next(0, 6 + i * 13)), v.next);
    assert.deepEqual(v.double.map(() => r.nextDouble()), v.double);
    assert.deepEqual(v.float.map(() => r.nextFloat(0, 1)), v.float);
  });
}

test("List<T>.Sort (introsort, unstable) matches Mono permutation", () => {
  for (const { keys, order } of V.sort) {
    const items = keys.map((_: number, i: number) => i);
    netSort(items, (a: number, b: number) => cmpNum(keys[a], keys[b]));
    assert.deepEqual(items, order, `n=${keys.length}`);
  }
});

// --- synthetic content: single-hex and two-hex tiles with plain edges
const hexTile = (code: string, hexes: [number, number, number][]) => {
  const hs = hexes.map(([x, y, z]) => ({ x, y, z, space: 0 }));
  const edges: any[] = [];
  hexes.forEach(([x, y, z], i) => {
    for (let d = 0; d < 6; d++) {
      const n = neighbor({ x, y, z }, d);
      if (!hexes.some(([a, b, c]) => eq({ x: a, y: b, z: c }, n))) edges.push({ hex: i, dir: d, traits: 0, open: true });
    }
  });
  return { code, hexes: hs, spaces: [{ traits: 1, hexes: hs.map((_, i) => i), connected: [] }], edges };
};
const codes = ["T1", "T2", "T3", "T4", "T5", "T6"];
const db = {
  tiles: codes.map((c, i) => hexTile(c, i % 2 ? [[0, 0, 0]] : [[0, 0, 0], [1, -1, 0]])),
  productOrder: [0],
  models: {
    TileModel: Object.fromEntries(codes.map((c, i) => [c, { m_Name: c, _id: c, HashId: 1000 + i, Set: 32 }])),
    ProductModel: { "0": { _id: 0, Tiles: codes.map((c) => ({ id: c })), EncounterGroups: [{ id: 1 }], Encounters: [{ id: 7 }] } },
    EncounterGroupModel: { "1": { _id: 1 } },
    EncounterModel: { "7": { _id: 7, m_Name: "7_Search" } },
    ItemModel: {},
  },
};
const sb = (min: number, max: number) => ({ AllowedTileSets: 32, MinimumSpaces: min, MaximumSpaces: max, TileClumpFactor: 0.5, SectionClumpFactor: 0.5, RelativeSizeFactor: 1, RandomFillPercent: 0.5 });
const adventure = {
  root: 1, model: { _id: 1 },
  gameObjects: {
    "1": { name: "Adv", parent: null, components: { MapBuilder: { Sections: [{ go: 2 }, { go: 3 }], RequiredConnections: [{ Section1: { go: 2 }, Section2: { go: 3 } }] } } },
    "2": { name: "S0", parent: 1, components: { SectionBuilder: sb(2, 3) } },
    "3": { name: "S1", parent: 1, components: { SectionBuilder: sb(2, 3) } },
  },
  fsms: [],
};

test("synthetic map: deterministic, no overlaps, sections touch", () => {
  const a = generateMap(db, adventure, { seed: 5, players: 1 });
  const b = generateMap(db, adventure, { seed: 5, players: 1 });
  assert.deepEqual(a, b);
  const hexes = a.sections.flatMap((s) => s.tiles.flatMap((t) => t.hexes.map((h) => `${h.x},${h.z}`)));
  assert.equal(new Set(hexes).size, hexes.length, "tiles overlap");
  for (const s of a.sections) assert.ok(s.tiles.reduce((n, t) => n + t.encounters.length, 0) >= 2);
  const s0 = new Set(a.sections[0]!.tiles.flatMap((t) => t.hexes.map((h) => `${h.x},${h.z}`)));
  const touch = a.sections[1]!.tiles.some((t) => t.hexes.some((h) => [0, 1, 2, 3, 4, 5].some((d) => { const n = neighbor(h, d); return s0.has(`${n.x},${n.z}`); })));
  assert.ok(touch, "required connection: sections must be adjacent");
  assert.equal(a.encounterGroup, 1);
});
