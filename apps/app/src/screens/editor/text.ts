// Localized texts for the editor: the pack's language tables in the game's current language
import { useEffect, useState } from "react";
import type { TextDb } from "@jime/content-tools/text";
import { loadText } from "../../data/pack.ts";
import { useLang } from "../../data/lang.ts";

export function useTexts(): TextDb | null {
  const lang = useLang();
  const [db, setDb] = useState<TextDb | null>(null);
  useEffect(() => {
    let live = true;
    void loadText(lang).then((t) => { if (live) setDb(t); }).catch(() => { if (live) setDb(null); });
    return () => { live = false; };
  }, [lang]);
  return db;
}

/** A localization key as the exported scenarios write it ("«A1_M1_INTRO»"), or null */
export function keyIn(v: unknown): string | null {
  if (typeof v === "string") { const m = /^«(.+)»$/.exec(v); return m ? m[1]! : null; }
  if (v && typeof v === "object" && "key" in (v as any)) return keyIn((v as any).key) ?? (typeof (v as any).key === "string" ? (v as any).key : null);
  return null;
}

/** Text of a key without markup; the key itself when missing */
export function say(t: TextDb | null, key: string | null | undefined): string {
  if (!key) return "";
  return t?.has(key) ? t.format(key, [], { markup: "strip" }) : key;
}
