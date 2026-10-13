// Check that the tile art, rotated as FFG rotates tiles, lands exactly on the generated hex positions
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateMap } from "../src/map/mapgen.ts";
import { artFor, layoutError, type TileArtDb } from "../src/map/layout.ts";
import { PackDirSource, defaultPackDir } from "../src/node/packSource.ts";
import { keysOf } from "../src/ojson.ts";

const src = new PackDirSource(defaultPackDir());
const art: TileArtDb = JSON.parse(readFileSync(join(src.scenarioDir, "tileart.json"), "utf8"));
const AM = src.db().models.AdventureModel;
let tiles = 0, worst = 0, missing = 0;
for (const k of keysOf(AM).map(Number)) {
  const a = src.adventure(k);
  if (!Object.values<any>(a.gameObjects).some((o) => o.components?.MapBuilder)) continue;
  for (const seed of [1]) {
    let m;
    try { m = generateMap(src.db(), a, { seed, players: 3, products: src.db().productOrder, maxAttempts: 3 }); } catch { continue; }
    for (const s of m.sections) for (const t of s.tiles) {
      const ta = artFor(art, k, t);
      if (!ta) { missing++; continue; }
      tiles++;
      worst = Math.max(worst, layoutError(t, ta));
    }
  }
}
console.log(`tiles ${tiles}, missing art ${missing}, worst misplacement ${(worst * 100).toFixed(2)}% of a hex`);
process.exit(worst > 0.04 || missing ? 1 : 0); // FFG art itself is off-lattice by up to ~3%
