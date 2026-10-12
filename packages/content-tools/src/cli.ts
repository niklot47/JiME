#!/usr/bin/env node
// jime-packs: validate packs in a directory.  Usage: node src/cli.ts validate [packsRoot]
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { validateDb, validateScenario } from "@jime/schema";
import { discoverPacks, resolvePacks } from "./packs.ts";
import { parseLangCsv } from "./csv.ts";

const repoRoot = resolve(import.meta.dirname, "../../..");
const defaultRoot = process.env.JIME_PACKS ?? join(process.env.JIME_WORK ?? join(repoRoot, "data"), "packs");

function validateScenarioDir(dir: string): { files: number; errors: string[] } {
  const errors: string[] = [];
  let files = 0;
  const check = (f: string, fn: (d: unknown) => { ok: boolean; errors: string[] }) => {
    files++;
    const r = fn(JSON.parse(readFileSync(f, "utf8")));
    if (!r.ok) errors.push(`${f}: ${r.errors.slice(0, 3).join("; ")}`);
  };
  if (existsSync(join(dir, "db.json"))) check(join(dir, "db.json"), validateDb);
  for (const sub of ["adventures", "encounters"]) {
    const d = join(dir, sub);
    if (!existsSync(d)) continue;
    for (const n of readdirSync(d).filter((n) => n.endsWith(".json"))) check(join(d, n), validateScenario);
  }
  return { files, errors };
}

function cmdValidate(root: string): number {
  console.log(`packs root: ${root}`);
  const packs = discoverPacks(root);
  if (!packs.length) { console.log("no packs found"); return 1; }
  const layers = resolvePacks(packs);
  console.log(`layer order: ${layers.map((p) => `${p.manifest.id}@${p.manifest.version}(p${p.manifest.priority})`).join(" -> ")}`);
  let bad = 0;
  for (const p of layers) {
    for (const c of p.manifest.contents) {
      const path = join(p.dir, c.path);
      if (!existsSync(path)) { console.log(`  ✗ ${p.manifest.id}: missing ${c.path}`); bad++; continue; }
      if (c.type === "scenario" && statSync(path).isDirectory()) {
        const r = validateScenarioDir(path);
        console.log(`  ${r.errors.length ? "✗" : "✓"} ${p.manifest.id} scenario: ${r.files} files, ${r.errors.length} invalid`);
        r.errors.slice(0, 10).forEach((e) => console.log(`      ${e}`));
        bad += r.errors.length;
      } else if (c.type === "lang") {
        const n = parseLangCsv(readFileSync(path, "utf8")).size;
        console.log(`  ✓ ${p.manifest.id} lang ${c.lang}: ${n} keys`);
      } else console.log(`  · ${p.manifest.id} ${c.type}: ${c.path} (not validated yet)`);
    }
  }
  console.log(bad ? `FAILED: ${bad} problems` : "OK");
  return bad ? 1 : 0;
}

const [cmd = "validate", arg] = process.argv.slice(2);
if (cmd === "validate") process.exit(cmdValidate(resolve(arg ?? defaultRoot)));
console.error(`unknown command: ${cmd}`);
process.exit(2);
