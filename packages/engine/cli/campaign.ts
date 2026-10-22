// Bot-play whole campaigns through the campaign layer and print the adventure chain.
// usage: node cli/campaign.ts [campaignId|all] [seed] [players]
import { Game } from "../src/game.ts";
import { adventureChoices, adventureSetup, beginAdventure, campaignAdventures, chooseAdventure, finishAdventure, newCampaignSave } from "../src/campaign.ts";
import { PackDirSource, defaultPackDir } from "../src/node/packSource.ts";

const src = new PackDirSource(defaultPackDir());
const D = src.db();
const arg = process.argv[2] ?? "all";
const seed0 = Number(process.argv[3] ?? 1);
const players = Number(process.argv[4] ?? 2);
const ids = arg === "all" ? Object.keys(D.models.CampaignModel).map(Number) : [Number(arg)];
const heroIds = Object.keys(D.models.HeroModel).map(Number);
let errors = 0;
const unimpl = new Map<string, number>();

for (const cid of ids) {
  const s = newCampaignSave(src, { campaign: cid, heroes: heroIds.slice(0, players) });
  const chain: string[] = [];
  let seed = seed0;
  try {
    for (let n = 0; n < 40 && s.status === "rest"; n++) {
      // the bot takes an alternative adventure now and then (UIMapScene choice)
      const ch = adventureChoices(s);
      if (ch.length > 1 && seed % 2) chooseAdventure(s, ch[1 + (seed % (ch.length - 1))]!);
      const alts = ch.length > 1 ? `[${ch.join("/")}]` : "";
      beginAdventure(s, seed, seed);
      const setup = adventureSetup(s, seed, seed);
      const g = new Game(src, setup.adv, { seed, mapSeed: seed, players, campaign: setup.campaign, mapMode: "ffg" });
      g.run();
      for (const [k, v] of g.unimpl) unimpl.set(k, (unimpl.get(k) ?? 0) + v);
      finishAdventure(s, g);
      const h = s.history.at(-1)!;
      chain.push(`${alts}${h.adv}:${(h.result ?? "-")[0]}${g.proceeded ? "" : "!"}`);
      seed++;
    }
  } catch (e) {
    errors++;
    chain.push(`ERROR ${(e as Error).message}`);
  }
  const listed = new Set(campaignAdventures(D, cid));
  const off = s.history.map((h) => h.adv).filter((a) => !listed.has(a));
  console.log(`campaign ${cid}: ${s.status} after ${s.history.length} | ${chain.join(" ")}`);
  console.log(`  lore ${s.state.lore} xp ${s.heroes[0]!.xp["-1"] ?? 0} items ${s.state.items.length} titles ${s.state.titles.length}`
    + ` flags ${Object.keys(s.state.flags).length} chain ${s.state.unlocked_chain.length}${off.length ? ` not-in-campaign ${off.join(",")}` : ""}`);
}
if (unimpl.size) console.log("unimplemented:", [...unimpl].map(([k, v]) => `${k}x${v}`).join(" "));
process.exit(errors ? 1 : 0);
