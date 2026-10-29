// A picture of the theme made of layers with effects between them (themes/<name>/ui/art/<art>/ 1.png, 2.png ... +
// layers.json, built into images/ui-skin/layered.json): e.g. the difficulty cards.
//   size + frame  the picture's size and the card's edges in it (px): the frame fills the card exactly (stretched a
//                 little if their proportions differ), what lies outside it (a blade, a whip of fire) sticks out of
//                 the card; effects stay inside the frame (unless "clip": false); frameSkin: a skin region drawn as
//                 the card's border at frameZ (default 15: over the back layer, under the figures)
//   layers        each moves a little with the pointer over the card (depth); "flicker" varies its opacity (fire
//                 glints), "blend" its blending (screen / lighten / multiply ...)
//   effects       between the layers by z (fog, leaves, embers, steam, rays, distort = a layer redrawn wavering);
//                 an effect with a depth moves with the layers of that depth; "hover": only while hovered or chosen
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { assetUrl, packJsonMerged } from "../../data/pack.ts";
import { EffectView, type Effect } from "./MenuBackground.tsx";

export interface LayeredLayer {
  src: string; depth?: number; z?: number;
  flicker?: { min?: number; max?: number; speed?: number };
  blend?: CSSProperties["mixBlendMode"];
}
export interface LayeredArtData {
  layers: LayeredLayer[];
  effects?: Effect[];
  /** the picture's size (px) */
  size?: [number, number];
  /** the card's edges in the picture: left, top, right, bottom (px) */
  frame?: [number, number, number, number];
  /** the skin region drawn as the card's border (9-slice over the frame), and its z among the layers */
  frameSkin?: string;
  frameZ?: number;
}

let all: Promise<Record<string, LayeredArtData>> | null = null;
export const loadLayeredArt = () => (all ??= packJsonMerged<Record<string, LayeredArtData>>("images/ui-skin/layered.json").catch(() => ({} as Record<string, LayeredArtData>)));

/** The layered art `name` of the theme, or null while loading / when the theme has none (the caller's fallback) */
export function useLayeredArt(name: string): LayeredArtData | null | undefined {
  const [a, setA] = useState<LayeredArtData | null | undefined>(undefined);
  useEffect(() => { void loadLayeredArt().then((m) => setA(m[name] ?? null)); }, [name]);
  return a;
}

/** A layer whose opacity wanders between min and max (two slow sines and a fast shimmer, like firelight) */
function Flicker({ layer }: { layer: LayeredLayer }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const f = layer.flicker!;
    const lo = f.min ?? 0.35, hi = f.max ?? 1, sp = f.speed ?? 1, ph = Math.random() * 10;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = ((now - t0) / 1000) * sp + ph;
      const k = 0.5 + 0.28 * Math.sin(t * 2.3) + 0.14 * Math.sin(t * 5.9 + 1.3) + 0.08 * Math.sin(t * 17.1 + 0.7);
      if (el.current) el.current.style.opacity = (lo + (hi - lo) * Math.min(1, Math.max(0, k))).toFixed(3);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [layer]);
  return <div ref={el} className="la-pic" style={{ backgroundImage: `url("${assetUrl(layer.src)}")` }} />;
}

export function LayeredArt({ art, active = false, hoverFx = true }: {
  art: LayeredArtData;
  /** chosen: its "hover" effects show */
  active?: boolean;
  /** false: the "hover" effects only for the chosen one (not while the pointer is over it) */
  hoverFx?: boolean;
}) {
  const card = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const [box, setBox] = useState<CSSProperties>({ inset: 0 });
  // the picture's box: its frame fitted into the card (contain), the rest outside the card
  useLayoutEffect(() => {
    const el = card.current;
    if (!el || !art.size || !art.frame) return;
    const [pw, ph] = art.size, [x0, y0, x1, y1] = art.frame;
    const fit = () => {
      const W = el.clientWidth, H = el.clientHeight;
      const sx = W / Math.max(1, x1 - x0), sy = H / Math.max(1, y1 - y0);
      setBox({ left: -x0 * sx, top: -y0 * sy, width: pw * sx, height: ph * sy });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [art]);
  // the pointer parallax (re-reads the moving parts each frame: hover effects come and go)
  useEffect(() => {
    const el = card.current;
    if (!el) return;
    let raf = 0, tx = 0, ty = 0, px = 0, py = 0;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      tx = ((e.clientX - r.left) / r.width - 0.5) * 2; ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
    };
    const leave = () => { tx = 0; ty = 0; };
    const tick = () => {
      px += (tx - px) * 0.08; py += (ty - py) * 0.08;
      el.querySelectorAll<HTMLElement>("[data-depth]").forEach((n) => {
        const d = Number(n.dataset.depth);
        n.style.transform = `translate3d(${(-px * 2.5 * d).toFixed(2)}%, ${(-py * 1.8 * d).toFixed(2)}%, 0)`;
      });
      raf = requestAnimationFrame(tick);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); el.removeEventListener("pointermove", move); el.removeEventListener("pointerleave", leave); };
  }, [art]);
  const parts = [
    ...art.layers.map((l, i) => ({ z: l.z ?? (i + 1) * 10, layer: l, effect: null as Effect | null })),
    ...(art.effects ?? []).map((e) => ({ z: e.z ?? 100, layer: null as LayeredLayer | null, effect: e })),
  ].sort((a, b) => a.z - b.z);
  const on = (hoverFx && hover) || active;
  const framed = !!(art.size && art.frame);
  // the frame inside the picture's box (%): where the effects are clipped and the border lies
  const fr = framed ? (() => {
    const [pw, ph] = art.size!, [x0, y0, x1, y1] = art.frame!;
    return { l: (x0 / pw) * 100, t: (y0 / ph) * 100, r: (1 - x1 / pw) * 100, b: (1 - y1 / ph) * 100 };
  })() : null;
  const clip = fr ? `inset(${fr.t}% ${fr.r}% ${fr.b}% ${fr.l}%)` : undefined;
  const border = fr && art.frameSkin ? (() => {
    const v = art.frameSkin!.replace(/\./g, "-");
    return { z: art.frameZ ?? 15, style: { left: `${fr.l}%`, top: `${fr.t}%`, right: `${fr.r}%`, bottom: `${fr.b}%`,
      borderImage: `var(--sk-${v}) var(--sk-${v}-slice) / var(--sk-${v}-w)` } as CSSProperties };
  })() : null;
  return (
    <div ref={card} className={`la${on ? " on" : ""}${framed ? " framed" : ""}`} onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
      <div className="la-box" style={box}>
        {[...parts, ...(border ? [{ z: border.z, layer: null, effect: null }] : [])].sort((a, b) => a.z - b.z).map((p, i) => {
          if (!p.layer && !p.effect) return <div key={i} className="la-frame" style={border!.style} />;
          if (p.layer) {
            const l = p.layer;
            return (
              <div key={i} className="la-layer" data-depth={l.depth ?? 0} style={l.blend ? { mixBlendMode: l.blend } : undefined}>
                {l.flicker ? <Flicker layer={l} /> : <div className="la-pic" style={{ backgroundImage: `url("${assetUrl(l.src)}")` }} />}
              </div>
            );
          }
          const e = p.effect!;
          if (e.hover && !on) return null;
          const cls = `la-fx${e.type === "rays" ? " pm-part-light" : ""}`;
          // (a distorted layer is the picture itself: it may stick out like the others)
          const st = clip && e.type !== "distort" && (e as any).clip !== false ? { clipPath: clip } : undefined;
          return e.depth !== undefined
            ? <div key={i} className={cls} style={st} data-depth={e.depth}><EffectView e={e} /></div>
            : <div key={i} className={cls} style={st}><EffectView e={e} /></div>;
        })}
      </div>
    </div>
  );
}
