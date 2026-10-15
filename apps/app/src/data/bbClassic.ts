// "Classic battleboard" option (UIOptionsPage PREF_BB_CLASSIC): terrain stays as flat tokens, no 3D pieces, rivers or pits
import { useEffect, useState } from "react";

const KEY = "jime.bb.classic";
const listeners = new Set<(v: boolean) => void>();

export function bbClassic(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

export function setBbClassic(v: boolean): void {
  try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* per-session only */ }
  for (const f of listeners) f(v);
}

export function useBbClassic(): boolean {
  const [v, setV] = useState(bbClassic);
  useEffect(() => { listeners.add(setV); return () => { listeners.delete(setV); }; }, []);
  return v;
}
