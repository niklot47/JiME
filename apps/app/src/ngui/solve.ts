// Layout solver for the NGUI tree: world rects of every widget, NGUI anchors resolved against the current screen size,
// bindings (show/hide, size, offsets, clones) applied. Output: a flat list of boxes in screen space, sorted like NGUI
// draws them (panel depth, then widget depth).
import type { ReactNode } from "react";
import type { UiNode, UiWidget } from "./types.ts";

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
  className?: string;
  /** custom React content inside the widget box */
  content?: ReactNode;
  /** repeat the node: one copy per entry (binds for that copy's subtree), shifted by step each */
  clones?: Record<string, Bind>[];
  step?: [number, number];
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
}

export interface Measured { w: number; h: number }

const PIVOT: Record<number, [number, number]> = { 0: [0, 1], 1: [0.5, 1], 2: [1, 1], 3: [0, 0.5], 4: [0.5, 0.5], 5: [1, 0.5], 6: [0, 0], 7: [0.5, 0], 8: [1, 0] };
type Rect = { l: number; r: number; b: number; t: number };

/**
 * screenW: width of the screen in UI units (720 * aspect); the root's origin is the screen centre.
 * measured: label sizes from the last render (UI units) by node key.
 * include: ids of the subtrees to draw (the whole tree is still laid out, for positions and anchor targets); the
 * activity of their ancestors is ignored, so a dialog can be drawn while its scene's root is inactive in the file.
 */
export function solve(root: UiNode, binds: Binds, screenW: number, measured: Map<string, Measured>, include: Set<number>, all = false): Box[] {
  const rootIsScreen = true;
  const H = 720;
  const screen: Rect = { l: -screenW / 2, r: screenW / 2, b: -H / 2, t: H / 2 };
  const rects = new Map<number, Rect>();
  const boxes: Box[] = [];
  let order = 0;

  const run = (collect: boolean) => {
    order = 0;
    const visit = (n: UiNode, px: number, py: number, sx: number, sy: number, panel: number, active: boolean, bs: Binds, key: string, inc: boolean) => {
      const b = bs[n.n] ?? {};
      const entering = !inc && include.has(n.id);
      if (entering) { inc = true; active = true; }
      if (b.clones && !key.endsWith("#")) {
        b.clones.forEach((cb, i) => {
          const step = b.step ?? [0, 0];
          const nb: Binds = { ...bs, ...cb, [n.n]: { ...b, ...(cb[n.n] ?? {}), clones: undefined, dx: (b.dx ?? 0) + step[0] * i + (cb[n.n]?.dx ?? 0), dy: (b.dy ?? 0) + step[1] * i + (cb[n.n]?.dy ?? 0) } };
          visit(n, px, py, sx, sy, panel, active, nb, `${key}#${i}#`, inc);
        });
        return;
      }
      const on = active && (b.show ?? (all && inc ? true : n.on ?? true));
      const lx = (n.p?.[0] ?? 0) + (b.dx ?? 0), ly = (n.p?.[1] ?? 0) + (b.dy ?? 0);
      let x = n === root && rootIsScreen ? 0 : px + lx * sx;
      let y = n === root && rootIsScreen ? 0 : py + ly * sy;
      const nsx = n === root && rootIsScreen ? 1 : sx * (n.s?.[0] ?? 1), nsy = n === root && rootIsScreen ? 1 : sy * (n.s?.[1] ?? 1);
      const pd = n.panel ? n.panel.d : panel;
      const k = `${key}/${n.id}`;
      const w = n.w;
      if (w) {
        const m = measured.get(k);
        const autoH = w.k === "label" && (w.lb?.ov === 3 || w.lb?.ov === 2);
        const autoW = w.k === "label" && w.lb?.ov === 2;
        let ww = (b.w ?? (autoW && m ? m.w : w.w)) * Math.abs(nsx);
        let hh = (b.h ?? (autoH && m ? m.h : w.h)) * Math.abs(nsy);
        const [fx, fy] = PIVOT[w.pv] ?? [0.5, 0.5];
        let rc: Rect = { l: x - fx * ww, r: x - fx * ww + ww, b: y - fy * hh, t: y - fy * hh + hh };
        // NGUI anchors: each anchored side follows its target's rect; the transform follows the rect
        if (w.an) {
          const side = (a: (typeof w.an)[number] | undefined, lo: "l" | "b", hi: "r" | "t") => {
            if (!a || !a[0]) return null;
            const tr = a[0] === root.id ? screen : rects.get(a[0]) ?? null;
            if (!tr) return null;
            return tr[lo] + a[1] * (tr[hi] - tr[lo]) + a[2];
          };
          const L = side(w.an[0], "l", "r"), R = side(w.an[1], "l", "r"), B = side(w.an[2], "b", "t"), T = side(w.an[3], "b", "t");
          if (L !== null && R !== null) { rc.l = L; rc.r = R; } else if (L !== null) { rc.r = L + (rc.r - rc.l); rc.l = L; } else if (R !== null) { rc.l = R - (rc.r - rc.l); rc.r = R; }
          if (!autoH) {
            if (B !== null && T !== null) { rc.b = B; rc.t = T; } else if (B !== null) { rc.t = B + (rc.t - rc.b); rc.b = B; } else if (T !== null) { rc.b = T - (rc.t - rc.b); rc.t = T; }
          }
          ww = rc.r - rc.l; hh = rc.t - rc.b;
          x = rc.l + fx * ww; y = rc.b + fy * hh;
        }
        rects.set(n.id, rc);
        if (collect && inc && on && !w.off) {
          boxes.push({ key: k, node: n, w, bind: b, left: rc.l + screenW / 2, top: H / 2 - rc.t, width: rc.r - rc.l, height: rc.t - rc.b,
            z: pd * 10000 + w.d * 10 + (order++ % 10) / 10, autoH, autoW });
        }
      } else {
        // a panel without clipping covers the screen; a bare transform is a point
        rects.set(n.id, n.panel && !n.panel.clip ? screen : { l: x, r: x, b: y, t: y });
      }
      for (const c of n.ch ?? []) visit(c, x, y, nsx, nsy, pd, on, bs, k, inc);
    };
    visit(root, 0, 0, 1, 1, 0, true, binds, "", false);
  };
  run(false); // targets laid out once, so anchors can point at later nodes too
  run(true);
  return boxes.sort((a, b) => a.z - b.z);
}
