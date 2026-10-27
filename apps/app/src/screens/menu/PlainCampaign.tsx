// This app's own campaign pages (without the imported game's interface): a cutscene (prologue, ending), the travel map
// (the next adventure and the alternatives), the rest (roles, skills with the roles' XP, item upgrades, embark).
// Same engine calls as the original-look pages (screens/campaign/*).
import { useMemo, useState } from "react";
import { adventureChoices, availableXP, canTakeRole, canUpgrade, embark, firstRest, ownedRoles, roleSkills, setRole, toggleSkill, upgradeItem, upgradeOptions,
  xpRoles, type CampaignSave, type ItemPlace } from "@jime/engine";
import { useTr } from "../../ui/i18n.ts";
import { MenuBackground } from "./MenuBackground.tsx";
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

/** The travel map: the next adventure (and alternatives, if the last one added any); choosing one goes to the rest */
export function PlainMap({ ui, save, onConfirm, onQuit }: { ui: MenuUi; save: CampaignSave; onConfirm: (adv: number) => void; onQuit: () => void }) {
  const t = useTr();
  const A = ui.db.models.AdventureModel ?? {};
  const C = ui.db.models.CampaignModel?.[String(save.campaign)];
  const choices = adventureChoices(save);
  const [pick, setPick] = useState(save.current);
  return (
    <div className="pm-screen">
      <MenuBackground dim />
      <section className="pm-panel wide">
        <header>
          <h2>{ui.raw(C?.TitleKey)} · {t("chapter")} {save.completed.length + 1}</h2>
          <p className="muted">{save.partyName} · {t("lore")} {save.state.lore}</p>
        </header>
        <div className="pm-body">
          <div className="pm-adventures">
            {choices.map((id) => {
              const a = A[String(id)];
              const pic = ui.pic(ui.art.adventures[String(id)]?.LocationArt);
              return (
                <button key={id} className={`pm-adv${pick === id ? " on" : ""}`} onClick={() => setPick(id)}>
                  {pic && <img src={pic} alt="" />}
                  <b>{ui.raw(a?.NameKey) || a?.m_Name || `#${id}`}</b>
                  <span className="muted">{ui.raw(a?.LocationKey)}</span>
                  <span className="pm-desc" dangerouslySetInnerHTML={{ __html: ui.say(a?.RestStoryKey) }} />
                </button>
              );
            })}
          </div>
        </div>
        <footer>
          <button className="pm-btn" onClick={onQuit}>{t("toMenu")}</button>
          <button className="pm-btn primary" onClick={() => onConfirm(pick)}>{t("choose")} →</button>
        </footer>
      </section>
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
