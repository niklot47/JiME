// What this app's own menus need (no layout of the original): the merged db, texts and the models' pictures
import { useEffect, useMemo, useState } from "react";
import type { TextDb } from "@jime/content-tools/text";
import { installFonts, loadDb, loadHeroArt, loadModelArt, loadText, assetUrl, type HeroArt, type ModelArt } from "../../data/pack.ts";
import { textHtml } from "../../text/markup.ts";

export interface MenuUi {
  db: any;
  lang: string;
  /** a key's text as HTML (markup, inserts; English when the language lacks it) */
  say: (key: string | null | undefined, ins?: readonly string[]) => string;
  /** a key's plain text ("" when missing) */
  raw: (key: string | null | undefined) => string;
  art: { campaigns: ModelArt; adventures: ModelArt; items: ModelArt; cutscenes: ModelArt; heroes: Record<string, HeroArt> };
  /** URL of a pack picture (undefined when there is none) */
  pic: (path: string | undefined | null) => string | undefined;
}

const plain = (s: string) => s.replace(/\[\/?[ib]\]/g, "").replace(/\\n/g, "\n");

export function useMenuData(lang: string): { ui: MenuUi | null; error: string | null } {
  const [db, setDb] = useState<any>(null);
  const [text, setText] = useState<TextDb | null>(null);
  const [english, setEnglish] = useState<TextDb | null>(null);
  const [art, setArt] = useState<MenuUi["art"]>({ campaigns: {}, adventures: {}, items: {}, cutscenes: {}, heroes: {} });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void installFonts();
    Promise.all([loadDb(), loadModelArt("campaigns"), loadModelArt("adventures"), loadModelArt("items"), loadModelArt("cutscenes"), loadHeroArt()])
      .then(([d, c, a, i, cs, h]) => { setDb(d); setArt({ campaigns: c, adventures: a, items: i, cutscenes: cs, heroes: h }); })
      .catch((e) => setError(String(e)));
    loadText("en").then(setEnglish).catch(() => setEnglish(null));
  }, []);
  useEffect(() => { loadText(lang).then(setText).catch((e) => setError(String(e))); }, [lang]);
  const ui = useMemo((): MenuUi | null => {
    if (!db || !text) return null;
    return {
      db, lang, art,
      say: (k, ins = []) => (k ? textHtml(text, k, ins, lang === "en" ? null : english) : ""),
      raw: (k) => (k ? plain(text.raw(k) ?? english?.raw(k) ?? "") : ""),
      pic: (p) => (p ? assetUrl(p) : undefined),
    };
  }, [db, text, english, art, lang]);
  return { ui, error };
}

export const refId = (v: any): number | null => (v && v.id !== undefined ? Number(v.id) : null);
