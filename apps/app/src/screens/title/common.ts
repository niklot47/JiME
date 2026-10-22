// Shared bits of the title screen and the new-game pages (Panel_Titlescreen from the exported layout)
import type { TextDb } from "@jime/content-tools/text";
import type { AtlasSprite, HeroArt, ModelArt } from "../../data/pack.ts";
import type { UiLayoutFile, UiNode } from "../../ngui/types.ts";
import type { Binds, Enter } from "../../ngui/NguiView.tsx";

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

/** SlidingElement's entrances: the offset is where the element starts (minus the slide's direction) */
export const SLIDE = {
  left: (farther = false, delay = 0): Enter => ({ from: [farther ? -600 : -300, 0], dur: farther ? 0.7 : 0.35, delay }),
  right: (delay = 0): Enter => ({ from: [300, 0], delay }),
  bottom: (delay = 0): Enter => ({ from: [0, -150], delay }),
  top: (delay = 0): Enter => ({ from: [0, 150], delay }),
  /** UIWidget / UIPanel.FadeIn */
  fade: (dur = 0.35, delay = 0): Enter => ({ fade: true, dur, delay, linear: true }),
};

/**
 * The binds with entrance animations added: the page's sliding elements (SlidingElement on Button_Back /
 * Button_Continue / Sprite_Titlebar, as every page controller's CoroutineShow plays them: back from the left, continue
 * from the right, the title from the top) under `root`, plus `extra` ("Parent/Name" or "Name" keys). A page bind under
 * the bare name is copied to the "Parent/Name" key so it still applies.
 */
export function withEnter(b: Binds, root: UiNode | null, extra: Record<string, Enter> = {}): Binds {
  const out: Binds = { ...b };
  const put = (key: string, e: Enter) => {
    const name = key.split("/").pop()!;
    out[key] = { ...(out[key] ?? out[name] ?? {}), enter: e };
  };
  const dir: Record<string, () => Enter> = { Button_Back: () => SLIDE.left(), Button_Continue: () => SLIDE.right(), Sprite_Titlebar: () => SLIDE.top() };
  const walk = (n: UiNode, parent: string) => {
    if (n.mb?.includes("SlidingElement") && dir[n.n]) put(`${parent}/${n.n}`, dir[n.n]!());
    for (const c of n.ch ?? []) walk(c, n.n);
  };
  if (root) walk(root, "");
  for (const [k, e] of Object.entries(extra)) put(k, e);
  return out;
}
