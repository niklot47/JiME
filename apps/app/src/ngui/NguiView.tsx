// Draws parts of the game's NGUI interface from the exported layout (ui.json), scaled to the window like UIRoot
// (fit height to 720 UI units). The app drives it with bindings by node name (texts, clicks, show/hide, fills, clones).
import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { assetUrl, type AtlasSprite } from "../data/pack.ts";
import type { UiLayoutFile, UiNode } from "./types.ts";
import { solve, type Binds, type Box, type Measured } from "./solve.ts";

export type { Bind, Binds } from "./solve.ts";
type Atlas = Record<string, AtlasSprite>;
type Say = (key: string | null | undefined, ins?: readonly string[]) => string;

// ---------------------------------------------------------------- tinted sprites (NGUI multiplies the sprite colour)
const tinted = new Map<string, string | null>();
const listeners = new Set<() => void>();
let version = 0;
const subscribe = (f: () => void) => { listeners.add(f); return () => listeners.delete(f); };
const snapshot = () => version;

/** URL of `src` multiplied by colour c (cached; null while it is being made) */
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
    cv.toBlob((b) => { if (b) { tinted.set(key, URL.createObjectURL(b)); version++; for (const f of listeners) f(); } });
  };
  img.src = src;
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
  if (w.k === "sprite" && bind.tex) {
    url = /^(https?:|blob:|data:|\/)/.test(bind.tex) ? bind.tex : assetUrl(bind.tex);
  } else if (w.k === "sprite") {
    const name = bind.sprite ?? w.sp;
    const s = name ? atlas[name] : undefined;
    if (!s) return null;
    url = assetUrl(s.file);
    border = s.border;
  } else if (w.k === "texture" || w.k === "sprite2d") {
    const t = bind.tex ?? w.tex;
    if (!t) return null;
    url = /^(https?:|blob:|data:|\/)/.test(t) ? t : assetUrl(t);
  } else return null;
  if (!isWhite(color)) url = tintUrl(url, color!) ?? url;
  const st: CSSProperties = {};
  const [l, r, t, b] = border;
  if (w.t === 1 && (l || r || t || b)) {
    st.borderStyle = "solid";
    st.borderWidth = `${t}px ${r}px ${b}px ${l}px`;
    st.borderImage = `url("${url}") ${t} ${r} ${b} ${l} fill / ${t}px ${r}px ${b}px ${l}px stretch`;
    st.boxSizing = "border-box";
  } else {
    st.backgroundImage = `url("${url}")`;
    st.backgroundSize = "100% 100%";
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
  if (w.flip === 1 || w.flip === 3) st.transform = "scaleX(-1)";
  if (w.flip === 2 || w.flip === 3) st.transform = `${st.transform ?? ""} scaleY(-1)`;
  return st;
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
  useSyncExternalStore(subscribe, snapshot);
  useLayoutEffect(() => {
    const el = host.current!;
    const ro = new ResizeObserver(() => setSize([el.clientWidth || 1280, el.clientHeight || 720]));
    ro.observe(el);
    setSize([el.clientWidth || 1280, el.clientHeight || 720]);
    return () => ro.disconnect();
  }, []);
  const scale = size[1] / 720;
  const screenW = size[0] / scale;
  const include = useMemo(() => new Set(show.map((n) => n.id)), [show]);
  const boxes = solve(layout.root, binds, screenW, measured, include, all);

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
  });

  return (
    <div ref={host} className={`ngui ${className ?? ""}`}>
      <div className="ngui-root" style={{ width: screenW, height: 720, transform: `scale(${scale})` }}>
        {boxes.map((b) => {
          const st: CSSProperties = { left: b.left, top: b.top, width: b.width, height: b.autoH ? "auto" : b.height, zIndex: Math.round(b.z * 10) };
          const color = b.bind.color ?? b.w.c;
          if (color && color[3] !== undefined && color[3] < 1) st.opacity = color[3];
          const click = b.bind.onClick && !b.bind.disabled ? b.bind.onClick : undefined;
          const cls = `ng ng-${b.w.k}${click ? " ng-click" : ""}${b.bind.disabled ? " ng-disabled" : ""}${b.node.btn ? " ng-btn" : ""} ${b.bind.className ?? ""}`;
          if (b.w.k === "label") {
            // label text: binding, its localization component, a bare key typed into the label (set by code), the saved text
            const raw = b.w.lb!.text;
            const keyText = /^[A-Z][A-Z0-9_]+$/.test(raw) ? say(raw) : "";
            const html = b.bind.html ?? (b.bind.text !== undefined ? escapeHtml(b.bind.text) : b.node.loc ? say(b.node.loc) : keyText || escapeHtml(raw));
            return (
              <div key={b.key} data-n={b.node.n} className={cls} style={{ ...st, ...labelStyle(b, 1) }} title={b.bind.title} onClick={click}
                ref={(el) => { if (el) labelRefs.current.set(b.key, el); else labelRefs.current.delete(b.key); }}>
                <span dangerouslySetInnerHTML={{ __html: html }} />
                {b.bind.content}
              </div>
            );
          }
          const img = imageStyle(b, atlas);
          if (!img && !click && !b.bind.content) return null;
          return <div key={b.key} data-n={b.node.n} className={cls} style={{ ...st, ...img }} title={b.bind.title} onClick={click}>{b.bind.content}</div>;
        })}
      </div>
    </div>
  );
}

const escapeHtml = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
