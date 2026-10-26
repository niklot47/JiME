// Graphics quality. Light mode on phones and tablets (later also a setting): fewer pixels, no MSAA, no depth of field.
import { isMobile } from "./host.ts";

export const LOW_GFX: boolean = isMobile();

/** WebGL canvas pixel ratio: phones report 2.5-3.5, which multiplies the fill cost by up to 12 */
export const PIXEL_RATIO: number = Math.min(LOW_GFX ? 1.25 : 2, window.devicePixelRatio || 1);

/** MSAA: costly on mobile GPUs, and with a pixel ratio above 1 hardly visible */
export const ANTIALIAS: boolean = !LOW_GFX;
