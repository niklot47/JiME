// This app's own campaign pages (without the imported game's interface): a cutscene (prologue, ending), the travel map
// (the next adventure and the alternatives), the rest (roles, skills with the roles' XP, item upgrades, embark).
// Same engine calls as the original-look pages (screens/campaign/*).
import { useEffect, useMemo, useState } from "react";
import { adventureChoices, chapterOf, availableXP, canTakeRole, canUpgrade, embark, firstRest, ownedRoles, roleSkills, setRole, toggleSkill, upgradeItem, upgradeOptions,
  xpRoles, type CampaignSave, type ItemPlace } from "@jime/engine";
import { useTr } from "../../ui/i18n.ts";
import { MenuBackground } from "./MenuBackground.tsx";
import { sound } from "../../audio/sound.ts";
import { CampaignMap2D, mapView } from "./CampaignMap2D.tsx";
import { CampaignMap3D } from "./CampaignMap3D.tsx";
import { loadCampaignMaps, loadMapScene, type CampaignMapData } from "../../data/pack.ts";
import type { MenuUi } from "./useMenuData.ts";

const ROMAN = ["", "I", "II", "III", "IV", "V"];

/**
 * A cutscene like the original's (CutsceneController): the picture across the screen, the campaign's title and the
 * story on a panel at the left (it slides in, its text fades in), its own music, then the button from the right:
 * "Embark" after the prologue, "Ending" at the end of the campaign. Without a picture the camp of the theme stands in.
 */
export function PlainCutscene({ ui, cutscene, title, onDone, ending = false }: {
  ui: MenuUi; cutscene: number; title: string; onDone: () => void; ending?: boolean;
}) {
  const t = useTr();
  const m = ui.db.models.CutsceneModel?.[String(cutscene)];
  const pic = ui.pic(ui.art.cutscenes[String(cutscene)]?.Texture);
  // AudioController.PlayCutsceneMusic: the cutscene's own clip
  const clip = String(m?.MusicClip?.Path ?? "").split("/").pop()?.replace(/\.[a-z0-9]+$/i, "") ?? "";
  useEffect(() => { if (clip) sound.music(`clip:${clip}`); }, [clip]);
  return (
    <div className="pm-screen ct-screen">
      {pic ? <div className="ct-art" style={{ backgroundImage: `url("${pic}")` }} /> : <MenuBackground which="rest-forest" />}
      <aside className="ct-panel">
        <h2>{title}</h2>
        <div className="lo-rule" />
        <div className="ct-text" dangerouslySetInnerHTML={{ __html: ui.say(m?.TextKey) }} />
      </aside>
      <button className="lo-corner lo-next ct-go" onClick={onDone}><span>{ui.raw(ending ? "UI_ENDING" : "UI_EMBARK") || t(ending ? "toMenu" : "embark")}</span></button>
    </div>
  );
}

/** The campaign map's look: "3d" (the theme's room, when it has one) or "2d"; the player's choice (settings) */
export type MapKind = "2d" | "3d";
const MAP_KIND_KEY = "jime.map.kind";
export const mapKind = (): MapKind => { try { return localStorage.getItem(MAP_KIND_KEY) === "2d" ? "2d" : "3d"; } catch { return "3d"; } };
export const setMapKind = (k: MapKind) => { try { localStorage.setItem(MAP_KIND_KEY, k); } catch { /* private mode */ } };

/**
 * The travel map like the original's: the campaign's title and chapter on a plate, the map with the trail and the
 * campfire on the coming adventure; Continue flies to it (its story and picture on the left, the place's name at the
 * fire, arrows between the alternatives), Confirm goes to the rest
 */
export function PlainMap({ ui, save, onConfirm, onQuit }: { ui: MenuUi; save: CampaignSave; onConfirm: (adv: number) => void; onQuit: () => void }) {
  const t = useTr();
  const A = ui.db.models.AdventureModel ?? {};
  const C = ui.db.models.CampaignModel?.[String(save.campaign)];
  const choices = adventureChoices(save);
  const [sel, setSel] = useState(Math.max(0, choices.indexOf(save.current)));
  const [zoomed, setZoomed] = useState(false);
  const [px, setPx] = useState<[number, number] | null>(null);
  const [maps, setMaps] = useState<Record<string, CampaignMapData> | null>(null);
  const [scene, setScene] = useState<string | null | undefined>(undefined);
  const [failed3d, setFailed3d] = useState(false);
  useEffect(() => { void loadCampaignMaps().then(setMaps); void loadMapScene().then(setScene); }, []);
  const adv = choices[sel] ?? save.current;
  const a = A[String(adv)] ?? {};
  const advIds = useMemo(() => (C?.Adventures ?? []).map((r: any) => Number(r?.id)).filter((n: number) => !Number.isNaN(n)), [C]);
  const view = useMemo(() => mapView(maps?.[String(save.campaign)], advIds, ui.pic, ui.raw), [maps, advIds, ui, save.campaign]);
  if (!maps || scene === undefined) return <div className="pm-screen" />;
  const trail = [...save.completed, adv];
  const many = choices.length > 1;
  const step = (d: number) => setSel((i) => (i + d + choices.length) % choices.length);
  const use3d = !!scene && !failed3d && mapKind() === "3d";
  const panel = 0.36;
  const story = save.restText ? ui.say(save.restText.key, save.restText.inserts) : ui.say(a.RestStoryKey);
  const art = ui.pic(ui.art.adventures[String(adv)]?.LocationArt);
  const chapter = ui.raw(`UI_CHAPTER_${chapterOf(save)}`) || `${t("chapter")} ${save.completed.length + 1}`;
  return (
    <div className="pm-screen cm-screen">
      {use3d
        ? <CampaignMap3D scene={scene!} view={view} trail={trail} focus={adv} zoomed={zoomed} panel={panel} onFocusPx={setPx} onError={() => setFailed3d(true)} />
        : <CampaignMap2D view={view} trail={trail} focus={adv} zoomed={zoomed} panel={panel} onFocusPx={setPx} />}
      {!zoomed && (
        <div className="cm-title">
          <h2 className="lo-banner"><span>{ui.raw(a.NameKey) || ui.raw(C?.TitleKey)}</span></h2>
          <p className="cm-chapter">{chapter}</p>
          {many && <>
            <button className="lo-arrow left cm-alt-l" aria-label="<" onClick={() => step(-1)} />
            <button className="lo-arrow right cm-alt-r" aria-label=">" onClick={() => step(1)} />
          </>}
        </div>
      )}
      {zoomed && (
        <aside className="cm-details" key={adv}>
          <h3>{ui.raw(a.NameKey) || a.m_Name}</h3>
          <div className="lo-rule" />
          <div className="cm-story" dangerouslySetInnerHTML={{ __html: story }} />
          {art && <img src={art} alt="" />}
          {many && <div className="cm-alts">
            <button className="lo-arrow left" aria-label="<" onClick={() => step(-1)} />
            <span>{sel + 1} / {choices.length}</span>
            <button className="lo-arrow right" aria-label=">" onClick={() => step(1)} />
          </div>}
        </aside>
      )}
      {zoomed && px && <span className="cm-place" style={{ left: px[0], top: px[1] + 34 }}>{ui.raw(a.LocationKey)}</span>}
      <div className="cm-buttons">
        <button className="pm-btn lo-btn cm-quit" onClick={onQuit}>{t("saveQuit")}</button>
        {zoomed && <button className="pm-btn lo-btn" onClick={() => setZoomed(false)}>{t("back")}</button>}
        <button className="lo-corner lo-next cm-go" onClick={() => (zoomed ? onConfirm(adv) : setZoomed(true))}><span>{t(zoomed ? "confirm" : "continue")}</span></button>
      </div>
    </div>
  );
}

/**
 * The rest like the original's (UI_Rest over the camp): the party's cards at the top (role, XP left), a card opens the
 * hero's skills (each role's XP spent on its cards); before the first adventure (or while a hero has no role) the
 * cards choose the roles. Gear (upgrades with lore, hero / party tabs) and the lore at the bottom left, the map at the
 * top left, save and quit / embark at the bottom right. The camp behind is the theme's (image, parallax or a 3D scene).
 */
export function PlainRest({ ui, save, onChange, onEmbark, onMap, onQuit }: {
  ui: MenuUi; save: CampaignSave; onChange: (s: CampaignSave) => void; onEmbark: (s: CampaignSave) => void; onMap: () => void; onQuit: () => void;
}) {
  const t = useTr();
  const D = ui.db;
  const H = D.models.HeroModel ?? {};
  const Ro = D.models.RoleModel ?? {};
  const S = D.models.SkillModel ?? {};
  const I = D.models.ItemModel ?? {};
  const roles = useMemo(() => ownedRoles(D, save.products).sort((a, b) => ui.raw(Ro[String(a)]?.NameKey).localeCompare(ui.raw(Ro[String(b)]?.NameKey))), [D, save.products, ui]); // eslint-disable-line react-hooks/exhaustive-deps
  const first = firstRest(save);
  const allRoles = save.heroes.every((h) => h.role >= 0);
  const choosing = first || !allRoles;
  const [hero, setHero] = useState<number | null>(null); // the hero whose skills are open
  const [skillRole, setSkillRole] = useState<number | null>(null);
  const [rolePick, setRolePick] = useState<number | null>(null); // the hero choosing a role
  const [inv, setInv] = useState<null | "hero" | "group">(null);
  const [up, setUp] = useState<ItemPlace | null>(null);
  const [upTo, setUpTo] = useState<number | null>(null);
  const [award, setAward] = useState<{ s: CampaignSave; title: number } | null>(null);
  const change = (f: (s: CampaignSave) => void) => { const s = structuredClone(save); f(s); onChange(s); };
  const A = D.models.AdventureModel?.[String(save.current)];
  const cave = Number(A?.RestAreaType ?? 0) === 1;
  const name = (m: any) => ui.raw(m?.NameKey) || m?.m_Name || "";
  const xpOf = (k: number) => { const h = save.heroes[k]!; return h.role >= 0 ? Math.max(0, availableXP(save, k, h.role)) : 0; };
  const places: ItemPlace[] = [...save.heroes.flatMap((h, k) => h.items.map((_, j) => ({ hero: k, slot: j }))), ...save.state.items.map((_, g) => ({ group: g }))];
  const anyUpgrade = places.some((at) => canUpgrade(D, save, at));
  const upKey = (at: ItemPlace) => ("group" in at ? `g${at.group}` : `${at.hero}.${at.slot}`);
  const itemCard = (id: number, onClick?: () => void, glow = false, key?: string | number) => {
    const m = I[String(id)];
    const icon = ui.art.items[String(id)]?.Icon;
    return (
      <button key={key} className={`lo-item${glow ? " glow" : ""}`} onClick={onClick} disabled={!onClick}>
        <span className="lo-item-icon">{icon && <img src={ui.pic(icon)} alt="" />}</span>
        <b>{name(m) || `#${id}`}</b>
        <i className="lo-item-level">{ROMAN[Number(m?.Level ?? 1)] ?? ""}</i>
        {!!Number(m?.Is2Handed ?? 0) && <i className="lo-item-2h">✋✋</i>}
      </button>
    );
  };
  const openSkills = (k: number) => {
    if (choosing) { setRolePick(k); return; }
    setInv(null);
    setHero(hero === k ? null : k);
    setSkillRole(save.heroes[k]!.role);
  };
  const embarkNow = () => { const s = structuredClone(save); const a = embark(s); if (a) setAward({ s, title: a[1] }); else onEmbark(s); };
  const k = hero;
  const skillRoles = k !== null ? [...new Set([...(save.heroes[k]!.role >= 0 ? [save.heroes[k]!.role] : []), ...xpRoles(save, k)])] : [];
  const sr = k !== null ? (skillRole ?? skillRoles[0] ?? null) : null;
  return (
    <div className="pm-screen rs-screen">
      <MenuBackground which={cave ? "rest-cave" : "rest-forest"} dim={hero !== null || inv !== null} />
      {choosing && <h2 className="lo-banner rs-banner"><span>{t("chooseRoles")}</span></h2>}
      <div className={`rs-party${choosing ? " low" : ""}`}>
        {save.heroes.map((h, i) => {
          const a = ui.art.heroes[String(h.hero)];
          const pic = a?.portrait ?? a?.icon;
          return (
            <button key={i} className={`lo-hero rs-hero${hero === i || rolePick === i ? " on" : ""}`} onClick={() => openSkills(i)}>
              <b className="lo-hero-name"><span>{name(H[String(h.hero)])}</span></b>
              <span className="lo-hero-pic">{pic ? <img src={ui.pic(pic)} alt="" /> : <i>{name(H[String(h.hero)]).slice(0, 1)}</i>}</span>
              <span className="rs-hero-foot">
                <span className={`rs-role${h.role < 0 ? " none" : ""}`}>{h.role >= 0 ? name(Ro[String(h.role)]) : t("noRole")}</span>
                {!choosing && <span className="rs-xp" title={t("xp")}>{xpOf(i)}</span>}
              </span>
            </button>
          );
        })}
      </div>
      {/* the role list of a hero (first rest, or a hero without a role) */}
      {rolePick !== null && (
        <div className="lo-modal" onClick={() => setRolePick(null)}>
          <div className="lo-replace rs-roles" onClick={(e) => e.stopPropagation()}>
            <p>{name(H[String(save.heroes[rolePick]!.hero)])}</p>
            <div className="lo-replace-list">
              {roles.map((r) => {
                const on = save.heroes[rolePick]!.role === r;
                const ok = canTakeRole(D, save, rolePick, r) || on;
                return (
                  <button key={r} className={`pm-btn lo-btn rs-role-btn${on ? " on" : ""}`} disabled={!ok}
                    onClick={() => { change((s) => setRole(s, rolePick, r)); setRolePick(null); }}>{name(Ro[String(r)])}</button>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {/* a hero's skills: the roles with XP on the left, the chosen role's cards on the right */}
      {k !== null && !inv && (
        <section className="rs-panel rs-skills">
          <div className="rs-skill-roles">
            {skillRoles.map((r) => (
              <button key={r} className={`rs-skill-role${sr === r ? " on" : ""}`} onClick={() => setSkillRole(r)}>
                <span>{name(Ro[String(r)])}</span><i className="rs-xp">{Math.max(0, availableXP(save, k, r))}</i>
              </button>
            ))}
            <button className="pm-btn lo-btn rs-change-role" onClick={() => setRolePick(k)}>{t("changeRole")}</button>
          </div>
          <div className="rs-skill-cards">
            <h3 className="rs-plate"><span>{t("roleCards")}</span></h3>
            <div className="rs-skill-grid">
              {sr !== null && roleSkills(D, save, k, sr).map((sk) => (
                <button key={sk.id} className={`rs-skill${sk.learned ? " learned" : ""}${!sk.learned && (!sk.canLearn || !sk.available) ? " locked" : ""}`}
                  disabled={!sk.learned && (!sk.canLearn || !sk.available)} onClick={() => change((s) => { toggleSkill(D, s, k, sr, sk.id); })}>
                  <span>{name(S[String(sk.id)])}</span><i className="rs-cost">{sk.cost}</i>
                </button>
              ))}
            </div>
          </div>
          <button className="rs-close" aria-label={t("close")} onClick={() => setHero(null)}>×</button>
        </section>
      )}
      {/* gear: each hero's items, or the party's; an item that can be upgraded glows, a click lists its upgrades */}
      {inv && (
        <section className="rs-panel rs-inv">
          <div className="rs-tabs">
            <div className="pm-seg">
              <button className={inv === "hero" ? "on" : ""} onClick={() => setInv("hero")}>{t("tabHero")}</button>
              <button className={inv === "group" ? "on" : ""} onClick={() => setInv("group")}>{t("tabParty")}</button>
            </div>
            <span className="rs-lore">{t("lore")}: <b>{save.state.lore}</b></span>
          </div>
          <div className="rs-inv-body">
            {inv === "hero" ? save.heroes.map((h, i) => {
              const a = ui.art.heroes[String(h.hero)];
              return (
                <div key={i} className="rs-inv-row">
                  {(a?.icon || a?.portrait) ? <img className="rs-inv-hero" src={ui.pic(a.icon ?? a.portrait)} alt="" /> : <i className="rs-inv-hero">{name(H[String(h.hero)]).slice(0, 1)}</i>}
                  {h.items.map((id, j) => {
                    const at: ItemPlace = { hero: i, slot: j };
                    const can = canUpgrade(D, save, at);
                    return itemCard(id, can ? () => { setUp(at); setUpTo(null); } : undefined, can, upKey(at));
                  })}
                </div>
              );
            }) : (
              <div className="rs-inv-row wrap">
                {!save.state.items.length && <p className="muted">{t("noPartyItems")}</p>}
                {save.state.items.map((id, g) => {
                  const at: ItemPlace = { group: g };
                  const can = canUpgrade(D, save, at);
                  return itemCard(Number(id), can ? () => { setUp(at); setUpTo(null); } : undefined, can, upKey(at));
                })}
              </div>
            )}
          </div>
          <button className="rs-close" aria-label={t("close")} onClick={() => { setInv(null); setUp(null); }}>×</button>
        </section>
      )}
      {up && (
        <div className="lo-modal" onClick={() => setUp(null)}>
          <div className="lo-replace" onClick={(e) => e.stopPropagation()}>
            <p>{t("chooseUpgrade")}<b>{name(I[String("group" in up ? save.state.items[up.group] : save.heroes[up.hero]!.items[up.slot])])}</b></p>
            <div className="lo-replace-list">
              {upgradeOptions(D, save, up).map((to) => (
                <div key={to} className={upTo === to ? "rs-pick on" : "rs-pick"}>{itemCard(to, () => setUpTo(to))}</div>
              ))}
            </div>
            <button className="pm-btn lo-btn" disabled={upTo === null}
              onClick={() => { change((s) => { upgradeItem(D, s, up, upTo!); }); setUp(null); }}>{t("confirm")}</button>
          </div>
        </div>
      )}
      {!first && <button className="rs-map" title={t("map")} aria-label={t("map")} onClick={onMap}><MapIcon /></button>}
      <div className="rs-left">
        <button className={`pm-btn lo-btn rs-gear${anyUpgrade ? " glow" : ""}`} onClick={() => { setHero(null); setInv(inv ? null : "hero"); }}>{t("items")}</button>
        <span className="rs-lore">{t("lore")}: <b>{save.state.lore}</b></span>
      </div>
      <div className="cm-buttons">
        {!allRoles && <span className="rs-need">{t("rolesNeeded")}</span>}
        <button className="pm-btn lo-btn cm-quit" onClick={onQuit}>{t("saveQuit")}</button>
        <button className="lo-corner lo-next cm-go" disabled={!allRoles || !!award} onClick={embarkNow}><span>{t(choosing ? "embark" : "continue")}</span></button>
      </div>
      {award && (
        <div className="lo-modal">
          <div className="lo-confirm">
            <p>{t("titleAwarded")}: {name(D.models.TitleModel?.[String(award.title)])}</p>
            <div><button className="pm-btn lo-btn" onClick={() => onEmbark(award.s)}>{t("continue")}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

/** The map button of the rest (the skin's "map" picture covers it) */
function MapIcon() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path d="M6 14 L22 8 L42 14 L58 8 L58 50 L42 56 L22 50 L6 56 Z" />
      <path className="fold" d="M22 8 L22 50 M42 14 L42 56" />
    </svg>
  );
}

/** The end of a campaign without a cutscene */
export function PlainEnding({ won, onDone }: { won: boolean; onDone: () => void }) {
  const t = useTr();
  return (
    <div className="pm-screen">
      <MenuBackground dim />
      <section className="pm-panel"><header><h2>{won ? t("victory") : t("defeat")}</h2></header>
        <footer><button className="pm-btn primary" onClick={onDone}>{t("toMenu")}</button></footer></section>
    </div>
  );
}
