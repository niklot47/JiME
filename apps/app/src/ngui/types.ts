// Layout tree of the game's NGUI interface (images/ui/layouts/ui.json from tools/importer/export_ui_layouts.py).
// Units: NGUI UI units of a 1280 x 720 reference screen (UIRoot fits height), y up, positions relative to the parent.

/** [target Transform id | null, relative (0..1 of the target rect), absolute offset] for left, right, bottom, top */
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
  /** _Color of the widget's custom material (UITexture.mMat) */
  mc?: number[];
  an?: Anchor[];
  /** UIWidget.keepAspectRatio (1 based on width, 2 based on height) and aspectRatio */
  ka?: [number, number];
  /** sprite type: 0 simple, 1 sliced, 2 tiled, 3 filled */
  t?: number;
  fa?: number;
  /** fill direction: 0 horizontal, 1 vertical, 2 radial90, 3 radial180, 4 radial360 */
  fd?: number;
  inv?: number;
  flip?: number;
  sp?: string | null;
  /** sprite gradient (UIBasicSprite.applyGradient): colours multiplied in at the top and at the bottom */
  grad?: [number[], number[]];
  tex?: string | null;
  lb?: UiLabel;
  /** the component is disabled */
  off?: boolean;
  /** the material's animation over a mesh-art picture (export_ui_layouts.py mesh_art):
   *  wobble - Shader Forge FlameDistortion (s: noise strength in UV units, v: speed, rev: reversed);
   *  scroll - ScrollingWithMask (tex scrolls sideways under mask; v: UV per second, sx / sy: tiling) */
  fx?: { k: "wobble"; s: number; v: number; rev: number } | { k: "scroll"; v: number; tex: string; mask: string; sx: number; sy: number };
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
  /** Transform path id: anchor targets refer to it */
  tr?: number;
  on?: boolean;
  p?: [number, number];
  s?: [number, number];
  r?: number;
  w?: UiWidget;
  panel?: { d: number; clip: [number, number, number, number] | null; off?: [number, number]; an?: Anchor[]; soft?: [number, number] };
  btn?: { hover: number[] | null; pressed: number[] | null; disabled: number[] | null; dur: number; target?: number };
  tw?: UiTween[];
  loc?: string;
  /** UIGrid (k "grid": cell, cols = maxPerLine, arr 0 horizontal / 1 vertical, pv pivot, sort 1 alphabetic, hide inactive) or UITable */
  grid?: { k: "grid" | "table"; cell: [number, number]; cols: number; arr: number; pv: number; exp: number; sort: number; hide: number };
  mb?: string[];
  /** a ParticleSystem on the node (export_ui_layouts.py ui_particles) */
  ps?: import("./Particles2D.tsx").UiPS;
  ch?: UiNode[];
}

export interface UiLayoutFile {
  size: [number, number];
  root: UiNode;
  fonts: Record<string, { role: string; name: string }>;
  /** UI prefabs instantiated at runtime by the scene's scripts: "<GameObject>/<Controller>.<field>" -> tree */
  prefabs?: Record<string, UiNode>;
}

/** A runtime prefab by its key's end (e.g. "CampaignSelectionPrefab", "Widget_SaveSlots/PrefabPool.Prefab") */
export function prefabOf(layout: UiLayoutFile, keyEnd: string): UiNode | null {
  for (const [k, n] of Object.entries(layout.prefabs ?? {})) if (k.endsWith(keyEnd)) return n;
  return null;
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
