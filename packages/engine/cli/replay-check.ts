// Bot games recorded as answers, then replayed through Session: traces must be identical.
// Also checks save/load round trip and undo at random points.  Usage: node cli/replay-check.ts [seeds=3]
import { isDeepStrictEqual } from "node:util";
import { Session, recordBotGame } from "../src/session.ts";
import { traceOf } from "../src/trace.ts";
import { keysOf } from "../src/ojson.ts";
import { PackDirSource, defaultPackDir } from "../src/node/packSource.ts";

const seeds = Number(process.argv[2] ?? 3);
const src = new PackDirSource(defaultPackDir());
const AM = src.db().models.AdventureModel;
const advs = keysOf(AM).filter((k) => AM[k]?.Prefab?.Path).map(Number).sort((a, b) => a - b);
let ok = 0, total = 0, decisions = 0, maxDecisions = 0;
const fails: string[] = [];
const t0 = Date.now();
for (const adv of advs) {
  for (let seed = 0; seed < seeds; seed++) {
    total++;
    const setup = { adv, seed };
    const { game, answers } = recordBotGame(src, setup);
    decisions += answers.length;
    maxDecisions = Math.max(maxDecisions, answers.length);
    const a = traceOf(game);
    const s = new Session(src, setup, answers);
    const b = traceOf(s.game);
    const id = `adv ${adv} seed ${seed}`;
    if (s.status !== "ended") { fails.push(`${id}: still waiting for ${s.pending?.kind}`); continue; }
    if (!isDeepStrictEqual({ ...a, coverage: 0 }, { ...b, coverage: 0 })) { fails.push(`${id}: replay differs`); continue; }
    // save/load + undo: cut at a random point, check the pending decision, then re-answer
    const cut = Math.floor(answers.length / 2);
    const loaded = Session.load(src, JSON.parse(JSON.stringify(new Session(src, setup, answers.slice(0, cut)).save())));
    if (loaded.status !== "waiting" && cut < answers.length) { fails.push(`${id}: no pending decision at ${cut}`); continue; }
    for (const ans of answers.slice(cut)) loaded.answer(ans);
    loaded.undo(1);
    loaded.answer(answers[answers.length - 1] ?? null);
    if (!isDeepStrictEqual(traceOf(loaded.game).log, a.log)) { fails.push(`${id}: load/answer/undo differs`); continue; }
    ok++;
  }
}
console.log(`replay: ${ok}/${total} ok, decisions per game avg ${(decisions / total).toFixed(0)} max ${maxDecisions}, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
for (const f of fails.slice(0, 10)) console.log("  ✗ " + f);
process.exit(fails.length ? 1 : 0);
