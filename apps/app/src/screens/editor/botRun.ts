// Play an edited adventure with the engine's bot (like the fuzzer, cli/fuzz-all.ts): many seeds, then what happened
// (ends, errors, warnings, actions the engine does not run, which states were reached). Runs on the main thread one
// game at a time, yielding between games so the page stays responsive.
import { cloneOrdered, Game, type ContentSource } from "@jime/engine";
import { packText } from "../../data/pack.ts";
import { parseOrdered } from "@jime/engine";

export interface BotReport {
  runs: number;
  /** result / end -> count (victory, defeat, campaign_end, max_rounds ...) */
  outcomes: Record<string, number>;
  avgRounds: number;
  errors: { seed: number; message: string }[];
  warnings: [string, number][];
  unimplemented: [string, number][];
  /** "<fsm name>\u001f<state>" reached in some run (scenario FSMs only) */
  visited: Set<string>;
  ms: number;
}

let encounters: Promise<Map<number, any | null>> | null = null;

/** Every encounter prefab of the pack (the bot may meet any of them), loaded once */
function loadEncounters(db: any): Promise<Map<number, any | null>> {
  encounters ??= (async () => {
    const ids = Object.values<any>(db.models.EncounterModel ?? {}).map((e) => Number(e._id));
    const m = new Map<number, any | null>();
    await Promise.all(ids.map(async (id) => {
      try { m.set(id, parseOrdered(await packText(`scenario/encounters/${id}.json`))); } catch { m.set(id, null); }
    }));
    return m;
  })();
  return encounters;
}

export async function runBot(db: any, advId: number, prefab: any, seeds: number, onProgress?: (done: number) => void): Promise<BotReport> {
  const t0 = performance.now();
  const enc = await loadEncounters(db);
  const src: ContentSource = {
    db: () => db,
    adventure: () => cloneOrdered(prefab),
    encounter: (id) => enc.get(Number(id)) ?? null,
  };
  const outcomes: Record<string, number> = {};
  const errors: BotReport["errors"] = [];
  const warnings = new Map<string, number>();
  const unimpl = new Map<string, number>();
  const visited = new Set<string>();
  let rounds = 0, ok = 0;
  for (let seed = 0; seed < seeds; seed++) {
    try {
      const g = new Game(src, advId, { seed }).run();
      const out = String(g.result ?? g.ended ?? "None");
      outcomes[out] = (outcomes[out] ?? 0) + 1;
      rounds += g.round;
      ok++;
      for (const [w, c] of g.warnings) { const k = String(w).split(" ").slice(0, 4).join(" "); warnings.set(k, (warnings.get(k) ?? 0) + c); }
      for (const [k, c] of g.unimpl) unimpl.set(String(k), (unimpl.get(String(k)) ?? 0) + c);
      for (const key of g.coverage.keys()) {
        const [s, fn, sn] = String(key).split("\u001f");
        if (s === "adv") visited.add(`${fn}\u001f${sn}`);
      }
    } catch (e) {
      errors.push({ seed, message: String(e).slice(0, 300) });
    }
    onProgress?.(seed + 1);
    await new Promise((r) => setTimeout(r, 0));
  }
  const top = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 12);
  return { runs: seeds, outcomes, avgRounds: rounds / Math.max(1, ok), errors, warnings: top(warnings), unimplemented: top(unimpl), visited, ms: performance.now() - t0 };
}
