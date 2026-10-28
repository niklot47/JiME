// The campaign map as a picture (images/campaigns/maps.json): the map fills the screen, the wheel / a pinch zooms it, a
// drag moves it; the trail between the completed adventures and to the coming one, the campfire on the coming one, the
// names of the map (labels, translated). `focus` + `zoomed` fly the view to an adventure (its details beside it).
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { CampaignMapData } from "../../data/pack.ts";

export interface MapView {
  /** the map's picture (URL); none: a plain parchment */
  image?: string;
  /** where an adventure is (0..1 of the picture) */
  at: (adv: number) => [number, number];
  labels: { text: string; x: number; y: number; size: number; angle: number }[];
  zoom: number;
}

/** Where the campaign's adventures are: the pack's positions, else spread along the map (left to right, a slow wave) */
export function mapView(data: CampaignMapData | undefined, adventures: number[], pic: (p?: string) => string | undefined,
  say: (k: string) => string): MapView {
  const loc = data?.locations ?? {};
  const at = (adv: number): [number, number] => {
    const p = loc[String(adv)];
    if (p) return p;
    const i = Math.max(0, adventures.indexOf(adv));
    const n = Math.max(1, adventures.length - 1);
    const x = 0.15 + (0.7 * i) / n;
    return [x, 0.5 + 0.18 * Math.sin(i * 1.7)];
  };
  return {
    image: pic(data?.image),
    at,
    labels: (data?.labels ?? []).map((l) => ({ text: say(l.key), x: l.x, y: l.y, size: l.size ?? 30, angle: l.angle ?? 0 })),
    zoom: data?.zoom ?? 2.4,
  };
}

/** The picture's world: WORLD units wide (any picture keeps its proportions) */
const WORLD = 1000;

export function CampaignMap2D({ view, trail, focus, zoomed, panel = 0, onFocusPx }: {
  view: MapView;
  /** the completed adventures in order (the trail), then the coming one */
  trail: number[];
  focus: number | null;
  zoomed: boolean;
  /** the share of the screen's width covered on the left while zoomed (the adventure's details) */
  panel?: number;
  onFocusPx?: (p: [number, number] | null) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<[number, number]>([1, 1]);
  const [aspect, setAspect] = useState(1.6);
  // the view: the map point at the screen's centre and the zoom over "cover"
  const [cam, setCam] = useState({ x: 0.5, y: 0.5, k: 1 });
  const [anim, setAnim] = useState(true);
  const drag = useRef(new Map<number, [number, number]>());
  const pinch = useRef<{ d: number; k: number } | null>(null);

  useLayoutEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => setSize([el.clientWidth || 1, el.clientHeight || 1]));
    ro.observe(el);
    setSize([el.clientWidth || 1, el.clientHeight || 1]);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!view.image) return;
    const i = new Image();
    i.onload = () => setAspect(i.naturalWidth / Math.max(1, i.naturalHeight));
    i.src = view.image;
  }, [view.image]);

  const [W, H] = size;
  const wh = WORLD / aspect;
  const cover = Math.max(W / WORLD, H / wh);
  /** keep the screen covered by the map */
  const clamp = (c: { x: number; y: number; k: number }) => {
    const k = Math.min(6, Math.max(1, c.k));
    const s = cover * k;
    const hx = W / 2 / (WORLD * s), hy = H / 2 / (wh * s);
    return { k, x: Math.min(1 - hx, Math.max(hx, c.x)), y: Math.min(1 - hy, Math.max(hy, c.y)) };
  };
  // fly to the focused adventure (zoomed), or back to the whole map
  useEffect(() => {
    setAnim(true);
    if (zoomed && focus !== null) {
      const [x, y] = view.at(focus);
      const s = cover * view.zoom;
      // the location a little right of the free part's centre (the details cover `panel` of the width on the left)
      setCam(clamp({ x: x - (panel * W) / 2 / (WORLD * s), y, k: view.zoom }));
    } else setCam(clamp({ x: 0.5, y: 0.5, k: 1 }));
  }, [zoomed, focus, W, H, aspect]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = cover * cam.k;
  const tx = W / 2 - cam.x * WORLD * s, ty = H / 2 - cam.y * wh * s;
  const toPx = (p: [number, number]): [number, number] => [tx + p[0] * WORLD * s, ty + p[1] * wh * s];
  useEffect(() => { onFocusPx?.(focus !== null ? toPx(view.at(focus)) : null); }, [tx, ty, s, focus]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomAt = (px: number, py: number, f: number, base = cam) => {
    // the map point under (px, py) stays under it
    const mx = (px - (W / 2 - base.x * WORLD * cover * base.k)) / (WORLD * cover * base.k);
    const my = (py - (H / 2 - base.y * wh * cover * base.k)) / (wh * cover * base.k);
    const k = Math.min(6, Math.max(1, base.k * f));
    const s2 = cover * k;
    return clamp({ k, x: mx - (px - W / 2) / (WORLD * s2), y: my - (py - H / 2) / (wh * s2) });
  };
  const rect = () => box.current!.getBoundingClientRect();
  const onWheel = (e: React.WheelEvent) => {
    const r = rect();
    setAnim(false);
    setCam(zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015)));
  };
  const onDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (drag.current.size === 2) {
      const [a, b] = [...drag.current.values()];
      pinch.current = { d: Math.hypot(a![0] - b![0], a![1] - b![1]), k: cam.k };
    }
    setAnim(false);
  };
  const onMove = (e: React.PointerEvent) => {
    const last = drag.current.get(e.pointerId);
    if (!last) return;
    drag.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (drag.current.size === 2 && pinch.current) {
      const [a, b] = [...drag.current.values()];
      const d = Math.hypot(a![0] - b![0], a![1] - b![1]);
      const r = rect();
      setCam((c) => zoomAt((a![0] + b![0]) / 2 - r.left, (a![1] + b![1]) / 2 - r.top, (pinch.current!.k * d) / pinch.current!.d / c.k, c));
      return;
    }
    const dx = e.clientX - last[0], dy = e.clientY - last[1];
    setCam((c) => clamp({ k: c.k, x: c.x - dx / (WORLD * cover * c.k), y: c.y - dy / (wh * cover * c.k) }));
  };
  const onUp = (e: React.PointerEvent) => { drag.current.delete(e.pointerId); if (drag.current.size < 2) pinch.current = null; };

  const pts = trail.map((a) => view.at(a));
  const path = pts.map((p, i) => `${i ? "L" : "M"}${(p[0] * WORLD).toFixed(1)} ${(p[1] * wh).toFixed(1)}`).join(" ");
  const world: CSSProperties = {
    width: WORLD, height: wh, transform: `translate(${tx}px, ${ty}px) scale(${s})`,
    transition: anim ? "transform 1.6s cubic-bezier(0.45, 0, 0.2, 1)" : "none",
    ["--inv" as string]: String(1 / s),
  };
  return (
    <div ref={box} className="cm2" onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      <div className="cm2-world" style={world}>
        {view.image ? <img className="cm2-pic" src={view.image} alt="" draggable={false} /> : <div className="cm2-pic cm2-parchment" />}
        {view.labels.map((l, i) => (
          <span key={i} className="cm2-label" style={{ left: l.x * WORLD, top: l.y * wh, fontSize: (l.size / 1000) * wh, transform: `translate(-50%, -50%) rotate(${l.angle}deg)` }}>{l.text}</span>
        ))}
        {pts.length > 1 && (
          <svg className="cm2-trail" viewBox={`0 0 ${WORLD} ${wh}`} width={WORLD} height={wh}>
            <path d={path} />
          </svg>
        )}
        {trail.slice(0, -1).map((a, i) => {
          const p = view.at(a);
          return <i key={`${a}:${i}`} className="cm2-done" style={{ left: p[0] * WORLD, top: p[1] * wh }} />;
        })}
        {focus !== null && (() => {
          const p = view.at(focus);
          return <i className="cm2-fire" style={{ left: p[0] * WORLD, top: p[1] * wh }}><b /><b /><b /></i>;
        })()}
      </div>
    </div>
  );
}
