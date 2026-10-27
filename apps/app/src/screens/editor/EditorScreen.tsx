// Campaign editor. A campaign as a graph of adventures (links from the scripts), and each adventure's scenario as FSM
// graphs. Texts, simple action parameters and actions' on/off can be changed: the changes are a draft until saved
// into the user pack my-edits (data/editPack.ts), which lies over core-ffg.
import { useEffect, useMemo, useRef, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ACTIONS, campaignGraph, checkScenario, cloneOrdered, issueId, newIssues, parseOrdered, type CampaignGraph, type FsmPath, type Issue } from "@jime/engine";
import type { TextDb } from "@jime/content-tools/text";
import { loadAdventure, loadDb, loadEncounter, loadModelArt, loadPackSet, loadText, PACK_ID, packFileUrl, type ModelArt } from "../../data/pack.ts";
import { EncounterList, encounterName } from "./EncounterList.tsx";
import { runBot, type BotReport } from "./botRun.ts";
import { CampaignGraphView, groupLinks, OUTCOME_COLOR, OUTCOME_NAME } from "./CampaignGraphView.tsx";
import { FsmView, type CheckInfo, type EditApi } from "./FsmView.tsx";
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

interface Draft {
  /** changed adventure / encounter prefabs (copies, changed in place) */
  adv: Map<number, any>;
  enc: Map<number, any>;
  /** changed texts: lang -> full key -> CSV text */
  texts: Map<string, Map<string, string>>;
}
const emptyDraft = (): Draft => ({ adv: new Map(), enc: new Map(), texts: new Map() });

/** Per language: does a key have a text (the pack's texts, or this draft's for that language) */
function hasTextFns(langs: Map<string, TextDb>, draft: Map<string, Map<string, string>> | null): Record<string, (k: string) => boolean> {
  const out: Record<string, (k: string) => boolean> = {};
  for (const [l, t] of langs) {
    out[l] = (k) => {
      // the draft's text wins (an emptied text is a missing one)
      const d = draft?.get(l)?.get(t.fullKey(k)) ?? draft?.get(l)?.get(k);
      return d !== undefined ? d.trim() !== "" : !!t.raw(k)?.trim();
    };
  }
  return out;
}

export function EditorScreen({ onBack }: { onBack: () => void }) {
  const [textsRev, setTextsRev] = useState(0);
  const texts = useTexts(textsRev);
  // the draft: changed adventure prefabs (copies, changed in place) and texts (lang -> full key -> CSV text)
  const draft = useRef<Draft>(emptyDraft());
  const [rev, setRev] = useState(0);
  const [saving, setSaving] = useState<string | null>(null);
  const [db, setDb] = useState<any>(null);
  const [art, setArt] = useState<ModelArt>({});
  const [campaign, setCampaign] = useState<number | null>(null);
  const [prefabs, setPrefabs] = useState<Map<number, any>>(new Map());
  const [loaded, setLoaded] = useState<CampaignGraph | null>(null);
  const [sel, setSel] = useState<{ adv?: number; link?: string }>({});
  // an open scenario: an adventure, or an encounter (the events and threats the adventures place on tiles)
  const [open, setOpen] = useState<{ kind: "adv" | "enc"; id: number; focus?: { fsm: string; state: string } } | null>(null);
  const [mode, setMode] = useState<"campaign" | "enc">("campaign");
  const [encPrefabs, setEncPrefabs] = useState<Map<number, any>>(new Map());
  useEffect(() => {
    if (open?.kind !== "enc" || encPrefabs.has(open.id)) return;
    const id = open.id;
    void loadEncounter(id).catch(() => null).then((p) => setEncPrefabs((m) => new Map(m).set(id, p)));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
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

  const docOf = (kind: "adv" | "enc", id: number) => (kind === "enc" ? draft.current.enc.get(id) ?? encPrefabs.get(id) : draft.current.adv.get(id) ?? prefabs.get(id));
  const openAdv = open && docOf(open.kind, open.id);
  const openName = open ? (open.kind === "enc" ? encounterName(db, texts, open.id) : advName(open.id)) : "";

  // ---- check: every language's texts, the original scenario's own issues, the bot
  const [langTexts, setLangTexts] = useState<Map<string, TextDb>>(new Map());
  useEffect(() => {
    let live = true;
    void loadPackSet().then(async (set) => {
      const m = new Map<string, TextDb>();
      for (const l of set.langs) { try { m.set(l, await loadText(l)); } catch { /* language without texts */ } }
      if (live) setLangTexts(m);
    });
    return () => { live = false; };
  }, [textsRev]);
  const [baseline, setBaseline] = useState<{ doc: string; issues: Issue[] } | null>(null);
  const docKey = open ? `${open.kind === "enc" ? "encounters" : "adventures"}/${open.id}` : "";
  useEffect(() => {
    if (!open || !db) return;
    let live = true;
    // the imported game's version of this adventure (none for an adventure of one's own)
    const doc = docKey;
    void fetch(packFileUrl(PACK_ID, `scenario/${doc}.json`)).then(async (r) => {
      const orig = r.ok && !(r.headers.get("content-type") ?? "").includes("text/html") ? parseOrdered(await r.text()) : null;
      if (live) setBaseline({ doc, issues: orig ? checkScenario(orig, { actions: Object.keys(ACTIONS), hasText: hasTextFns(langTexts, null) }) : [] });
    }).catch(() => { if (live) setBaseline({ doc, issues: [] }); });
    return () => { live = false; };
  }, [docKey, db, langTexts]); // eslint-disable-line react-hooks/exhaustive-deps
  const issues = useMemo(() => (openAdv ? checkScenario(openAdv, { actions: Object.keys(ACTIONS), hasText: hasTextFns(langTexts, draft.current.texts) }) : []),
    [openAdv, rev, langTexts]); // eslint-disable-line react-hooks/exhaustive-deps
  const fresh = useMemo(() => new Set(newIssues(issues, baseline && baseline.doc === docKey ? baseline.issues : issues).map(issueId)), [issues, baseline, docKey]);
  const [bot, setBot] = useState<{ adv: number; report: BotReport } | null>(null);
  const [botRunning, setBotRunning] = useState<number | null>(null);
  const BOT_SEEDS = 20;
  const check: CheckInfo | undefined = open && openAdv ? {
    issues, fresh, bot: open.kind === "adv" && bot?.adv === open.id ? bot.report : null, running: botRunning, botSeeds: BOT_SEEDS,
    // an encounter alone is not a game (it needs an adventure that places it)
    onRunBot: open.kind === "enc" ? undefined : () => {
      setBotRunning(0);
      void runBot(db, open.id, openAdv, BOT_SEEDS, setBotRunning, draft.current.enc)
        .then((report) => setBot({ adv: open.id, report }))
        .catch((e) => setError(String(e)))
        .finally(() => setBotRunning(null));
    },
  } : undefined;
  const dirtyTexts = [...draft.current.texts.values()].reduce((n, m) => n + m.size, 0);
  const dirtyDocs = draft.current.adv.size + draft.current.enc.size;
  const dirty = dirtyDocs + dirtyTexts;

  const editApi = (kind: "adv" | "enc", advId: number): EditApi => {
    const prefab = () => {
      const map = kind === "enc" ? draft.current.enc : draft.current.adv;
      let d = map.get(advId);
      if (!d) { d = cloneOrdered((kind === "enc" ? encPrefabs : prefabs).get(advId)); map.set(advId, d); }
      return d;
    };
    const action = (fsm: string, state: string, i: number) => prefab().fsms[fsm].states.find((x: any) => x.name === state).actions[i];
    const langMap = (l = getLang()) => {
      if (!draft.current.texts.has(l)) draft.current.texts.set(l, new Map());
      return draft.current.texts.get(l)!;
    };
    // the pack's texts of a language (the current one is loaded first, the others a moment later)
    const tdb = (l = getLang()) => langTexts.get(l) ?? (l === getLang() ? texts : null);
    // the full "Sheet|KEY" a pack overrides a text by (the same sheet in every language)
    const full = (key: string, l = getLang()) => tdb(l)?.fullKey(key) ?? texts?.fullKey(key) ?? key;
    const draftText = (key: string, l = getLang()) => draft.current.texts.get(l)?.get(full(key, l));
    return {
      setParam(fsm, state, i, key, value) { const a = action(fsm, state, i); a.params ??= {}; a.params[key] = value; setRev((r) => r + 1); },
      setEnabled(fsm, state, i, on) { action(fsm, state, i).enabled = on; setRev((r) => r + 1); },
      text(key, l = getLang()) { return fromCsv(draftText(key, l) ?? tdb(l)?.raw(key) ?? ""); },
      setText(key, value, l = getLang()) {
        const map = langMap(l), k = full(key, l), v = toCsv(value);
        // back to the pack's own text: no longer an edit
        if (v === (tdb(l)?.raw(key) ?? "") && tdb(l)?.has(key)) map.delete(k); else map.set(k, v);
        setRev((r) => r + 1);
      },
      textChanged(key, l = getLang()) { return !!draft.current.texts.get(l)?.has(full(key, l)); },
      hasText(key, l) { const d = draftText(key, l); return d !== undefined ? d.trim() !== "" : !!tdb(l)?.raw(key)?.trim(); },
      langs: [getLang(), ...[...langTexts.keys()].filter((l) => l !== getLang())],
      mutateState(fsm, state, f) { f(prefab().fsms[fsm].states.find((x: any) => x.name === state)); setRev((r) => r + 1); },
      mutateFsm(fsm, f) { f(prefab().fsms[fsm]); setRev((r) => r + 1); },
      newKey() {
        // unique against the pack's texts and this draft: EDIT_A<adventure>_<base36 time><counter>
        for (;;) {
          const k = `EDIT_${kind === "enc" ? "E" : "A"}${advId}_${Date.now().toString(36).toUpperCase()}${(keySeq++).toString(36).toUpperCase()}`;
          if (!texts?.has(k) && ![...draft.current.texts.values()].some((m) => m.has(k))) { langMap().set(k, ""); setRev((r) => r + 1); return k; }
        }
      },
      db,
    };
  };

  async function save() {
    setSaving("Сохраняю…");
    try {
      await saveEdits({ adventures: draft.current.adv, encounters: draft.current.enc, texts: draft.current.texts });
      const saved = new Map(prefabs);
      for (const [id, p] of draft.current.adv) saved.set(id, p);
      setPrefabs(saved);
      const savedEnc = new Map(encPrefabs);
      for (const [id, p] of draft.current.enc) savedEnc.set(id, p);
      setEncPrefabs(savedEnc);
      draft.current = emptyDraft();
      setTextsRev((r) => r + 1);
      setRev((r) => r + 1);
      setSaving(`Сохранено в пак «${EDIT_PACK}»`);
    } catch (e) {
      setSaving(null);
      setError(String(e));
    }
  }

  function discard() {
    draft.current = emptyDraft();
    setRev((r) => r + 1);
    setSaving(null);
  }
  return (
    <div className="editor">
      <header className="ed-top">
        <button className="link" onClick={open ? () => setOpen(null) : onBack}>{open ? (open.kind === "enc" ? "← К событиям" : "← К кампании") : "← Инструменты"}</button>
        <h2>Редактор {open ? `· ${openName}` : ""}</h2>
        {!open && (
          <span className="ed-tabs top">
            <button className={mode === "campaign" ? "on" : ""} onClick={() => setMode("campaign")}>Кампании</button>
            <button className={mode === "enc" ? "on" : ""} onClick={() => setMode("enc")}>События и угрозы</button>
          </span>
        )}
        {!open && mode === "campaign" && (
          <select value={campaign ?? ""} onChange={(e) => setCampaign(Number(e.target.value))}>
            {campaigns.map((c) => <option key={c._id} value={c._id}>{say(texts, c.TitleKey) || c.m_Name}</option>)}
          </select>
        )}
        {!open && mode === "campaign" && graph && <span className="muted">{graph.adventures.length} приключений · {graph.links.length} переходов</span>}
        {dirty > 0 ? (
          <span className="ed-save">
            <span>Не сохранено: {dirtyDocs ? `сценариев ${dirtyDocs}` : ""}{dirtyDocs && dirtyTexts ? ", " : ""}{dirtyTexts ? `текстов ${dirtyTexts}` : ""}</span>
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
          <FsmView key={docKey} prefab={openAdv} rev={rev} title={openName} texts={texts} focus={open.focus} edit={editApi(open.kind, open.id)} check={check} />
        ) : open ? <p className="muted ed-wait">{encPrefabs.has(open.id) || prefabs.has(open.id) ? "Файла сценария нет в паках." : "Загружаю…"}</p>
        : mode === "enc" ? (db && <EncounterList db={db} texts={texts} changed={draft.current.enc} onOpen={(id) => setOpen({ kind: "enc", id })} />)
        : (
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
                    <button className="primary" disabled={!prefabs.get(a.id)} onClick={() => setOpen({ kind: "adv", id: a.id })}>Открыть сценарий</button>
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
                        <p>Состояние <button className="link" onClick={() => setOpen({ kind: "adv", id: l.from, focus: { fsm: l.fsm, state: l.state } })}>{l.state}</button>
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

