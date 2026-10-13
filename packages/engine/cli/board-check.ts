// Pre-generated board path (what the browser app does): sessionBoard() -> load only boardEncounters() ->
// Session with opts.board. The game must be identical to a normal run, and must not need other encounters.
// Also prints which token types the visible nodes use.  Usage: node cli/board-check.ts [seeds=2]
import { isDeepStrictEqual } from "node:util";
import { Session, recordBotGame, sessionBoard } from "../src/session.ts";
import { TOKEN_TYPES, boardEncounters, type ContentSource } from "../src/game.ts";
import { traceOf } from "../src/trace.ts";
import { keysOf } from "../src/ojson.ts";
import { Counter } from "../src/py.ts";
import { PackDirSource, defaultPackDir } from "../src/node/packSource.ts";

const seeds = Number(process.argv[2] ?? 2);
const disk = new PackDirSource(defaultPackDir());
const AM = disk.db().models.AdventureModel;
const advs = keysOf(AM).filter((k) => AM[k]?.Prefab?.Path).map(Number).sort((a, b) => a - b);
let ok = 0, total = 0, boards = 0, encs = 0;
const fails: string[] = [];
const tokens = new Counter();
const t0 = Date.now();
for (const adv of advs) {
  for (let seed = 0; seed < seeds; seed++) {
    total++;
    const id = `adv ${adv} seed ${seed}`;
    const setup = { adv, seed };
    try {
      const { game, answers } = recordBotGame(disk, setup);
      const board = sessionBoard(disk, setup);
      // a source that only knows the board's encounters, like a client that preloaded them
      const allowed = new Set(board ? boardEncounters(board) : []);
      const strict: ContentSource = {
        db: () => disk.db(),
        adventure: (a) => disk.adventure(a),
        encounter: (e) => { if (!allowed.has(e)) throw new Error(`encounter ${e} not preloaded`); return disk.encounter(e); },
      };
      if (board) { boards++; encs += allowed.size; }
      const s = new Session(strict, setup, answers, { board });
      if (!isDeepStrictEqual({ ...traceOf(game), coverage: 0 }, { ...traceOf(s.game), coverage: 0 })) { fails.push(`${id}: differs`); continue; }
      if (board && !isDeepStrictEqual(board.spawnOrder, game.board?.spawnOrder)) { fails.push(`${id}: board differs`); continue; }
      for (const n of s.view().nodes) if (n.visible) tokens.inc(`${n.kind}/${TOKEN_TYPES[n.token] ?? n.token}`);
      ok++;
    } catch (e) {
      fails.push(`${id}: ${e instanceof Error ? e.message : e}`);
    }
  }
}
console.log(`board: ${ok}/${total} ok, ${boards} generated boards, avg ${(encs / Math.max(1, boards)).toFixed(1)} encounters to preload, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log("visible nodes at game end (kind/token):", [...tokens.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} ${v}`).join(", "));
for (const f of fails.slice(0, 10)) console.log("  ✗ " + f);
process.exit(fails.length ? 1 : 0);
