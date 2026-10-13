// Pack access from the app (main thread and the game worker).
// Browser dev: Vite serves /packs/* from the local data folder (vite.config.ts).
// Tauri: the "jime-pack" URI scheme serves the user's packs folder (src-tauri/src/lib.rs, data/host.ts).
import { parseOrdered } from "@jime/engine";
import type { TileArtDb } from "@jime/engine/map";
import { parseLangCsv } from "@jime/content-tools/csv";
import { TextDb } from "@jime/content-tools/text";

/** The pack the game uses (later: a pack manager with layers) */
export const PACK_ID = "core-ffg";

let root = "/packs";
/** URL of the packs folder; set by host.ts in Tauri, passed to the worker in its start request */
export const packsRoot = () => root;
export function setPacksRoot(url: string): void {
  root = url.replace(/\/+$/, "");
}

export async function packText(path: string): Promise<string> {
  const r = await fetch(assetUrl(path));
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status} — пак ${PACK_ID} не найден (импортёр: pnpm packs:build; в приложении — экран «Паки»)`);
  return r.text();
}

const cache = new Map<string, Promise<any>>();
/** Forget loaded pack data (after the packs folder changed) */
export const clearPackCache = () => cache.clear();
const once = <T,>(key: string, f: () => Promise<T>): Promise<T> => {
  if (!cache.has(key)) cache.set(key, f());
  return cache.get(key)!;
};

export const loadDb = () => once("db", async () => parseOrdered(await packText("scenario/db.json")) as any);
export const loadTileArt = () => once("art", async () => JSON.parse(await packText("scenario/tileart.json")) as TileArtDb);
/** Fresh copy each time: the engine may keep references into it */
export const loadAdventure = async (id: number) => parseOrdered(await packText(`scenario/adventures/${id}.json`)) as any;
export const loadText = (lang: string) => once(`lang:${lang}`, async () => new TextDb(parseLangCsv(await packText(`lang/${lang}.csv`))));
export const assetUrl = (path: string) => `${root}/${PACK_ID}/${path}`;

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
    /* no fonts in this pack */
  }
});

/** Token art by Token3DType id (images/tokens/tokens.json from tools/importer/export_tokens.py); {} if absent */
export const loadTokenArt = () => once("tokens", async () => {
  try {
    return JSON.parse(await packText("images/tokens/tokens.json")) as Record<string, string>;
  } catch {
    return {} as Record<string, string>;
  }
});
