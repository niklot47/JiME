// Generate a map like the original app.  Usage: node cli/mapgen.ts <adv> <seed> [players=2] [--products 0,1] [--lang Russian]
// [--used 1,2] [--groups 6] [--chain 3] [--items 55]
import { generateMap } from "../src/map/mapgen.ts";
import { PackDirSource, defaultPackDir } from "../src/node/packSource.ts";

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1]! : null; };
const nums = (s: string | null) => (s ? s.split(",").filter(Boolean).map(Number) : []);
const products = nums(opt("--products"));
const lang = opt("--lang") ?? "English";
const used = nums(opt("--used")), groups = nums(opt("--groups")), chain = nums(opt("--chain")), items = nums(opt("--items"));
const [adv = "1", seed = "0", players = "2"] = args;
const src = new PackDirSource(defaultPackDir());
const m = generateMap(src.db(), src.adventure(Number(adv)), {
  seed: Number(seed), players: Number(players), products: products.length ? products : [0], language: lang,
  usedEncounters: used, usedGroups: groups, unlockedChain: chain, groupItems: items,
});
const E = src.db().models.EncounterModel;
console.log(`seed ${m.seed} (attempts ${m.attempts}), encounter group ${m.encounterGroup}`);
for (const s of m.sections) {
  console.log(`section ${s.id}:`);
  for (const t of s.tiles) {
    const enc = t.encounters.map((e) => (e < 0 ? "-" : E[String(e)]?.m_Name ?? e)).join(", ");
    console.log(`  ${t.code.padEnd(5)} rot ${t.rotation} at ${JSON.stringify(t.hexes[0])}  [${enc}]`);
  }
}
