// One scenario's PlayMaker FSMs as graphs (read only): states with their actions, transitions by event, and the
// global events that jump into a state. Click a state: its actions with parameters and texts in the side panel;
// with an EditApi the texts, simple parameters and the actions' on/off switches can be changed there.
import { useEffect, useMemo, useState } from "react";
import { Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, useReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { scenarioFsms, type FsmGraph, type FsmStateNode } from "@jime/engine";
import type { TextDb } from "@jime/content-tools/text";
import { layout } from "./layout.ts";
import { keyIn, say } from "./text.ts";

/** Actions that end the adventure or steer the campaign: such states are marked */
const CAMPAIGN_ACTIONS = new Set(["SetNextAdventure", "AddAlternativeAdventure", "EndCampaign", "ProceedToNextGame", "EndGame"]);
const SHOWN_ACTIONS = 4;

/** Changes from the state panel (EditorScreen keeps them as a draft until saved) */
export interface EditApi {
  setParam(fsm: string, state: string, action: number, key: string, value: unknown): void;
  setEnabled(fsm: string, state: string, action: number, on: boolean): void;
  /** text of a key in the current language, line breaks as real ones (draft first) */
  text(key: string): string;
  setText(key: string, value: string): void;
  /** the key's text was changed in this draft */
  textChanged(key: string): boolean;
}

type StateData = { st: FsmStateNode; selected: boolean };
type EntryData = { event: string };

function StateNode({ data }: NodeProps<Node<StateData>>) {
  const s = data.st;
  const campaign = s.actions.some((a) => CAMPAIGN_ACTIONS.has(a.action));
  return (
    <div className={`ed-state${data.selected ? " sel" : ""}${s.start ? " start" : ""}${campaign ? " camp" : ""}`}>
      <Handle type="target" position={Position.Top} />
      <b>{s.name}</b>
      {s.actions.slice(0, SHOWN_ACTIONS).map((a, i) => <span key={i} className={a.enabled ? "" : "off"}>{a.action}</span>)}
      {s.actions.length > SHOWN_ACTIONS && <span className="more">+{s.actions.length - SHOWN_ACTIONS}</span>}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function EntryNode({ data }: NodeProps<Node<EntryData>>) {
  return (
    <div className="ed-entry">
      {data.event}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const nodeTypes = { state: StateNode, entry: EntryNode };

function FsmGraphView({ g, selected, onSelect }: { g: FsmGraph; selected: string | null; onSelect: (s: string) => void }) {
  const flow = useReactFlow();
  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = g.states.map((s) => ({
      id: `s:${s.name}`, type: "state", position: { x: 0, y: 0 }, width: 200,
      height: 30 + 15 * Math.min(s.actions.length, SHOWN_ACTIONS + 1), data: { st: s, selected: selected === s.name },
    }));
    const edges: Edge[] = g.edges.map((e, i) => ({
      id: `t${i}`, source: `s:${e.from}`, target: `s:${e.to}`, label: e.event === "FINISHED" ? undefined : e.event,
      markerEnd: { type: MarkerType.ArrowClosed, color: "#9a9080" }, style: { stroke: "#9a9080" },
      labelStyle: { fill: "#e8dcc0", fontSize: 10 }, labelBgStyle: { fill: "#2a241c" },
    }));
    for (const s of g.states) {
      for (const ev of s.entries) {
        nodes.push({ id: `e:${ev}`, type: "entry", position: { x: 0, y: 0 }, width: Math.max(90, 7 * ev.length + 20), height: 26, data: { event: ev } });
        edges.push({ id: `e:${ev}>${s.name}`, source: `e:${ev}`, target: `s:${s.name}`, style: { stroke: "#d0a040", strokeDasharray: "4 4" },
          markerEnd: { type: MarkerType.ArrowClosed, color: "#d0a040" } });
      }
    }
    return { nodes: layout(nodes, edges, { dir: "TB", rankSep: 50, nodeSep: 24 }), edges };
  }, [g, selected]);
  // a new FSM: show all of it
  useEffect(() => { requestAnimationFrame(() => flow.fitView({ duration: 0 })); }, [g, flow]);
  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView minZoom={0.05} maxZoom={2}
      nodesDraggable={false} nodesConnectable={false} onlyRenderVisibleElements
      onNodeClick={(_e, n) => { if (n.id.startsWith("s:")) onSelect(n.id.slice(2)); }}
      proOptions={{ hideAttribution: true }} colorMode="dark">
      <Background gap={24} color="#3a3226" />
      <MiniMap pannable zoomable nodeColor={(n) => (n.type === "entry" ? "#d0a040" : "#6a5a40")} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

/** A parameter value for the panel: references by name, «keys» with their text */
function ParamValue({ v, texts }: { v: unknown; texts: TextDb | null }) {
  const k = keyIn(v);
  if (k) return <span className="ed-key">{k}<em>{say(texts, k) !== k ? say(texts, k) : ""}</em></span>;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, any>;
    if (o.ref && (o.name !== undefined || o.id !== undefined)) return <span className="ed-ref">{o.ref}: {o.name ?? o.id}</span>;
    if (o.ref === "go" || o.go !== undefined) return <span className="ed-ref">{o.kind ?? "объект"} #{o.go}</span>;
  }
  return <code>{typeof v === "string" ? v : JSON.stringify(v)}</code>;
}

/** One parameter in edit mode: a text key -> its text; numbers, strings, booleans -> inputs; references stay read only */
function ParamEdit({ v, texts, edit, onChange }: { v: unknown; texts: TextDb | null; edit: EditApi; onChange: (v: unknown) => void }) {
  const k = keyIn(v);
  if (k) {
    return (
      <span className="ed-key">{k}{edit.textChanged(k) && <b className="ed-dirty"> · изменён</b>}
        <textarea className="ed-input" rows={Math.min(10, Math.max(2, edit.text(k).split("\n").length + 1))}
          defaultValue={edit.text(k)} key={`${k}|${edit.text(k)}`} onBlur={(e) => { if (e.target.value !== edit.text(k)) edit.setText(k, e.target.value); }} />
      </span>
    );
  }
  if (typeof v === "boolean") return <input type="checkbox" checked={v} onChange={(e) => onChange(e.target.checked)} />;
  if (typeof v === "number") {
    return <input className="ed-input num" type="number" step="any" defaultValue={v} key={String(v)}
      onBlur={(e) => { const n = Number(e.target.value); if (e.target.value !== "" && Number.isFinite(n) && n !== v) onChange(n); }} />;
  }
  if (typeof v === "string") {
    return <input className="ed-input" type="text" defaultValue={v} key={v} spellCheck={false}
      onBlur={(e) => { if (e.target.value !== v) onChange(e.target.value); }} />;
  }
  return <ParamValue v={v} texts={texts} />;
}

function StatePanel({ g, name, texts, onSelect, edit }: { g: FsmGraph; name: string; texts: TextDb | null; onSelect: (s: string) => void; edit?: EditApi }) {
  const s = g.states.find((x) => x.name === name);
  if (!s) return null;
  const out = g.edges.filter((e) => e.from === name);
  const inn = g.edges.filter((e) => e.to === name);
  return (
    <div className="ed-panel-body">
      <h3>{s.name}</h3>
      {s.start && <p className="muted">Начальное состояние</p>}
      {s.entries.length > 0 && <p>Глобальные события: {s.entries.map((e) => <span key={e} className="ed-chip">{e}</span>)}</p>}
      <h4>Действия ({s.actions.length})</h4>
      <ol className="ed-actions">
        {s.actions.map((a, i) => (
          <li key={i} className={a.enabled ? "" : "off"}>
            {edit && <input type="checkbox" title="Действие включено" checked={a.enabled} onChange={(e) => edit.setEnabled(g.index, s.name, i, e.target.checked)} />}
            <b>{a.action}</b>{a.enabled ? "" : " (выключено)"}
            {Object.keys(a.params).length > 0 && (
              <dl>{Object.entries(a.params).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>
                {edit ? <ParamEdit v={v} texts={texts} edit={edit} onChange={(nv) => edit.setParam(g.index, s.name, i, k, nv)} /> : <ParamValue v={v} texts={texts} />}
              </dd></div>)}</dl>
            )}
          </li>
        ))}
      </ol>
      <h4>Переходы</h4>
      {out.length === 0 && <p className="muted">Нет: здесь цепочка заканчивается</p>}
      <ul className="ed-links">{out.map((e, i) => <li key={i}><span className="ed-chip">{e.event}</span> → <button className="link" onClick={() => onSelect(e.to)}>{e.to}</button></li>)}</ul>
      {inn.length > 0 && <>
        <h4>Сюда ведут</h4>
        <ul className="ed-links">{inn.map((e, i) => <li key={i}><button className="link" onClick={() => onSelect(e.from)}>{e.from}</button> <span className="ed-chip">{e.event}</span></li>)}</ul>
      </>}
    </div>
  );
}

export function FsmView({ prefab, rev = 0, title, texts, focus, edit }: {
  prefab: any; rev?: number; title: string; texts: TextDb | null; focus?: { fsm: string; state: string }; edit?: EditApi;
}) {
  // rev: the draft prefab is changed in place, a new rev rebuilds the graphs
  const fsms = useMemo(() => scenarioFsms(prefab), [prefab, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const [idx, setIdx] = useState(focus?.fsm ?? fsms[0]?.index ?? "0");
  const [state, setState] = useState<string | null>(focus?.state ?? null);
  useEffect(() => { if (focus) { setIdx(focus.fsm); setState(focus.state); } }, [focus?.fsm, focus?.state]); // eslint-disable-line react-hooks/exhaustive-deps
  const g = fsms.find((f) => f.index === idx) ?? fsms[0];
  if (!g) return <p className="muted">В сценарии нет FSM.</p>;
  return (
    <div className="ed-fsm">
      <aside className="ed-list">
        <h3>{title}</h3>
        <p className="muted">Автоматы сценария ({fsms.length})</p>
        <ul>
          {fsms.map((f) => (
            <li key={f.index}>
              <button className={`link${f.index === g.index ? " on" : ""}`} onClick={() => { setIdx(f.index); setState(null); }}>
                {f.owner ?? f.name}<span className="muted"> · {f.name} · {f.states.length}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <div className="ed-canvas"><FsmGraphView g={g} selected={state} onSelect={setState} /></div>
      <aside className="ed-panel">
        {state ? <StatePanel g={g} name={state} texts={texts} onSelect={setState} edit={edit} />
          : <div className="ed-panel-body"><p className="muted">Выберите состояние на графе.</p>
            <p className="muted">Пунктир от золотых меток — глобальные события, которые переводят автомат прямо в состояние
              (например, ADVENTURE_END_VICTORY). Зелёная рамка — состояние, которое завершает приключение или выбирает следующее.</p></div>}
      </aside>
    </div>
  );
}
