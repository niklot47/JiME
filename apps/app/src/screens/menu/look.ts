// Which interface the menus use: the original's (its layout imported and the "original" look chosen) or this app's own
import { useEffect, useState } from "react";
import { loadUiLayout, themeChoice } from "../../data/pack.ts";

/** "original"; "plain-chosen" (the original is there, our look chosen); "plain" (no original); "loading" */
export type Look = "loading" | "original" | "plain-chosen" | "plain";

export function useLook(): Look {
  const [look, setLook] = useState<Look>("loading");
  useEffect(() => {
    let live = true;
    void loadUiLayout().then((l) => { if (live) setLook(!l ? "plain" : themeChoice() === "plain" ? "plain-chosen" : "original"); });
    return () => { live = false; };
  }, []);
  return look;
}
