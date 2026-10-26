// Campaign editor, step 1: viewing. A campaign as a graph of adventures (links from the scripts), and each adventure's
// scenario as FSM graphs. Nothing is changed yet; editing comes on top of these views.
import { useEffect, useMemo, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { campaignGraph, type CampaignGraph, type FsmPath } from "@jime/engine";
import { loadAdventure, loadDb, loadModelArt, type ModelArt } from "../../data/pack.ts";
import { CampaignGraphView, groupLinks, OUTCOME_COLOR, OUTCOME_NAME } from "./CampaignGraphView.tsx";
import { FsmView } from "./FsmView.tsx";
import { say, useTexts } from "./text.ts";

const ENTRY_NAME: Record<string, string> = { start: "старт сценария", ADVENTURE_END_VICTORY: "победа в приключении", ADVENTURE_END_FAILURE: "поражение в приключении" };

function PathText({ p }: { p: FsmPath }) {
  return (
    <div className="ed-path">
      <span className="ed-chip gold">{ENTRY_NAME[p.entry] ?? p.entry}</span>
      {p.steps.map((s, i) => <span key={i}> → {s.state}{s.event !== "FINISHED" && <span className="ed-chip">{s.event}</span>}</span>)}
    </div>
  );
}

export function EditorScreen({ onBack }: { onBack: () => void }) {
  const texts = useTexts();
  const [db, setDb] = useState<any>(null);
  const [art, setArt] = useState<ModelArt>({});
  const [campaign, setCampaign] = useState<number | null>(null);
  const [prefabs, setPrefabs] = useState<Map<number, any>>(new Map());
  const [graph, setGraph] = useState<CampaignGraph | null>(null);
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
    setGraph(null); setSel({}); setOpen(null);
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
        if (!want.length) { if (live) { setPrefabs(cache); setGraph(g); } return; }
        await Promise.all(want.map(get));
      }
    })().catch((e) => { if (live) setError(String(e)); });
    return () => { live = false; };
  }, [db, campaign]); // eslint-disable-line react-hooks/exhaustive-deps

  const campaigns = useMemo(() => (db ? Object.values<any>(db.models.CampaignModel) : []), [db]);
  const groups = useMemo(() => (graph ? groupLinks(graph.links) : []), [graph]);
  const advName = (id: number | null, won?: boolean) => {
    if (id === null) return won ? "Победа в кампании" : "Поражение в кампании";
    const a = graph?.adventures.find((x) => x.id === id);
    return a ? say(texts, a.nameKey) || a.name : `#${id}`;
  };

  const openAdv = open && prefabs.get(open.adv);
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
        <span className="ed-legend">
          {(["victory", "failure", "both", "other"] as const).map((o) => <span key={o}><i style={{ background: OUTCOME_COLOR[o] }} />{OUTCOME_NAME[o]}</span>)}
          <span><i className="dash" />альтернатива</span>
        </span>
      </header>
      {error && <p className="error">{error}</p>}
      <ReactFlowProvider>
        {open && openAdv ? (
          <FsmView key={open.adv} prefab={openAdv} title={advName(open.adv)} texts={texts} focus={open.focus} />
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

