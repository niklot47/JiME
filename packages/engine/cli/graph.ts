// Campaign graphs from a pack's scenarios (graph.ts): node packages/engine/cli/graph.ts [campaign-id] [packs-dir]
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { campaignGraph } from "../src/graph.ts";

const only = process.argv[2] ? Number(process.argv[2]) : null;
const dir = join(process.argv[3] ?? process.env.JIME_PACKS ?? "data/packs", "core-ffg", "scenario");
const D = JSON.parse(readFileSync(join(dir, "db.json"), "utf8"));
const adv = (id: number) => {
  const p = join(dir, "adventures", `${id}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
};
for (const c of Object.values<any>(D.models.CampaignModel)) {
  if (only !== null && Number(c._id) !== only) continue;
  const g = campaignGraph(D, Number(c._id), adv);
  console.log(`\n## ${g.id} ${g.name}: ${g.adventures.length} adventures, ${g.links.length} links${g.missing.length ? `, missing ${g.missing}` : ""}`);
  for (const l of g.links) {
    const to = l.to ?? (l.campaignWon ? "WON" : "LOST");
    const via = l.paths[0] ? `${l.paths[0].entry}: ${l.paths[0].steps.map((s) => `${s.state}[${s.event}]`).join(" > ")}` : "(unreachable)";
    console.log(`  ${l.from} -> ${to}  ${l.kind}/${l.outcome}  @${l.fsmName}#${l.fsm}/${l.state}  via ${via}`);
  }
}
