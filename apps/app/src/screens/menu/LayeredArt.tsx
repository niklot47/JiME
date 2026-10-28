// A picture of the theme made of layers with effects between them (themes/<name>/ui/art/<art>/ 1.png, 2.png ... +
// layers.json, built into images/ui-skin/layered.json): e.g. the difficulty cards. The layers move apart a little with
// the pointer over the card (depth), effects marked "hover" show only while it is hovered or chosen.
import { useEffect, useRef, useState } from "react";
import { assetUrl, packJsonMerged } from "../../data/pack.ts";
import { EffectView, type Effect } from "./MenuBackground.tsx";

export interface LayeredArtData { layers: { src: string; depth?: number; z?: number }[]; effects?: Effect[] }

let all: Promise<Record<string, LayeredArtData>> | null = null;
export const loadLayeredArt = () => (all ??= packJsonMerged<Record<string, LayeredArtData>>("images/ui-skin/layered.json").catch(() => ({} as Record<string, LayeredArtData>)));

/** The layered art `name` of the theme, or null while loading / when the theme has none (the caller's fallback) */
export function useLayeredArt(name: string): LayeredArtData | null | undefined {
  const [a, setA] = useState<LayeredArtData | null | undefined>(undefined);
  useEffect(() => { void loadLayeredArt().then((m) => setA(m[name] ?? null)); }, [name]);
  return a;
}

export function LayeredArt({ art, active = false }: { art: LayeredArtData; active?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const items = [...el.querySelectorAll<HTMLElement>("[data-depth]")].map((n) => ({ n, d: Number(n.dataset.depth) }));
    let raf = 0, tx = 0, ty = 0, px = 0, py = 0;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      tx = ((e.clientX - r.left) / r.width - 0.5) * 2; ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
    };
    const leave = () => { tx = 0; ty = 0; };
    const tick = () => {
      px += (tx - px) * 0.08; py += (ty - py) * 0.08;
      for (const { n, d } of items) n.style.transform = `translate3d(${(-px * 3 * d).toFixed(2)}%, ${(-py * 2 * d).toFixed(2)}%, 0) scale(1.08)`;
      raf = requestAnimationFrame(tick);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); el.removeEventListener("pointermove", move); el.removeEventListener("pointerleave", leave); };
  }, [art]);
  const parts = [
    ...art.layers.map((l, i) => ({ z: l.z ?? (i + 1) * 10, layer: l, effect: null as Effect | null })),
    ...(art.effects ?? []).map((e) => ({ z: e.z ?? 100, layer: null, effect: e })),
  ].sort((a, b) => a.z - b.z);
  const on = hover || active;
  return (
    <div ref={box} className={`la${on ? " on" : ""}`} onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
      {parts.map((p, i) => p.layer
        ? <div key={i} className="la-layer" data-depth={p.layer.depth ?? 0} style={{ backgroundImage: `url("${assetUrl(p.layer.src)}")` }} />
        : (!p.effect!.hover || on) && <div key={i} className={`la-fx${p.effect!.type === "rays" ? " pm-part-light" : ""}`}><EffectView e={p.effect!} /></div>)}
    </div>
  );
}
