// Events and threats: the encounters (EncounterModel + scenario/encounters/<id>.json) the adventures put on tile
// spaces: the random pool, encounter groups, story encounters an adventure places itself, chains, item encounters.
// A list with type, where it is used and its first text; a click opens its FSMs in the same editor as an adventure.
import { useEffect, useMemo, useState } from "react";
import { scenarioTextKeys } from "@jime/engine";
import type { TextDb } from "@jime/content-tools/text";
import { packText } from "../../data/pack.ts";
import { loadEncounters } from "./botRun.ts";
import { say } from "./text.ts";

/** EncounterModel.Type (game.ts placeEncounters) */
export const ENC_TYPE: Record<number, string> = { 0: "случайное", 1: "из группы", 2: "цепочка", 3: "сюжетное", 4: "предмет" };

export function encounterName(db: any, texts: TextDb | null, id: number): string {
  const m = db?.models?.EncounterModel?.[String(id)];
  void texts;
  return m ? String(m.m_Name).replace(/^\d+_/, "") : `событие ${id}`;
}

const REF = /\{"ref":\s*"EncounterModel"[^{}]*?"id":\s*(\d+)/g;
let uses: Promise<Map<number, number[]>> | null = null;
/** encounter id -> adventures that place it themselves (scanned once) */
function adventureUses(db: any): Promise<Map<number, number[]>> {
  uses ??= (async () => {
    const m = new Map<number, number[]>();
    for (const a of Object.values<any>(db.models.AdventureModel ?? {})) {
      let s: string;
      try { s = await packText(`scenario/adventures/${a._id}.json`); } catch { continue; }
      for (const [, id] of s.matchAll(REF)) {
        const list = m.get(Number(id)) ?? [];
        if (!list.includes(a._id)) list.push(a._id);
        m.set(Number(id), list);
      }
    }
    return m;
  })();
  return uses;
}

export function EncounterList({ db, texts, changed, onOpen }: { db: any; texts: TextDb | null; changed: Map<number, any>; onOpen: (id: number) => void }) {
  const [type, setType] = useState<string>("all");
  const [find, setFind] = useState("");
  const [limit, setLimit] = useState(150);
  const [advUses, setAdvUses] = useState<Map<number, number[]> | null>(null);
  const [prefabs, setPrefabs] = useState<Map<number, any | null> | null>(null);
  useEffect(() => {
    void adventureUses(db).then(setAdvUses);
    void loadEncounters(db).then(setPrefabs);
  }, [db]);
  const groups = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const g of Object.values<any>(db.models.EncounterGroupModel ?? {}))
      for (const r of [...(g.RequiredEncounters ?? []), ...(g.OptionalEncounters ?? [])]) {
        const id = Number(r?.id ?? r);
        m.set(id, [...(m.get(id) ?? []), String(g.m_Name).replace(/^\d+_/, "")]);
      }
    return m;
  }, [db]);
  const advName = (id: number) => {
    const a = db.models.AdventureModel?.[String(id)];
    return a ? say(texts, a.NameKey) || a.m_Name : `#${id}`;
  };
  // the first text the encounter shows (its search prompt, usually)
  const firstText = (id: number) => {
    const p = changed.get(id) ?? prefabs?.get(id);
    const keys: string[] = p ? scenarioTextKeys(p).map((t) => t.key) : [];
    const k = keys.find((x) => !x.startsWith("UI_")) ?? keys[0];
    return k ? say(texts, k).replace(/\[\/?[ib]\]/g, "") : "";
  };
  const all = useMemo(() => Object.values<any>(db.models.EncounterModel ?? {}).sort((a, b) => a._id - b._id), [db]);
  const q = find.trim().toLowerCase();
  const shown = all.filter((e) => (type === "all" || (type === "changed" ? changed.has(e._id) : String(e.Type ?? 0) === type))
    && (!q || String(e._id).includes(q) || String(e.m_Name).toLowerCase().includes(q) || firstText(e._id).toLowerCase().includes(q)));
  return (
    <div className="ed-enc">
      <div className="ed-texts-bar">
        <span>Событий: {all.length}</span>
        <select value={type} onChange={(e) => { setType(e.target.value); setLimit(150); }}>
          <option value="all">все типы</option>
          {Object.entries(ENC_TYPE).map(([k, v]) => <option key={k} value={k}>{v} ({all.filter((e) => String(e.Type ?? 0) === k).length})</option>)}
          <option value="changed">изменённые ({changed.size})</option>
        </select>
        <input className="ed-input" style={{ width: 240 }} placeholder="поиск: id, имя, текст" value={find} onChange={(e) => { setFind(e.target.value); setLimit(150); }} />
        {!prefabs && <span className="muted">загружаю тексты событий…</span>}
        <span className="muted">Угрозы самих приключений (ThreatEvent_*) — в автоматах приключения.</span>
      </div>
      <div className="ed-enc-table">
        <table>
          <thead><tr><th>id</th><th>Событие</th><th>Тип</th><th>Где упоминается</th><th>Текст</th></tr></thead>
          <tbody>
            {shown.slice(0, limit).map((e) => (
              <tr key={e._id} className="row" onClick={() => onOpen(e._id)}>
                <td>{e._id}</td>
                <td>{encounterName(db, texts, e._id)}{changed.has(e._id) && <b className="ed-dirty"> · изменено</b>}</td>
                <td>{ENC_TYPE[e.Type ?? 0] ?? e.Type}</td>
                <td>{[...(advUses?.get(e._id) ?? []).map(advName), ...(groups.get(e._id) ?? []).map((g) => `группа ${g}`)].join(", ")}</td>
                <td className="txt">{firstText(e._id).slice(0, 140)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length > limit && <button className="link" onClick={() => setLimit(limit + 150)}>показать ещё ({shown.length - limit})</button>}
      </div>
    </div>
  );
}
