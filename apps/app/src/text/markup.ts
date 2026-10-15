// Localized text -> safe HTML: FFG markup [i]/[b] becomes <i>/<b>, everything else is escaped, newlines kept (CSS pre-line)
import type { TextDb } from "@jime/content-tools/text";

const OPEN = "\u0001", CLOSE = "\u0002";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * fallback: another language (English) for keys missing in `text` - e.g. DLC keys a translation lacks;
 * applies to the key itself and to inserts that are keys
 */
let heroNames: readonly string[] = [];
/** Names of the party's heroes, by player index (the game screen sets them) */
export function setHeroNames(names: readonly string[]): void { heroNames = names; }

/** Hero inserts from the engine ("@hero:<index>", "@hero:?" = a random hero) */
export function heroInsert(i: string): string | null {
  const m = /^@hero:(\d+|\?)$/.exec(i);
  if (!m) return null;
  return m[1] === "?" ? "Один из героев" : heroNames[Number(m[1])] || `Герой ${Number(m[1]) + 1}`;
}

export function textHtml(text: TextDb, key: string, inserts: readonly string[] = [], fallback?: TextDb | null): string {
  const markup = (tag: "i" | "b", open: boolean) => (open ? OPEN : CLOSE) + tag;
  const db = !text.has(key) && fallback?.has(key) ? fallback : text;
  const one = (k: string) => (text.has(k) ? text.format(k, [], { markup }) : fallback?.has(k) ? fallback.format(k, [], { markup }) : k);
  // "@lines:<n>|<key>;...": a list of counted names, one per line (RevealTerrainNodes: "\t{n} {name}\n")
  const lines = (i: string) => (i.startsWith("@lines:") ? i.slice(7).split(";").filter(Boolean).map((x) => { const [n, k] = x.split("|"); return `${n} ${one(k ?? "")}`; }).join("\n") : null);
  const ins = inserts.map((i) => heroInsert(i) ?? lines(i) ?? (fallback && !text.has(i) && fallback.has(i) ? fallback.format(i, [], { markup }) : i));
  const s = db.format(key, ins, { markup });
  return esc(s)
    .replace(/\u0001([ib])/g, "<$1>")
    .replace(/\u0002([ib])/g, "</$1>")
    // NGUI color tags: [RRGGBBAA] ... [-]
    .replace(/\[([0-9A-F]{6})[0-9A-F]{2}\]/g, '<span style="color:#$1">')
    .replace(/\[-\]/g, "</span>")
    // inserts the engine does not supply yet (e.g. the objective counter)
    .replace(/\{\d+\}/g, "");
}
