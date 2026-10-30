// The sparks around a chosen element, with the original's particle systems' numbers (the same ones the imported
// interface plays, NewGamePages: the campaign card's Sprite_Highlight_Interior, the difficulty cards' Effects), drawn
// by the same player (Particles2D) with its own soft dot. The system's emitter box is fitted to the parent element:
// put <UiSparks> into a positioned wrapper next to (before) the element, so the sparks stay under it.
import { useEffect, useMemo, useRef, useState } from "react";
import { Particles2D, type UiPS } from "../ngui/Particles2D.tsx";

/** a particle's size over its life: shrinks linearly to nothing */
const SHRINK = { c: [1, 0.875, 0.75, 0.625, 0.5, 0.375, 0.25, 0.125, 0] };

const base = (o: Partial<UiPS>): UiPS => ({
  dur: 1, loop: true, prewarm: false, delay: [0, 0], speed: 1, world: false, scaling: 1, max: 1000, life: [1, 1],
  size: [0.04, 0.04], v0: [0.06, 0.06], rot: [0, 0], color: { k: [[1, 0.753, 0.2279, 1]] }, grav: [0, 0], rate: [30, 30],
  sol: SHRINK as UiPS["sol"], blend: "alpha", tint: [1, 1, 1, 1], ...o,
}) as UiPS;
const box = (sx: number, sy: number, thick: number, sph: number) =>
  ({ type: 15, radius: 0.5, angle: 25, arc: 360, len: 5, thick, pos: [0, 0, 0], rot: [0, 0, 0], scale: [sx, sy, 1], rnd: 0, sph });

export const SPARKS = {
  /** CampaignSelection/Sprite_Highlight_Interior's system: gold dots off the card's edges */
  campaign: base({ dur: 0.75, speed: 0.5, max: 100, size: [0.03, 0.03], rate: [20, 20], shape: box(0.53, 0.31, 0, 0.1) }),
  /** Difficulty_Normal/Effects */
  normal: base({ rol: [0, 3.1416], shape: box(0.72, 0.83, 1, 1) }),
  /** Difficulty_Adventure/Effects: light grey */
  adventure: base({ rol: [0, 3.1416], color: { k: [[0.8824, 0.8824, 0.8824, 1]] }, shape: box(1.68, 0.4, 1, 1) }),
} satisfies Record<string, UiPS>;
export type SparksKind = keyof typeof SPARKS;

/** the imported interface's tuning (NewGamePages.SPARKS): a little sparser and slower than the systems' own numbers */
const RATE = 0.8, SPEED = 0.6;

export function UiSparks({ kind }: { kind: SparksKind }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<[number, number] | null>(null);
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const fit = () => setSize((s) => {
      const w = Math.round(el.clientWidth), h = Math.round(el.clientHeight);
      return s && s[0] === w && s[1] === h ? s : [w, h];
    });
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // the emitter box on the parent's edges: the system's width is the parent's, its height follows the parent's
  const ps = useMemo(() => {
    if (!size || !size[0] || !size[1]) return null;
    const p = SPARKS[kind];
    const k = size[0] / p.shape!.scale[0]!;
    return { k, ps: { ...p, shape: { ...p.shape!, scale: [p.shape!.scale[0]!, size[1] / k, 1] } } as UiPS };
  }, [kind, size]);
  return (
    <div ref={ref} className="ui-sparks" aria-hidden="true">
      {ps && size && <Particles2D ps={ps.ps} x={size[0] / 2} y={size[1] / 2} k={ps.k} z={0} rate={RATE} speed={SPEED} />}
    </div>
  );
}
