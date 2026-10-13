// Pack manager (main thread and the game worker): all packs in the packs folder, layered.
// Browser dev: Vite serves /packs/* from the local data folder (vite.config.ts).
// Tauri: the "jime-pack" URI scheme serves the user's packs folder (src-tauri/src/lib.rs, data/host.ts).
// Both also serve /__list.json (packs + pack.json) and /<dir>/__index.json (files of one pack).
//
// Layers (content-tools/layers.ts): dependencies first, then priority; a later layer overrides:
// - files by virtual path ("scenario/adventures/1.json", "images/tiles/100A.jpg" ...): the topmost pack that has it;
//   a pack's scenario content may live in any folder (contents[].path), it is mounted at "scenario/";
// - scenario/db.json: merged (models, standard tiles and globals by id; other fields replaced);
// - lang: CSVs of all layers merged by key.
import { ORDER, keysOf, parseOrdered } from "@jime/engine";
import type { TileArtDb } from "@jime/engine/map";
import { parseLangCsv } from "@jime/content-tools/csv";
import { TextDb } from "@jime/content-tools/text";
import { layerLangs, orderLayers, type LayerResult, type PackRef } from "@jime/content-tools/layers";

/** The pack with the imported game (the wizard creates it) */
export const PACK_ID = "core-ffg";

export interface PackConfig {
  /** URL of the packs folder */
  root: string;
  /** Pack folders turned off by the user */
  disabled: string[];
}

const DISABLED_KEY = "jime.packs.disabled";

function readDisabled(): string[] {
  try {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(DISABLED_KEY) : null;
    return v ? (JSON.parse(v) as string[]) : [];
  } catch {
    return [];
  }
}

let config: PackConfig = { root: "/packs", disabled: readDisabled() };
/** Current config; the worker cannot read localStorage or ask the host, so it gets this in its start request */
export const packConfig = (): PackConfig => ({ ...config, disabled: [...config.disabled] });

export function setPacksRoot(url: string): void {
  config = { ...config, root: url.replace(/\/+$/, "") };
  clearPackCache();
}

/** Apply a config (worker side); returns true if it changed */
export function applyPackConfig(c: PackConfig): boolean {
  if (c.root === config.root && JSON.stringify(c.disabled) === JSON.stringify(config.disabled)) return false;
  config = { root: c.root.replace(/\/+$/, ""), disabled: [...c.disabled] };
  clearPackCache();
  return true;
}

/** Turn packs on/off (main thread; remembered in localStorage) */
export function setDisabledPacks(dirs: string[]): void {
  config = { ...config, disabled: [...new Set(dirs)].sort() };
  try {
    localStorage.setItem(DISABLED_KEY, JSON.stringify(config.disabled));
  } catch {
    /* not remembered: still applies for this session */
  }
  clearPackCache();
}

export interface PackSet extends LayerResult {
  /** Every pack folder found, with its pack.json */
  all: PackRef[];
  /** Virtual path -> URL (topmost layer wins) */
  files: Map<string, string>;
  /** Virtual path -> pack folder that provides it */
  owner: Map<string, string>;
  langs: string[];
}

const cache = new Map<string, Promise<any>>();
let current: PackSet | null = null;
/** Forget loaded pack data (after the packs folder or the enabled packs changed) */
export function clearPackCache(): void {
  cache.clear();
  current = null;
}
const once = <T,>(key: string, f: () => Promise<T>): Promise<T> => {
  if (!cache.has(key)) cache.set(key, f());
  return cache.get(key)!;
};

const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
const url = (dir: string, rel: string) => `${config.root}/${enc(dir)}/${enc(rel)}`;

async function getJson(u: string): Promise<any> {
  const r = await fetch(u);
  if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`);
  return r.json();
}

export const loadPackSet = (): Promise<PackSet> => once("set", async () => {
  const all = (await getJson(`${config.root}/__list.json`)) as PackRef[];
  const res = orderLayers(all, config.disabled);
  const files = new Map<string, string>();
  const owner = new Map<string, string>();
  const indexes = await Promise.all(res.layers.map((p) => getJson(`${config.root}/${enc(p.dir)}/__index.json`) as Promise<string[]>));
  res.layers.forEach((p, i) => {
    const mounts = (p.manifest.contents as any[])
      .filter((c) => c.type === "scenario")
      .map((c) => String(c.path).replace(/\\/g, "/").replace(/\/+$/, ""));
    for (const rel of indexes[i]!) {
      if (rel === "pack.json") continue;
      let virtual = rel;
      for (const m of mounts) if (m !== "scenario" && rel.startsWith(`${m}/`)) virtual = `scenario/${rel.slice(m.length + 1)}`;
      files.set(virtual, url(p.dir, rel));
      owner.set(virtual, p.dir);
    }
  });
  const set: PackSet = { ...res, all, files, owner, langs: layerLangs(res.layers) };
  current = set;
  return set;
});

export async function packText(path: string): Promise<string> {
  const set = await loadPackSet();
  const u = set.files.get(path);
  if (!u) throw new Error(`${path}: нет ни в одном включённом паке (пак ${PACK_ID} собирает мастер импорта — экран «Паки»)`);
  const r = await fetch(u);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.text();
}

/** URL of a pack file (sync: valid once loadPackSet() has resolved; before that, the core pack's path) */
export const assetUrl = (path: string): string => current?.files.get(path) ?? url(PACK_ID, path);

// ---------------------------------------------------------------- db merge
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);

/** Put the entries of `over` into `base` by key, keeping parseOrdered key order (new keys go last) */
function mergeById(base: Record<string, any>, over: Record<string, any>): void {
  const order = (base as any)[ORDER] as string[] | undefined;
  for (const k of keysOf(over)) {
    if (!Object.hasOwn(base, k) && order) order.push(k);
    base[k] = over[k];
  }
}

/** Layered content database: maps keyed by id are merged, everything else is replaced by the upper layer */
export function mergeDb(layers: any[]): any {
  const [first, ...rest] = layers;
  if (!rest.length) return first;
  const db = first;
  for (const d of rest) {
    for (const k of Object.keys(d)) {
      if (k === "models" && isObj(db.models) && isObj(d.models)) {
        for (const t of Object.keys(d.models)) {
          if (isObj(db.models[t]) && isObj(d.models[t])) mergeById(db.models[t], d.models[t]);
          else db.models[t] = d.models[t];
        }
      } else if ((k === "standardTiles" || k === "globals") && isObj(db[k]) && isObj(d[k])) mergeById(db[k], d[k]);
      else db[k] = d[k];
    }
  }
  return db;
}

export const loadDb = () => once("db", async () => {
  const set = await loadPackSet();
  const urls: string[] = [];
  for (const p of set.layers)
    for (const c of p.manifest.contents as any[])
      if (c.type === "scenario") urls.push(url(p.dir, `${String(c.path).replace(/\\/g, "/").replace(/\/+$/, "")}/db.json`));
  const texts = await Promise.all(urls.map(async (u) => { const r = await fetch(u); return r.ok ? r.text() : null; }));
  const dbs = texts.filter((t): t is string => t !== null).map((t) => parseOrdered(t));
  if (!dbs.length) throw new Error(`scenario/db.json: нет ни в одном включённом паке (нужен пак ${PACK_ID})`);
  return mergeDb(dbs) as any;
});

export const loadTileArt = () => once("art", async () => JSON.parse(await packText("scenario/tileart.json")) as TileArtDb);
/** Fresh copy each time: the engine may keep references into it */
export const loadAdventure = async (id: number) => parseOrdered(await packText(`scenario/adventures/${id}.json`)) as any;

/** Text of one language from all layers (later layers override keys) */
export const loadText = (lang: string) => once(`lang:${lang}`, async () => {
  const set = await loadPackSet();
  const merged = new Map<string, string>();
  for (const p of set.layers)
    for (const c of p.manifest.contents as any[]) {
      if (c.type !== "lang" || c.lang !== lang) continue;
      const r = await fetch(url(p.dir, String(c.path).replace(/\\/g, "/")));
      if (r.ok) for (const [k, v] of parseLangCsv(await r.text())) merged.set(k, v);
    }
  return new TextDb(merged);
});

/**
 * Register the pack's fonts (fonts/fonts.json, from tools/importer/export_fonts.py) as CSS families
 * "JiME Text" and "JiME Title". They also hold the in-text icons (U+F460..F47A). Missing fonts: CSS fallbacks apply.
 */
export const installFonts = () => once("fonts", async () => {
  try {
    const list = JSON.parse(await packText("fonts/fonts.json")) as Record<string, { file: string }>;
    const families: Record<string, string> = { text: "JiME Text", title: "JiME Title" };
    await Promise.all(Object.entries(list).map(async ([role, f]) => {
      if (!families[role]) return;
      const face = new FontFace(families[role]!, `url(${assetUrl(f.file)})`);
      document.fonts.add(await face.load());
    }));
  } catch {
    /* no fonts in the enabled packs */
  }
});

/** One token's art: top face crop (2D), the mesh's whole texture (3D) and which mesh it uses */
export interface TokenArt { top: string; raw?: string; mesh?: string }
/** Token mesh from the game: positions (z up), UVs, triangles */
export interface TokenMeshData { pos: [number, number, number][]; uv: [number, number][]; faces: [number, number, number][] }

/** Token art by Token3DType id (images/tokens/tokens.json from tools/importer/export_tokens.py); {} if absent */
export const loadTokenArt = () => once("tokens", async () => {
  try {
    const raw = JSON.parse(await packText("images/tokens/tokens.json")) as Record<string, TokenArt | string>;
    // older packs: id -> top image path
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === "string" ? { top: v } : v])) as Record<string, TokenArt>;
  } catch {
    return {} as Record<string, TokenArt>;
  }
});

/** Token meshes by name (images/tokens/meshes.json); {} if absent */
export const loadTokenMeshes = () => once("tokenMeshes", async () => {
  try {
    return JSON.parse(await packText("images/tokens/meshes.json")) as Record<string, TokenMeshData>;
  } catch {
    return {} as Record<string, TokenMeshData>;
  }
});

/** Board effect textures by role (images/fx/fx.json from tools/importer/export_fx.py); {} if absent */
export const loadFx = () => once("fx", async () => {
  try {
    return JSON.parse(await packText("images/fx/fx.json")) as Record<string, string>;
  } catch {
    return {} as Record<string, string>;
  }
});

/** Enemy icons by EnemyModel id (images/enemies/enemies.json from tools/importer/export_icons.py); {} if absent */
export const loadEnemyArt = () => once("enemies", async () => {
  try {
    return JSON.parse(await packText("images/enemies/enemies.json")) as Record<string, string>;
  } catch {
    return {} as Record<string, string>;
  }
});

/** Interface art of the "Original" theme (images/ui/ui.json from tools/importer/export_ui.py); {} if absent */
export const loadUiArt = () => once("ui", async () => {
  try {
    return JSON.parse(await packText("images/ui/ui.json")) as Record<string, string>;
  } catch {
    return {} as Record<string, string>;
  }
});

/** One sprite of the game's NGUI atlas (images/ui/atlas/atlas.json from tools/importer/export_atlas.py) */
export interface AtlasSprite { file: string; w: number; h: number; border: [number, number, number, number] }
/** UI atlas sprites by name ("Enemy_Frame_Normal", "Threat_Event2" ...); {} if absent */
export const loadUiAtlas = () => once("atlas", async () => {
  try {
    return JSON.parse(await packText("images/ui/atlas/atlas.json")) as Record<string, AtlasSprite>;
  } catch {
    return {} as Record<string, AtlasSprite>;
  }
});

/** The game's NGUI interface layout (images/ui/layouts/ui.json from tools/importer/export_ui_layouts.py); null if absent */
export const loadUiLayout = () => once("uiLayout", async () => {
  try {
    return JSON.parse(await packText("images/ui/layouts/ui.json")) as import("../ngui/types.ts").UiLayoutFile;
  } catch {
    return null;
  }
});

const THEME_KEY = "jime.theme";
export const themeChoice = (): "original" | "plain" => {
  try {
    return localStorage.getItem(THEME_KEY) === "plain" ? "plain" : "original";
  } catch {
    return "original";
  }
};

/**
 * Apply the theme: "original" maps the pack's interface art to CSS variables (--ui-frame, --ui-leather, --ui-map,
 * --ui-paper) and sets the theme-original class on <html>; "plain" (or no art in the packs) keeps the base look.
 */
export async function installTheme(choice = themeChoice()): Promise<void> {
  try { localStorage.setItem(THEME_KEY, choice); } catch { /* not remembered */ }
  const root = document.documentElement;
  const art = choice === "original" ? await loadUiArt() : {};
  for (const role of ["frame", "leather", "map", "paper"]) {
    if (art[role]) root.style.setProperty(`--ui-${role}`, `url("${assetUrl(art[role]!)}")`);
    else root.style.removeProperty(`--ui-${role}`);
  }
  root.classList.toggle("theme-original", Object.keys(art).length > 0);
}
