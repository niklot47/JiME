/// <reference lib="webworker" />
// Tinted and 9-sliced NGUI sprites made off the main thread (pixel loops and PNG encoding stalled animations on
// phones for up to 0.7 s). Request: {id, op: "tint", src, c} | {id, op: "slice", src, border, w, h, W, H, scale}.
// ("scale": UI unit -> pixels of the slice). Reply: {id, blob} (blob null on failure). Same drawing as the main-thread fallback in NguiView.tsx.

type Req =
  | { id: number; op: "tint"; src: string; c: number[] }
  | { id: number; op: "slice"; src: string; border: [number, number, number, number]; w: number; h: number; W: number; H: number; scale: number };

const bitmaps = new Map<string, Promise<ImageBitmap>>();
function load(src: string): Promise<ImageBitmap> {
  let p = bitmaps.get(src);
  if (!p) {
    p = fetch(src).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${src}`);
      return r.blob();
    }).then((b) => createImageBitmap(b, { premultiplyAlpha: "none", colorSpaceConversion: "none" }));
    bitmaps.set(src, p);
  }
  return p;
}

function tint(img: ImageBitmap, c: number[]): OffscreenCanvas {
  const cv = new OffscreenCanvas(img.width, img.height);
  const g = cv.getContext("2d")!;
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, cv.width, cv.height);
  const r = c[0]!, gr = c[1]!, b = c[2]!;
  for (let i = 0; i < d.data.length; i += 4) {
    d.data[i] = d.data[i]! * r; d.data[i + 1] = d.data[i + 1]! * gr; d.data[i + 2] = d.data[i + 2]! * b;
  }
  g.putImageData(d, 0, 0);
  return cv;
}

function slice(img: ImageBitmap, border: [number, number, number, number], w: number, h: number, W: number, H: number, scale: number): OffscreenCanvas {
  const iw = img.width, ih = img.height;
  const [l, r, t, b] = border;
  // source columns / rows: border, middle (at least one texel), border
  const sx = [0, Math.min(l, iw - 1), Math.max(Math.min(l, iw - 1) + 1, iw - r), iw];
  const sy = [0, Math.min(t, ih - 1), Math.max(Math.min(t, ih - 1) + 1, ih - b), ih];
  // destination: borders at their UI size (shrunk together when the widget is smaller), middle stretched
  const kx = Math.min(1, w / Math.max(1, l + r)), ky = Math.min(1, h / Math.max(1, t + b));
  const dl = Math.round(l * kx * scale), dr = Math.round(r * kx * scale);
  const dt = Math.round(t * ky * scale), db = Math.round(b * ky * scale);
  const dx = [0, dl, W - dr, W], dy = [0, dt, H - db, H];
  const cv = new OffscreenCanvas(W, H);
  const g = cv.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const sw = sx[i + 1]! - sx[i]!, sh = sy[j + 1]! - sy[j]!, ow = dx[i + 1]! - dx[i]!, oh = dy[j + 1]! - dy[j]!;
      if (sw > 0 && sh > 0 && ow > 0 && oh > 0) g.drawImage(img, sx[i]!, sy[j]!, sw, sh, dx[i]!, dy[j]!, ow, oh);
    }
  }
  return cv;
}

self.onmessage = async (e: MessageEvent<Req>) => {
  const m = e.data;
  try {
    const img = await load(m.src);
    const cv = m.op === "tint" ? tint(img, m.c) : slice(img, m.border, m.w, m.h, m.W, m.H, m.scale);
    const blob = await cv.convertToBlob({ type: "image/png" });
    self.postMessage({ id: m.id, blob });
  } catch {
    self.postMessage({ id: m.id, blob: null });
  }
};
