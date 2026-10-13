// Shared helpers for the in-game UI built from the game's NGUI atlas (images/ui/atlas, tools/importer/export_atlas.py)
import type { CSSProperties } from "react";
import type { GameView } from "@jime/engine";
import { assetUrl, type AtlasSprite } from "../../data/pack.ts";

export type Atlas = Record<string, AtlasSprite>;
export type Say = (key: string | null | undefined, ins?: readonly string[]) => string;

/** URL of an atlas sprite, undefined when the pack has no atlas */
export const spriteUrl = (a: Atlas, name: string): string | undefined => (a[name] ? assetUrl(a[name]!.file) : undefined);

/**
 * CSS for an NGUI "sliced" sprite: border-image with the sprite's 9-slice borders ([left, right, top, bottom] px).
 * scale: screen px per sprite px for the borders. Empty object without the atlas (CSS fallbacks apply).
 */
export function sliced(a: Atlas, name: string, scale = 0.5): CSSProperties {
  const s = a[name];
  if (!s) return {};
  const [l, r, t, b] = s.border;
  const w = (v: number) => `${Math.round(v * scale)}px`;
  return {
    borderStyle: "solid",
    borderWidth: `${w(t)} ${w(r)} ${w(b)} ${w(l)}`,
    borderImage: `url("${assetUrl(s.file)}") ${t} ${r} ${b} ${l} fill / ${w(t)} ${w(r)} ${w(b)} ${w(l)} stretch`,
    background: "none",
  };
}

/** Whole sprite as a stretched background */
export function bg(a: Atlas, name: string): CSSProperties {
  const u = spriteUrl(a, name);
  return u ? { backgroundImage: `url("${u}")`, backgroundSize: "100% 100%", backgroundRepeat: "no-repeat" } : {};
}

/** Game font glyphs (fonts from export_fonts.py; same code points as in the texts) */
export const GLYPH = { success: "", fate: "", damage: "", fear: "" } as const;

export const resultText = (v: GameView) => (v.result === "victory" ? "Победа" : v.result === "defeat" ? "Поражение" : v.ended ?? "");
