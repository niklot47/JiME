// One scenario's PlayMaker FSMs as graphs (read only): states with their actions, transitions by event, and the
// global events that jump into a state. Click a state: its actions with parameters and texts in the side panel;
// with an EditApi the texts, simple parameters and the actions' on/off switches can be changed there.
import { useEffect, useMemo, useState } from "react";
import { Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, useReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { issueId, keysOf, ORDER, scenarioFsms, type FsmGraph, type FsmStateNode, type Issue } from "@jime/engine";
import type { TextDb } from "@jime/content-tools/text";
import { layout } from "./layout.ts";
import { KIND_NAME, loadActionCatalog, newAction, paramKind, type ActionInfo } from "./catalog.ts";
import type { BotReport } from "./botRun.ts";
import { keyIn, say } from "./text.ts";
import { TextsTable, Translations } from "./TextsTable.tsx";

/** Actions that end the adventure or steer the campaign: such states are marked */
const CAMPAIGN_ACTIONS = new Set(["SetNextAdventure", "AddAlternativeAdventure", "EndCampaign", "ProceedToNextGame", "EndGame"]);
const SHOWN_ACTIONS = 4;

/** Changes from the state panel (EditorScreen keeps them as a draft until saved) */
export interface EditApi {
  setParam(fsm: string, state: string, action: number, key: string, value: unknown): void;
  setEnabled(fsm: string, state: string, action: number, on: boolean): void;
  /** text of a key in a language (default: the current one), line breaks as real ones (draft first) */
  text(key: string, lang?: string): string;
  setText(key: string, value: string, lang?: string): void;
  /** the key's text was changed in this draft */
  textChanged(key: string, lang?: string): boolean;
  /** the key has a non-empty text in the language (pack or draft) */
  hasText(key: string, lang: string): boolean;
  /** the pack set's languages, the current one first */
  langs: string[];
  /** change one state of the draft (transitions); the FSM graphs are rebuilt */
  mutateState(fsm: string, state: string, f: (st: any) => void): void;
  /** change the whole FSM (states added / renamed / removed) */
  mutateFsm(fsm: string, f: (fsm: any) => void): void;
  /** a fresh text key for a new message (its text starts empty in the draft) */
  newKey(): string;
  /** the merged db (model lists for references) */
  db: any;
}

/** Delete a key of an object read by parseOrdered (its ORDER list too) */
function deleteKey(o: any, k: string): void {
  delete o[k];
  const order = o[ORDER] as string[] | undefined;
  if (order) { const i = order.indexOf(k); if (i >= 0) order.splice(i, 1); }
}

/** Rename a state everywhere the FSM names it: the state, transitions into it, global events, the start */
function renameState(fsm: any, from: string, to: string): void {
  for (const st of fsm.states ?? []) {
    if (st.name === from) st.name = to;
    for (const ev of keysOf(st.transitions ?? {})) if (st.transitions[ev] === from) st.transitions[ev] = to;
  }
  for (const ev of keysOf(fsm.global ?? {})) if (fsm.global[ev] === from) fsm.global[ev] = to;
  if (fsm.start === from) fsm.start = to;
}

/** Remove a state and every transition / global event into it */
function removeState(fsm: any, name: string): void {
  fsm.states = (fsm.states ?? []).filter((st: any) => st.name !== name);
  for (const st of fsm.states) for (const ev of keysOf(st.transitions ?? {})) if (st.transitions[ev] === name) deleteKey(st.transitions, ev);
  for (const ev of keysOf(fsm.global ?? {})) if (fsm.global[ev] === name) deleteKey(fsm.global, ev);
}

/** Add an action from the catalog: list (most used first), the chosen action's parameters as help */
function AddAction({ edit, onAdd }: { edit: EditApi; onAdd: (a: any) => void }) {
  const [cat, setCat] = useState<Map<string, ActionInfo> | null>(null);
  const [pick, setPick] = useState("");
  const [loading, setLoading] = useState(false);
  const list = useMemo(() => (cat ? [...cat.values()].sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name)) : []), [cat]);
  if (!cat) {
    return <button className="link" disabled={loading} onClick={() => { setLoading(true); void loadActionCatalog(edit.db).then((c) => { setCat(c); setPick(""); }); }}>
      {loading ? "Собираю каталог действий из сценариев…" : "+ добавить действие"}</button>;
  }
  const info = cat.get(pick);
  return (
    <div className="ed-addact">
      <div className="row">
        <select className="ed-input" value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">— действие —</option>
          {list.map((a) => <option key={a.name} value={a.name}>{a.name} · {a.uses}{a.supported ? "" : " · нет в движке"}</option>)}
        </select>
        <button className="primary" disabled={!info} onClick={() => { if (info) { onAdd(newAction(info, () => edit.newKey())); setPick(""); } }}>Добавить</button>
      </div>
      {info && (
        <div className="ed-help">
          <p>{info.supported ? "Движок выполняет это действие." : <b className="error">Движок это действие не выполняет (пропустит с предупреждением).</b>}
            {" "}В сценариях встречается {info.uses} раз, в {info.adventures} приключениях.</p>
          {info.params.length > 0 ? (
            <dl>{info.params.map((p) => (
              <div key={p.name}><dt>{p.name}</dt><dd>
                {Object.entries(p.kinds).map(([k, n]) => `${KIND_NAME[k as keyof typeof KIND_NAME]}${Object.keys(p.kinds).length > 1 ? ` ×${n}` : ""}`).join(", ")}
                <span className="muted"> · в {Math.round((100 * p.uses) / Math.max(1, info.uses))}% использований{p.uses * 2 < info.uses ? " (не добавляется)" : ""}</span>
                {paramKind(p.example) !== "text" && <code className="ed-ex">{JSON.stringify(p.example)?.slice(0, 80)}</code>}
              </dd></div>
            ))}</dl>
          ) : <p className="muted">Без параметров.</p>}
        </div>
      )}
    </div>
  );
}

/** A model entry's name for lists: its localized name key when there is one, else m_Name */
function modelLabel(m: any, texts: TextDb | null): string {
  for (const k of ["NameKey", "TitleKey", "Name", "Key"]) {
    const key = m?.[k];
    if (typeof key === "string" && key) { const t = say(texts, key); if (t && t !== key) return `${t} (${m.m_Name})`; }
  }
  return m?.m_Name ?? String(m?._id);
}

/** A reference to a db model: a list of all entries of that model */
function ModelSelect({ v, db, texts, onChange }: { v: any; db: any; texts: TextDb | null; onChange: (v: unknown) => void }) {
  const opts = useMemo(() => Object.values<any>(db?.models?.[v.ref] ?? {}).map((m) => ({ id: Number(m._id), name: m.m_Name, label: modelLabel(m, texts) }))
    .sort((a, b) => a.id - b.id), [db, v.ref, texts]);
  if (!opts.length) return <ParamValue v={v} texts={texts} />;
  return (
    <span className="ed-ref">{v.ref}
      <select className="ed-input" value={String(v.id)} onChange={(e) => { const o = opts.find((x) => String(x.id) === e.target.value)!; onChange({ ...v, name: o.name, id: o.id }); }}>
        {!opts.some((o) => o.id === Number(v.id)) && <option value={String(v.id)}>#{v.id} {v.name ?? ""} (нет в базе)</option>}
        {opts.map((o) => <option key={o.id} value={String(o.id)}>{o.id} · {o.label}</option>)}
      </select>
    </span>
  );
}

/** A reference to a game object of this scenario: a list of the prefab's objects */
function ObjectSelect({ v, prefab, onChange }: { v: any; prefab: any; onChange: (v: unknown) => void }) {
  const opts = useMemo(() => Object.entries<any>(prefab?.gameObjects ?? {}).map(([id, go]) => ({ id: Number(id), name: go.name as string }))
    .sort((a, b) => a.name.localeCompare(b.name)), [prefab]);
  return (
    <span className="ed-ref">{v.kind ?? "объект"}
      <select className="ed-input" value={String(v.go)} onChange={(e) => onChange({ ...v, go: Number(e.target.value) })}>
        {!opts.some((o) => o.id === Number(v.go)) && <option value={String(v.go)}>#{v.go} (нет в сцене)</option>}
        {opts.map((o) => <option key={o.id} value={String(o.id)}>{o.name} · #{o.id}</option>)}
      </select>
    </span>
  );
}

type StateData = { st: FsmStateNode; selected: boolean; mark: "error" | "warning" | null; unvisited: boolean };

/** The check's results and the bot's report for this scenario (EditorScreen computes them) */
export interface CheckInfo {
  issues: Issue[];
  /** issueId of the issues the original scenario does not have */
  fresh: Set<string>;
  bot: BotReport | null;
  /** games played so far while the bot runs, else null */
  running: number | null;
  botSeeds: number;
  /** absent: no bot for this scenario (an encounter) */
  onRunBot?: () => void;
}

const OUTCOME_RU: Record<string, string> = { victory: "победа", defeat: "поражение", timeout: "не закончил" };

export const ISSUE_TEXT: Record<Issue["kind"], string> = {
  "missing-state": "переход в несуществующее состояние",
  "duplicate-state": "два состояния с одним именем (работает первое)",
  "no-start": "начального состояния нет",
  unreachable: "сюда не ведёт ни один переход",
  "unsent-event": "событие перехода никто не посылает",
  "unknown-action": "движок не выполняет это действие",
  "missing-text": "нет текста",
};
type EntryData = { event: string };

function StateNode({ data }: NodeProps<Node<StateData>>) {
  const s = data.st;
  const campaign = s.actions.some((a) => CAMPAIGN_ACTIONS.has(a.action));
  return (
    <div className={`ed-state${data.selected ? " sel" : ""}${s.start ? " start" : ""}${campaign ? " camp" : ""}${data.mark ? ` ${data.mark}` : ""}${data.unvisited ? " unvisited" : ""}`}>
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

function FsmGraphView({ g, selected, onSelect, check }: { g: FsmGraph; selected: string | null; onSelect: (s: string) => void; check?: CheckInfo }) {
  const flow = useReactFlow();
  // only the issues an edit brought in mark the graph (the original's own left-overs would mark half of it)
  const marks = useMemo(() => {
    const m = new Map<string, "error" | "warning">();
    for (const i of check?.issues ?? []) {
      if (i.fsm !== g.index || i.state === undefined || !check!.fresh.has(issueId(i))) continue;
      if (i.level === "error" || !m.has(i.state)) m.set(i.state, i.level);
    }
    return m;
  }, [check, g]);
  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = g.states.map((s) => ({
      id: `s:${s.name}`, type: "state", position: { x: 0, y: 0 }, width: 200,
      height: 30 + 15 * Math.min(s.actions.length, SHOWN_ACTIONS + 1),
      data: { st: s, selected: selected === s.name, mark: marks.get(s.name) ?? null, unvisited: !!check?.bot && !check.bot.visited.has(`${g.name}\u001f${s.name}`) },
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
  }, [g, selected, marks, check?.bot]); // eslint-disable-line react-hooks/exhaustive-deps
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

/** One parameter in edit mode: a text key -> its text; numbers, strings, booleans -> inputs; references -> lists */
function ParamEdit({ v, texts, edit, prefab, onChange }: { v: unknown; texts: TextDb | null; edit: EditApi; prefab: any; onChange: (v: unknown) => void }) {
  const k = keyIn(v);
  if (k) {
    return (
      <span className="ed-key">{k}{edit.textChanged(k) && <b className="ed-dirty"> · изменён</b>}
        <textarea className="ed-input" rows={Math.min(10, Math.max(2, edit.text(k).split("\n").length + 1))}
          defaultValue={edit.text(k)} key={`${k}|${edit.text(k)}`} onBlur={(e) => { if (e.target.value !== edit.text(k)) edit.setText(k, e.target.value); }} />
        <Translations k={k} edit={edit} />
        <button className="link small" title="Этот текст может быть общим с другими местами: новый ключ меняет только это действие"
          onClick={() => {
            const nk = edit.newKey();
            for (const l of edit.langs) edit.setText(nk, edit.text(k, l), l); // every language's text goes along
            onChange(typeof v === "string" ? `«${nk}»` : { ...(v as object), key: `«${nk}»` });
          }}>отдельный текст для этого места</button>
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
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, any>;
    if (o.ref === "go" || (o.go !== undefined && !o.ref)) return <ObjectSelect v={o} prefab={prefab} onChange={onChange} />;
    if (typeof o.ref === "string" && o.id !== undefined) return <ModelSelect v={o} db={edit.db} texts={texts} onChange={onChange} />;
  }
  return <ParamValue v={v} texts={texts} />;
}

/** Transitions of a state in edit mode: event name, target state, remove; a row to add one */
function TransitionsEdit({ g, s, edit }: { g: FsmGraph; s: FsmStateNode; edit: EditApi }) {
  const out = g.edges.filter((e) => e.from === s.name);
  const names = g.states.map((x) => x.name);
  const [ev, setEv] = useState(out.length ? "" : "FINISHED");
  const [to, setTo] = useState(names[0] ?? "");
  // transitions is an object keyed by event: rebuild it to rename one in place. Events may be integer-like ("0", "1"
  // from multiple-choice actions): the file order is kept in ORDER like parseOrdered does
  const rebuild = (f: (pairs: [string, string][]) => [string, string][]) =>
    edit.mutateState(g.index, s.name, (st) => {
      const old = st.transitions ?? {};
      const pairs = f(keysOf(old).map((k) => [k, old[k] as string]));
      const o: Record<string, string> = {};
      for (const [k, t] of pairs) o[k] = t;
      Object.defineProperty(o, ORDER, { value: pairs.map(([k]) => k) });
      st.transitions = o;
    });
  return (
    <>
      {out.length === 0 && <p className="muted">Нет: здесь цепочка заканчивается</p>}
      <ul className="ed-trans">
        {out.map((e) => (
          <li key={e.event}>
            <input className="ed-input ev" defaultValue={e.event} key={e.event} spellCheck={false}
              onBlur={(x) => { const n = x.target.value.trim(); if (n && n !== e.event && !out.some((o) => o.event === n)) rebuild((p) => p.map(([k, t]) => [k === e.event ? n : k, t])); }} />
            <span>→</span>
            <select className="ed-input" value={e.to} onChange={(x) => rebuild((p) => p.map(([k, t]) => [k, k === e.event ? x.target.value : t]))}>
              {names.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <button className="link" title="Убрать переход" onClick={() => rebuild((p) => p.filter(([k]) => k !== e.event))}>✕</button>
          </li>
        ))}
        <li className="add">
          <input className="ed-input ev" placeholder="событие" value={ev} spellCheck={false} onChange={(x) => setEv(x.target.value)} />
          <span>→</span>
          <select className="ed-input" value={to} onChange={(x) => setTo(x.target.value)}>{names.map((n) => <option key={n} value={n}>{n}</option>)}</select>
          <button className="link" disabled={!ev.trim() || out.some((o) => o.event === ev.trim())}
            onClick={() => { rebuild((p) => [...p, [ev.trim(), to]]); setEv(""); }}>+ добавить</button>
        </li>
      </ul>
    </>
  );
}

function StatePanel({ g, name, texts, onSelect, edit, prefab, stateIssues }: {
  g: FsmGraph; name: string; texts: TextDb | null; onSelect: (s: string) => void; edit?: EditApi; prefab: any; stateIssues?: Issue[];
}) {
  const s = g.states.find((x) => x.name === name);
  if (!s) return null;
  const out = g.edges.filter((e) => e.from === name);
  const inn = g.edges.filter((e) => e.to === name);
  const moveAction = (i: number, d: number) => edit?.mutateState(g.index, s.name, (st) => {
    const j = i + d;
    if (j < 0 || j >= st.actions.length) return;
    [st.actions[i], st.actions[j]] = [st.actions[j], st.actions[i]];
  });
  return (
    <div className="ed-panel-body">
      {edit ? (
        <div className="ed-statehead">
          <input className="ed-input title" defaultValue={s.name} key={s.name} spellCheck={false} title="Имя состояния"
            onBlur={(e) => {
              const n = e.target.value.trim();
              if (!n || n === s.name) return;
              if (g.states.some((x) => x.name === n)) { e.target.value = s.name; return; }
              edit.mutateFsm(g.index, (f) => renameState(f, s.name, n));
              onSelect(n);
            }} />
          <button className="link" disabled={s.start} title={s.start ? "Начальное состояние не удаляется" : "Удалить состояние и переходы в него"}
            onClick={() => { edit.mutateFsm(g.index, (f) => removeState(f, s.name)); onSelect(""); }}>удалить</button>
        </div>
      ) : <h3>{s.name}</h3>}
      {s.start && <p className="muted">Начальное состояние</p>}
      {stateIssues && stateIssues.length > 0 && (
        <ul className="ed-issues">{stateIssues.map((i, n) => <li key={n} className={i.level}>{ISSUE_TEXT[i.kind]}{i.detail ? `: ${i.detail}` : ""}{i.langs ? ` (${i.langs.join(", ")})` : ""}</li>)}</ul>
      )}
      {s.entries.length > 0 && <p>Глобальные события: {s.entries.map((e) => <span key={e} className="ed-chip">{e}</span>)}</p>}
      <h4>Действия ({s.actions.length})</h4>
      <ol className="ed-actions">
        {s.actions.map((a, i) => (
          <li key={i} className={a.enabled ? "" : "off"}>
            {edit && <input type="checkbox" title="Действие включено" checked={a.enabled} onChange={(e) => edit.setEnabled(g.index, s.name, i, e.target.checked)} />}
            <b>{a.action}</b>{a.enabled ? "" : " (выключено)"}
            {edit && <span className="ed-actbtns">
              <button className="link" disabled={i === 0} title="Выше" onClick={() => moveAction(i, -1)}>↑</button>
              <button className="link" disabled={i === s.actions.length - 1} title="Ниже" onClick={() => moveAction(i, 1)}>↓</button>
              <button className="link" title="Удалить действие" onClick={() => edit.mutateState(g.index, s.name, (st) => { st.actions.splice(i, 1); })}>✕</button>
            </span>}
            {Object.keys(a.params).length > 0 && (
              <dl>{Object.entries(a.params).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>
                {edit ? <ParamEdit v={v} texts={texts} edit={edit} prefab={prefab} onChange={(nv) => edit.setParam(g.index, s.name, i, k, nv)} /> : <ParamValue v={v} texts={texts} />}
              </dd></div>)}</dl>
            )}
          </li>
        ))}
      </ol>
      {edit && <AddAction edit={edit} onAdd={(a) => edit.mutateState(g.index, s.name, (st) => { (st.actions ??= []).push(a); })} />}
      <h4>Переходы</h4>
      {edit ? <TransitionsEdit key={s.name} g={g} s={s} edit={edit} /> : <>
        {out.length === 0 && <p className="muted">Нет: здесь цепочка заканчивается</p>}
        <ul className="ed-links">{out.map((e, i) => <li key={i}><span className="ed-chip">{e.event}</span> → <button className="link" onClick={() => onSelect(e.to)}>{e.to}</button></li>)}</ul>
      </>}
      {edit && out.length > 0 && <p className="ed-goto">Перейти: {out.map((e) => <button key={e.event} className="link" onClick={() => onSelect(e.to)}>{e.to}</button>)}</p>}
      {inn.length > 0 && <>
        <h4>Сюда ведут</h4>
        <ul className="ed-links">{inn.map((e, i) => <li key={i}><button className="link" onClick={() => onSelect(e.from)}>{e.from}</button> <span className="ed-chip">{e.event}</span></li>)}</ul>
      </>}
    </div>
  );
}

/** The check and bot results in the side list: new issues first (clickable), the original's own ones on request */
function CheckSection({ check, fsms, onGo }: { check: CheckInfo; fsms: FsmGraph[]; onGo: (fsm: string, state?: string) => void }) {
  const [old, setOld] = useState(false);
  const fresh = check.issues.filter((i) => check.fresh.has(issueId(i)));
  const shown = old ? check.issues : fresh;
  const errors = fresh.filter((i) => i.level === "error").length;
  const b = check.bot;
  return (
    <div className="ed-check">
      <h4>Проверка</h4>
      <p className={errors ? "error" : fresh.length ? "warn" : "ok"}>
        {fresh.length ? `Новых проблем: ${fresh.length}${errors ? ` (ошибок ${errors})` : ""}` : "Новых проблем нет"}
        <span className="muted"> · в оригинале {check.issues.length - fresh.length}</span>
      </p>
      {shown.length > 0 && (
        <ul className="ed-issues">{shown.slice(0, 60).map((i, n) => (
          <li key={n} className={`${i.level}${check.fresh.has(issueId(i)) ? "" : " old"}`}>
            <button className="link" onClick={() => onGo(i.fsm, i.state)}>{i.state ?? i.fsmName}</button>{" "}
            {ISSUE_TEXT[i.kind]}{i.detail ? `: ${i.detail}` : ""}{i.langs ? ` (${i.langs.join(", ")})` : ""}
            {fsms.length > 1 && <span className="muted"> · {i.fsmName}</span>}
          </li>
        ))}{shown.length > 60 && <li className="muted">… ещё {shown.length - 60}</li>}</ul>
      )}
      <button className="link small" onClick={() => setOld(!old)}>{old ? "только новые" : "показать и оригинальные"}</button>
      {check.onRunBot && <>
      <h4>Бот</h4>
      <button className="primary" disabled={check.running !== null} onClick={check.onRunBot}>
        {check.running !== null ? `Играю… ${check.running} / ${check.botSeeds}` : `Прогнать ботом × ${check.botSeeds}`}</button>
      {b && (
        <div className="ed-bot">
          <p>{Object.entries(b.outcomes).map(([k, v]) => <span key={k} className="ed-chip">{OUTCOME_RU[k] ?? k} × {v}</span>)}
            <span className="muted"> · раундов в среднем {b.avgRounds.toFixed(1)} · {(b.ms / 1000).toFixed(1)} с</span></p>
          {b.errors.length > 0 && <><p className="error">Ошибки движка: {b.errors.length}</p>
            <ul className="ed-issues">{b.errors.slice(0, 5).map((e) => <li key={e.seed} className="error">сид {e.seed}: {e.message}</li>)}</ul></>}
          {b.unimplemented.length > 0 && <p className="warn">Не выполнено движком: {b.unimplemented.map(([k, v]) => `${k} × ${v}`).join(", ")}</p>}
          {b.warnings.length > 0 && <details><summary>Предупреждения движка ({b.warnings.length})</summary>
            <ul className="ed-issues">{b.warnings.map(([k, v]) => <li key={k} className="warning">{k} × {v}</li>)}</ul></details>}
          <p className="muted">На графе бледные — состояния, до которых бот ни разу не дошёл.</p>
        </div>
      )}
      </>}
    </div>
  );
}

export function FsmView({ prefab, rev = 0, title, texts, focus, edit, check }: {
  prefab: any; rev?: number; title: string; texts: TextDb | null; focus?: { fsm: string; state: string }; edit?: EditApi; check?: CheckInfo;
}) {
  // rev: the draft prefab is changed in place, a new rev rebuilds the graphs
  const fsms = useMemo(() => scenarioFsms(prefab), [prefab, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const [idx, setIdx] = useState(focus?.fsm ?? fsms[0]?.index ?? "0");
  const [state, setState] = useState<string | null>(focus?.state ?? null);
  const [newName, setNewName] = useState("");
  const [view, setView] = useState<"graph" | "texts">("graph");
  useEffect(() => { if (focus) { setIdx(focus.fsm); setState(focus.state); } }, [focus?.fsm, focus?.state]); // eslint-disable-line react-hooks/exhaustive-deps
  const g = fsms.find((f) => f.index === idx) ?? fsms[0];
  if (!g) return <p className="muted">В сценарии нет FSM.</p>;
  return (
    <div className="ed-fsm">
      <aside className="ed-list">
        <h3>{title}</h3>
        {edit && (
          <div className="ed-tabs">
            <button className={view === "graph" ? "on" : ""} onClick={() => setView("graph")}>Граф</button>
            <button className={view === "texts" ? "on" : ""} onClick={() => setView("texts")}>Тексты и переводы</button>
          </div>
        )}
        <p className="muted">Автоматы сценария ({fsms.length})</p>
        {edit && (
          <div className="ed-newstate">
            <input className="ed-input" placeholder="новое состояние" value={newName} spellCheck={false} onChange={(e) => setNewName(e.target.value)} />
            <button className="link" disabled={!newName.trim() || !!g?.states.some((x) => x.name === newName.trim())}
              onClick={() => { const n = newName.trim(); edit.mutateFsm(g!.index, (f) => { (f.states ??= []).push({ name: n, transitions: {}, actions: [] }); }); setState(n); setNewName(""); }}>
              + в «{g?.owner ?? g?.name}»</button>
          </div>
        )}
        <ul>
          {fsms.map((f) => (
            <li key={f.index}>
              <button className={`link${f.index === g.index ? " on" : ""}`} onClick={() => { setIdx(f.index); setState(null); setView("graph"); }}>
                {f.owner ?? f.name}<span className="muted"> · {f.name} · {f.states.length}</span>
              </button>
            </li>
          ))}
        </ul>
        {check && fsms.length > 0 && <CheckSection check={check} fsms={fsms} onGo={(f, st) => { setIdx(f); setState(st ?? null); setView("graph"); }} />}
      </aside>
      {view === "texts" && edit ? (
        <TextsTable prefab={prefab} rev={rev} edit={edit} onGo={(f, st) => { setIdx(f); setState(st); setView("graph"); }} />
      ) : <>
      <div className="ed-canvas"><FsmGraphView g={g} selected={state} onSelect={setState} check={check} /></div>
      <aside className="ed-panel">
        {state && g.states.some((x) => x.name === state) ? <StatePanel g={g} name={state} texts={texts} onSelect={setState} edit={edit} prefab={prefab}
          stateIssues={check?.issues.filter((i) => i.fsm === g.index && i.state === state)} />
          : <div className="ed-panel-body"><p className="muted">Выберите состояние на графе.</p>
            <p className="muted">Пунктир от золотых меток — глобальные события, которые переводят автомат прямо в состояние
              (например, ADVENTURE_END_VICTORY). Зелёная рамка — состояние, которое завершает приключение или выбирает следующее.</p></div>}
      </aside>
      </>}
    </div>
  );
}
