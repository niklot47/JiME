// Catalog of FSM actions for the editor: which actions exist and what parameters they take, learned from the
// scenarios themselves (every adventure of the pack is scanned once), plus whether the engine runs them.
import { ACTIONS, cloneOrdered } from "@jime/engine";
import { loadAdventure } from "../../data/pack.ts";
import { keyIn } from "./text.ts";

export type ParamKind = "text" | "number" | "boolean" | "string" | "variable" | "model" | "object" | "other";

export interface ParamInfo {
  name: string;
  /** how many of the action's uses have it */
  uses: number;
  kinds: Partial<Record<ParamKind, number>>;
  /** an example value (the most common kind) */
  example: unknown;
}

export interface ActionInfo {
  name: string;
  uses: number;
  /** in how many adventures */
  adventures: number;
  params: ParamInfo[];
  /** the engine has a handler for it */
  supported: boolean;
}

export function paramKind(v: unknown): ParamKind {
  if (keyIn(v)) return "text";
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "string") return v.startsWith("@") ? "variable" : "string";
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if (o.ref === "go" || (o.go !== undefined && !o.ref)) return "object";
    if (typeof o.ref === "string" && o.id !== undefined) return "model";
  }
  return "other";
}

export const KIND_NAME: Record<ParamKind, string> = {
  text: "текст", number: "число", boolean: "да/нет", string: "строка", variable: "переменная", model: "ссылка на модель", object: "объект сцены", other: "другое",
};

let catalog: Promise<Map<string, ActionInfo>> | null = null;

/** Scan every adventure of the db once (cached for the session) */
export function loadActionCatalog(db: any): Promise<Map<string, ActionInfo>> {
  catalog ??= (async () => {
    const ids = Object.values<any>(db.models.AdventureModel).map((a) => Number(a._id));
    const prefabs = await Promise.all(ids.map((id) => loadAdventure(id).catch(() => null)));
    const acc = new Map<string, { uses: number; advs: Set<number>; params: Map<string, { uses: number; kinds: Map<ParamKind, number>; ex: Map<ParamKind, unknown> }> }>();
    prefabs.forEach((p, i) => {
      if (!p) return;
      for (const f of Object.values<any>(p.fsms ?? {})) for (const s of f.states ?? []) for (const a of s.actions ?? []) {
        let e = acc.get(a.action);
        if (!e) acc.set(a.action, e = { uses: 0, advs: new Set(), params: new Map() });
        e.uses++;
        e.advs.add(ids[i]!);
        for (const [k, v] of Object.entries<unknown>(a.params ?? {})) {
          let q = e.params.get(k);
          if (!q) e.params.set(k, q = { uses: 0, kinds: new Map(), ex: new Map() });
          q.uses++;
          const kind = paramKind(v);
          q.kinds.set(kind, (q.kinds.get(kind) ?? 0) + 1);
          if (!q.ex.has(kind)) q.ex.set(kind, v);
        }
      }
    });
    const out = new Map<string, ActionInfo>();
    const names = new Set([...acc.keys(), ...Object.keys(ACTIONS)]);
    for (const name of names) {
      const e = acc.get(name);
      const params: ParamInfo[] = e ? [...e.params].map(([pn, q]) => {
        const top = [...q.kinds].sort((a, b) => b[1] - a[1])[0]![0];
        return { name: pn, uses: q.uses, kinds: Object.fromEntries(q.kinds), example: q.ex.get(top) };
      }).sort((a, b) => b.uses - a.uses) : [];
      out.set(name, { name, uses: e?.uses ?? 0, adventures: e?.advs.size ?? 0, params, supported: name in ACTIONS });
    }
    return out;
  })();
  return catalog;
}

/**
 * A new action from the catalog: the parameters its uses mostly have, with neutral values of their kind
 * (text: a fresh key from newKey(); references: the example, so the list editor knows the model)
 */
export function newAction(info: ActionInfo, newKey: () => string): { action: string; enabled: boolean; params: Record<string, unknown> } {
  const params: Record<string, unknown> = {};
  for (const p of info.params) {
    if (p.uses * 2 < info.uses) continue; // a parameter only some uses set
    const kind = paramKind(p.example);
    params[p.name] = kind === "text" ? `«${newKey()}»` : kind === "number" ? 0 : kind === "boolean" ? false : kind === "string" ? ""
      : kind === "variable" ? "@" : cloneOrdered(p.example);
  }
  return { action: info.name, enabled: true, params };
}
