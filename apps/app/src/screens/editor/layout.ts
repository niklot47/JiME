// Automatic layout of editor graphs (dagre): positions for React Flow nodes of known sizes
import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";

export interface LayoutOptions {
  /** LR: left to right, TB: top to bottom */
  dir: "LR" | "TB";
  rankSep?: number;
  nodeSep?: number;
}

/** Node sizes come from node.width / node.height (set by the caller) */
export function layout<N extends Node, E extends Edge>(nodes: N[], edges: E[], o: LayoutOptions): N[] {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: o.dir, ranksep: o.rankSep ?? 70, nodesep: o.nodeSep ?? 30, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: n.width ?? 160, height: n.height ?? 60 });
  for (const e of edges) if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target, {}, e.id);
  dagre.layout(g);
  return nodes.map((n) => {
    const p = g.node(n.id);
    return p ? { ...n, position: { x: p.x - (n.width ?? 160) / 2, y: p.y - (n.height ?? 60) / 2 } } : n;
  });
}
