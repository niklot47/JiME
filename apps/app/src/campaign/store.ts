// Campaign save slots (SaveLoadUtility: up to 10 saves) and the owned products (the original's collection), kept in
// the browser storage of the app's window. A save is the engine's CampaignSave as it is: the party, the chain and the
// adventure in progress (seeds and answers).
import { isCampaignSave, type CampaignSave } from "@jime/engine";

const SAVES = "jime.campaigns";
const PRODUCTS = "jime.products";
/** SaveLoadUtility: CampaignSelectController blocks a new campaign at 10 saves */
export const MAX_SAVES = 10;

function readAll(): CampaignSave[] {
  try {
    const v = JSON.parse(localStorage.getItem(SAVES) ?? "[]");
    return Array.isArray(v) ? v.filter(isCampaignSave) : [];
  } catch {
    return [];
  }
}

function writeAll(all: CampaignSave[]): void {
  try {
    localStorage.setItem(SAVES, JSON.stringify(all));
  } catch {
    /* storage full or unavailable: the game goes on unsaved */
  }
}

/** All saves, the latest first */
export const listSaves = (): CampaignSave[] => readAll().sort((a, b) => b.savedAt.localeCompare(a.savedAt));

export const getSave = (slot: string): CampaignSave | null => readAll().find((s) => s.slot === slot) ?? null;

/** Write (or replace) a save by its slot */
export function putSave(s: CampaignSave): void {
  const all = readAll().filter((x) => x.slot !== s.slot);
  all.push(s);
  writeAll(all);
}

export function deleteSave(slot: string): void {
  writeAll(readAll().filter((x) => x.slot !== slot));
}

/** Owned products (ProductModel ids; the collection), undefined = all of the pack */
export function ownedProducts(): number[] | undefined {
  try {
    const v = JSON.parse(localStorage.getItem(PRODUCTS) ?? "null");
    return Array.isArray(v) ? v.map(Number) : undefined;
  } catch {
    return undefined;
  }
}

export function setOwnedProducts(ids: number[] | undefined): void {
  try {
    if (ids) localStorage.setItem(PRODUCTS, JSON.stringify(ids));
    else localStorage.removeItem(PRODUCTS);
  } catch {
    /* per session only */
  }
}
