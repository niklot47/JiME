// This app's own title menu (works without the imported game): main menu, a new campaign (campaign, difficulty,
// heroes, party name), saved campaigns, settings. The pictures and texts come from the packs; the look from styles.css
// (.pm-*) and the background from MenuBackground (a theme's parallax layers).
import { useMemo, useState } from "react";
import { itemCounts, itemSubstitutes, newCampaignSave, scopeProducts, type CampaignSave, type ContentSource, type Difficulty } from "@jime/engine";
import { setLang, useLang } from "../../data/lang.ts";
import { inTauri, quitApp } from "../../data/host.ts";
import { installTheme, loadPackSet, themeChoice } from "../../data/pack.ts";
import { MAX_SAVES, deleteSave, listSaves, ownedProducts, putSave } from "../../campaign/store.ts";
import { sound } from "../../audio/sound.ts";
import { useTr } from "../../ui/i18n.ts";
import { MenuBackground } from "./MenuBackground.tsx";
import { refId, useMenuData, type MenuUi } from "./useMenuData.ts";
import { useEffect } from "react";

type Page = "main" | "campaign" | "difficulty" | "heroes" | "items" | "party" | "load" | "settings";
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
  // starting items per hero: [armor, weapon, second weapon] (StartingItemController), the slot being replaced
  const [items, setItems] = useState<(number | null)[][]>([]);
  const [replace, setReplace] = useState<{ hero: number; slot: number } | null>(null);
  const [nameWarn, setNameWarn] = useState(false);
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
    const heroItems = heroes.map((_, i) => (items[i] ?? []).filter((x): x is number => x !== null));
    const s = newCampaignSave(src, { campaign: campaign!, heroes, difficulty, partyName: party.trim(), language: lang, heroItems,
      ...(owned ? { products: owned } : {}) });
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
        <button className="lo-corner lo-next" disabled={campaign === null} onClick={() => { setShelf(0); setPage("difficulty"); }}><span>{t("toDifficulty")}</span></button>
      </div>
    );
  } else if (page === "difficulty") {
    // like the original: the wide picture on top (adventure mode), normal and hard side by side under it, the chosen
    // one's description at the bottom; the pictures are the theme's (ui/art/difficulty-<mode>.png), else a plain card
    const card = (d: Difficulty, name: "easy" | "normal" | "hard", cls: string) => (
      <button className={`lo-diff ${cls}${difficulty === d ? " on" : ""}`} onClick={() => setDifficulty(d)} onDoubleClick={() => setPage("heroes")}>
        <span className="lo-diff-art" style={{ backgroundImage: `var(--sk-art-difficulty-${d}, none)` }} />
        <b>{t(name)}</b>
      </button>
    );
    const desc = difficulty === "adventure" ? "easyDesc" : difficulty === "hard" ? "hardDesc" : "normalDesc";
    body = (
      <div className="lo-campaign lo-difficulty">
        <h2 className="lo-banner"><span>{t("toDifficulty")}</span></h2>
        <div className="lo-diffs">
          {card("adventure", "easy", "wide")}
          {card("normal", "normal", "half")}
          {card("hard", "hard", "half")}
        </div>
        <p className="lo-hint"><b>{t(difficulty === "adventure" ? "easy" : difficulty === "hard" ? "hard" : "normal")}.</b> {t(desc)}</p>
        <button className="lo-corner lo-back" onClick={() => setPage("campaign")}><span>{t("back")}</span></button>
        <button className="lo-corner lo-next" onClick={() => setPage("heroes")}><span>{t("toHeroes")}</span></button>
      </div>
    );
  } else if (page === "heroes") {
    // like the original: a row of HERO_ROW portrait cards with their names (paged by the arrows), the chosen heroes
    // in the five slots under it (click a slot to take the hero out again)
    const HERO_ROW = 5;
    const pages = Math.max(1, Math.ceil(heroList.length / HERO_ROW));
    const sh = Math.min(shelf, pages - 1);
    const pic = (id: number) => { const a = ui.art.heroes[String(id)]; return a?.portrait ?? a?.icon; };
    const toggle = (id: number) => setHeroes((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < 5 ? [...p, id] : p));
    body = (
      <div className="lo-campaign lo-heroes">
        <h2 className="lo-banner"><span>{t("chooseHeroes")}</span></h2>
        <div className="lo-hero-row">
          <button className="lo-arrow left" aria-label="<" disabled={sh === 0} onClick={() => setShelf(sh - 1)} />
          <div className="lo-hero-cards">
            {heroList.slice(sh * HERO_ROW, sh * HERO_ROW + HERO_ROW).map((id) => {
              const h = H[String(id)];
              const p = pic(id);
              return (
                <button key={id} className={`lo-hero${heroes.includes(id) ? " on" : ""}`} title={ui.raw(h.RaceKey)} onClick={() => toggle(id)}>
                  <b className="lo-hero-name"><span>{ui.raw(h.NameKey) || h.m_Name}</span></b>
                  <span className="lo-hero-pic">{p ? <img src={ui.pic(p)} alt="" /> : <i>{(ui.raw(h.NameKey) || h.m_Name).slice(0, 1)}</i>}</span>
                </button>
              );
            })}
          </div>
          <button className="lo-arrow right" aria-label=">" disabled={sh >= pages - 1} onClick={() => setShelf(sh + 1)} />
        </div>
        <div className="lo-slots">
          {Array.from({ length: 5 }, (_, i) => {
            const id = heroes[i];
            const p = id !== undefined ? pic(id) : undefined;
            return (
              <button key={i} className={`lo-slot${id !== undefined ? " full" : ""}`} disabled={id === undefined}
                title={id !== undefined ? ui.raw(H[String(id)]?.NameKey) : ""} onClick={() => id !== undefined && toggle(id)}>
                {id !== undefined && (p ? <img src={ui.pic(p)} alt="" /> : <i>{ui.raw(H[String(id)]?.NameKey).slice(0, 1)}</i>)}
              </button>
            );
          })}
        </div>
        <button className="lo-corner lo-back" onClick={() => { setShelf(0); setPage("difficulty"); }}><span>{t("back")}</span></button>
        <button className="lo-corner lo-next" disabled={!heroes.length}
          onClick={() => { setItems(defaultItems(ui, heroes, scopeProducts(ui.db, campaign, ownedProducts()))); setReplace(null); setPage("items"); }}>
          <span>{t("toItems")}</span></button>
      </div>
    );
  } else if (page === "items") {
    // like the original: a column per hero (name, portrait, armor, weapon in hand and a second one), a click on an item
    // opens the list of the cards it can be swapped for (same level and kind, copies left in the products)
    const I = ui.db.models.ItemModel ?? {};
    const products = scopeProducts(ui.db, campaign, ownedProducts());
    const twoHanded = (id: number | null) => id !== null && !!Number(I[String(id)]?.Is2Handed ?? 0);
    const hobbit = (h: number) => (Number(H[String(h)]?.Traits ?? 0) & 8) !== 0;
    const itemCard = (id: number | null, onClick: () => void, key?: string | number) => {
      const m = id !== null ? I[String(id)] : null;
      const icon = id !== null ? ui.art.items[String(id)]?.Icon : undefined;
      return (
        <button key={key} className={`lo-item${m ? "" : " empty"}`} onClick={onClick}>
          <span className="lo-item-icon">{icon && <img src={ui.pic(icon)} alt="" />}</span>
          <b>{m ? ui.raw(m.NameKey) || m.m_Name : t("noneChosen")}</b>
          {m && <i className="lo-item-level">{roman(Number(m.Level ?? 1))}</i>}
          {twoHanded(id) && <i className="lo-item-2h" title={t("twoHanded")}>✋✋</i>}
        </button>
      );
    };
    const choose = (hero: number, slot: number, id: number) => {
      setItems((all) => all.map((row, i) => {
        if (i !== hero) return row;
        const r = [...row];
        if (slot > 0 && twoHanded(id)) { r[1] = id; r[2] = null; } else r[slot] = id;
        return r;
      }));
      setReplace(null);
    };
    const subs = replace ? itemSubstitutes(ui.db, items.map((r) => r.filter((x): x is number => x !== null)), heroes[replace.hero]!,
      replace.slot === 0 ? "armor" : "weapon", items[replace.hero]?.[replace.slot] ?? null, products) : [];
    const repId = replace ? items[replace.hero]?.[replace.slot] ?? null : null;
    body = (
      <div className="lo-campaign lo-items">
        <h2 className="lo-banner"><span>{t("toItems")}</span></h2>
        <div className="lo-gear-cols">
          {heroes.map((h, i) => {
            const row = items[i] ?? [null, null, null];
            const a = ui.art.heroes[String(h)];
            const second = !twoHanded(row[1] ?? null) && (row[2] !== null || !hobbit(h));
            return (
              <div key={h} className="lo-gear-col">
                <div className="lo-hero lo-gear-hero">
                  <b className="lo-hero-name"><span>{ui.raw(H[String(h)]?.NameKey)}</span></b>
                  <span className="lo-hero-pic">{(a?.portrait || a?.icon) ? <img src={ui.pic(a.portrait ?? a.icon)} alt="" /> : <i>{ui.raw(H[String(h)]?.NameKey).slice(0, 1)}</i>}</span>
                </div>
                <small>{t("armor")}</small>
                {itemCard(row[0] ?? null, () => setReplace({ hero: i, slot: 0 }))}
                <small>{t("inHands")}</small>
                {itemCard(row[1] ?? null, () => setReplace({ hero: i, slot: 1 }))}
                {second && itemCard(row[2] ?? null, () => setReplace({ hero: i, slot: 2 }))}
              </div>
            );
          })}
        </div>
        {replace && (
          <div className="lo-modal" onClick={() => setReplace(null)}>
            <div className="lo-replace" onClick={(e) => e.stopPropagation()}>
              <p>{repId !== null ? t("replaceItem") : t(replace.slot === 0 ? "chooseArmor" : "chooseItem")}
                {repId !== null && <b>{ui.raw(I[String(repId)]?.NameKey)}</b>}</p>
              <div className="lo-replace-list">
                {subs.length ? subs.map((id) => itemCard(id, () => choose(replace.hero, replace.slot, id), id)) : <p className="muted">{t("noSubstitutes")}</p>}
              </div>
            </div>
          </div>
        )}
        <button className="lo-corner lo-back" onClick={() => { setReplace(null); setPage("heroes"); }}><span>{t("back")}</span></button>
        <button className="lo-corner lo-next" onClick={() => { setReplace(null); setNameWarn(false); setPage("party"); }}><span>{t("toParty")}</span></button>
      </div>
    );
  } else if (page === "party") {
    // like the original: the title plate, one name field in the middle, back / start in the corners
    const go = () => { if (!party.trim()) { setNameWarn(true); return; } start(); };
    body = (
      <div className="lo-campaign lo-party">
        <h2 className="lo-banner"><span>{t("toParty")}</span></h2>
        <input className="pm-input lo-name" autoFocus maxLength={24} value={party} placeholder={t("partyNamePlaceholder")}
          onChange={(e) => { setNameWarn(false); setParty(e.target.value); }} onKeyDown={(e) => { if (e.key === "Enter") go(); }} />
        {nameWarn && <p className="lo-warn">{t("partyNameNeeded")}</p>}
        <p className="lo-party-sum">{ui.raw(C[String(campaign)]?.TitleKey)} · {heroes.map((h) => ui.raw(H[String(h)]?.NameKey)).join(", ")}</p>
        <button className="lo-corner lo-back" onClick={() => setPage("items")}><span>{t("back")}</span></button>
        <button className="lo-corner lo-next" onClick={go}><span>{t("start")}</span></button>
      </div>
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

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI"];
const roman = (n: number) => ROMAN[n] ?? String(n);

/** ItemSelectionSlot.DisplayHero: each hero's default armor / weapon / second weapon while copies are left */
function defaultItems(ui: MenuUi, heroes: number[], products?: number[]): (number | null)[][] {
  const max = itemCounts(ui.db, products);
  const used = new Map<number, number>();
  const take = (id: number | null) => {
    if (id === null || (used.get(id) ?? 0) >= (max.get(id) ?? 0)) return null;
    used.set(id, (used.get(id) ?? 0) + 1);
    return id;
  };
  return heroes.map((h) => {
    const m = ui.db.models.HeroModel?.[String(h)] ?? {};
    return [take(refId(m.DefaultArmor)), take(refId(m.DefaultWeapon)), take(refId(m.DefaultSecondWeapon))];
  });
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
