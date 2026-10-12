// Run one adventure with the bot and print a LogA-style log.  Usage: node cli/run.ts <adv> [seed] [packDir]
import { Game } from "../src/game.ts";
import { PackDirSource, defaultPackDir } from "../src/node/packSource.ts";

const [adv = "1", seed = "1", pack = defaultPackDir()] = process.argv.slice(2);
const g = new Game(new PackDirSource(pack), Number(adv), { seed: Number(seed) }).run();
for (const [a, r, k, ins] of g.log) console.log(`[${a}|${r}|${k}${ins.map((i) => "|" + i).join("")}]`);
console.error("ENDED:", g.ended, g.result, "round", g.round, "threat", g.globals.Threat, "/", g.threatMax);
console.error("next:", g.campaign.next_adventure, "lore", g.campaign.lore, "xp", g.campaign.xp);
console.error("unimpl:", g.unimpl.toObject());
console.error("warnings:", Object.fromEntries([...g.warnings].sort((a, b) => b[1] - a[1]).slice(0, 12)));
