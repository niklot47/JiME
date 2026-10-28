// The interface skin of this app's own menus (a theme pack's images/ui-skin/skin.json + its atlas, see
// tools/menu-theme/build_skin.py): every region is cut out of the atlas once and published as CSS variables
//   --sk-<name>        url(...) of the region (dots in the name become dashes: button.primary -> button-primary)
//   --sk-<name>-slice  its fixed borders (border-image-slice, with "fill")
//   --sk-<name>-w      their width on screen (the atlas is drawn at skin.scale times the screen size)
// and the class "skinned" on <html>, which the .pm-* rules in styles.css use. No skin in the packs: the CSS look stays.
import { assetUrl, packJsonMerged } from "../data/pack.ts";

interface Skin {
  atlas: string;
  scale?: number;
  regions: Record<string, { rect: [number, number, number, number]; slice?: [number, number, number, number] }>;
  colors?: Record<string, string>;
}

let installed: Promise<boolean> | null = null;

export function installSkin(): Promise<boolean> {
  installed ??= (async () => {
    let skin: Skin;
    try { skin = await packJsonMerged<Skin>("images/ui-skin/skin.json"); } catch { return false; }
    if (!skin?.atlas || !skin.regions) return false;
    const img = new Image();
    img.src = assetUrl(skin.atlas);
    try { await img.decode(); } catch { return false; }
    const root = document.documentElement;
    const k = skin.scale ?? 1;
    for (const [name, r] of Object.entries(skin.regions)) {
      const [x, y, w, h] = r.rect;
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d")!.drawImage(img, x, y, w, h, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/png"));
      if (!blob) continue;
      const v = name.replace(/\./g, "-");
      const [t, ri, b, l] = r.slice ?? [0, 0, 0, 0];
      root.style.setProperty(`--sk-${v}`, `url("${URL.createObjectURL(blob)}")`);
      root.style.setProperty(`--sk-${v}-slice`, `${t} ${ri} ${b} ${l} fill`);
      root.style.setProperty(`--sk-${v}-w`, `${t / k}px ${ri / k}px ${b / k}px ${l / k}px`);
    }
    for (const [name, c] of Object.entries(skin.colors ?? {})) root.style.setProperty(`--sk-c-${name}`, c);
    root.classList.add("skinned");
    return true;
  })();
  return installed;
}
