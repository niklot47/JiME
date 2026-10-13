// Layout tree of the game's NGUI interface (images/ui/layouts/ui.json from tools/importer/export_ui_layouts.py).
// Units: NGUI UI units of a 1280 x 720 reference screen (UIRoot fits height), y up, positions relative to the parent.

/** [target GameObject id | null, relative (0..1 of the target rect), absolute offset] for left, right, bottom, top */
export type Anchor = [number | null, number, number] | null;

export interface UiLabel {
  text: string;
  size: number;
  font: "text" | "title";
  /** NGUIText.Alignment: 0 automatic, 1 left, 2 center, 3 right, 4 justified */
  al: number;
  /** UILabel.Overflow: 0 shrink, 1 clamp, 2 resize freely, 3 resize height */
  ov: number;
  style: number;
  /** effect: [1 shadow | 2 outline | 3 outline8, colour, distance] */
  eff?: [number, number[], number];
  grad?: [number[] | null, number[] | null];
  sy?: number;
  lines?: number;
}

export interface UiWidget {
  k: "sprite" | "texture" | "sprite2d" | "label" | "widget";
  w: number;
  h: number;
  /** UIWidget.Pivot 0..8: TopLeft, Top, TopRight, Left, Center, Right, BottomLeft, Bottom, BottomRight */
  pv: number;
  d: number;
  c?: number[];
  an?: Anchor[];
  /** sprite type: 0 simple, 1 sliced, 2 tiled, 3 filled */
  t?: number;
  fa?: number;
  /** fill direction: 0 horizontal, 1 vertical, 2 radial90, 3 radial180, 4 radial360 */
  fd?: number;
  inv?: number;
  flip?: number;
  sp?: string | null;
  tex?: string | null;
  lb?: UiLabel;
  /** the component is disabled */
  off?: boolean;
}

export interface UiTween {
  k: "scale" | "alpha" | "pos" | "rot" | "color" | "width" | "height";
  from: any;
  to: any;
  dur: number;
  delay: number;
  /** 0 once, 1 loop, 2 ping-pong */
  style: number;
  on: boolean;
  group: number;
}

export interface UiNode {
  n: string;
  id: number;
  on?: boolean;
  p?: [number, number];
  s?: [number, number];
  r?: number;
  w?: UiWidget;
  panel?: { d: number; clip: [number, number, number, number] | null };
  btn?: { hover: number[] | null; pressed: number[] | null; disabled: number[] | null; dur: number; target?: number };
  tw?: UiTween[];
  loc?: string;
  grid?: { k: string; cell: [number, number]; cols: number; pad: [number, number] | null; arr: number };
  mb?: string[];
  ch?: UiNode[];
}

export interface UiLayoutFile {
  size: [number, number];
  root: UiNode;
  fonts: Record<string, { role: string; name: string }>;
}

/** Depth-first search by name (or a "/"-separated path of names, each step searching the subtree) */
export function findNode(root: UiNode, path: string): UiNode | null {
  let cur: UiNode | null = root;
  for (const name of path.split("/")) {
    if (!cur) return null;
    cur = findIn(cur, name);
  }
  return cur;
}

function findIn(n: UiNode, name: string): UiNode | null {
  if (n.n === name) return n;
  for (const c of n.ch ?? []) {
    const r = findIn(c, name);
    if (r) return r;
  }
  return null;
}
