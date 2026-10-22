// The game language (PREF_LANGUAGE): one choice for the menus and the game, kept between sessions
import { useSyncExternalStore } from "react";

const KEY = "jime.lang";
let lang = (() => { try { return localStorage.getItem(KEY) || "ru"; } catch { return "ru"; } })();
const listeners = new Set<() => void>();

export const getLang = (): string => lang;

export function setLang(l: string): void {
  lang = l;
  try { localStorage.setItem(KEY, l); } catch { /* per session only */ }
  for (const f of listeners) f();
}

export function useLang(): string {
  return useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f); }, getLang);
}
