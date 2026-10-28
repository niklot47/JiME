
// The interface skin of this app's own menus (a theme pack's images/ui-skin/skin.json + its atlas, see
// tools/menu-theme/build_skin.py): every region is cut out of the atlas once and published as CSS variables
//   --sk-<name>        url(...) of the region (dots in the name become dashes: button.primary -> button-primary)
//   --sk-<name>-slice  its fixed borders (border-image-slice, with "fill")
//   --sk-<name>-w      their width on screen (the atlas is drawn at skin.scale times the screen size)
//   --sk-<name>-ar     its aspect ratio (width / height), e.g. for the logo
// and the class "skinned" on <html>, which the .pm-* rules in styles.css use. No skin in the packs: the CSS look stays.
// A region may also be a separate image instead of an atlas rect: {"src": "images/ui-skin/logo.png"}. skin.json is
// merged over the packs per region, so a personal pack can replace just the logo (or any one region) this way.
import { assetUrl, packJsonMerged } from "../data/pack.ts";

interface Region {
  rect?: [number, number, number, number];
  src?: string;
  slice?: [number, number, number, number];
  /** picture pixels per screen pixel of this region (own pictures; else the skin's scale) */
  scale?: number;
  /** "height": the picture always fills the element's height (no vertical middle) */
  fit?: "height";
}

interface Skin {
  atlas: string;
  scale?: number;
  regions: Record<string, Region>;
  colors?: Record<string, string>;
}

let installed: Promise<boolean> | null = null;

async function decoded(src: string): Promise<HTMLImageElement | null> {
  const img = new Image();
  img.src = assetUrl(src);
  try { await img.decode(); return img; } catch { return null; }
}

export function installSkin(): Promise<boolean> {
  installed ??= (async () => {
    let skin: Skin;
    try { skin = await packJsonMerged<Skin>("images/ui-skin/skin.json"); } catch { return false; }
    if (!skin?.atlas || !skin.regions) return false;
    const atlas = await decoded(skin.atlas);
    if (!atlas) return false;
    const root = document.documentElement;
    const k = skin.scale ?? 1;
    for (const [name, r] of Object.entries(skin.regions)) {
      const v = name.replace(/\./g, "-");
      let url: string;
      let ar: number;
      if (r.src) {
        // own image: used as is
        const img = await decoded(r.src);
        if (!img) continue;
        url = img.src;
        ar = img.naturalWidth / Math.max(1, img.naturalHeight);
      } else if (r.rect) {
        const [x, y, w, h] = r.rect;
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d")!.drawImage(atlas, x, y, w, h, 0, 0, w, h);
        const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/png"));
        if (!blob) continue;
        url = URL.createObjectURL(blob);
        ar = w / Math.max(1, h);
      } else continue;
      const [t, ri, b, l] = r.slice ?? [0, 0, 0, 0];
      root.style.setProperty(`--sk-${v}`, `url("${url}")`);
      root.style.setProperty(`--sk-${v}-slice`, `${t} ${ri} ${b} ${l} fill`);
      const s = r.scale ?? k;
      // fit "height": top and bottom share the whole height (a frame with ornaments along its sides keeps them whole,
      // only its middle stretches sideways)
      root.style.setProperty(`--sk-${v}-w`, r.fit === "height"
        ? `50% ${ri / s}px 50% ${l / s}px` : `${t / s}px ${ri / s}px ${b / s}px ${l / s}px`);
      root.style.setProperty(`--sk-${v}-ar`, ar.toFixed(4));
    }
    for (const [name, c] of Object.entries(skin.colors ?? {})) root.style.setProperty(`--sk-c-${name}`, c);
    root.classList.add("skinned");
    return true;
  })();
  return installed;
}
