// The scene transitioner (UI_Game.SceneTransitioner, Panel_SceneTransitioner: a black panel whose TweenAlpha LevelLoader
// plays forward before a scene change and in reverse after it): fade to black, swap the screen, fade back in.
import { useEffect, useState } from "react";

/** seconds of each half (the original's tween is 1.5 s; a little quicker here) */
export const CURTAIN_S = 0.9;

let setOn: ((on: boolean) => void) | null = null;
let busy = false;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The black panel over everything; mount once */
export function Curtain() {
  const [on, set] = useState(false);
  useEffect(() => { setOn = set; return () => { setOn = null; }; }, []);
  return <div className={`scene-curtain${on ? " on" : ""}`} style={{ transitionDuration: `${CURTAIN_S}s` }} />;
}

/**
 * Fade to black, run `change` (the new screen mounts behind the curtain), give it a moment to set up, fade back in.
 * A transition already running swallows the call (LevelLoader.s_isLoading).
 */
export async function sceneTransition(change: () => void | Promise<void>, settleMs = 350): Promise<void> {
  if (busy) return;
  if (!setOn) { await change(); return; }
  busy = true;
  try {
    setOn(true);
    await wait(CURTAIN_S * 1000);
    await change();
    await wait(settleMs);
  } finally {
    setOn?.(false);
    busy = false;
  }
}

/**
 * The page's sliding elements leave the way they came (Bind.enter played backwards, styles.css .ng-leaving), the rest
 * fades out; then `next` runs. Returns [leaving, leave].
 */
export function useLeave(ms = 350): [boolean, (next: () => void) => void] {
  const [leaving, setLeaving] = useState(false);
  const leave = (next: () => void) => {
    if (leaving) return;
    setLeaving(true);
    setTimeout(() => { setLeaving(false); next(); }, ms);
  };
  return [leaving, leave];
}
