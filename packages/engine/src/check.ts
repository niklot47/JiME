// Static checks of a scenario prefab for the editor: problems a script can have without running it.
//   error   - broken: a transition to a state that does not exist, no start state
//   warning - likely a mistake: two states with one name (the first one is used), a state no way leads to, an event
//             nothing sends, an action the engine does not run, a text key without text in a language
// The original adventures have some of these too (left-over states, a few odd events): compareIssues() tells the
// editor which issues an edit brought in.
import { keysOf } from "./ojson.ts";
import { scenarioFsms, type FsmGraph } from "./graph.ts";

export type IssueLevel = "error" | "warning";
export type IssueKind = "missing-state" | "duplicate-state" | "no-start" | "unreachable" | "unsent-event" | "unknown-action" | "missing-text";

export interface Issue {
  level: IssueLevel;
  kind: IssueKind;
  fsm: string;
  fsmName: string;
  state?: string;
  /** event, action name or text key the issue is about */
  detail?: string;
  /** languages without the text (missing-text) */
  langs?: string[];
}

export interface CheckOptions {
  /** action names the engine runs (ACTIONS) */
  actions?: Iterable<string>;
  /** language -> does the key have a text there (pack texts + draft) */
  hasText?: Record<string, (key: string) => boolean>;
}

/**
 * Events sent without a parameter naming them: by the actions themselves (FINISHED, the message buttons) and by the
 * game (game.ts: node clicks, tile reveals, rounds, enemies). Checked against every FFG adventure (cli/check.ts).
 */
const IMPLICIT_EVENTS = new Set(["FINISHED", "CONFIRM", "CANCEL", "TRUE", "FALSE", "SUCCESS", "FAILURE",
  "NODE CLICKED", "ADJACENT_TILE_EXPLORED", "BEFORE_UNEXHAUST", "DEFEATED", "PRE_REVEAL", "REVEALED", "ROUND_END",
  "THREAT_EVENT_START", "TRY_DEFEAT"]);

/** Every string anywhere in a value (parameters name the events actions send: isTrue, sendEvent, ...) */
function strings(v: unknown, out: Set<string>): void {
  if (typeof v === "string") out.add(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === "object") for (const k of keysOf(v)) strings((v as any)[k], out);
}

const KEY = /^«(.+)»$/;
function textKeys(v: unknown, out: Set<string>): void {
  if (typeof v === "string") { const m = KEY.exec(v); if (m) out.add(m[1]!); }
  else if (Array.isArray(v)) for (const x of v) textKeys(x, out);
  else if (v && typeof v === "object") for (const k of keysOf(v)) textKeys((v as any)[k], out);
}

/** One text key of a scenario and the places that show it */
export interface TextUse {
  key: string;
  uses: { fsm: string; fsmName: string; state: string; action: string; enabled: boolean }[];
}

/** Every text key the scenario's actions name, in the order of the file (FSM, state, action) */
export function scenarioTextKeys(prefab: any): TextUse[] {
  const out = new Map<string, TextUse>();
  for (const g of scenarioFsms(prefab)) {
    for (const s of g.states) for (const a of s.actions) {
      const keys = new Set<string>();
      textKeys(a.params, keys);
      for (const k of keys) {
        if (!out.has(k)) out.set(k, { key: k, uses: [] });
        out.get(k)!.uses.push({ fsm: g.index, fsmName: g.owner ?? g.name, state: s.name, action: a.action, enabled: a.enabled });
      }
    }
  }
  return [...out.values()];
}

export function checkScenario(prefab: any, opts: CheckOptions = {}): Issue[] {
  const issues: Issue[] = [];
  const known = opts.actions ? new Set(opts.actions) : null;
  // events named anywhere in the scenario (an action of another state or FSM may send them: SendEventByName ...)
  const named = new Set<string>();
  strings(prefab.fsms ?? {}, named);
  const fsms = scenarioFsms(prefab);
  const raw = prefab.fsms ?? {};
  for (const g of fsms) {
    const at = (state?: string, detail?: string) => ({ fsm: g.index, fsmName: g.owner ?? g.name, ...(state !== undefined ? { state } : {}), ...(detail !== undefined ? { detail } : {}) });
    const names = new Map<string, number>();
    for (const s of g.states) names.set(s.name, (names.get(s.name) ?? 0) + 1);
    for (const [n, c] of names) if (c > 1) issues.push({ level: "warning", kind: "duplicate-state", ...at(n) });
    if (!g.states.some((s) => s.start) && g.states.length) issues.push({ level: "error", kind: "no-start", ...at(undefined, String(raw[g.index]?.start ?? "")) });
    for (const e of g.edges) if (!names.has(e.to)) issues.push({ level: "error", kind: "missing-state", ...at(e.from, `${e.event} → ${e.to}`) });
    // reachability from the start and the global events
    const seen = new Set<string>();
    const queue = g.states.filter((s) => s.start || s.entries.length).map((s) => s.name);
    for (const q of queue) seen.add(q);
    const out = new Map<string, string[]>();
    for (const e of g.edges) { if (!out.has(e.from)) out.set(e.from, []); out.get(e.from)!.push(e.to); }
    while (queue.length) for (const t of out.get(queue.shift()!) ?? []) if (!seen.has(t)) { seen.add(t); queue.push(t); }
    for (const s of g.states) if (!seen.has(s.name)) issues.push({ level: "warning", kind: "unreachable", ...at(s.name) });
    // transition events nobody sends
    for (const e of g.edges) {
      if (IMPLICIT_EVENTS.has(e.event) || /^\d+$/.test(e.event) || named.has(e.event)) continue;
      issues.push({ level: "warning", kind: "unsent-event", ...at(e.from, e.event) });
    }
    for (const s of g.states) for (const a of s.actions) {
      if (known && a.enabled && !known.has(a.action)) issues.push({ level: "warning", kind: "unknown-action", ...at(s.name, a.action) });
    }
    // texts
    if (opts.hasText) {
      for (const s of g.states) {
        const keys = new Set<string>();
        for (const a of s.actions) if (a.enabled) textKeys(a.params, keys);
        for (const k of keys) {
          const langs = Object.entries(opts.hasText).filter(([, has]) => !has(k)).map(([l]) => l);
          if (langs.length) issues.push({ level: "warning", kind: "missing-text", ...at(s.name, k), langs });
        }
      }
    }
  }
  return issues;
}

/** A stable identity of an issue (to compare a scenario with its original) */
export const issueId = (i: Issue): string => [i.kind, i.fsm, i.state ?? "", i.detail ?? "", (i.langs ?? []).join(",")].join("\u001f");

/** The issues of `now` that `before` (the original scenario) did not have */
export function newIssues(now: Issue[], before: Issue[]): Issue[] {
  const old = new Set(before.map(issueId));
  return now.filter((i) => !old.has(issueId(i)));
}

/** Issues of one FSM state, for marking graph nodes */
export const issuesByState = (issues: Issue[], g: FsmGraph): Map<string, Issue[]> => {
  const m = new Map<string, Issue[]>();
  for (const i of issues) if (i.fsm === g.index && i.state !== undefined) { if (!m.has(i.state)) m.set(i.state, []); m.get(i.state)!.push(i); }
  return m;
};
