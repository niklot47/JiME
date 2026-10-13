// Localized text -> safe HTML: FFG markup [i]/[b] becomes <i>/<b>, everything else is escaped, newlines kept (CSS pre-line)
import type { TextDb } from "@jime/content-tools/text";

const OPEN = "\u0001", CLOSE = "\u0002";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function textHtml(text: TextDb, key: string, inserts: readonly string[] = []): string {
  const s = text.format(key, inserts, { markup: (tag, open) => (open ? OPEN : CLOSE) + tag });
  return esc(s)
    .replace(/\u0001([ib])/g, "<$1>")
    .replace(/\u0002([ib])/g, "</$1>")
    // NGUI color tags: [RRGGBBAA] ... [-]
    .replace(/\[([0-9A-F]{6})[0-9A-F]{2}\]/g, '<span style="color:#$1">')
    .replace(/\[-\]/g, "</span>")
    // inserts the engine does not supply yet (e.g. the objective counter)
    .replace(/\{\d+\}/g, "");
}
