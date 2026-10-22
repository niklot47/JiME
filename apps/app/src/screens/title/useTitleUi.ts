// Loads what the menu pages need (layout, atlas, texts, models and their pictures) as a TitleUi
import { useEffect, useMemo, useState } from "react";
import type { TextDb } from "@jime/content-tools/text";
import { installFonts, loadDb, loadHeroArt, loadModelArt, loadText, loadUiAtlas, loadUiLayout, type AtlasSprite, type HeroArt, type ModelArt } from "../../data/pack.ts";
import { textHtml } from "../../text/markup.ts";
import { ownedProducts } from "../../campaign/store.ts";
import { textOf, type TitleUi } from "./common.ts";
import type { UiLayoutFile } from "../../ngui/types.ts";

export function useTitleUi(lang: string): { ui: TitleUi | null; adventures: ModelArt; cutscenes: ModelArt; error: string | null } {
  const [layout, setLayout] = useState<UiLayoutFile | null>(null);
  const [atlas, setAtlas] = useState<Record<string, AtlasSprite>>({});
  const [db, setDb] = useState<any>(null);
  const [text, setText] = useState<TextDb | null>(null);
  const [english, setEnglish] = useState<TextDb | null>(null);
  const [heroArt, setHeroArt] = useState<Record<string, HeroArt>>({});
  const [art, setArt] = useState<{ campaigns: ModelArt; items: ModelArt; products: ModelArt; adventures: ModelArt; cutscenes: ModelArt }>({ campaigns: {}, items: {}, products: {}, adventures: {}, cutscenes: {} });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void installFonts();
    Promise.all([loadUiLayout(), loadUiAtlas(), loadDb(), loadHeroArt(), loadModelArt("campaigns"), loadModelArt("items"), loadModelArt("products"), loadModelArt("adventures"), loadModelArt("cutscenes")])
      .then(([l, a, d, h, c, i, p, ad, cs]) => { setLayout(l); setAtlas(a); setDb(d); setHeroArt(h); setArt({ campaigns: c, items: i, products: p, adventures: ad, cutscenes: cs }); })
      .catch((e) => setError(String(e)));
    loadText("en").then(setEnglish).catch(() => setEnglish(null));
  }, []);
  useEffect(() => { loadText(lang).then(setText).catch((e) => setError(String(e))); }, [lang]);
  const ui = useMemo((): TitleUi | null => {
    if (!layout || !db || !text) return null;
    return {
      layout, atlas, db, heroArt, lang, products: ownedProducts(),
      campaignArt: art.campaigns, itemArt: art.items, productArt: art.products,
      say: (k, ins = []) => (k ? textHtml(text, k, ins, lang === "en" ? null : english) : ""),
      raw: textOf(text, english),
    };
  }, [layout, atlas, db, text, english, heroArt, art, lang]);
  return { ui, adventures: art.adventures, cutscenes: art.cutscenes, error };
}
