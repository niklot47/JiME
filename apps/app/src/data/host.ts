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

/**
 * Write a text file into a user pack folder (the editor's saves; core-ffg is refused): the Tauri command
 * write_pack_file, or a PUT to the Vite dev server in a plain browser
 */
export async function writePackFile(dir: string, path: string, content: string): Promise<void> {
  if (inTauri()) { await invoke("write_pack_file", { dir, path, content }); return; }
  const r = await fetch(`/packs/${dir}/${path.split("/").map(encodeURIComponent).join("/")}`, { method: "PUT", body: content });
  if (!r.ok) throw new Error(`${dir}/${path}: HTTP ${r.status} ${await r.text()}`);
}

// ---------------------------------------------------------------- packs as zip files (src-tauri/src/packzip.rs)
/** Phones and tablets: no game install and no Python there, packs come as zip files */
export const isMobile = (): boolean => /Android|iPhone|iPad/i.test(navigator.userAgent);

export interface PackZipProgress { task: "export" | "import"; done: number; total: number }
export const onPackZip = (f: (p: PackZipProgress) => void): Promise<UnlistenFn> =>
  listen<PackZipProgress>("pack-zip", (e) => f(e.payload));

/** Ask where to save and export the pack folder `dir` there; null if the dialog was cancelled */
export async function exportPackZip(dir: string): Promise<string | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const dest = await save({ defaultPath: `${dir}.zip`, filters: [{ name: "Пак JiME", extensions: ["zip"] }] });
  if (!dest) return null;
  return invoke<string>("export_pack", { dir, dest: /\.zip$/i.test(dest) ? dest : `${dest}.zip` });
}

/** Pick a pack zip and unpack it into the packs folder; null if the dialog was cancelled */
export async function importPackZip(): Promise<PacksInfo | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  // Android's picker filters by MIME type: an extension filter there can hide the file, so no filter
  const src = await open({ multiple: false, directory: false, filters: isMobile() ? undefined : [{ name: "Пак JiME", extensions: ["zip"] }] });
  if (!src) return null;
  return invoke<PacksInfo>("import_pack", { src });
}

/** Application.OpenURL: a web page in the system browser (a new tab outside Tauri) */
export async function openUrl(url: string): Promise<void> {
  if (!/^https?:\/\//.test(url)) return;
  if (isTauri()) await invoke("open_url", { url });
  else window.open(url, "_blank", "noopener");
}

/** The title screen's Quit: close the app window (a plain browser tab cannot close itself: false) */
export async function quitApp(): Promise<boolean> {
  if (!isTauri()) return false;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().close();
  return true;
}
