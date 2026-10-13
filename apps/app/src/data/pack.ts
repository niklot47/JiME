// Pack access from the app. Dev: Vite serves /packs/* from the local data folder (see vite.config.ts).
// TODO(Stage 3.1): Tauri build reads packs from the user's app-data folder.
import { parseOrdered } from "@jime/engine";
import type { TileArtDb } from "@jime/engine/map";
import { parseLangCsv } from "@jime/content-tools/csv";
import { TextDb } from "@jime/content-tools/text";

export const PACK = "/packs/core-ffg";

export async function packText(path: string): Promise<string> {
  const r = await fetch(`${PACK}/${path}`);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status} (run the importer: pnpm packs:build)`);
  return r.text();
}

const cache = new Map<string, Promise<any>>();
const once = <T,>(key: string, f: () => Promise<T>): Promise<T> => {
  if (!cache.has(key)) cache.set(key, f());
  return cache.get(key)!;
};

export const loadDb = () => once("db", async () => parseOrdered(await packText("scenario/db.json")) as any);
export const loadTileArt = () => once("art", async () => JSON.parse(await packText("scenario/tileart.json")) as TileArtDb);
/** Fresh copy each time: the engine may keep references into it */
export const loadAdventure = async (id: number) => parseOrdered(await packText(`scenario/adventures/${id}.json`)) as any;
export const loadText = (lang: string) => once(`lang:${lang}`, async () => new TextDb(parseLangCsv(await packText(`lang/${lang}.csv`))));
export const assetUrl = (path: string) => `${PACK}/${path}`;

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
