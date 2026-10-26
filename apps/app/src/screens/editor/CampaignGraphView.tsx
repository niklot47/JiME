// A campaign as a graph of adventures (read only): the links come from the adventures' scripts (graph.ts).
// Solid arrow: the next adventure; dashed: an alternative the party may pick on the map; colour: which end of the
// adventure leads there (green victory, red failure, grey either, amber another event).
import { useMemo } from "react";
import { Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import type { CampaignGraph, CampaignLink, LinkOutcome } from "@jime/engine";
import type { TextDb } from "@jime/content-tools/text";
import { assetUrl, type ModelArt } from "../../data/pack.ts";
import { layout } from "./layout.ts";
import { say } from "./text.ts";

export const OUTCOME_COLOR: Record<LinkOutcome, string> = { victory: "#5fae5a", failure: "#c8574a", both: "#9a9080", other: "#d0a040" };
export const OUTCOME_NAME: Record<LinkOutcome, string> = { victory: "победа", failure: "поражение", both: "любой исход", other: "другое событие" };

type AdvData = { title: string; location: string; art: string | null; order: number; selected: boolean };
type EndData = { won: boolean };

function AdventureNode({ data }: NodeProps<Node<AdvData>>) {
  return (
    <div className={`ed-adv${data.selected ? " sel" : ""}${data.order < 0 ? " outside" : ""}`}>
      <Handle type="target" position={Position.Left} />
      {data.art ? <img src={data.art} alt="" draggable={false} /> : <div className="ed-adv-noart" />}
      <div className="ed-adv-text">
        <b>{data.order >= 0 ? `${data.order + 1}. ` : ""}{data.title}</b>
        <span>{data.location}</span>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function EndNode({ data }: NodeProps<Node<EndData>>) {
  return (
    <div className={`ed-end ${data.won ? "won" : "lost"}`}>
      <Handle type="target" position={Position.Left} />
      {data.won ? "Победа в кампании" : "Поражение в кампании"}
    </div>
  );
}

const nodeTypes = { adv: AdventureNode, end: EndNode };

/** Links between the same two places of the same kind, drawn as one arrow */
export interface LinkGroup { id: string; from: number; to: number | null; won?: boolean; kind: CampaignLink["kind"]; links: CampaignLink[]; outcome: LinkOutcome }

export function groupLinks(links: CampaignLink[]): LinkGroup[] {
  const m = new Map<string, LinkGroup>();
  for (const l of links) {
    const to = l.to ?? (l.campaignWon ? "won" : "lost");
    const id = `${l.from}>${to}:${l.kind}`;
    const g = m.get(id) ?? { id, from: l.from, to: l.to, won: l.campaignWon, kind: l.kind, links: [], outcome: l.outcome };
    if (g.links.length && g.outcome !== l.outcome) g.outcome = "both";
    g.links.push(l);
    m.set(id, g);
  }
  return [...m.values()];
}

export function CampaignGraphView({ graph, texts, art, selected, onSelectAdventure, onSelectLink }: {
  graph: CampaignGraph; texts: TextDb | null; art: ModelArt;
  selected: { adv?: number; link?: string };
  onSelectAdventure: (id: number) => void; onSelectLink: (id: string) => void;
}) {
  const groups = useMemo(() => groupLinks(graph.links), [graph]);
  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = graph.adventures.map((a) => ({
      id: `a${a.id}`, type: "adv", position: { x: 0, y: 0 }, width: 230, height: 76,
      data: { title: say(texts, a.nameKey) || a.name, location: say(texts, a.locationKey), order: a.order,
        art: art[String(a.id)]?.LocationArt ? assetUrl(art[String(a.id)]!.LocationArt!) : null, selected: selected.adv === a.id },
    }));
    for (const won of [true, false]) {
      if (groups.some((g) => g.to === null && !!g.won === won)) nodes.push({ id: won ? "won" : "lost", type: "end", position: { x: 0, y: 0 }, width: 150, height: 44, data: { won } });
    }
    const edges: Edge[] = groups.map((g) => {
      const color = OUTCOME_COLOR[g.outcome];
      const sel = selected.link === g.id;
      // an adventure picked: its own arrows stand out, the rest fade (the branching campaigns are a tangle otherwise)
      const dim = selected.adv !== undefined && g.from !== selected.adv && g.to !== selected.adv;
      return {
        id: g.id, source: `a${g.from}`, target: g.to !== null ? `a${g.to}` : g.won ? "won" : "lost",
        style: { stroke: color, strokeWidth: sel ? 4 : 2, strokeDasharray: g.kind === "alternative" ? "6 5" : undefined, opacity: dim ? 0.12 : 1 },
        zIndex: dim ? 0 : 1,
        markerEnd: { type: MarkerType.ArrowClosed, color },
        label: g.links.length > 1 ? `×${g.links.length}` : undefined,
        labelStyle: { fill: "#e8dcc0", fontSize: 11 }, labelBgStyle: { fill: "#2a241c" },
      };
    });
    return { nodes: layout(nodes, edges, { dir: "LR", rankSep: 80, nodeSep: 24 }), edges };
  }, [graph, groups, texts, art, selected.adv, selected.link]);

  return (
    // a long campaign does not fit readably: the view opens on its first chapters (pan / zoom out for the rest)
    <ReactFlow key={graph.id} nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView minZoom={0.1} maxZoom={2}
      fitViewOptions={{ maxZoom: 1, nodes: graph.adventures.filter((a) => a.order >= 0 && a.order < 5).map((a) => ({ id: `a${a.id}` })) }}
      nodesDraggable={false} nodesConnectable={false} edgesFocusable elementsSelectable
      onNodeClick={(_e, n) => { if (n.id.startsWith("a")) onSelectAdventure(Number(n.id.slice(1))); }}
      onEdgeClick={(_e, e) => onSelectLink(e.id)} proOptions={{ hideAttribution: true }} colorMode="dark">
      <Background gap={24} color="#3a3226" />
      <MiniMap pannable zoomable nodeColor={(n) => (n.type === "end" ? ((n.data as EndData).won ? "#5fae5a" : "#c8574a") : "#8a6a3a")} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
