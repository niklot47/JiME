// Auto-play a Session like a careful human (attacks enemies, clicks tokens, passes tests) and print the story as the
// players would read it: a quick way to see where an adventure stalls or reads wrong.
// Usage: node cli/autoplay.ts <adv> [seed] [maxAnswers=400] [--lang ru]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseLangCsv, TextDb } from "@jime/content-tools";
import { Session, type Answer, type Decision } from "../src/session.ts";
import { PackDirSource, defaultPackDir } from "../src/node/packSource.ts";

const args = process.argv.slice(2);
const li = args.indexOf("--lang");
const lang = li >= 0 ? args.splice(li, 2)[1]! : "ru";
const [advArg = "2", seedArg = "1", maxArg = "400"] = args;
const packDir = defaultPackDir();
const src = new PackDirSource(packDir);
const text = new TextDb(parseLangCsv(readFileSync(join(packDir, "lang", `${lang}.csv`), "utf8")));
const say = (k: string | null, ins: readonly string[] = []) => (k ? text.format(k, ins).replace(/\s+/g, " ").slice(0, 160) : "");
let seedRnd = Number(seedArg) * 9301 + 49297;
const rnd = () => ((seedRnd = (seedRnd * 9301 + 49297) % 233280) / 233280);

const s = new Session(src, { adv: Number(advArg), seed: Number(seedArg), players: 2 });
let shown = 0;
const counts: Record<string, number> = {};
const answerFor = (d: Decision): Answer => {
  counts[d.kind] = (counts[d.kind] ?? 0) + 1;
  switch (d.kind) {
    case "action": {
      const atk = d.options.findIndex((o) => o.type === "attack");
      const node = d.options.findIndex((o) => o.type === "node" && o.kind !== "Terrain");
      if (atk >= 0 && rnd() < 0.6) return atk;
      if (node >= 0 && rnd() < 0.6) return node;
      return null;
    }
    case "choice": return Math.floor(rnd() * d.choices.length);
    case "test": return Math.floor(rnd() * (d.top + 2));
    case "confirm": return rnd() < 0.6;
    case "hero": return { player: 0, skip: false };
    case "attack": return 2 + Math.floor(rnd() * 4);
    case "lastStand": return rnd() < 0.7;
    case "lastStandType": return true;
  }
};
for (let i = 0; i < Number(maxArg) && s.status === "waiting"; i++) {
  for (; shown < s.log.length; shown++) {
    const [, r, k, ins, meta] = s.log[shown]!;
    if (!meta?.log) console.log(`[r${r}] ${say(k, ins) || k}`);
  }
  const d = s.pending!;
  const a = answerFor(d);
  const label = d.kind === "action" ? (a === null ? "end round" : JSON.stringify(d.options[a as number])) : d.kind === "choice" ? `#${a} ${say(d.choices[a as number]?.key ?? null)}` : JSON.stringify(a);
  console.log(`  >> ${d.kind}: ${label.slice(0, 140)}`);
  s.answer(a);
}
for (; shown < s.log.length; shown++) { const [, r, k, ins] = s.log[shown]!; console.log(`[r${r}] ${say(k, ins) || k}`); }
const v = s.view();
console.log("END", s.status, v.ended, v.result, "round", v.round, counts, "warnings", JSON.stringify([...(s as any).game?.warnings ?? []]).slice(0, 400));
