// Draws parts of the game's NGUI interface from the exported layout (ui.json), scaled to the window like UIRoot
// (fit height to 720 UI units). The app drives it with bindings by node name (texts, clicks, show/hide, fills, clones).
import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { assetUrl, type AtlasSprite } from "../data/pack.ts";
import { Particles2D } from "./Particles2D.tsx";
import type { UiLayoutFile, UiNode } from "./types.ts";
import { solve, type Binds, type Box, type Enter, type Measured } from "./solve.ts";

export type { Bind, Binds, Enter } from "./solve.ts";
type Atlas = Record<string, AtlasSprite>;
type Say = (key: string | null | undefined, ins?: readonly string[]) => string;

// ---------------------------------------------------------------- tinted sprites (NGUI multiplies the sprite colour)
const tinted = new Map<string, string | null>();
const listeners = new Set<() => void>();
let version = 0;
const subscribe = (f: () => void) => { listeners.add(f); return () => listeners.delete(f); };
const snapshot = () => version;

// ---------------------------------------------------------------- interface scale (options): UIRoot fits 720 / scale
const SCALE_KEY = "jime.ui.scale";
let uiScale = (() => { try { const v = Number(localStorage.getItem(SCALE_KEY)); return v >= 0.4 && v <= 1.5 ? v : 1; } catch { return 1; } })();
export const getUiScale = () => uiScale;
export function setUiScale(v: number): void {
  uiScale = v;
  try { localStorage.setItem(SCALE_KEY, String(v)); } catch { /* per session only */ }
  version++;
  for (const f of listeners) f();
}


// images still being made for the view now drawing: the view stays hidden until they are all there, so a dialog
// appears complete instead of flashing through its unfinished parts (plain sprites, then tinted / sliced ones)
let pendingImages = 0;

/** URL of `src` multiplied by colour c (cached; null while it is being made, "" if it failed) */
function tintUrl(src: string, c: number[]): string | null {
  const key = `${src}|${c.join(",")}`;
  if (tinted.has(key)) return tinted.get(key)!;
  tinted.set(key, null);
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    const cv = document.createElement("canvas");
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const g = cv.getContext("2d")!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, cv.width, cv.height);
    for (let i = 0; i < d.data.length; i += 4) {
      d.data[i] = d.data[i]! * c[0]!; d.data[i + 1] = d.data[i + 1]! * c[1]!; d.data[i + 2] = d.data[i + 2]! * c[2]!;
    }
    g.putImageData(d, 0, 0);
    cv.toBlob((b) => { tinted.set(key, b ? URL.createObjectURL(b) : ""); version++; for (const f of listeners) f(); });
  };
  img.onerror = () => { tinted.set(key, ""); version++; for (const f of listeners) f(); };
  img.src = src;
  return null;
}

// ---------------------------------------------------------------- sliced sprites, drawn once per size
// CSS border-image leaves seams between the slices when the UI is scaled, and cannot stretch a zero-width middle:
// many NGUI sprites are all border (Frame_Empty 64 x 37 with borders 32 + 32 / 28 + 9), NGUI then stretches the one
// texel line between the borders. Here the nine parts are drawn into one canvas at twice the UI size.
const SLICE_SCALE = 2;
const sliced = new Map<string, string | null>();
const images = new Map<string, Promise<HTMLImageElement>>();
function loadImage(src: string): Promise<HTMLImageElement> {
  let p = images.get(src);
  if (!p) {
    p = new Promise((ok, fail) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => ok(i); i.onerror = fail; i.src = src; });
    images.set(src, p);
  }
  return p;
}

/** URL of `src` 9-sliced to w x h UI units with borders [l, r, t, b] (cached; null while it is being made) */
function slicedUrl(src: string, border: [number, number, number, number], w: number, h: number): string | null {
  const W = Math.max(1, Math.round(w * SLICE_SCALE)), H = Math.max(1, Math.round(h * SLICE_SCALE));
  const key = `${src}|${W}x${H}`;
  if (sliced.has(key)) return sliced.get(key)!;
  sliced.set(key, null);
  void loadImage(src).then((img) => {
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const [l, r, t, b] = border;
    // source columns / rows: border, middle (at least one texel), border
    const sx = [0, Math.min(l, iw - 1), Math.max(Math.min(l, iw - 1) + 1, iw - r), iw];
    const sy = [0, Math.min(t, ih - 1), Math.max(Math.min(t, ih - 1) + 1, ih - b), ih];
    // destination: borders at their UI size (shrunk together when the widget is smaller), middle stretched
    const kx = Math.min(1, w / Math.max(1, l + r)), ky = Math.min(1, h / Math.max(1, t + b));
    const dl = Math.round(l * kx * SLICE_SCALE), dr = Math.round(r * kx * SLICE_SCALE);
    const dt = Math.round(t * ky * SLICE_SCALE), db = Math.round(b * ky * SLICE_SCALE);
    const dx = [0, dl, W - dr, W], dy = [0, dt, H - db, H];
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const g = cv.getContext("2d")!;
    g.imageSmoothingQuality = "high";
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const sw = sx[i + 1]! - sx[i]!, sh = sy[j + 1]! - sy[j]!, ow = dx[i + 1]! - dx[i]!, oh = dy[j + 1]! - dy[j]!;
        if (sw > 0 && sh > 0 && ow > 0 && oh > 0) g.drawImage(img, sx[i]!, sy[j]!, sw, sh, dx[i]!, dy[j]!, ow, oh);
      }
    }
    cv.toBlob((bl) => { sliced.set(key, bl ? URL.createObjectURL(bl) : ""); version++; for (const f of listeners) f(); });
  }).catch(() => { sliced.set(key, ""); version++; for (const f of listeners) f(); });
  return null;
}

// ---------------------------------------------------------------- widget styles
const MAT_GAIN = 1.6;
const isWhite = (c?: number[]) => !c || (c[0] === 1 && c[1] === 1 && c[2] === 1);

function imageStyle(box: Box, atlas: Atlas): CSSProperties | null {
  const { w, bind } = box;
  let color = bind.color ?? w.c;
  // a custom material's _Color (lit/emissive shaders in the game): multiplied in, brightened to stand for the emission
  if (w.mc) {
    const c = color ?? [1, 1, 1, 1];
    color = [0, 1, 2].map((i) => Math.min(1, c[i]! * w.mc![i]! * MAT_GAIN)).concat([c[3] ?? 1]);
  }
  let url: string | undefined;
  let border: [number, number, number, number] = [0, 0, 0, 0];
  let pad: [number, number, number, number] | null = null;
  let size: [number, number] = [1, 1];
  if (w.k === "sprite" && bind.tex) {
    url = /^(https?:|blob:|data:|\/)/.test(bind.tex) ? bind.tex : assetUrl(bind.tex);
  } else if (w.k === "sprite") {
    const name = bind.sprite ?? w.sp;
    const s = name ? atlas[name] : undefined;
    if (!s) return null;
    url = assetUrl(s.file);
    border = s.border;
    pad = (s as { pad?: [number, number, number, number] }).pad ?? null;
    size = [s.w, s.h];
  } else if (w.k === "texture" || w.k === "sprite2d") {
    const t = bind.tex ?? w.tex;
    if (!t) return null;
    url = /^(https?:|blob:|data:|\/)/.test(t) ? t : assetUrl(t);
  } else return null;
  let waiting = false;
  if (!isWhite(color)) {
    const t = tintUrl(url, color!);
    if (t === null) waiting = true;
    url = t || url;
  }
  const st: CSSProperties = {};
  const [l, r, t, b] = border;
  const ready = w.t === 1 && (l || r || t || b) ? slicedUrl(url, border, box.width, box.height) : null;
  if (ready === null && w.t === 1 && (l || r || t || b)) waiting = true;
  if (waiting) pendingImages++;
  if (ready) {
    st.backgroundImage = `url("${ready}")`;
    st.backgroundSize = "100% 100%";
  } else if (w.t === 1 && (l || r || t || b)) {
    st.borderStyle = "solid";
    st.borderWidth = `${t}px ${r}px ${b}px ${l}px`;
    st.borderImage = `url("${url}") ${t} ${r} ${b} ${l} fill / ${t}px ${r}px ${b}px ${l}px stretch`;
    st.boxSizing = "border-box";
  } else {
    st.backgroundImage = `url("${url}")`;
    st.backgroundSize = "100% 100%";
    if (pad) {
      // UISprite.drawingDimensions: the trimmed sprite inside its padding, scaled with the widget
      const [pl, pr, pt, pb] = pad;
      const fw = size[0] + pl + pr, fh = size[1] + pt + pb;
      st.backgroundSize = `${(size[0] / fw) * 100}% ${(size[1] / fh) * 100}%`;
      st.backgroundPosition = `${pl + pr ? (pl / (pl + pr)) * 100 : 0}% ${pt + pb ? (pt / (pt + pb)) * 100 : 0}%`;
      st.backgroundRepeat = "no-repeat";
    }
  }
  // filled sprites: horizontal / vertical crop, radial with a conic mask
  const fa = bind.fill ?? w.fa;
  if (w.t === 3 && fa !== undefined && fa < 1) {
    const cut = `${(1 - fa) * 100}%`;
    if (w.fd === 0) st.clipPath = w.inv ? `inset(0 0 0 ${cut})` : `inset(0 ${cut} 0 0)`;
    else if (w.fd === 1) st.clipPath = w.inv ? `inset(0 0 ${cut} 0)` : `inset(${cut} 0 0 0)`;
    else {
      const deg = fa * 360;
      const m = `conic-gradient(#000 ${deg}deg, transparent ${deg}deg)`;
      st.maskImage = m; (st as any).WebkitMaskImage = m;
    }
  }
  // gradient sprites: alpha from the top colour to the bottom one (a fade; the hue is the widget colour)
  if (w.grad && w.k === "sprite") {
    const [top, bottom] = w.grad;
    const m = `linear-gradient(to bottom, rgba(0,0,0,${top[3] ?? 1}), rgba(0,0,0,${bottom[3] ?? 1}))`;
    st.maskImage = m; (st as any).WebkitMaskImage = m;
  }
  // not drawn until its tinted / sliced image is made (no flash of the plain sprite)
  if (waiting) st.visibility = "hidden";
  if (w.flip === 1 || w.flip === 3) st.transform = "scaleX(-1)";
  if (w.flip === 2 || w.flip === 3) st.transform = `${st.transform ?? ""} scaleY(-1)`;
  return st;
}

/** CSS of an entrance animation (styles.css @keyframes ng-enter: from the offset / transparent to the box as it is) */
function enterStyle(e: Enter): CSSProperties {
  const [dx, dy] = e.from ?? [0, 0];
  if (e.via) {
    // in, a stop on the way (held while it shakes), then to the place: keyframes built for these times
    const name = `ng-enter-via-${Math.round((e.viaAt ?? 0.4) * 100)}-${Math.round((e.holdTo ?? e.viaAt ?? 0.4) * 100)}`;
    ensureViaKeyframes(name, e.viaAt ?? 0.4, e.holdTo ?? e.viaAt ?? 0.4);
    return {
      animation: `${name} ${e.dur ?? 1}s ease-in-out ${e.delay ?? 0}s both`
        + (e.shake ? `, ng-shake ${e.shake.dur}s ease-out ${(e.delay ?? 0) + e.shake.delay}s both` : ""),
      ["--ng-x" as string]: `${dx}px`, ["--ng-y" as string]: `${-dy}px`,
      ["--ng-vx" as string]: `${e.via[0]}px`, ["--ng-vy" as string]: `${-e.via[1]}px`,
      ["--ng-o" as string]: e.fade ? 0 : 1, ["--ng-out" as string]: e.from && !e.fade ? 1 : 0,
      ...(e.shake ? { ["--ng-sh" as string]: `${e.shake.deg}deg` } : {}),
    };
  }
  return {
    // SlidingElement.SlideElement: smoothstep 6t^5 - 15t^4 + 10t^3 (close to this bezier)
    animation: `ng-enter ${e.dur ?? 0.35}s ${e.linear ? "linear" : "cubic-bezier(0.65, 0, 0.35, 1)"} ${e.delay ?? 0}s both`
      + (e.shake ? `, ng-shake ${e.shake.dur}s ease-out ${(e.delay ?? 0) + e.shake.delay}s both` : ""),
    ...(e.shake ? { ["--ng-sh" as string]: `${e.shake.deg}deg` } : {}),
    ["--ng-x" as string]: `${dx}px`,
    ["--ng-y" as string]: `${-dy}px`,
    ["--ng-o" as string]: e.fade ? 0 : 1,
    // leaving (.ng-leaving): a slide goes back out opaque, anything else fades
    ["--ng-out" as string]: e.from && !e.fade ? 1 : 0,
  };
}

const viaDone = new Set<string>();
/** keyframes for an entrance with a stop: from the offset to the stop by `at`, held until `hold`, then to the place */
function ensureViaKeyframes(name: string, at: number, hold: number): void {
  if (viaDone.has(name)) return;
  viaDone.add(name);
  const st = document.createElement("style");
  const p = (v: number) => `${Math.round(v * 100)}%`;
  st.textContent = `@keyframes ${name} { 0% { translate: var(--ng-x) var(--ng-y); opacity: var(--ng-o, 1); }
    ${p(at)}, ${p(hold)} { translate: var(--ng-vx) var(--ng-vy); opacity: 1; } 100% { translate: 0 0; opacity: 1; } }`;
  document.head.appendChild(st);
}

const ALIGN: Record<number, CSSProperties["textAlign"]> = { 0: "left", 1: "left", 2: "center", 3: "right", 4: "justify" };
const AUTO: CSSProperties["textAlign"][] = ["left", "center", "right"];
const css = (c?: number[] | null) => (c ? `rgba(${Math.round(c[0]! * 255)}, ${Math.round(c[1]! * 255)}, ${Math.round(c[2]! * 255)}, ${c[3] ?? 1})` : undefined);

function labelStyle(box: Box, fontScale: number): CSSProperties {
  const lb = box.w.lb!;
  const color = box.bind.color ?? box.w.c ?? [1, 1, 1, 1];
  const st: CSSProperties = {
    fontFamily: lb.font === "title" ? "var(--font-title)" : "var(--font-text)",
    // NGUI bitmap font sizes are line heights; the TTF versions look right at ~0.8 of it
    fontSize: `${lb.size * fontScale * 0.8}px`,
    lineHeight: `${(lb.size + (lb.sy ?? 0)) * fontScale}px`,
    color: css([color[0]!, color[1]!, color[2]!, 1]),
    // Automatic (0) follows the pivot's horizontal side, as in NGUIText
    textAlign: (box.bind.al ?? lb.al) === 0 ? AUTO[(box.bind.pv ?? box.w.pv) % 3] : ALIGN[box.bind.al ?? lb.al] ?? "left",
    fontStyle: lb.style === 2 || lb.style === 3 ? "italic" : undefined,
    fontWeight: lb.style === 1 || lb.style === 3 ? "bold" : undefined,
    whiteSpace: "pre-line",
    display: "flex",
    flexDirection: "column",
    justifyContent: [0, 1, 2].includes(box.bind.pv ?? box.w.pv) ? "flex-start" : [6, 7, 8].includes(box.bind.pv ?? box.w.pv) ? "flex-end" : "center",
  };
  if (lb.eff) {
    const [kind, c, d] = lb.eff;
    const e = css(c);
    st.textShadow = kind === 1 ? `${d}px ${d}px 0 ${e}` : `${d}px 0 0 ${e}, -${d}px 0 0 ${e}, 0 ${d}px 0 ${e}, 0 -${d}px 0 ${e}`;
  }
  return st;
}

// ---------------------------------------------------------------- view
export interface NguiViewProps {
  layout: UiLayoutFile;
  atlas: Atlas;
  /** subtrees to draw, by node name or path (see findNode) */
  show: UiNode[];
  binds: Binds;
  say: Say;
  className?: string;
  /** draw inactive nodes too (layout preview) */
  all?: boolean;
}

export function NguiView({ layout, atlas, show, binds, say, className, all }: NguiViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<[number, number]>([1280, 720]);
  const [measured, setMeasured] = useState(() => new Map<string, Measured>());
  // UILabel.Overflow.ShrinkContent: font factor per label until its text fits (reset when the text changes)
  const shownOnce = useRef(false);
  // boxes whose entrance animation has finished: no restart when React moves their element (a reorder re-inserts it)
  const entered = useRef(new Set<string>());
  const [shrink, setShrink] = useState(() => new Map<string, { html: string; f: number }>());
  useSyncExternalStore(subscribe, snapshot);
  useLayoutEffect(() => {
    const el = host.current!;
    const ro = new ResizeObserver(() => setSize([el.clientWidth || 1280, el.clientHeight || 720]));
    ro.observe(el);
    setSize([el.clientWidth || 1280, el.clientHeight || 720]);
    return () => ro.disconnect();
  }, []);
  // the whole interface at uiScale: a taller (and wider) virtual screen, anchored parts follow its edges
  const scale = (size[1] / 720) * uiScale;
  const screenW = size[0] / scale;
  const screenH = size[1] / scale;
  const include = useMemo(() => new Set(show.map((n) => n.id)), [show]);
  const placed = useMemo(() => {
    let out: Binds | null = null;
    for (const [k, b] of Object.entries(binds)) {
      if (!b.atPx) continue;
      out ??= { ...binds };
      out[k] = { ...b, at: [b.atPx[0] / scale - screenW / 2, screenH / 2 - b.atPx[1] / scale] };
    }
    return out ?? binds;
  }, [binds, scale, screenW, screenH]);
  const boxes = solve(layout.root, placed, screenW, measured, include, all, screenH);

  // labels that size themselves: measure, then lay out again
  const labelRefs = useRef(new Map<string, HTMLDivElement>());
  useLayoutEffect(() => {
    let changed = false;
    const next = new Map(measured);
    for (const b of boxes) {
      if (!b.autoH && !b.autoW) continue;
      const el = labelRefs.current.get(b.key);
      if (!el) continue;
      const m = { w: b.autoW ? el.scrollWidth : b.width, h: el.scrollHeight };
      const old = measured.get(b.key);
      if (!old || Math.abs(old.h - m.h) > 0.5 || Math.abs(old.w - m.w) > 0.5) { next.set(b.key, m); changed = true; }
    }
    if (changed) setMeasured(next);
    let shrunk = false;
    const sh = new Map(shrink);
    for (const b of boxes) {
      if (b.w.k !== "label" || b.w.lb!.ov !== 0 || b.autoH || b.autoW) continue;
      const el = labelRefs.current.get(b.key);
      if (!el) continue;
      const html = el.firstElementChild?.innerHTML ?? "";
      const cur = sh.get(b.key);
      if (cur && cur.html !== html) { sh.set(b.key, { html, f: 1 }); shrunk = true; continue; }
      const f = cur?.f ?? 1;
      if (f > 0.3 && (el.scrollHeight > b.height + 1 || el.scrollWidth > b.width + 1)) { sh.set(b.key, { html, f: f * 0.92 }); shrunk = true; }
      else if (!cur) sh.set(b.key, { html, f: 1 });
    }
    if (shrunk) setShrink(sh);
  });

  pendingImages = 0;
  // a box gone from the view enters again next time it shows
  const present = new Set(boxes.map((b) => b.key));
  for (const k of entered.current) if (!present.has(k)) entered.current.delete(k);
  const wobbles = new Map<string, Wobble>();
  const onEnd = (key: string) => (e: React.AnimationEvent) => { if (e.animationName.startsWith("ng-enter")) entered.current.add(key); };
  const items = boxes.map((b) => {
          const st: CSSProperties = { left: b.left, top: b.top, width: b.width, height: b.autoH ? "auto" : b.height, zIndex: Math.round(b.z * 10) };
          let softMask: CSSProperties | null = null;
          if (b.clip) {
            // inside a clipping panel (scroll views): cut to its region, nothing at all when wholly outside
            const c = b.clip;
            if (b.left >= c.r || b.left + b.width <= c.l || b.top >= c.b || b.top + b.height <= c.t) return null;
            const ins = [c.t - b.top, b.left + b.width - c.r, b.top + b.height - c.b, c.l - b.left].map((v) => Math.max(0, v));
            if (c.sx || c.sy) {
              // UIPanel soft clip: the contents fade out towards the region's edges
              const sx = c.sx ?? 0, sy = c.sy ?? 0;
              const h = `linear-gradient(to right, transparent ${c.l - b.left}px, #000 ${c.l + sx - b.left}px, #000 ${c.r - sx - b.left}px, transparent ${c.r - b.left}px)`;
              const v = `linear-gradient(to bottom, transparent ${c.t - b.top}px, #000 ${c.t + sy - b.top}px, #000 ${c.b - sy - b.top}px, transparent ${c.b - b.top}px)`;
              softMask = { maskImage: `${h}, ${v}`, maskComposite: "intersect", WebkitMaskImage: `${h}, ${v}`, WebkitMaskComposite: "source-in" } as CSSProperties;
            } else if (ins.some((v) => v > 0)) st.clipPath = `inset(${ins.map((v) => `${v}px`).join(" ")})`;
          }
          // a particle system: the player around its point
          if (b.node.ps) {
            if (!b.psK) return null;
            return <Particles2D key={b.key} ps={b.node.ps} x={b.left} y={b.top} k={b.psK} z={Math.round(b.z * 10)} mirror={b.orient[0]! < 0} />;
          }
          if (b.bind.originParent) st.transformOrigin = `${b.px - b.left}px ${b.py - b.top}px`;
          // turned / mirrored widgets turn about their pivot; a shaking group turns about its entering node, so the
          // matrix carries the pivot offset itself (a sprite's own flip stays the image style's, about its centre)
          const m = b.orient;
          const turned = Math.abs(m[0]! - 1) > 1e-3 || Math.abs(m[1]!) > 1e-3 || Math.abs(m[2]!) > 1e-3 || Math.abs(m[3]! - 1) > 1e-3;
          const shake = b.enter?.shake && b.eo && !entered.current.has(b.key);
          if (turned || shake) {
            const [fx, fy] = ([[0, 1], [0.5, 1], [1, 1], [0, 0.5], [0.5, 0.5], [1, 0.5], [0, 0], [0.5, 0], [1, 0]][b.bind.pv ?? b.w.pv] ?? [0.5, 0.5]) as [number, number];
            const P = [fx * b.width, (1 - fy) * b.height];
            const O = shake ? [b.eo![0] - b.left, b.eo![1] - b.top] : P;
            st.transformOrigin = `${O[0]}px ${O[1]}px`;
            if (turned) {
              // y-up [a b; c d] in CSS's y-down space, about P while the origin is O
              const A = m[0]!, B = -m[2]!, C = -m[1]!, D = m[3]!;
              const dx = P[0]! - O[0]!, dy = P[1]! - O[1]!;
              st.transform = `matrix(${A}, ${B}, ${C}, ${D}, ${dx - (A * dx + C * dy)}, ${dy - (B * dx + D * dy)})`;
            }
          }
          const color = b.bind.color ?? b.w.c;
          if (color && color[3] !== undefined && color[3] < 1) st.opacity = color[3];
          if (b.enter) {
            Object.assign(st, enterStyle(b.enter));
            if (entered.current.has(b.key)) st.animation = "none";
          }
          if (b.bind.pulse) {
            const [a0, a1, d] = b.bind.pulse;
            const anim = `ng-pulse ${d}s ease-in-out infinite alternate`;
            st.animation = st.animation && st.animation !== "none" ? `${st.animation}, ${anim}` : anim;
            Object.assign(st, { ["--ng-a0" as string]: a0, ["--ng-a1" as string]: a1 });
          }
          // looping tweens of the node (style 1 loop / 2 ping-pong, playing): a pulsing glow (TweenAlpha)
          for (const t of b.node.tw ?? []) {
            if (!t.on || !t.style || t.k !== "alpha" || typeof t.from !== "number" || typeof t.to !== "number") continue;
            const a = color && color[3] !== undefined ? color[3] : 1;
            const anim = `ng-pulse ${t.dur}s ease-in-out ${t.delay ?? 0}s infinite ${t.style === 2 ? "alternate" : "normal"}`;
            st.animation = st.animation && st.animation !== "none" ? `${st.animation}, ${anim}` : anim;
            Object.assign(st, { ["--ng-a0" as string]: t.from * a, ["--ng-a1" as string]: t.to * a });
          }
          // TweenPosition / TweenScale between two states: glide to the new place and size
          if (b.move) st.transition = ["left", "top", "width", "height"].map((p) => `${p} ${b.move}s cubic-bezier(0.65, 0, 0.35, 1)`).join(", ");
          const click = b.bind.onClick && !b.bind.disabled ? b.bind.onClick : undefined;
          // UIButton.disabledColor multiplies the sprite (a plain darkening, the hue is kept)
          const dis = b.bind.disabled && b.node.btn?.disabled;
          if (dis) st.filter = `brightness(${(((dis[0] ?? 1) + (dis[1] ?? 1) + (dis[2] ?? 1)) / 3).toFixed(3)})`;
          const cls = `ng ng-${b.w.k}${click ? " ng-click" : ""}${b.bind.disabled ? " ng-disabled" : ""}${b.node.btn ? " ng-btn" : ""} ${b.bind.className ?? ""}`;
          if (b.w.k === "label") {
            // label text: binding, its localization component, a bare key typed into the label (set by code), the saved text
            const raw = b.w.lb!.text;
            const keyText = /^[A-Z][A-Z0-9_]+$/.test(raw) ? say(raw) : "";
            const html = b.bind.html ?? (b.bind.text !== undefined ? escapeHtml(b.bind.text) : b.node.loc ? say(b.node.loc) : keyText || escapeHtml(raw));
            return (
              <div key={b.key} data-n={b.node.n} className={cls} style={{ ...st, ...labelStyle(b, shrink.get(b.key)?.f ?? 1), ...softMask }} title={b.bind.title} onClick={click} onAnimationEnd={b.enter ? onEnd(b.key) : undefined}
                ref={(el) => { if (el) labelRefs.current.set(b.key, el); else labelRefs.current.delete(b.key); }}>
                <span dangerouslySetInnerHTML={{ __html: html }} />
                {b.bind.content}
              </div>
            );
          }
          let img = imageStyle(b, atlas);
          if (img && st.transform) delete (img as CSSProperties).transform;
          const fx = b.w.fx;
          if (fx?.k === "scroll") {
            // ScrollingWithMask: the texture tiled and moving one tile per 1 / v seconds, cut by its mask (a grey image)
            const fs = b.bind.fxScroll;
            const tw = b.width * (fs?.tile ?? 1), th = b.height * (fs?.tile ?? 1);
            img = { backgroundImage: `url("${assetUrl(fx.tex)}")`, backgroundSize: `${tw}px ${th}px`, backgroundRepeat: "repeat",
              maskImage: `url("${assetUrl(fx.mask)}")`, maskSize: "100% 100%", maskMode: "luminance", WebkitMaskImage: `url("${assetUrl(fx.mask)}")`, WebkitMaskSize: "100% 100%",
              // (the direction is the screen's: a mirrored picture scrolls its texture the other way)
              ["--ng-tw" as string]: `${(fs?.dx ?? -1) * (b.orient[0]! < 0 ? -1 : 1) * tw}px`, ["--ng-th" as string]: `${(fs?.dy ?? 0) * th}px`,
              ...(fs?.opacity !== undefined ? { opacity: fs.opacity } : {}) } as CSSProperties;
            const scrollAnim = `ng-scroll ${(fs?.dur ?? 1 / Math.max(0.005, fx.v)).toFixed(1)}s linear infinite`;
            st.animation = st.animation && st.animation !== "none" ? `${st.animation}, ${scrollAnim}` : scrollAnim;
          } else if (fx?.k === "wobble" && fx.s > 0) {
            // FlameDistortion: displaced by a noise flowing one way (up, or down when reversed) through the picture
            const id = wobbleId(b.width, b.height, fx.s * Math.min(b.width, b.height) * 0.5, fx.v, !!fx.rev);
            wobbles.set(id.id, id);
            st.filter = `${st.filter ? `${st.filter} ` : ""}url(#${id.id})`;
          }
          if (!img && !click && !b.bind.content) return null;
          return <div key={b.key} data-n={b.node.n} className={cls} style={{ ...st, ...img, ...softMask }} title={b.bind.title} onClick={click} onAnimationEnd={b.enter ? onEnd(b.key) : undefined}>{b.bind.content}</div>;
        });
  // hidden only until it has been complete once (a later new image must not blank a view that is already up)
  const complete = pendingImages === 0;
  if (complete) shownOnce.current = true;
  return (
    <div ref={host} className={`ngui ${className ?? ""}`}>
      <div className={`ngui-root${complete || shownOnce.current ? "" : " ng-wait"}`} style={{ width: screenW, height: screenH, transform: `scale(${scale})`, visibility: complete || shownOnce.current ? undefined : "hidden" }}>
        {items}
      </div>
      {wobbles.size > 0 && (
        <svg className="ng-fx-defs" width="0" height="0" aria-hidden="true">
          {[...wobbles.values()].map((w) => (
            // the noise is one seamless tile of the picture's size, tiled, and moved by a whole tile per cycle: it flows
            // without turning back
            <filter key={w.id} id={w.id} filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse"
              x={-w.pad} y={-w.pad} width={w.w + 2 * w.pad} height={w.h + 2 * w.pad}>
              <feTurbulence type="fractalNoise" baseFrequency={`${(3 / w.w).toFixed(4)} ${(3 / w.h).toFixed(4)}`} numOctaves="2" seed="3"
                stitchTiles="stitch" x="0" y="0" width={w.w} height={w.h} result="n" />
              <feTile in="n" x={-w.w} y={-w.h} width={3 * w.w} height={3 * w.h} result="t" />
              <feOffset in="t" dx="0" dy="0" result="o">
                <animate attributeName="dy" from="0" to={w.rev ? w.h : -w.h} dur={`${w.dur}s`} repeatCount="indefinite" />
              </feOffset>
              <feDisplacementMap in="SourceGraphic" in2="o" scale={w.scale} xChannelSelector="R" yChannelSelector="G" />
            </filter>
          ))}
        </svg>
      )}
    </div>
  );
}

interface Wobble { id: string; w: number; h: number; pad: number; scale: number; dur: number; rev: boolean }
/** a flowing-noise filter for a picture's size, a displacement (px), a speed (_Speed: picture heights per second)
 *  and a direction, shared by the boxes that need the same */
function wobbleId(width: number, height: number, px: number, speed: number, rev: boolean): Wobble {
  const w = Math.max(4, Math.round(width)), h = Math.max(4, Math.round(height));
  const scale = Math.max(1, Math.round(px));
  const dur = Math.round(Math.min(30, Math.max(1.5, 1 / Math.max(0.01, speed))) * 10) / 10;
  return { id: `ng-wobble-${w}-${h}-${scale}-${String(dur).replace(".", "_")}${rev ? "r" : ""}`, w, h, pad: scale + 2, scale, dur, rev };
}

const escapeHtml = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
