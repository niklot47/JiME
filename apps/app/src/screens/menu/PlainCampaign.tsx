// This app's own campaign pages (without the imported game's interface): a cutscene (prologue, ending), the travel map
// (the next adventure and the alternatives), the rest (roles, skills with the roles' XP, item upgrades, embark).
// Same engine calls as the original-look pages (screens/campaign/*).
import { useEffect, useMemo, useState } from "react";
import { adventureChoices, chapterOf, availableXP, canTakeRole, canUpgrade, embark, firstRest, ownedRoles, roleSkills, setRole, toggleSkill, upgradeItem, upgradeOptions,
  xpRoles, type CampaignSave, type ItemPlace } from "@jime/engine";
import { useTr } from "../../ui/i18n.ts";
import { MenuBackground } from "./MenuBackground.tsx";
import { CampaignMap2D, mapView } from "./CampaignMap2D.tsx";
import { CampaignMap3D } from "./CampaignMap3D.tsx";
import { loadCampaignMaps, loadMapScene, type CampaignMapData } from "../../data/pack.ts";
import type { MenuUi } from "./useMenuData.ts";

const ROMAN = ["", "I", "II", "III", "IV", "V"];

/** A cutscene: its picture and text, then on */
export function PlainCutscene({ ui, cutscene, title, onDone }: { ui: MenuUi; cutscene: number; title: string; onDone: () => void }) {
  const t = useTr();
  const m = ui.db.models.CutsceneModel?.[String(cutscene)];
  const pic = ui.pic(ui.art.cutscenes[String(cutscene)]?.Texture);
  return (
    <div className="pm-screen pm-cutscene" style={pic ? { backgroundImage: `url("${pic}")` } : undefined}>
      <div className="pm-cutscene-text">
        <h2>{title}</h2>
        <p dangerouslySetInnerHTML={{ __html: ui.say(m?.TextKey) }} />
        <button className="pm-btn primary" onClick={onDone}>{t("continue")} →</button>
      </div>
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

/** The rest before an adventure: each hero's role, skills bought with XP, gear upgrades with lore; then embark */
export function PlainRest({ ui, save, onChange, onEmbark, onMap, onQuit }: {
  ui: MenuUi; save: CampaignSave; onChange: (s: CampaignSave) => void; onEmbark: (s: CampaignSave) => void; onMap: () => void; onQuit: () => void;
}) {
  const t = useTr();
  const D = ui.db;
  const H = D.models.HeroModel ?? {};
  const R = D.models.RoleModel ?? {};
  const S = D.models.SkillModel ?? {};
  const I = D.models.ItemModel ?? {};
  const roles = useMemo(() => ownedRoles(D, save.products).sort((a, b) => ui.raw(R[String(a)]?.NameKey).localeCompare(ui.raw(R[String(b)]?.NameKey))), [D, save.products, ui]); // eslint-disable-line react-hooks/exhaustive-deps
  const [award, setAward] = useState<{ s: CampaignSave; title: number } | null>(null);
  const [up, setUp] = useState<ItemPlace | null>(null);
  const change = (f: (s: CampaignSave) => void) => { const s = structuredClone(save); f(s); onChange(s); };
  const allRoles = save.heroes.every((h) => h.role >= 0);
  const A = D.models.AdventureModel?.[String(save.current)];
  const itemName = (id: number | null | undefined) => (id ? ui.raw(I[String(id)]?.NameKey) || I[String(id)]?.m_Name || `#${id}` : "");
  const itemPic = (id: number) => ui.pic(ui.art.items[String(id)]?.Icon);
  const upKey = (at: ItemPlace) => ("group" in at ? `g${at.group}` : `${at.hero}.${at.slot}`);
  const upgradeBox = (at: ItemPlace) => {
    if (!up || upKey(up) !== upKey(at)) return null;
    return (
      <div className="pm-upgrade">
        <span>{t("upgradeTo")}:</span>
        {upgradeOptions(D, save, at).map((to) => (
          <button key={to} className="pm-btn small" onClick={() => { change((s) => { upgradeItem(D, s, at, to); }); setUp(null); }}>
            {itemPic(to) && <img src={itemPic(to)} alt="" />}{itemName(to)} <small>{t("level")} {ROMAN[Number(I[String(to)]?.Level ?? 1)]}</small>
          </button>
        ))}
        <button className="pm-btn small" onClick={() => setUp(null)}>{t("close")}</button>
      </div>
    );
  };
  const item = (id: number, at: ItemPlace) => (
    <li key={upKey(at)}>
      {itemPic(id) && <img src={itemPic(id)} alt="" />}
      <span>{itemName(id)} <small>{t("level")} {ROMAN[Number(I[String(id)]?.Level ?? 1)] ?? ""}</small></span>
      {canUpgrade(D, save, at) && <button className="pm-btn small" onClick={() => setUp(at)}>{t("upgrade")} ({I[String(id)]?.UpgradeCost})</button>}
      {upgradeBox(at)}
    </li>
  );
  return (
    <div className="pm-screen">
      <MenuBackground dim />
      <section className="pm-panel wide">
        <header>
          <h2>{t("rest")} · {ui.raw(A?.NameKey)}</h2>
          <p className="muted">{save.partyName} · {t("lore")} {save.state.lore}{firstRest(save) ? "" : ` · ${t("chapter")} ${save.completed.length + 1}`}</p>
        </header>
        <div className="pm-body">
          {A?.RestStoryKey && <p className="pm-story" dangerouslySetInnerHTML={{ __html: ui.say(A.RestStoryKey) }} />}
          <div className="pm-party">
            {save.heroes.map((h, k) => {
              const a = ui.art.heroes[String(h.hero)];
              const xr = [...new Set([...xpRoles(save, k), ...(h.role >= 0 ? [h.role] : [])])];
              return (
                <article key={k} className="pm-member">
                  <header>
                    {(a?.portrait || a?.icon) && <img src={ui.pic(a.icon ?? a.portrait)} alt="" />}
                    <div><b>{ui.raw(H[String(h.hero)]?.NameKey)}</b><span className="muted">{ui.raw(H[String(h.hero)]?.RaceKey)}</span></div>
                  </header>
                  <label>{t("role")}
                    <select value={h.role} onChange={(e) => change((s) => setRole(s, k, Number(e.target.value)))}>
                      {h.role < 0 && <option value={-1}>{t("noRole")}</option>}
                      {roles.map((r) => <option key={r} value={r} disabled={!canTakeRole(D, save, k, r) && r !== h.role}>{ui.raw(R[String(r)]?.NameKey)}</option>)}
                    </select>
                  </label>
                  {xr.filter((r) => availableXP(save, k, r) >= 0 || (R[String(r)]?.UpgradeSkills ?? []).length).map((r) => (
                    <div key={r} className="pm-skills">
                      <h4>{t("skills")}: {ui.raw(R[String(r)]?.NameKey)} <small>· {Math.max(0, availableXP(save, k, r))} {t("xp")}</small></h4>
                      <ul>
                        {roleSkills(D, save, k, r).map((sk) => (
                          <li key={sk.id}>
                            <label className={!sk.available ? "off" : ""}>
                              <input type="checkbox" checked={sk.learned} disabled={!sk.learned && (!sk.canLearn || !sk.available)}
                                onChange={() => change((s) => { toggleSkill(D, s, k, r, sk.id); })} />
                              {ui.raw(S[String(sk.id)]?.NameKey)} <small>({sk.cost})</small>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  <h4>{t("items")}</h4>
                  <ul className="pm-items">{h.items.map((id, j) => item(id, { hero: k, slot: j }))}</ul>
                </article>
              );
            })}
          </div>
          {save.state.items.length > 0 && <>
            <h4>{t("partyItems")}</h4>
            <ul className="pm-items">{save.state.items.map((id, g) => item(Number(id), { group: g }))}</ul>
          </>}
          {award && (
            <div className="pm-award">
              <p>{t("titleAwarded")}: <b>{ui.raw(D.models.TitleModel?.[String(award.title)]?.NameKey)}</b></p>
              <button className="pm-btn primary" onClick={() => onEmbark(award.s)}>{t("continue")} →</button>
            </div>
          )}
        </div>
        <footer>
          <button className="pm-btn" onClick={onQuit}>{t("toMenu")}</button>
          {!firstRest(save) && <button className="pm-btn" onClick={onMap}>{t("map")}</button>}
          {!allRoles && <span className="muted">{t("rolesNeeded")}</span>}
          <button className="pm-btn primary" disabled={!allRoles || !!award}
            onClick={() => { const s = structuredClone(save); const a = embark(s); if (a) setAward({ s, title: a[1] }); else onEmbark(s); }}>{t("embark")} →</button>
        </footer>
      </section>
    </div>
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
