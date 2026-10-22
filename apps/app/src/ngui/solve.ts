// Layout solver for the NGUI tree: world rects of every widget, NGUI anchors resolved against the current screen size,
// bindings (show/hide, size, offsets, clones) applied. Output: a flat list of boxes in screen space, sorted like NGUI
// draws them (panel depth, then widget depth).
import type { ReactNode } from "react";
import type { Anchor, UiNode, UiWidget } from "./types.ts";

/**
 * An entrance animation (SlidingElement.SlidingInAnimation, UIWidget/UIPanel.FadeIn), played when the node appears:
 * from an offset (UI units, y up) and / or from transparent, over dur seconds after delay. It applies to the node's
 * whole subtree (a child's own entrance replaces it).
 */
export interface Enter {
  from?: [number, number];
  fade?: boolean;
  /** seconds (SlidingElement: 0.35, 0.7 when farther) */
  dur?: number;
  delay?: number;
  /** linear instead of SlideElement's smoothstep */
  linear?: boolean;
}

/** What the app changes on a node (matched by node name) */
export interface Bind {
  /** force the node (and its subtree) shown or hidden */
  show?: boolean;
  /** label content: HTML (from the text markup) or plain text */
  html?: string;
  text?: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  /** filled sprite amount 0..1 */
  fill?: number;
  sprite?: string;
  /** texture: a pack path or a URL */
  tex?: string;
  color?: number[];
  /** extra offset in UI units (y up) */
  dx?: number;
  dy?: number;
  w?: number;
  h?: number;
  /** widget pivot override (UIWidget.Pivot 0..8), e.g. MessagePopup turns its label to Top when the text grows */
  pv?: number;
  /** label alignment override (NGUIText.Alignment) */
  al?: number;
  /**
   * keep the node at its distance from screen sides of the 1280 x 720 reference (UIAnchor-style), e.g. "left bottom"
   * for the lore gain, "top" for the threat bar when the interface is scaled down (the virtual screen gets taller)
   */
  pin?: string;
  /** CSS transform origin at the parent node's position (parts of one thing animated together) */
  originParent?: boolean;
  /** keep the saved height above the anchored bottom (the original's enemy bar shows at its saved 47, not the 61 its
   *  anchors give) */
  keepH?: boolean;
  /** panel depth override for the subtree (a popup inside a dialog whose saved panel depth is lower than the dialog's) */
  depth?: number;
  /** UIGrid cell size override (e.g. EnemyHealthBar: 350 / max health) */
  cell?: [number, number];
  /** place at a screen point (CSS px from the view's top-left), for things that follow the 3D board; NguiView turns it
   *  into `at` (the node's parents must sit at the root's origin) */
  atPx?: [number, number];
  /** replace the transform position (UI units, y up) */
  at?: [number, number];
  className?: string;
  /** custom React content inside the widget box */
  content?: ReactNode;
  /** repeat the node: one copy per entry (binds for that copy's subtree), shifted by step each */
  clones?: Record<string, Bind>[];
  step?: [number, number];
  /** entrance animation of the subtree when it appears */
  enter?: Enter;
  /** make the node a clipping panel (a scroll view the layout does not have): region [cx, cy, w, h] around the node,
   *  off: the clip offset (minus the scroll, so the region stays while the contents move), soft: fading edges */
  clipPanel?: { clip: [number, number, number, number]; off?: [number, number]; soft?: [number, number] };
  /** seconds: a change of place glides there (a position tween between two states, e.g. the rest's heroes moving
   *  down for the role selection); applies to the subtree */
  move?: number;
  /** more children after the saved ones: UI prefabs the game instantiates at runtime (ui.json "prefabs"), e.g. the
   *  campaign cards in Table_CampaignList, hero portraits in the hero scroll view, save slots */
  extra?: UiNode[];
}
export type Binds = Record<string, Bind>;

export interface Box {
  key: string;
  node: UiNode;
  w: UiWidget;
  bind: Bind;
  /** CSS px space of the UI (origin top-left, y down), UI units */
  left: number;
  top: number;
  width: number;
  height: number;
  z: number;
  /** label sized by its text (resize height / freely): measured box drives the layout */
  autoH: boolean;
  autoW: boolean;
  /** the parent's position (same space as left / top) */
  px: number;
  py: number;
  /** the region of the nearest clipping panel (UIPanel softness / alpha clip), same space as left / top; sx / sy: the
   *  soft clip's fade width at the sides / top and bottom */
  clip?: { l: number; t: number; r: number; b: number; sx?: number; sy?: number };
  /** total rotation (degrees, counter-clockwise as in Unity) of the node and its parents */
  rot: number;
  /** the entrance animation (own or an ancestor's) */
  enter?: Enter;
  /** the gliding time of place changes (own or an ancestor's) */
  move?: number;
}

export interface Measured { w: number; h: number }

const PIVOT: Record<number, [number, number]> = { 0: [0, 1], 1: [0.5, 1], 2: [1, 1], 3: [0, 0.5], 4: [0.5, 0.5], 5: [1, 0.5], 6: [0, 0], 7: [0.5, 0], 8: [1, 0] };
type Rect = { l: number; r: number; b: number; t: number; sx?: number; sy?: number };

/**
 * screenW: width of the screen in UI units (720 * aspect); the root's origin is the screen centre.
 * measured: label sizes from the last render (UI units) by node key.
 * include: ids of the subtrees to draw (the whole tree is still laid out, for positions and anchor targets); the
 * activity of their ancestors is ignored, so a dialog can be drawn while its scene's root is inactive in the file.
 */
export function solve(root: UiNode, binds: Binds, screenW: number, measured: Map<string, Measured>, include: Set<number>, all = false,
  screenH = 720): Box[] {
  const rootIsScreen = true;
  const H = screenH;
  const screen: Rect = { l: -screenW / 2, r: screenW / 2, b: -H / 2, t: H / 2 };
  const rects = new Map<number, Rect>();
  const boxes: Box[] = [];
  let order = 0;

  const run = (collect: boolean) => {
    order = 0;
    const visit = (n: UiNode, px: number, py: number, sx: number, sy: number, panel: number, active: boolean, bs: Binds, key: string, inc: boolean,
      anc: string[], at?: [number, number], clip: Rect | null = null, ent?: Enter, mv?: number, rot = 0) => {
      const b = bindOf(bs, anc, n.n);
      ent = b.enter ?? ent;
      mv = b.move ?? mv;
      const entering = !inc && include.has(n.id);
      if (entering) { inc = true; active = true; }
      if (b.clones && !key.endsWith("#")) {
        b.clones.forEach((cb, i) => {
          const step = b.step ?? [0, 0];
          // the copy's own bind replaces the one that matched (any of its key forms), so it wins inside the copy
          const own = cb[n.n] ?? {};
          const nb: Binds = { ...bs, ...cb, [bindKeyOf(bs, anc, n.n) ?? n.n]: { ...b, ...own, clones: undefined, dx: (b.dx ?? 0) + step[0] * i + (own.dx ?? 0), dy: (b.dy ?? 0) + step[1] * i + (own.dy ?? 0) } };
          visit(n, px, py, sx, sy, panel, active, nb, `${key}#${i}#`, inc, anc, at, clip, ent, mv, rot);
        });
        return;
      }
      const on = active && (b.show ?? (entering || (all && inc) ? true : n.on ?? true));
      // one-shot tweens (style 0) are drawn at their end: the scene saves many elements at the start of their entrance
      // animation (title pieces, borders, panels sliding in), the game plays them forward when the screen opens
      const end = restState(n);
      const lx = (b.at?.[0] ?? at?.[0] ?? end.p?.[0] ?? n.p?.[0] ?? 0) + (b.dx ?? 0), ly = (b.at?.[1] ?? at?.[1] ?? end.p?.[1] ?? n.p?.[1] ?? 0) + (b.dy ?? 0);
      const pin = b.pin ?? "";
      // the local position turns with the parents' rotation (a rotated piece of art carries its children around)
      const [ox, oy] = turn(lx * sx, ly * sy, rot);
      let x = n === root && rootIsScreen ? 0 : px + ox + (pin.includes("left") ? 640 - screenW / 2 : pin.includes("right") ? screenW / 2 - 640 : 0);
      let y = n === root && rootIsScreen ? 0 : py + oy + (pin.includes("top") ? (H - 720) / 2 : pin.includes("bottom") ? (720 - H) / 2 : 0);
      const nrot = n === root ? 0 : rot + (n.r ?? 0);
      const nsx = n === root && rootIsScreen ? 1 : sx * (end.s?.[0] ?? n.s?.[0] ?? 1), nsy = n === root && rootIsScreen ? 1 : sy * (end.s?.[1] ?? n.s?.[1] ?? 1);
      const pd = b.depth ?? (n.panel ? n.panel.d : panel);
      const k = `${key}/${n.id}`;
      const w = n.w;
      if (w) {
        const m = measured.get(k);
        const autoH = w.k === "label" && (w.lb?.ov === 3 || w.lb?.ov === 2);
        const autoW = w.k === "label" && w.lb?.ov === 2;
        let ww = (b.w ?? (autoW && m ? m.w : end.w ?? w.w)) * Math.abs(nsx);
        let hh = (b.h ?? (autoH && m ? m.h : end.h ?? w.h)) * Math.abs(nsy);
        // full-screen darkenings / input blockers (saved at about 1280 x 720) cover the whole, possibly larger, screen
        if (w.k !== "label" && !w.an && w.w >= 1270 && w.h >= 715) { ww = Math.max(ww, screenW + 20); hh = Math.max(hh, H + 20); }
        const [fx, fy] = PIVOT[b.pv ?? w.pv] ?? [0.5, 0.5];
        let rc: Rect = { l: x - fx * ww, r: x - fx * ww + ww, b: y - fy * hh, t: y - fy * hh + hh };
        // NGUI anchors: each anchored side follows its target's rect; the transform follows the rect
        if (w.an) {
          const side = (a: (typeof w.an)[number] | undefined, lo: "l" | "b", hi: "r" | "t") => {
            if (!a || !a[0]) return null;
            const tr = a[0] === root.id || a[0] === root.tr ? screen : rects.get(a[0]) ?? null;
            if (!tr) return null;
            return tr[lo] + a[1] * (tr[hi] - tr[lo]) + a[2];
          };
          const L = side(w.an[0], "l", "r"), R = side(w.an[1], "l", "r"), B = side(w.an[2], "b", "t"), T = side(w.an[3], "b", "t");
          if (L !== null && R !== null) { rc.l = L; rc.r = R; } else if (L !== null) { rc.r = L + (rc.r - rc.l); rc.l = L; } else if (R !== null) { rc.l = R - (rc.r - rc.l); rc.r = R; }
          if (!autoH) {
            if (B !== null && T !== null) { rc.b = B; rc.t = T; } else if (B !== null) { rc.t = B + (rc.t - rc.b); rc.b = B; } else if (T !== null) { rc.b = T - (rc.t - rc.b); rc.t = T; }
          }
          if (b.keepH) rc.t = rc.b + (b.h ?? w.h) * Math.abs(nsy);
          ww = rc.r - rc.l; hh = rc.t - rc.b;
          x = rc.l + fx * ww; y = rc.b + fy * hh;
          // UIWidget.OnAnchor: the position comes from the anchored sides, then the size keeps its aspect ratio
          if (w.ka && w.ka[1]) {
            if (w.ka[0] === 2) ww = hh * w.ka[1];
            else hh = ww / w.ka[1];
            rc = { l: x - fx * ww, r: x - fx * ww + ww, b: y - fy * hh, t: y - fy * hh + hh };
          }
        }
        rects.set(n.id, rc);
        if (n.tr) rects.set(n.tr, rc);
        if (collect && inc && on && !w.off) {
          boxes.push({ key: k, node: n, w, bind: b, left: rc.l + screenW / 2, top: H / 2 - rc.t, width: rc.r - rc.l, height: rc.t - rc.b,
            z: pd * 10000 + w.d * 10 + (order++ % 10) / 10, autoH, autoW, px: px + screenW / 2, py: H / 2 - py, rot: nrot,
            ...(ent ? { enter: ent } : {}),
            ...(mv ? { move: mv } : {}),
            ...(clip ? { clip: { l: clip.l + screenW / 2, r: clip.r + screenW / 2, t: H / 2 - clip.t, b: H / 2 - clip.b, sx: clip.sx, sy: clip.sy } } : {}) });
        }
      } else {
        // a panel without clipping covers the screen, a clipping one its clip region (moved by the clip offset, e.g. a
        // scrolled UIScrollView); a bare transform is a point
        const pnl = b.clipPanel ? { d: n.panel?.d ?? panel, ...b.clipPanel } : n.panel;
        const c = pnl?.clip, co = pnl?.off ?? [0, 0];
        const r0 = pnl && !c ? screen
          : c ? { l: x + (co[0] + c[0] - c[2] / 2) * sx, r: x + (co[0] + c[0] + c[2] / 2) * sx, b: y + (co[1] + c[1] - c[3] / 2) * sy, t: y + (co[1] + c[1] + c[3] / 2) * sy }
          : { l: x, r: x, b: y, t: y };
        // UIPanel.OnAnchor: an anchored clipping panel's region is its anchored sides
        if (c && n.panel?.an && !b.clipPanel) {
          const side = (a: Anchor, lo: "l" | "b", hi: "r" | "t") => {
            if (!a || !a[0]) return null;
            const tr = a[0] === root.id || a[0] === root.tr ? screen : rects.get(a[0]) ?? null;
            return tr ? tr[lo] + a[1] * (tr[hi] - tr[lo]) + a[2] : null;
          };
          const [la, ra, ba, ta] = n.panel.an!;
          r0.l = side(la!, "l", "r") ?? r0.l; r0.r = side(ra!, "l", "r") ?? r0.r;
          r0.b = side(ba!, "b", "t") ?? r0.b; r0.t = side(ta!, "b", "t") ?? r0.t;
        }
        rects.set(n.id, r0);
        if (n.tr) rects.set(n.tr, r0);
        // a clipping panel: what it holds is cut to its region (within any outer clipping panel)
        // UIPanel soft clip: the fade at its edges (in screen units)
        const soft = pnl?.soft;
        if (c) {
          clip = clip ? { l: Math.max(clip.l, r0.l), r: Math.min(clip.r, r0.r), b: Math.max(clip.b, r0.b), t: Math.min(clip.t, r0.t) } : { ...r0 };
          if (soft) { clip.sx = soft[0] * Math.abs(sx); clip.sy = soft[1] * Math.abs(sy); }
        }
      }
      const kids = b.extra ? [...(n.ch ?? []), ...b.extra] : n.ch ?? [];
      const na = [...anc, n.n];
      const places = n.grid?.k === "grid" ? gridPlaces(n, kids.map((c) => bindOf(bs, na, c.n).show ?? (all && inc ? true : c.on ?? true)), b.cell) : null;
      kids.forEach((c, i) => visit(c, x, y, nsx, nsy, pd, on, bs, k, inc, na, places?.[i] ?? undefined, clip, ent, mv, nrot));
    };
    visit(root, 0, 0, 1, 1, 0, true, binds, "", false, []);
  };
  run(false); // targets laid out once, so anchors can point at later nodes too
  run(true);
  return boxes.sort((a, b) => a.z - b.z);
}

/** (x, y) turned by deg degrees counter-clockwise (Unity's z rotation, y up) */
function turn(x: number, y: number, deg: number): [number, number] {
  const r = ((deg % 360) + 360) % 360;
  if (r < 0.01 || r > 359.99) return [x, y];
  const a = (r * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
}

/** Rest state of a node's one-shot tweens (position, scale, width, height); loops and ping-pongs keep the saved state */
function restState(n: UiNode): { p?: [number, number]; s?: [number, number]; w?: number; h?: number } {
  const out: { p?: [number, number]; s?: [number, number]; w?: number; h?: number } = {};
  for (const t of n.tw ?? []) {
    // only plain one-shot entrance tweens: tween groups are state toggles played by UIPlayTween (e.g. the enemy dialog
    // sliding aside for the combat panel), a scale from 1 is a hover / pulse
    if (t.style !== 0 || t.to === null || t.to === undefined || t.group !== 0) continue;
    if (t.k === "scale" && Array.isArray(t.from) && t.from[0] === 1) continue;
    // per axis: only when the saved value is the tween's start (scripts often rewrite from/to before playing,
    // e.g. TitleLogoAnimation keeps x and tweens y), otherwise the saved value is already the rest state
    const at = (saved: number, from: unknown, to: unknown) => (typeof from === "number" && typeof to === "number" && Math.abs(saved - from) < 1 ? to : saved);
    const f = t.from, e = t.to;
    if (t.k === "pos" && Array.isArray(e) && Array.isArray(f)) out.p = [at(n.p?.[0] ?? 0, f[0], e[0]), at(n.p?.[1] ?? 0, f[1], e[1])];
    else if (t.k === "scale" && Array.isArray(e) && Array.isArray(f)) out.s = [at(n.s?.[0] ?? 1, f[0], e[0]), at(n.s?.[1] ?? 1, f[1], e[1])];
    else if (t.k === "width" && n.w) out.w = at(n.w.w, f, e);
    else if (t.k === "height" && n.w) out.h = at(n.w.h, f, e);
  }
  return out;
}

/**
 * Bind of a node: "Ancestor//Name" (nearest ancestor first) > "Parent/Name" > "Name". Names repeat across dialogs and
 * inside repeated parts (the three enemy health bars), so a bind can be scoped to an ancestor.
 */
function bindOf(bs: Binds, anc: string[], name: string): Bind {
  const k = bindKeyOf(bs, anc, name);
  return k !== null ? bs[k]! : {};
}

/** The key of the bind that applies to a node (see bindOf), null when none */
function bindKeyOf(bs: Binds, anc: string[], name: string): string | null {
  for (let i = anc.length - 1; i >= 0; i--) {
    const k = `${anc[i]}//${name}`;
    if (bs[k]) return k;
  }
  const k = `${anc[anc.length - 1] ?? ""}/${name}`;
  return bs[k] ? k : bs[name] ? name : null;
}

/** UIGrid.ResetPosition: active children laid out by cell, line by line, then shifted to the grid's pivot */
function gridPlaces(n: UiNode, active: boolean[], cell?: [number, number]): ([number, number] | null)[] {
  const g = n.grid!;
  const [cw, ch] = cell ?? g.cell;
  const horizontal = g.arr !== 1;
  const list = (n.ch ?? []).map((c, i) => i).filter((i) => !g.hide || active[i]);
  if (g.sort === 1) list.sort((a, b) => n.ch![a]!.n.localeCompare(n.ch![b]!.n));
  const out: ([number, number] | null)[] = (n.ch ?? []).map(() => null);
  let col = 0, row = 0, maxCol = 0, maxRow = 0;
  for (const i of list) {
    out[i] = horizontal ? [cw * col, -ch * row] : [cw * row, -ch * col];
    maxCol = Math.max(maxCol, col); maxRow = Math.max(maxRow, row);
    if (++col >= g.cols && g.cols > 0) { col = 0; row++; }
  }
  if (g.pv !== 0) {
    const [fx, fy] = PIVOT[g.pv] ?? [0, 1];
    const ox = horizontal ? fx * maxCol * cw : fx * maxRow * cw;
    const oy = horizontal ? -maxRow * ch * (1 - fy) : -maxCol * ch * (1 - fy);
    for (const i of list) out[i] = [out[i]![0] - ox, out[i]![1] - oy];
  }
  return out;
}
