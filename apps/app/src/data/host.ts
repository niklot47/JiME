// Desktop host (Tauri) integration: packs folder. In a plain browser everything falls back to the Vite dev server.
import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
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

// ---------------------------------------------------------------- first-run import (src-tauri/src/importer.rs)
export interface GameCandidate { path: string; dataDir: string }
export interface PythonInfo { exe: string | null; version: string | null; missing: string[]; importer: string | null }

export const detectGame = () => invoke<GameCandidate[]>("detect_game");
/** Resolves to the game's JiME_Data folder, rejects with a message if `path` is not a game install */
export const checkGame = (path: string) => invoke<string>("check_game", { path });
export const pythonInfo = () => invoke<PythonInfo>("python_info");
export const installRequirements = (exe: string) => invoke<void>("install_requirements", { exe });
/** Starts the import in the background (log: onImportLog, end: onImportDone); resolves to the work folder */
export const runImport = (exe: string, game: string) => invoke<string>("run_import", { exe, game });
export const onImportLog = (f: (line: string) => void): Promise<UnlistenFn> =>
  listen<{ line: string }>("import-log", (e) => f(e.payload.line));
export const onImportDone = (f: (d: { ok: boolean; code: number | null; task: "pip" | "import" }) => void): Promise<UnlistenFn> =>
  listen<{ ok: boolean; code: number | null; task: "pip" | "import" }>("import-done", (e) => f(e.payload));

/** The title screen's Quit: close the app window (a plain browser tab cannot close itself: false) */
export async function quitApp(): Promise<boolean> {
  if (!isTauri()) return false;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().close();
  return true;
}
