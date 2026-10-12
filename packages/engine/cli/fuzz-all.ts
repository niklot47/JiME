// Run every adventure with several seeds; summarize robustness and adventure-FSM coverage.
// Usage: node cli/fuzz-all.ts [seeds=10]   (TS port of engine-py/fuzz_all.py)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Game } from "../src/game.ts";
import { Counter } from "../src/py.ts";
import { keysOf } from "../src/ojson.ts";
import { PackDirSource, defaultPackDir } from "../src/node/packSource.ts";

const n = Number(process.argv[2] ?? 10);
const src = new PackDirSource(defaultPackDir());
const AM = src.db().models.AdventureModel;
const unimpl = new Counter();
const warns = new Counter();
const errs = new Counter();
const rows: [number, string, number, Record<string, number>, number, number, number][] = [];

for (const aid of keysOf(AM).map(Number).sort((a, b) => a - b)) {
  const am = AM[aid];
  if (!am?.Prefab?.Path) continue;
  const A = src.adventure(aid);
  const states = new Set<string>(A.fsms.flatMap((f: any) => f.states.map((s: any) => `${f.name}\u001f${s.name}`)));
  const hit = new Set<string>();
  const out = new Counter();
  let rounds = 0;
  let ok = 0;
  let err = 0;
  for (let seed = 0; seed < n; seed++) {
    try {
      const g = new Game(src, aid, { seed }).run();
      out.inc(g.result ?? g.ended ?? "None");
      rounds += g.round;
      ok++;
      for (const [k, v] of g.unimpl) unimpl.inc(k, v);
      for (const [w, c] of g.warnings) warns.inc(w.split(" ").slice(0, 3).join(" "), c);
      for (const key of g.coverage.keys()) {
        const [s, fn, sn] = key.split("\u001f");
        if (s === "adv") hit.add(`${fn}\u001f${sn}`);
      }
    } catch (e) {
      err++;
      errs.inc(String(e).slice(0, 100));
    }
  }
  const cov = [...states].filter((s) => hit.has(s)).length / Math.max(1, states.size);
  rows.push([aid, am.m_Name, am.Type ?? 0, out.toObject(), err, rounds / Math.max(1, ok), cov]);
}

console.log(`${"id".padStart(4)} ${"type".padStart(4)} ${"cov".padStart(5)} ${"avgR".padStart(5)} err  outcomes  name`);
for (const r of rows) {
  console.log(`${String(r[0]).padStart(4)} ${String(r[2]).padStart(4)} ${(r[6] * 100).toFixed(0).padStart(4)}% ${r[5].toFixed(1).padStart(5)} ${String(r[4]).padStart(3)}  ${JSON.stringify(r[3])}  ${r[1]}`);
}
const top = (c: Counter, k: number) => Object.fromEntries([...c].sort((a, b) => b[1] - a[1]).slice(0, k));
const avgCov = rows.reduce((s, r) => s + r[6], 0) / Math.max(1, rows.length);
console.log(`\nadventures: ${rows.length}, runs: ${rows.length * n}, errors: ${rows.reduce((s, r) => s + r[4], 0)}, avg coverage: ${(avgCov * 100).toFixed(1)}%`);
console.log("unimplemented:", top(unimpl, 50));
console.log("errors:", top(errs, 10));
console.log("warnings:", top(warns, 15));
const outFile = join(dirname(dirname(src.packDir)), "out", "fuzz_all_ts.json");
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(rows));
process.exit(rows.some((r) => r[4] > 0) ? 1 : 0);
