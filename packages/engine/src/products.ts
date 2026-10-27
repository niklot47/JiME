// Which products (ProductModel ids: tiles, heroes, items, encounters, groups) a game plays with.
// An extension of this app, not in the original: packs of other content (the demo campaign, a user's own game)
// lie next to an imported game, and their components must not mix:
// - a CampaignModel with "Products" plays with exactly those products (the demo campaign with its demo set);
// - a ProductModel with "Standalone" is left out of every other campaign and adventure.
import { keysOf } from "./ojson.ts";
import { gd, or, truthy } from "./py.ts";

const refId = (v: any): number | null => {
  const id = gd(or(v, {}), "id", null);
  return id === null ? null : Number(id);
};

/** The campaign that lists the adventure (CampaignModel.Adventures), null if none */
export function campaignOfAdventure(D: any, adv: number): number | null {
  const C = D.models?.CampaignModel ?? {};
  for (const k of keysOf(C)) if (or(gd(C[k], "Adventures"), []).some((a: any) => refId(a) === adv)) return Number(gd(C[k], "_id", k));
  return null;
}

/**
 * The products a game of this campaign uses: the campaign's own "Products" if it lists them, otherwise the owned
 * products (undefined = every product) without the standalone ones. undefined = no restriction (no standalone products).
 */
export function scopeProducts(D: any, campaign: number | null, owned?: number[]): number[] | undefined {
  const P = D.models?.ProductModel ?? {};
  const cm = campaign !== null ? D.models?.CampaignModel?.[String(campaign)] : null;
  const own = gd(or(cm, {}), "Products", null);
  if (Array.isArray(own) && own.length) return own.map(refId).filter((x: number | null): x is number => x !== null);
  const standalone = keysOf(P).filter((k) => truthy(gd(P[k], "Standalone"))).map(Number);
  if (!standalone.length) return owned;
  const all: number[] = D.productOrder ?? keysOf(P).map(Number);
  return (owned ?? all).filter((p) => !standalone.includes(p));
}

/** scopeProducts for a single adventure (its campaign, if any) */
export const adventureProducts = (D: any, adv: number, owned?: number[]): number[] | undefined =>
  scopeProducts(D, campaignOfAdventure(D, adv), owned);
