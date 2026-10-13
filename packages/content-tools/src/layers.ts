// Pack layering without file access (browser-safe): which packs are active and in what order.
// Order: dependencies first, then ascending priority, then id; later layers override earlier ones.
// Unlike resolvePacks() (CLI: throws), problems are reported per pack and the rest still loads.
import { satisfies } from "./semver.ts";

export interface PackRef {
  /** Folder name inside the packs folder */
  dir: string;
  /** pack.json content (null: missing or unreadable) */
  manifest: any | null;
}

export interface LayerProblem {
  dir: string;
  error: string;
}

export interface LayerResult {
  layers: PackRef[];
  problems: LayerProblem[];
  /** Folders turned off by the user */
  disabled: string[];
}

const ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
const TYPES = new Set(["scenario", "lang", "voice", "theme", "models", "rules"]);

/** Light structural check of pack.json (the full JSON Schema check is the CLI's packs:validate) */
export function checkManifest(m: any): string | null {
  if (!m || typeof m !== "object") return "нет pack.json";
  if (m.formatVersion !== 1) return `неподдерживаемый formatVersion ${m.formatVersion}`;
  if (typeof m.id !== "string" || !ID.test(m.id)) return `некорректный id ${JSON.stringify(m.id)}`;
  if (typeof m.version !== "string" || !/^\d+\.\d+\.\d+/.test(m.version)) return `некорректная версия ${JSON.stringify(m.version)}`;
  if (typeof m.priority !== "number") return "нет priority";
  if (!Array.isArray(m.contents)) return "нет contents";
  for (const c of m.contents) {
    if (!c || !TYPES.has(c.type)) return `неизвестный тип содержимого ${JSON.stringify(c?.type)}`;
    if (typeof c.path !== "string" || c.path.startsWith("/") || c.path.split(/[\\/]/).includes("..")) return `некорректный path ${JSON.stringify(c?.path)}`;
    if ((c.type === "lang" || c.type === "voice") && typeof c.lang !== "string") return `${c.type} без lang`;
  }
  return null;
}

export function orderLayers(packs: PackRef[], disabledDirs: Iterable<string> = []): LayerResult {
  const off = new Set(disabledDirs);
  const problems: LayerProblem[] = [];
  const disabled: string[] = [];
  const byId = new Map<string, PackRef>();
  for (const p of [...packs].sort((a, b) => a.dir.localeCompare(b.dir))) {
    const err = checkManifest(p.manifest);
    if (err) { problems.push({ dir: p.dir, error: err }); continue; }
    if (off.has(p.dir)) { disabled.push(p.dir); continue; }
    if (byId.has(p.manifest.id)) { problems.push({ dir: p.dir, error: `id ${p.manifest.id} уже занят папкой ${byId.get(p.manifest.id)!.dir}` }); continue; }
    byId.set(p.manifest.id, p);
  }
  // drop packs with missing or incompatible dependencies, repeatedly (dropping one can break another)
  for (let changed = true; changed;) {
    changed = false;
    for (const [id, p] of byId) {
      for (const [dep, range] of Object.entries<string>(p.manifest.dependencies ?? {})) {
        const d = byId.get(dep);
        const why = !d ? `нужен пак ${dep}` : !satisfies(d.manifest.version, range) ? `нужен ${dep}@${range}, есть ${d.manifest.version}` : null;
        if (why) { problems.push({ dir: p.dir, error: why }); byId.delete(id); changed = true; break; }
      }
    }
  }
  // Kahn's algorithm; among ready packs the lowest priority, then id
  const indeg = new Map<string, number>();
  const users = new Map<string, string[]>();
  for (const [id, p] of byId) {
    const deps = Object.keys(p.manifest.dependencies ?? {});
    indeg.set(id, deps.length);
    for (const d of deps) users.set(d, [...(users.get(d) ?? []), id]);
  }
  const cmp = (a: string, b: string) => byId.get(a)!.manifest.priority - byId.get(b)!.manifest.priority || a.localeCompare(b);
  const ready = [...indeg].filter(([, n]) => n === 0).map(([id]) => id);
  const layers: PackRef[] = [];
  while (ready.length) {
    ready.sort(cmp);
    const id = ready.shift()!;
    layers.push(byId.get(id)!);
    for (const u of users.get(id) ?? []) {
      indeg.set(u, indeg.get(u)! - 1);
      if (indeg.get(u) === 0) ready.push(u);
    }
  }
  for (const [id, n] of indeg) if (n > 0) problems.push({ dir: byId.get(id)!.dir, error: "циклическая зависимость" });
  return { layers, problems, disabled };
}

/** Languages provided by the layers (lang contents), in first-seen order */
export function layerLangs(layers: PackRef[]): string[] {
  const out: string[] = [];
  for (const p of layers) for (const c of p.manifest.contents) if (c.type === "lang" && !out.includes(c.lang)) out.push(c.lang);
  return out;
}
