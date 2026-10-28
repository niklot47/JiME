// This app's own title menu (works without the imported game): main menu, a new campaign (campaign, difficulty,
// heroes, party name), saved campaigns, settings. The pictures and texts come from the packs; the look from styles.css
// (.pm-*) and the background from MenuBackground (a theme's parallax layers).
import { useMemo, useState } from "react";
import { newCampaignSave, scopeProducts, type CampaignSave, type ContentSource, type Difficulty } from "@jime/engine";
import { setLang, useLang } from "../../data/lang.ts";
import { inTauri, quitApp } from "../../data/host.ts";
import { installTheme, loadPackSet, themeChoice } from "../../data/pack.ts";
import { MAX_SAVES, deleteSave, listSaves, ownedProducts, putSave } from "../../campaign/store.ts";
import { sound } from "../../audio/sound.ts";
import { useTr } from "../../ui/i18n.ts";
import { MenuBackground } from "./MenuBackground.tsx";
import { refId, useMenuData, type MenuUi } from "./useMenuData.ts";
import { useEffect } from "react";

type Page = "main" | "campaign" | "difficulty" | "heroes" | "party" | "load" | "settings";
const LANG_NAME: Record<string, string> = { ru: "Русский", en: "English", it: "Italiano", de: "Deutsch", fr: "Français", es: "Español", pl: "Polski", uk: "Українська" };

/** HeroModel ids a campaign may use (its products, else every hero), sorted by name */
export function campaignHeroes(ui: MenuUi, campaign: number | null): number[] {
  const P = ui.db.models.ProductModel ?? {};
  const products = scopeProducts(ui.db, campaign, ownedProducts());
  const ids = new Set<number>();
  for (const [pid, p] of Object.entries<any>(P)) {
    if (products && !products.includes(Number(pid))) continue;
    for (const h of p.Heroes ?? []) { const id = refId(h); if (id !== null) ids.add(id); }
  }
  const H = ui.db.models.HeroModel ?? {};
  const list = ids.size ? [...ids] : Object.keys(H).map(Number);
  return list.filter((id) => H[String(id)]).sort((a, b) => ui.raw(H[String(a)].NameKey).localeCompare(ui.raw(H[String(b)].NameKey)));
}

/** Campaigns with adventures, the packs' order (an imported game's first: its ids are lower) */
function campaigns(ui: MenuUi): any[] {
  return Object.values<any>(ui.db.models.CampaignModel ?? {}).filter((c) => (c.Adventures ?? []).length).sort((a, b) => a._id - b._id);
}

export function PlainTitle({ onPlay, onTools, hasOriginal }: {
  onPlay: (s: CampaignSave, intro?: boolean) => void;
  onTools: () => void;
  /** the imported game's interface is there (the look can be switched to it) */
  hasOriginal: boolean;
}) {
  const lang = useLang();
  const t = useTr();
  const { ui, error } = useMenuData(lang);
  const [page, setPage] = useState<Page>("main");
  const [saves, setSaves] = useState<CampaignSave[]>(() => listSaves());
  const [campaign, setCampaign] = useState<number | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [heroes, setHeroes] = useState<number[]>([]);
  const [party, setParty] = useState("");
  const [shelf, setShelf] = useState(0); // the page of campaign thumbnails
  const [langs, setLangs] = useState<string[]>(["ru", "en", "it"]);
  useEffect(() => { loadPackSet().then((s) => { if (s.langs.length) setLangs(s.langs); }).catch(() => {}); }, []);
  useEffect(() => { sound.music(page === "main" || page === "load" || page === "settings" ? "TitlescreenMusic" : "NewGameMusic"); }, [page]);
  const camps = useMemo(() => (ui ? campaigns(ui) : []), [ui]);
  const heroList = useMemo(() => (ui ? campaignHeroes(ui, campaign) : []), [ui, campaign]);

  if (error) return <div className="pm-screen"><MenuBackground /><div className="pm-panel"><p className="error">{error}</p><button className="pm-btn" onClick={onTools}>{t("tools")}</button></div></div>;
  if (!ui) return <div className="pm-screen"><MenuBackground /></div>;
  const C = ui.db.models.CampaignModel ?? {};
  const H = ui.db.models.HeroModel ?? {};

  const start = () => {
    const src = { db: () => ui.db } as unknown as ContentSource;
    const owned = ownedProducts();
    const s = newCampaignSave(src, { campaign: campaign!, heroes, difficulty, partyName: party.trim(), language: lang, ...(owned ? { products: owned } : {}) });
    putSave(s);
    onPlay(s, true);
  };
  const latest = saves[0];

  let body;
  if (page === "main") {
    // like the original's title screen: the logo top left, a column of same-size buttons under it (any number of them:
    // the column scrolls instead of pushing anything around), the settings gear top right, the version bottom right
    const latestName = latest ? `${ui.raw(C[String(latest.campaign)]?.TitleKey)}${latest.partyName ? ` · ${latest.partyName}` : ""}` : "";
    body = (
      <div className="lo-title">
        <h1 className="pm-logo lo-logo">JiME <span>Reborn</span></h1>
        <nav className="lo-menu">
          {latest && <button className="pm-btn lo-btn" title={latestName} onClick={() => onPlay(latest)}>{t("continue")}</button>}
          <button className="pm-btn lo-btn" disabled={saves.length >= MAX_SAVES}
            onClick={() => { setCampaign(camps[0]?._id ?? null); setShelf(0); setHeroes([]); setParty(""); setPage("campaign"); }}>{t("newCampaign")}</button>
          <button className="pm-btn lo-btn" disabled={!saves.length} onClick={() => setPage("load")}>{t("load")}</button>
          <button className="pm-btn lo-btn" onClick={onTools}>{t("tools")}</button>
          {inTauri() && <button className="pm-btn lo-btn" onClick={() => { void quitApp(); }}>{t("quit")}</button>}
        </nav>
        <button className="lo-gear" title={t("settings")} aria-label={t("settings")} onClick={() => setPage("settings")}><GearIcon /></button>
        <p className="pm-version lo-version">JiME Reborn {__APP_VERSION__}</p>
      </div>
    );
  } else if (page === "campaign") {
    // like the original's campaign selection: a title plate, the chosen campaign (text on the left, its picture on the
    // right), a shelf of thumbnails under it (SHELF per page, arrows when there are more), back / next in the corners
    const SHELF = 3;
    const pages = Math.max(1, Math.ceil(camps.length / SHELF));
    const sh = Math.min(shelf, pages - 1);
    const cur = C[String(campaign)] ?? null;
    const art = cur ? ui.art.campaigns[String(cur._id)] : undefined;
    body = (
      <div className="lo-campaign">
        <h2 className="lo-banner"><span>{t("chooseCampaign")}</span></h2>
        <div className="lo-show">
          <div className="lo-text">
            {cur ? <>
              <h3>{ui.raw(cur.TitleKey) || cur.m_Name}</h3>
              <div className="lo-rule" />
              <div className="lo-desc" dangerouslySetInnerHTML={{ __html: ui.say(cur.DescriptionKey) }} />
            </> : <p className="muted">{t("noCampaigns")}</p>}
          </div>
          <div className="lo-art">{(art?.Image || art?.ThumbnailImage) && <img src={ui.pic(art.Image ?? art.ThumbnailImage)} alt="" />}</div>
        </div>
        <div className="lo-shelf">
          <button className="lo-arrow left" aria-label="<" disabled={sh === 0} onClick={() => setShelf(sh - 1)} />
          <div className="lo-thumbs">
            {camps.slice(sh * SHELF, sh * SHELF + SHELF).map((c) => {
              const a = ui.art.campaigns[String(c._id)];
              const pic = a?.ThumbnailImage ?? a?.Image;
              return (
                <button key={c._id} className={`lo-thumb${campaign === c._id ? " on" : ""}`} title={ui.raw(c.TitleKey) || c.m_Name}
                  onClick={() => { setCampaign(c._id); setHeroes([]); }}>
                  {pic ? <img src={ui.pic(pic)} alt="" /> : <b>{ui.raw(c.TitleKey) || c.m_Name}</b>}
                </button>
              );
            })}
          </div>
          <button className="lo-arrow right" aria-label=">" disabled={sh >= pages - 1} onClick={() => setShelf(sh + 1)} />
        </div>
        <button className="lo-corner lo-back" onClick={() => setPage("main")}><span>{t("back")}</span></button>
        <button className="lo-corner lo-next" disabled={campaign === null} onClick={() => setPage("difficulty")}><span>{t("toDifficulty")}</span></button>
      </div>
    );
  } else if (page === "difficulty") {
    const opts: [Difficulty, "easy" | "normal" | "hard", "easyDesc" | "normalDesc" | "hardDesc"][] = [["adventure", "easy", "easyDesc"], ["normal", "normal", "normalDesc"], ["hard", "hard", "hardDesc"]];
    body = (
      <Step title={t("difficulty")} onBack={() => setPage("campaign")} onNext={() => setPage("heroes")} canNext t={t}>
        <div className="pm-choices">
          {opts.map(([d, name, desc]) => (
            <button key={d} className={`pm-choice${difficulty === d ? " on" : ""}`} onClick={() => setDifficulty(d)}>
              <b>{t(name)}</b><span>{t(desc)}</span>
            </button>
          ))}
        </div>
      </Step>
    );
  } else if (page === "heroes") {
    body = (
      <Step title={t("heroes")} sub={`${t("heroesHint")} ${heroes.length}/5`} onBack={() => setPage("difficulty")} onNext={() => setPage("party")} canNext={heroes.length > 0} t={t}>
        <div className="pm-heroes">
          {heroList.map((id) => {
            const h = H[String(id)];
            const a = ui.art.heroes[String(id)];
            const k = heroes.indexOf(id);
            return (
              <button key={id} className={`pm-hero${k >= 0 ? " on" : ""}`}
                onClick={() => setHeroes((p) => (k >= 0 ? p.filter((x) => x !== id) : p.length < 5 ? [...p, id] : p))}>
                {(a?.portrait || a?.icon) && <img src={ui.pic(a.portrait ?? a.icon)} alt="" />}
                <b>{ui.raw(h.NameKey) || h.m_Name}</b>
                <span>{ui.raw(h.RaceKey)}</span>
                {k >= 0 && <i className="pm-badge">{k + 1}</i>}
              </button>
            );
          })}
        </div>
      </Step>
    );
  } else if (page === "party") {
    body = (
      <Step title={t("partyName")} sub={t("partyNameHint")} onBack={() => setPage("heroes")} onNext={start} nextLabel={t("start")} canNext={party.trim().length > 0} t={t}>
        <input className="pm-input" autoFocus maxLength={30} value={party} onChange={(e) => setParty(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && party.trim()) start(); }} />
        <p className="pm-summary">{ui.raw(C[String(campaign)]?.TitleKey)} · {heroes.map((h) => ui.raw(H[String(h)]?.NameKey)).join(", ")}</p>
      </Step>
    );
  } else if (page === "load") {
    body = (
      <Step title={t("savedGames")} onBack={() => setPage("main")} t={t}>
        {!saves.length && <p className="muted">{t("noSaves")}</p>}
        <ul className="pm-saves">
          {saves.map((s) => (
            <li key={s.slot}>
              <div>
                <b>{s.partyName || ui.raw(C[String(s.campaign)]?.TitleKey)}</b>
                <span>{ui.raw(C[String(s.campaign)]?.TitleKey)} · {t("chapter")} {s.completed.length + 1} · {s.heroes.map((h) => ui.raw(H[String(h.hero)]?.NameKey)).join(", ")}</span>
                <small>{new Date(s.savedAt).toLocaleString(lang)}</small>
              </div>
              <button className="pm-btn small primary" onClick={() => onPlay(s)}>{t("resume")}</button>
              <button className="pm-btn small" onClick={() => { if (confirm(t("deleteConfirm"))) { deleteSave(s.slot); setSaves(listSaves()); } }}>{t("delete")}</button>
            </li>
          ))}
        </ul>
      </Step>
    );
  } else {
    body = (
      <Step title={t("settings")} onBack={() => setPage("main")} t={t}>
        <h3>{t("language")}</h3>
        <div className="pm-seg">{langs.map((l) => <button key={l} className={l === lang ? "on" : ""} onClick={() => setLang(l)}>{LANG_NAME[l] ?? l}</button>)}</div>
        <h3>{t("look")}</h3>
        <div className="pm-seg">
          <button className="on">{t("lookOwn")}</button>
          <button disabled={!hasOriginal} onClick={() => { void installTheme("original"); location.reload(); }}>{t("lookOriginal")}</button>
        </div>
        {!hasOriginal && <p className="muted">{t("lookOriginalMissing")}</p>}
      </Step>
    );
  }
  return (
    <div className="pm-screen">
      <MenuBackground dim={page !== "main"} />
      <div className={`pm-page pm-page-${page}`} key={page}>{body}</div>
    </div>
  );
}

/** The settings gear (the skin's "gear" picture covers it when there is one) */
function GearIcon() {
  const teeth = Array.from({ length: 8 }, (_, i) => i * 45);
  return (
    <svg viewBox="-50 -50 100 100" aria-hidden="true">
      {teeth.map((a) => <rect key={a} x={-8} y={-44} width={16} height={18} rx={3} transform={`rotate(${a})`} />)}
      <circle r={30} />
      <circle r={12} className="hole" />
    </svg>
  );
}

/** One page of the menu: title, content, back / next */
function Step({ title, sub, children, onBack, onNext, canNext = false, nextLabel, t }: {
  title: string; sub?: string; children: React.ReactNode; onBack: () => void; onNext?: () => void; canNext?: boolean; nextLabel?: string; t: ReturnType<typeof useTr>;
}) {
  return (
    <section className="pm-panel">
      <header><h2>{title}</h2>{sub && <p className="muted">{sub}</p>}</header>
      <div className="pm-body">{children}</div>
      <footer>
        <button className="pm-btn" onClick={onBack}>← {t("back")}</button>
        {onNext && <button className="pm-btn primary" disabled={!canNext} onClick={onNext}>{nextLabel ?? t("next")} →</button>}
      </footer>
    </section>
  );
}

export const plainLook = () => themeChoice() === "plain";
