// The editor's own pack: changed scenarios and texts are saved here, on top of core-ffg (which is never touched).
//   my-edits/pack.json             origin "user", priority 100, depends on core-ffg
//   my-edits/scenario/adventures/<id>.json   whole adventure files (the topmost layer wins per file)
//   my-edits/lang/<lang>.csv       only the changed texts, by their full "Sheet|KEY" (merged over core-ffg by key)
import { stringifyOrdered } from "@jime/engine";
import { parseLangCsv, writeCsv } from "@jime/content-tools/csv";
import { PACK_ID, packFileUrl, packsChanged } from "./pack.ts";
import { writePackFile } from "./host.ts";

export const EDIT_PACK = "my-edits";

export interface Edits {
  /** changed adventure prefabs by id */
  adventures: Map<number, any>;
  /** changed texts: lang -> full key -> text (as stored in the CSV: line breaks as "\n") */
  texts: Map<string, Map<string, string>>;
}

async function current(path: string): Promise<string | null> {
  try {
    const r = await fetch(packFileUrl(EDIT_PACK, path), { cache: "no-store" });
    // the Vite dev server answers a missing file with the app's index.html (200)
    return r.ok && !(r.headers.get("content-type") ?? "").includes("text/html") ? await r.text() : null;
  } catch {
    return null;
  }
}

/** Save the edits into the edit pack (texts merged with the ones saved before) and drop the pack caches */
export async function saveEdits(e: Edits): Promise<void> {
  const old = await current("pack.json");
  let manifest: any = null;
  try { manifest = old ? JSON.parse(old) : null; } catch { manifest = null; }
  const langs = new Set<string>((manifest?.contents ?? []).filter((c: any) => c.type === "lang").map((c: any) => c.lang));
  for (const [id, prefab] of e.adventures) await writePackFile(EDIT_PACK, `scenario/adventures/${id}.json`, stringifyOrdered(prefab));
  for (const [lang, changed] of e.texts) {
    if (!changed.size) continue;
    const prev = await current(`lang/${lang}.csv`);
    const merged = prev ? parseLangCsv(prev) : new Map<string, string>();
    for (const [k, v] of changed) merged.set(k, v);
    const rows = [["key", "text"], ...[...merged].sort((a, b) => a[0].localeCompare(b[0]))];
    await writePackFile(EDIT_PACK, `lang/${lang}.csv`, writeCsv(rows));
    langs.add(lang);
  }
  manifest = {
    formatVersion: 1, id: EDIT_PACK,
    name: { ru: "Мои правки", en: "My edits", it: "Le mie modifiche" },
    description: "Changes made in the editor, on top of the imported game.",
    version: manifest?.version ?? "0.1.0", priority: 100, origin: "user",
    dependencies: { [PACK_ID]: "^1.0.0" },
    contents: [{ type: "scenario", path: "scenario" }, ...[...langs].sort().map((l) => ({ type: "lang", lang: l, path: `lang/${l}.csv` }))],
  };
  await writePackFile(EDIT_PACK, "pack.json", JSON.stringify(manifest, null, 2) + "\n");
  packsChanged();
}
