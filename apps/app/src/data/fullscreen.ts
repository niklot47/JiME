// Full screen: the app window opens full screen (tauri.conf.json); F11 / the game menu toggle it. In a browser the
// document's fullscreen API is used instead.
import { getCurrentWindow } from "@tauri-apps/api/window";
import { inTauri } from "./host.ts";

export async function isFullscreen(): Promise<boolean> {
  if (inTauri()) return getCurrentWindow().isFullscreen();
  return !!document.fullscreenElement;
}

export async function toggleFullscreen(): Promise<void> {
  try {
    if (inTauri()) {
      const w = getCurrentWindow();
      await w.setFullscreen(!(await w.isFullscreen()));
    } else if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { /* not allowed here: stay as it is */ }
}

/** F11 toggles full screen (Escape leaves it, like a game) */
export function installFullscreenKeys(): void {
  document.addEventListener("keydown", (e) => {
    if (e.key === "F11") { e.preventDefault(); void toggleFullscreen(); }
    else if (e.key === "Escape" && inTauri()) void isFullscreen().then((f) => { if (f) void getCurrentWindow().setFullscreen(false); });
  });
}
