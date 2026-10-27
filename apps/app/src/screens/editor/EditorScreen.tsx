// Campaign editor. A campaign as a graph of adventures (links from the scripts), and each adventure's scenario as FSM
// graphs. Texts, simple action parameters and actions' on/off can be changed: the changes are a draft until saved
// into the user pack my-edits (data/editPack.ts), which lies over core-ffg.
import { useEffect, useMemo, useRef, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { campaignGraph, cloneOrdered, type CampaignGraph, type FsmPath } from "@jime/engine";
import { loadAdventure, loadDb, loadModelArt, type ModelArt } from "../../data/pack.ts";
import { CampaignGraphView, groupLinks, OUTCOME_COLOR, OUTCOME_NAME } from "./CampaignGraphView.tsx";
import { FsmView, type EditApi } from "./FsmView.tsx";
import { fromCsv, say, toCsv, useTexts } from "./text.ts";
import { EDIT_PACK, saveEdits } from "../../data/editPack.ts";
import { getLang } from "../../data/lang.ts";

const ENTRY_NAME: Record<string, string> = { start: "старт сценария", ADVENTURE_END_VICTORY: "победа в приключении", ADVENTURE_END_FAILURE: "поражение в приключении" };

function PathText({ p }: { p: FsmPath }) {
  return (
    <div className="ed-path">
      <span className="ed-chip gold">{ENTRY_NAME[p.entry] ?? p.entry}</span>
      {p.steps.map((s, i) => <span key={i}> → {s.state}{s.event !== "FINISHED" && <span className="ed-chip">{s.event}</span>}</span>)}
    </div>
  );
}

let keySeq = 0;

export function EditorScreen({ onBack }: { onBack: () => void }) {
  const [textsRev, setTextsRev] = useState(0);
  const texts = useTexts(textsRev);
  // the draft: changed adventure prefabs (copies, changed in place) and texts (lang -> full key -> CSV text)
  const draft = useRef<{ adv: Map<number, any>; texts: Map<string, Map<string, string>> }>({ adv: new Map(), texts: new Map() });
  const [rev, setRev] = useState(0);
  const [saving, setSaving] = useState<string | null>(null);
  const [db, setDb] = useState<any>(null);
  const [art, setArt] = useState<ModelArt>({});
  const [campaign, setCampaign] = useState<number | null>(null);
  const [prefabs, setPrefabs] = useState<Map<number, any>>(new Map());
  const [loaded, setLoaded] = useState<CampaignGraph | null>(null);
  const [sel, setSel] = useState<{ adv?: number; link?: string }>({});
  const [open, setOpen] = useState<{ adv: number; focus?: { fsm: string; state: string } } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDb().then((d) => { setDb(d); setCampaign(Number(Object.values<any>(d.models.CampaignModel)[0]?._id ?? 1)); }).catch((e) => setError(String(e)));
    void loadModelArt("adventures").then(setArt);
  }, []);

  // a campaign: load its adventures (and those the scripts lead to) and build the graph
  useEffect(() => {
    if (!db || campaign === null) return;
    let live = true;
    setLoaded(null); setSel({}); setOpen(null);
    (async () => {
      const cache = new Map(prefabs);
      const get = async (id: number) => {
        if (!cache.has(id)) { try { cache.set(id, await loadAdventure(id)); } catch { cache.set(id, null); } }
        return cache.get(id);
      };
      // breadth-first: campaignGraph asks synchronously, so fetch until no new adventure turns up
      for (let round = 0; round < 10; round++) {
        const g = campaignGraph(db, campaign, (id) => cache.get(id) ?? null);
        const want = g.adventures.map((a) => a.id).filter((id) => !cache.has(id));
        if (!want.length) { if (live) { setPrefabs(cache); setLoaded(g); } return; }
        await Promise.all(want.map(get));
      }
    })().catch((e) => { if (live) setError(String(e)); });
    return () => { live = false; };
  }, [db, campaign]); // eslint-disable-line react-hooks/exhaustive-deps

  // the graph as the draft has it (a changed SetNextAdventure moves its arrow at once); an adventure only the draft
  // leads to is loaded by the effect below
  const graph = useMemo(() => (loaded && db && campaign !== null
    ? campaignGraph(db, campaign, (id) => draft.current.adv.get(id) ?? prefabs.get(id) ?? null) : null), [loaded, prefabs, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const want = (graph?.missing ?? []).filter((id) => !prefabs.has(id));
    if (!want.length) return;
    void Promise.all(want.map(async (id) => [id, await loadAdventure(id).catch(() => null)] as const))
      .then((got) => setPrefabs((p) => { const m = new Map(p); for (const [id, v] of got) m.set(id, v); return m; }));
  }, [graph]); // eslint-disable-line react-hooks/exhaustive-deps

  const campaigns = useMemo(() => (db ? Object.values<any>(db.models.CampaignModel) : []), [db]);
  const groups = useMemo(() => (graph ? groupLinks(graph.links) : []), [graph]);
  const advName = (id: number | null, won?: boolean) => {
    if (id === null) return won ? "Победа в кампании" : "Поражение в кампании";
    const a = graph?.adventures.find((x) => x.id === id);
    return a ? say(texts, a.nameKey) || a.name : `#${id}`;
  };

  const openAdv = open && (draft.current.adv.get(open.adv) ?? prefabs.get(open.adv));
  const dirtyTexts = [...draft.current.texts.values()].reduce((n, m) => n + m.size, 0);
  const dirty = draft.current.adv.size + dirtyTexts;

  const editApi = (advId: number): EditApi => {
    const prefab = () => {
      let d = draft.current.adv.get(advId);
      if (!d) { d = cloneOrdered(prefabs.get(advId)); draft.current.adv.set(advId, d); }
      return d;
    };
    const action = (fsm: string, state: string, i: number) => prefab().fsms[fsm].states.find((x: any) => x.name === state).actions[i];
    const langMap = () => {
      const l = getLang();
      if (!draft.current.texts.has(l)) draft.current.texts.set(l, new Map());
      return draft.current.texts.get(l)!;
    };
    const full = (key: string) => texts?.fullKey(key) ?? key;
    return {
      setParam(fsm, state, i, key, value) { const a = action(fsm, state, i); a.params ??= {}; a.params[key] = value; setRev((r) => r + 1); },
      setEnabled(fsm, state, i, on) { action(fsm, state, i).enabled = on; setRev((r) => r + 1); },
      text(key) { const d = draft.current.texts.get(getLang())?.get(full(key)); return fromCsv(d ?? texts?.raw(key) ?? ""); },
      setText(key, value) { langMap().set(full(key), toCsv(value)); setRev((r) => r + 1); },
      textChanged(key) { return !!draft.current.texts.get(getLang())?.has(full(key)); },
      mutateState(fsm, state, f) { f(prefab().fsms[fsm].states.find((x: any) => x.name === state)); setRev((r) => r + 1); },
      mutateFsm(fsm, f) { f(prefab().fsms[fsm]); setRev((r) => r + 1); },
      newKey() {
        // unique against the pack's texts and this draft: EDIT_A<adventure>_<base36 time><counter>
        for (;;) {
          const k = `EDIT_A${advId}_${Date.now().toString(36).toUpperCase()}${(keySeq++).toString(36).toUpperCase()}`;
          if (!texts?.has(k) && ![...draft.current.texts.values()].some((m) => m.has(k))) { langMap().set(k, ""); setRev((r) => r + 1); return k; }
        }
      },
      db,
    };
  };

  async function save() {
    setSaving("Сохраняю…");
    try {
      await saveEdits({ adventures: draft.current.adv, texts: draft.current.texts });
      const saved = new Map(prefabs);
      for (const [id, p] of draft.current.adv) saved.set(id, p);
      setPrefabs(saved);
      draft.current = { adv: new Map(), texts: new Map() };
      setTextsRev((r) => r + 1);
      setRev((r) => r + 1);
      setSaving(`Сохранено в пак «${EDIT_PACK}»`);
    } catch (e) {
      setSaving(null);
      setError(String(e));
    }
  }

  function discard() {
    draft.current = { adv: new Map(), texts: new Map() };
    setRev((r) => r + 1);
    setSaving(null);
  }
  return (
    <div className="editor">
      <header className="ed-top">
        <button className="link" onClick={open ? () => setOpen(null) : onBack}>{open ? "← К кампании" : "← Инструменты"}</button>
        <h2>Редактор {open ? `· ${advName(open.adv)}` : ""}</h2>
        {!open && (
          <select value={campaign ?? ""} onChange={(e) => setCampaign(Number(e.target.value))}>
            {campaigns.map((c) => <option key={c._id} value={c._id}>{say(texts, c.TitleKey) || c.m_Name}</option>)}
          </select>
        )}
        {!open && graph && <span className="muted">{graph.adventures.length} приключений · {graph.links.length} переходов</span>}
        {dirty > 0 ? (
          <span className="ed-save">
            <span>Не сохранено: {draft.current.adv.size ? `сценариев ${draft.current.adv.size}` : ""}{draft.current.adv.size && dirtyTexts ? ", " : ""}{dirtyTexts ? `текстов ${dirtyTexts}` : ""}</span>
            <button className="primary" onClick={() => void save()}>Сохранить</button>
            <button className="link" onClick={discard}>Отменить</button>
          </span>
        ) : saving && <span className="muted">{saving}</span>}
        <span className="ed-legend">
          {(["victory", "failure", "both", "other"] as const).map((o) => <span key={o}><i style={{ background: OUTCOME_COLOR[o] }} />{OUTCOME_NAME[o]}</span>)}
          <span><i className="dash" />альтернатива</span>
        </span>
      </header>
      {error && <p className="error">{error}</p>}
      <ReactFlowProvider>
        {open && openAdv ? (
          <FsmView key={open.adv} prefab={openAdv} rev={rev} title={advName(open.adv)} texts={texts} focus={open.focus} edit={editApi(open.adv)} />
        ) : (
          <div className="ed-main">
            <div className="ed-canvas">
              {graph ? <CampaignGraphView graph={graph} texts={texts} art={art} selected={sel}
                onSelectAdventure={(id) => setSel({ adv: id })} onSelectLink={(id) => setSel({ link: id })} />
                : <p className="muted ed-wait">Загружаю сценарии кампании…</p>}
            </div>
            <aside className="ed-panel">
              <div className="ed-panel-body">
                {sel.adv !== undefined && graph && (() => {
                  const a = graph.adventures.find((x) => x.id === sel.adv)!;
                  const outs = groups.filter((g) => g.from === a.id), ins = groups.filter((g) => g.to === a.id);
                  return <>
                    <h3>{advName(a.id)}</h3>
                    <p className="muted">{say(texts, a.locationKey)} · {a.order >= 0 ? `глава ${a.order + 1}` : "вне списка кампании"} · id {a.id}</p>
                    <button className="primary" disabled={!prefabs.get(a.id)} onClick={() => setOpen({ adv: a.id })}>Открыть сценарий</button>
                    <h4>Дальше</h4>
                    {outs.length === 0 && <p className="muted">Сценарий не задаёт следующее приключение.</p>}
                    <ul className="ed-links">{outs.map((g) => <li key={g.id}><button className="link" onClick={() => setSel({ link: g.id })}>{advName(g.to, g.won)}</button> <span className="muted">{g.kind === "alternative" ? "альтернатива, " : ""}{OUTCOME_NAME[g.outcome]}</span></li>)}</ul>
                    <h4>Сюда ведут</h4>
                    {ins.length === 0 && <p className="muted">{a.order === 0 ? "Первое приключение кампании." : "Ни одно приключение кампании."}</p>}
                    <ul className="ed-links">{ins.map((g) => <li key={g.id}><button className="link" onClick={() => setSel({ link: g.id })}>{advName(g.from)}</button> <span className="muted">{OUTCOME_NAME[g.outcome]}</span></li>)}</ul>
                  </>;
                })()}
                {sel.link && (() => {
                  const g = groups.find((x) => x.id === sel.link);
                  if (!g) return null;
                  return <>
                    <h3>{advName(g.from)} → {advName(g.to, g.won)}</h3>
                    <p className="muted">{g.kind === "next" ? "Следующее приключение" : g.kind === "alternative" ? "Альтернатива на карте" : "Конец кампании"} · {OUTCOME_NAME[g.outcome]}</p>
                    {g.links.map((l, i) => (
                      <div key={i} className="ed-linkcase">
                        <p>Состояние <button className="link" onClick={() => setOpen({ adv: l.from, focus: { fsm: l.fsm, state: l.state } })}>{l.state}</button>
                          <span className="muted"> · {l.fsmName} #{l.fsm}</span></p>
                        {l.paths.length === 0 ? <p className="muted">Путь в это состояние не найден (вызывается извне).</p>
                          : l.paths.map((p, j) => <PathText key={j} p={p} />)}
                      </div>
                    ))}
                  </>;
                })()}
                {sel.adv === undefined && !sel.link && <>
                  <p className="muted">Граф строится из сценариев: SetNextAdventure, AddAlternativeAdventure и EndCampaign в автоматах
                    приключений. Цвет стрелки — каким концом приключения туда приходят.</p>
                  <p className="muted">Нажмите на приключение или стрелку, чтобы увидеть подробности; «Открыть сценарий» показывает автоматы приключения.</p>
                </>}
              </div>
            </aside>
          </div>
        )}
      </ReactFlowProvider>
    </div>
  );
}

