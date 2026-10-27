// Texts and translations of one scenario: every text key its actions show, with a column per language.
// The same edits as in the state panel (EditApi.setText per language): saved into the edit pack's lang/<lang>.csv.
import { useMemo, useState } from "react";
import { scenarioTextKeys } from "@jime/engine";
import type { EditApi } from "./FsmView.tsx";

const LANG_NAME: Record<string, string> = { ru: "Русский", en: "English", it: "Italiano", de: "Deutsch", fr: "Français", es: "Español", pl: "Polski", uk: "Українська" };
export const langName = (l: string) => LANG_NAME[l] ?? l;

function rows(text: string): number {
  return Math.min(8, Math.max(2, Math.ceil(text.length / 48) + text.split("\n").length - 1));
}

/** One editable cell: a text of a key in a language (written on leaving the field) */
function Cell({ k, lang, edit }: { k: string; lang: string; edit: EditApi }) {
  const t = edit.text(k, lang);
  return (
    <textarea className="ed-input" rows={rows(t)} defaultValue={t} key={`${k}|${lang}|${t}`} lang={lang}
      placeholder="нет текста" onBlur={(e) => { if (e.target.value !== edit.text(k, lang)) edit.setText(k, e.target.value, lang); }} />
  );
}

/** The other languages of a key under its text in the state panel (opened when one is missing) */
export function Translations({ k, edit }: { k: string; edit: EditApi }) {
  const others = edit.langs.slice(1);
  if (!others.length) return null;
  const missing = others.filter((l) => !edit.hasText(k, l));
  return (
    <details className="ed-tr" open={missing.length > 0}>
      <summary>Переводы: {others.map((l) => <span key={l} className="ed-chip">{l} {edit.hasText(k, l) ? "✓" : "—"}</span>)}</summary>
      {others.map((l) => (
        <label key={l} className={`lang${edit.hasText(k, l) ? "" : " missing"}${edit.textChanged(k, l) ? " changed" : ""}`}>
          {langName(l)} {edit.hasText(k, l) ? <b className="ok">✓</b> : <b className="no">нет перевода</b>}
          <Cell k={k} lang={l} edit={edit} />
        </label>
      ))}
    </details>
  );
}

type Filter = "all" | "missing" | "changed" | "new";
const PAGE = 120;

export function TextsTable({ prefab, rev, edit, onGo }: { prefab: any; rev: number; edit: EditApi; onGo: (fsm: string, state: string) => void }) {
  const all = useMemo(() => scenarioTextKeys(prefab), [prefab, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const [filter, setFilter] = useState<Filter>("all");
  const [find, setFind] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const langs = edit.langs;
  const missing = (k: string) => langs.some((l) => !edit.hasText(k, l));
  const q = find.trim().toLowerCase();
  const shown = all.filter((t) =>
    (filter === "all" || (filter === "missing" ? missing(t.key) : filter === "changed" ? langs.some((l) => edit.textChanged(t.key, l)) : t.key.startsWith("EDIT_")))
    && (!q || t.key.toLowerCase().includes(q) || langs.some((l) => edit.text(t.key, l).toLowerCase().includes(q))));
  const without = langs.map((l) => [l, all.filter((t) => !edit.hasText(t.key, l)).length] as const);
  return (
    <div className="ed-texts">
      <div className="ed-texts-bar">
        <span>Ключей: {all.length}</span>
        <span className="muted">без текста: {without.map(([l, n]) => <span key={l} className="ed-chip">{l} {n}</span>)}</span>
        <select value={filter} onChange={(e) => { setFilter(e.target.value as Filter); setLimit(PAGE); }}>
          <option value="all">все</option>
          <option value="missing">без перевода</option>
          <option value="changed">изменённые</option>
          <option value="new">новые ключи</option>
        </select>
        <input className="ed-input" style={{ width: 200 }} placeholder="поиск по ключу и тексту" value={find} onChange={(e) => { setFind(e.target.value); setLimit(PAGE); }} />
      </div>
      {shown.length === 0 ? <p className="muted">Ничего не найдено.</p> : (
        <table>
          <thead><tr><th style={{ width: 230 }}>Ключ · где</th>{langs.map((l) => <th key={l}>{langName(l)}</th>)}</tr></thead>
          <tbody>
            {shown.slice(0, limit).map((t) => (
              <tr key={t.key}>
                <td className="key">{t.key}
                  <span className="muted">{t.uses.slice(0, 3).map((u, i) => (
                    <span key={i}>{i > 0 && ", "}<button className="link small" onClick={() => onGo(u.fsm, u.state)}>{u.state}</button>{u.enabled ? "" : " (выкл.)"}</span>
                  ))}{t.uses.length > 3 && ` … ещё ${t.uses.length - 3}`}</span>
                </td>
                {langs.map((l) => (
                  <td key={l} className={`${edit.hasText(t.key, l) ? "" : "missing"}${edit.textChanged(t.key, l) ? " changed" : ""}`}><Cell k={t.key} lang={l} edit={edit} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {shown.length > limit && <button className="link" onClick={() => setLimit(limit + PAGE)}>показать ещё ({shown.length - limit})</button>}
    </div>
  );
}
