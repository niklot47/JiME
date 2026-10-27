// Static checks (check.ts) over a pack's adventures: node packages/engine/cli/check.ts [adventure] [packs-dir]
// The original adventures should come out (almost) clean: what remains shows where the checks are too strict.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkScenario } from "../src/check.ts";
import { parseOrdered } from "../src/ojson.ts";
import { ACTIONS } from "../src/actions.ts";
import { Counter } from "../src/py.ts";

const only = process.argv[2] ? Number(process.argv[2]) : null;
const dir = join(process.argv[3] ?? process.env.JIME_PACKS ?? "data/packs", "core-ffg");
const D = JSON.parse(readFileSync(join(dir, "scenario", "db.json"), "utf8"));
const kinds = new Counter();
const unsent = new Counter();
const unknown = new Counter();
let total = 0;
for (const a of Object.values<any>(D.models.AdventureModel)) {
  const id = Number(a._id);
  if (only !== null && id !== only) continue;
  const p = join(dir, "scenario", "adventures", `${id}.json`);
  if (!existsSync(p)) continue;
  const issues = checkScenario(parseOrdered(readFileSync(p, "utf8")), { actions: Object.keys(ACTIONS) });
  total += issues.length;
  for (const i of issues) {
    kinds.inc(`${i.level} ${i.kind}`);
    if (i.kind === "unsent-event") unsent.inc(i.detail!);
    if (i.kind === "unknown-action") unknown.inc(i.detail!);
    if (only !== null || (process.env.SHOW && i.kind === process.env.SHOW)) console.log(id, i.level, i.kind, `${i.fsmName}#${i.fsm}`, i.state ?? "", i.detail ?? "");
  }
}
const top = (c: Counter, k: number) => Object.fromEntries([...c].sort((x, y) => y[1] - x[1]).slice(0, k));
console.log("issues:", total, top(kinds, 20));
console.log("unsent events:", top(unsent, 40));
console.log("unknown actions:", top(unknown, 40));
