// Pack discovery, dependency resolution and layering
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { validatePack, type ContentType, type PackManifest } from "@jime/schema";
import { satisfies } from "./semver.ts";
import { parseLangCsv } from "./csv.ts";

export interface LoadedPack {
  dir: string;
  manifest: PackManifest;
}

export class PackError extends Error {}

export function readPack(dir: string): LoadedPack {
  const file = join(dir, "pack.json");
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  const r = validatePack(manifest);
  if (!r.ok) throw new PackError(`${file}: ${r.errors.join("; ")}`);
  return { dir, manifest };
}

/** Every immediate subdirectory of `root` that contains a pack.json */
export function discoverPacks(root: string): LoadedPack[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .map((n) => join(root, n))
    .filter((d) => statSync(d).isDirectory() && existsSync(join(d, "pack.json")))
    .map(readPack);
}

/**
 * Order packs into layers: dependencies first, then by ascending priority.
 * Later layers override earlier ones. Throws on missing/incompatible deps, cycles and duplicate ids.
 */
export function resolvePacks(packs: LoadedPack[]): LoadedPack[] {
  const byId = new Map<string, LoadedPack>();
  for (const p of packs) {
    if (byId.has(p.manifest.id)) throw new PackError(`duplicate pack id: ${p.manifest.id}`);
    byId.set(p.manifest.id, p);
  }
  for (const p of packs) {
    for (const [dep, range] of Object.entries(p.manifest.dependencies ?? {})) {
      const d = byId.get(dep);
      if (!d) throw new PackError(`${p.manifest.id}: missing dependency ${dep}`);
      if (!satisfies(d.manifest.version, range))
        throw new PackError(`${p.manifest.id}: needs ${dep}@${range}, found ${d.manifest.version}`);
    }
  }
  // Kahn's algorithm; among ready packs pick lowest priority, then id, for a stable order
  const indeg = new Map<string, number>();
  const users = new Map<string, string[]>();
  for (const p of packs) {
    const deps = Object.keys(p.manifest.dependencies ?? {});
    indeg.set(p.manifest.id, deps.length);
    for (const d of deps) users.set(d, [...(users.get(d) ?? []), p.manifest.id]);
  }
  const key = (id: string): [number, string] => [byId.get(id)!.manifest.priority, id];
  const ready = [...indeg].filter(([, n]) => n === 0).map(([id]) => id);
  const out: LoadedPack[] = [];
  while (ready.length) {
    ready.sort((a, b) => key(a)[0] - key(b)[0] || key(a)[1].localeCompare(key(b)[1]));
    const id = ready.shift()!;
    out.push(byId.get(id)!);
    for (const u of users.get(id) ?? []) {
      indeg.set(u, indeg.get(u)! - 1);
      if (indeg.get(u) === 0) ready.push(u);
    }
  }
  if (out.length !== packs.length) throw new PackError("dependency cycle between packs");
  return out;
}

export function contentsOf(pack: LoadedPack, type: ContentType, lang?: string): string[] {
  return pack.manifest.contents
    .filter((c) => c.type === type && (lang === undefined || c.lang === lang))
    .map((c) => join(pack.dir, c.path));
}

/** Merge all lang CSVs of the given language; later layers win */
export function loadLang(layers: LoadedPack[], lang: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of layers)
    for (const f of contentsOf(p, "lang", lang))
      for (const [k, v] of parseLangCsv(readFileSync(f, "utf8"))) out.set(k, v);
  return out;
}
