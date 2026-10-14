// Comparable summary of a finished game (same shape as engine-py/trace.py output)
import type { Game } from "./game.ts";

export interface Trace {
  adv: number;
  seed: number;
  error?: string;
  log?: [number, number, string, string[]][];
  ended?: string | null;
  result?: string | null;
  round?: number;
  threat?: unknown;
  threat_max?: number;
  warnings?: Record<string, number>;
  unimpl?: Record<string, number>;
  coverage?: Record<string, number>;
  campaign?: Record<string, unknown>;
  group?: unknown;
}

export function traceOf(g: Game): Trace {
  const c = g.campaign;
  return {
    adv: g.advId, seed: g.seed, log: g.log.map((e) => [e[0], e[1], e[2], e[3]] as [number, number, string, string[]]), ended: g.ended, result: g.result, round: g.round,
    threat: g.globals.Threat, threat_max: g.threatMax,
    warnings: g.warnings.toObject(), unimpl: g.unimpl.toObject(), coverage: g.coverage.toObject(),
    campaign: { next_adventure: c.next_adventure, lore: c.lore, xp: c.xp, items: c.items, titles: c.titles, result: c.result },
    group: g.encounterGroup,
  };
}
