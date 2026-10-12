// Run engine-py and the TS engine on the same adventures/seeds and diff the traces.
// Usage: node cli/parity.ts <adv[,adv...]|all> <seedFrom> <seedTo> [--verbose]
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { Game } from "../src/game.ts";
import { traceOf, type Trace } from "../src/trace.ts";
import { PackDirSource, defaultPackDir } from "../src/node/packSource.ts";
import { keysOf } from "../src/ojson.ts";

const [spec = "1", from = "0", to = "20", ...flags] = process.argv.slice(2);
const verbose = flags.includes("--verbose");
const repo = resolve(import.meta.dirname, "../../..");
const src = new PackDirSource(defaultPackDir());

const advs = spec === "all"
  ? keysOf(src.db().models.AdventureModel)
      .filter((k) => src.db().models.AdventureModel[k]?.Prefab?.Path)
      .map(Number).sort((a, b) => a - b)
  : spec.split(",").map(Number);

let py: Trace[] = [];
// On Windows "python3" may be the Store stub, so try "python" first there
for (const exe of process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python", "py"]) {
  const r = spawnSync(exe, [resolve(repo, "engine-py/trace.py"), advs.join(","), from, to],
    { encoding: "utf8", maxBuffer: 1 << 30, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  if (r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT") continue;
  if (r.status !== 0) { console.error(r.stderr); process.exit(2); }
  py = r.stdout.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  break;
}
if (!py.length) { console.error("python not found or no output"); process.exit(2); }

const ts: Trace[] = [];
for (const adv of advs) {
  for (let seed = Number(from); seed < Number(to); seed++) {
    try {
      ts.push(traceOf(new Game(src, adv, { seed, mapMode: "legacy" }).run())); // engine-py has only the simplified map
    } catch (e) {
      ts.push({ adv, seed, error: String(e) });
    }
  }
}

const FIELDS = ["ended", "result", "round", "threat", "threat_max", "warnings", "unimpl", "coverage", "campaign", "group"] as const;
let same = 0;
const fails: string[] = [];
for (let i = 0; i < py.length; i++) {
  const a = py[i]!;
  const b = ts[i]!;
  const id = `adv ${a.adv} seed ${a.seed}`;
  if (a.error || b.error) {
    if (a.error && b.error) same++;
    else fails.push(`${id}: error mismatch py=${a.error ?? "-"} ts=${b.error ?? "-"}`);
    continue;
  }
  const la = a.log!;
  const lb = b.log!;
  let diff = "";
  const n = Math.min(la.length, lb.length);
  for (let k = 0; k < n && !diff; k++) {
    if (!isDeepStrictEqual(la[k], lb[k])) diff = `log[${k}] py=${JSON.stringify(la[k])} ts=${JSON.stringify(lb[k])}`;
  }
  if (!diff && la.length !== lb.length) diff = `log length py=${la.length} ts=${lb.length}`;
  for (const f of FIELDS) {
    if (diff) break;
    if (!isDeepStrictEqual(a[f] ?? null, b[f] ?? null)) diff = `${f}: py=${JSON.stringify(a[f]).slice(0, 300)} ts=${JSON.stringify(b[f]).slice(0, 300)}`;
  }
  if (diff) fails.push(`${id}: ${diff}`);
  else same++;
}
console.log(`parity: ${same}/${py.length} identical (advs=${advs.length}, seeds ${from}..${Number(to) - 1})`);
for (const f of fails.slice(0, verbose ? 200 : 10)) console.log("  ✗ " + f);
if (fails.length > 10 && !verbose) console.log(`  ... ${fails.length - 10} more (--verbose)`);
process.exit(fails.length ? 1 : 0);
