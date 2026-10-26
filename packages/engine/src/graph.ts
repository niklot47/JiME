// Static views of scenarios for the editor (no game is run): an adventure's PlayMaker FSMs as graphs of states, and a
// campaign as a graph of adventures. The campaign links come from the adventures' own scripts: SetNextAdventure /
// AddAlternativeAdventure / EndCampaign, with the way the FSM gets there (which end of the adventure, which choices).

export interface FsmAction {
  action: string;
  enabled: boolean;
  params: Record<string, unknown>;
}

export interface FsmStateNode {
  name: string;
  actions: FsmAction[];
  /** the FSM's start state */
  start: boolean;
  /** global events that jump straight here (FsmTemplate globalTransitions) */
  entries: string[];
}

export interface FsmEdge {
  from: string;
  to: string;
  event: string;
}

export interface FsmGraph {
  /** key in the adventure's `fsms` */
  index: string;
  name: string;
  /** game object that owns the FSM ("1_Bandit Hunt", "Kill Dudes (Enemy Logic)") */
  owner: string | null;
  states: FsmStateNode[];
  edges: FsmEdge[];
}

/** One step of a path through an FSM: in `state`, the transition taken by `event` */
export interface PathStep {
  state: string;
  event: string;
}

export interface FsmPath {
  /** "start" (the start state) or the global event the path begins with */
  entry: string;
  steps: PathStep[];
}

const isObj = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);

export function fsmGraph(index: string, fsm: any, owner: string | null = null): FsmGraph {
  const entries = new Map<string, string[]>();
  for (const [ev, st] of Object.entries<string>(fsm.global ?? {})) {
    if (!entries.has(st)) entries.set(st, []);
    entries.get(st)!.push(ev);
  }
  const states: FsmStateNode[] = [];
  const edges: FsmEdge[] = [];
  for (const s of fsm.states ?? []) {
    states.push({
      name: s.name,
      actions: (s.actions ?? []).map((a: any) => ({ action: a.action, enabled: a.enabled !== false, params: isObj(a.params) ? a.params : {} })),
      start: s.name === fsm.start,
      entries: entries.get(s.name) ?? [],
    });
    for (const [event, to] of Object.entries<string>(s.transitions ?? {})) edges.push({ from: s.name, to, event });
  }
  return { index, name: fsm.name ?? `FSM ${index}`, owner, states, edges };
}

/** Every FSM of an adventure (or encounter) prefab, with the game object that owns it */
export function scenarioFsms(prefab: any): FsmGraph[] {
  const owners = new Map<string, string>();
  for (const go of Object.values<any>(prefab.gameObjects ?? {})) {
    for (const i of go.components?.PlayMakerFSM ?? []) owners.set(String(i), go.name);
  }
  return Object.entries<any>(prefab.fsms ?? {}).map(([i, f]) => fsmGraph(i, f, owners.get(i) ?? null));
}

/**
 * Shortest ways into `target`: one from the start state and one from each global event that reaches it
 * (breadth-first over the transitions; a path stops at the target)
 */
export function pathsTo(g: FsmGraph, target: string): FsmPath[] {
  const out = new Map<string, FsmEdge[]>();
  for (const e of g.edges) {
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from)!.push(e);
  }
  const search = (from: string): PathStep[] | null => {
    if (from === target) return [];
    const prev = new Map<string, FsmEdge>();
    const seen = new Set([from]);
    let front = [from];
    while (front.length) {
      const next: string[] = [];
      for (const s of front) {
        for (const e of out.get(s) ?? []) {
          if (seen.has(e.to)) continue;
          seen.add(e.to);
          prev.set(e.to, e);
          if (e.to === target) {
            const steps: PathStep[] = [];
            for (let at = target; at !== from;) { const p = prev.get(at)!; steps.unshift({ state: p.from, event: p.event }); at = p.from; }
            return steps;
          }
          next.push(e.to);
        }
      }
      front = next;
    }
    return null;
  };
  const res: FsmPath[] = [];
  const start = g.states.find((s) => s.start);
  if (start) { const p = search(start.name); if (p) res.push({ entry: "start", steps: p }); }
  for (const s of g.states) {
    for (const ev of s.entries) { const p = search(s.name); if (p) res.push({ entry: ev, steps: p }); }
  }
  return res.sort((a, b) => a.steps.length - b.steps.length);
}

/** States with more than one way out: where a path makes a choice */
export function branchStates(g: FsmGraph): Set<string> {
  const n = new Map<string, number>();
  for (const e of g.edges) n.set(e.from, (n.get(e.from) ?? 0) + 1);
  return new Set([...n].filter(([, k]) => k > 1).map(([s]) => s));
}

// ---------------------------------------------------------------- campaigns

export interface CampaignAdventure {
  id: number;
  /** AdventureModel.m_Name ("1_Bandit Hunt") */
  name: string;
  nameKey: string | null;
  locationKey: string | null;
  /** LocationArt path in the original's assets */
  art: string | null;
  /** position in CampaignModel.Adventures; -1 for an adventure the scripts reach from outside that list */
  order: number;
}

export type LinkKind = "next" | "alternative" | "end";
/** which end of the adventure leads there (ADVENTURE_END_VICTORY / _FAILURE), "both", or "other" (another event) */
export type LinkOutcome = "victory" | "failure" | "both" | "other";

export interface CampaignLink {
  from: number;
  /** the next / alternative adventure; null for the end of the campaign */
  to: number | null;
  kind: LinkKind;
  /** EndCampaign: won or lost */
  campaignWon?: boolean;
  outcome: LinkOutcome;
  /** where in the script: FSM index / name and state */
  fsm: string;
  fsmName: string;
  state: string;
  /** how the FSM gets there (shortest path per entry) */
  paths: FsmPath[];
}

export interface CampaignGraph {
  id: number;
  name: string;
  titleKey: string | null;
  adventures: CampaignAdventure[];
  links: CampaignLink[];
  /** adventure ids whose prefab could not be read */
  missing: number[];
}

const refId = (v: any): number | null => (isObj(v) && v.id !== undefined ? Number(v.id) : typeof v === "number" ? v : null);
const truthy = (v: unknown) => v !== undefined && v !== null && v !== 0 && v !== "" && v !== false;

function outcomeOf(paths: FsmPath[]): LinkOutcome {
  const v = paths.some((p) => p.entry === "ADVENTURE_END_VICTORY");
  const f = paths.some((p) => p.entry === "ADVENTURE_END_FAILURE");
  return v && f ? "both" : v ? "victory" : f ? "failure" : "other";
}

/** The campaign links one adventure's scripts make */
export function adventureLinks(advId: number, prefab: any): CampaignLink[] {
  const links: CampaignLink[] = [];
  for (const g of scenarioFsms(prefab)) {
    for (const s of g.states) {
      for (const a of s.actions) {
        if (!a.enabled) continue;
        let kind: LinkKind | null = null, to: number | null = null, won: boolean | undefined;
        if (a.action === "SetNextAdventure") { kind = "next"; to = refId(a.params.Adventure); }
        else if (a.action === "AddAlternativeAdventure") { kind = "alternative"; to = refId(a.params.Adventure); }
        else if (a.action === "EndCampaign") { kind = "end"; won = truthy(a.params.Victory); }
        if (!kind || (kind !== "end" && to === null)) continue;
        const paths = pathsTo(g, s.name);
        links.push({ from: advId, to, kind, ...(won !== undefined ? { campaignWon: won } : {}), outcome: outcomeOf(paths),
          fsm: g.index, fsmName: g.name, state: s.name, paths });
      }
    }
  }
  return links;
}

/**
 * A campaign as a graph: its adventures (CampaignModel order) plus any the scripts lead to, and the links between them.
 * `adventure(id)` returns the adventure prefab (scenario/adventures/<id>.json) or null.
 */
export function campaignGraph(D: any, campaignId: number, adventure: (id: number) => any | null): CampaignGraph {
  const cm = Object.values<any>(D.models.CampaignModel).find((c) => Number(c._id) === campaignId);
  if (!cm) throw new Error(`no campaign ${campaignId}`);
  const am = D.models.AdventureModel as Record<string, any>;
  const byId = new Map(Object.values<any>(am).map((a) => [Number(a._id), a]));
  const advOf = (id: number, order: number): CampaignAdventure => {
    const m = byId.get(id);
    return { id, name: m?.m_Name ?? `#${id}`, nameKey: m?.NameKey ?? null, locationKey: m?.LocationKey ?? null,
      art: m?.LocationArt?.Path ?? null, order };
  };
  const adventures = (cm.Adventures ?? []).map((r: any, i: number) => advOf(Number(r.id), i));
  const links: CampaignLink[] = [];
  const missing: number[] = [];
  const done = new Set<number>();
  const queue = adventures.map((a: CampaignAdventure) => a.id);
  while (queue.length) {
    const id = queue.shift()!;
    if (done.has(id)) continue;
    done.add(id);
    const prefab = adventure(id);
    if (!prefab) { missing.push(id); continue; }
    for (const l of adventureLinks(id, prefab)) {
      links.push(l);
      if (l.to !== null && !adventures.some((a: CampaignAdventure) => a.id === l.to)) {
        adventures.push(advOf(l.to, -1));
        queue.push(l.to);
      }
    }
  }
  return { id: campaignId, name: cm.m_Name, titleKey: cm.TitleKey ?? null, adventures, links, missing };
}
