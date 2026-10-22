// Shared bits of the title screen and the new-game pages (Panel_Titlescreen from the exported layout)
import type { TextDb } from "@jime/content-tools/text";
import type { AtlasSprite, HeroArt, ModelArt } from "../../data/pack.ts";
import type { UiLayoutFile } from "../../ngui/types.ts";

export type Say = (key: string | null | undefined, ins?: readonly string[]) => string;

/** What every page needs: the layout, its atlas, texts and the pack's models with their pictures */
export interface TitleUi {
  layout: UiLayoutFile;
  atlas: Record<string, AtlasSprite>;
  say: Say;
  /** plain text of a key ("" when missing) */
  raw: (key: string | null | undefined) => string;
  db: any;
  heroArt: Record<string, HeroArt>;
  campaignArt: ModelArt;
  itemArt: ModelArt;
  productArt: ModelArt;
  /** owned products (undefined: all of the pack) */
  products?: number[];
  lang: string;
}

/** FFGTools.GetNumeralString */
export function roman(n: number): string {
  const R: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = "";
  for (const [v, s] of R) while (n >= v) { out += s; n -= v; }
  return out;
}

export const refId = (v: any): number | null => (v && v.id !== undefined ? Number(v.id) : null);

/** UserCollectionManager.IsOwned: a model's product is owned (no list = all owned) */
export const owns = (products: number[] | undefined, id: number | null) => id === null || !products || products.includes(id);

/** HeroModel ids of the owned products (UserCollectionManager.GetHeroes(ownedOnly)), sorted by name like HeroSelectController */
export function ownedHeroes(ui: TitleUi): number[] {
  const P = ui.db.models.ProductModel ?? {};
  const ids = new Set<number>();
  for (const [pid, p] of Object.entries<any>(P)) {
    if (!owns(ui.products, Number(pid))) continue;
    for (const h of p.Heroes ?? []) { const id = refId(h); if (id !== null) ids.add(id); }
  }
  const H = ui.db.models.HeroModel ?? {};
  // heroes no product lists (packs without product data): all of them
  const list = ids.size ? [...ids] : Object.keys(H).map(Number);
  return list.filter((id) => H[String(id)]).sort((a, b) => ui.raw(H[String(a)].NameKey).localeCompare(ui.raw(H[String(b)].NameKey)));
}

export const textOf = (t: TextDb | null, fallback: TextDb | null) => (k: string | null | undefined) =>
  (k && (t?.raw(k) ?? fallback?.raw(k))) || "";
