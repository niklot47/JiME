// Desktop host (Tauri) integration: packs folder. In a plain browser everything falls back to the Vite dev server.
import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { setPacksRoot } from "./pack.ts";

export interface PacksInfo {
  dir: string;
  /** env | settings | repo | default */
  source: string;
  exists: boolean;
  packs: { dir: string; manifest: any | null }[];
}

export const inTauri = (): boolean => isTauri();

/** Call once at startup, before any pack access */
export function initHost(): void {
  // jime-pack://localhost/ (macOS, Linux) or http://jime-pack.localhost/ (Windows, Android)
  if (inTauri()) setPacksRoot(convertFileSrc("", "jime-pack"));
}

export const packsInfo = () => invoke<PacksInfo>("packs_info");
/** null = back to the default folder */
export const setPacksDir = (path: string | null) => invoke<PacksInfo>("set_packs_dir", { path });
