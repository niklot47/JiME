// The rest between adventures (UI_Rest, UIRestScene over the camp): the party with its XP, lore, the skills page (spend
// XP of each role on its skills), role selection, Embark. Before the campaign's first adventure it opens on the roles.
import { useMemo, useState } from "react";
import { availableXP, canTakeRole, canUpgrade, embark, firstRest, ownedRoles, roleSkills, setRole, toggleSkill, upgradeItem, upgradeOptions, xpRoles,
  type CampaignSave, type ItemPlace } from "@jime/engine";
import { NguiView, type Bind, type Binds } from "../../ngui/NguiView.tsx";
import { findNode, type UiNode } from "../../ngui/types.ts";
import { RestScene3D } from "../../board/RestScene3D.tsx";
import { SLIDE, withEnter, type TitleUi } from "../title/common.ts";

const HERO_STEP = 135;
const ROLE_ROW = 52.14;
const SKILL_ROLE_ROW = 62.04;
const HERO_ITEMS_ROW = 90.1;
const GROUP_CELL: [number, number] = [255.8, 85.7];
const UPGRADE_ROW = 86.86;
const roman = (n: number) => ["", "I", "II", "III", "IV", "V"][n] ?? String(n);

export function RestPage({ ui, save, onChange, onEmbark, onMap, onQuit }: {
  ui: TitleUi; save: CampaignSave;
  /** the changed save (roles, skills, XP), written to the slot */
  onChange: (s: CampaignSave) => void;
  /** every hero has a role: set off (the caller starts the adventure) */
  onEmbark: (s: CampaignSave, title: [number, number] | null) => void;
  /** Button_Epilogue: back to the travel map */
  onMap: () => void;
  onQuit: () => void;
}) {
  const first = firstRest(save);
  const [mode, setMode] = useState<"main" | "roles">(first ? "roles" : "main");
  const [roleHero, setRoleHero] = useState<number | null>(() => (first ? save.heroes.findIndex((h) => h.role < 0) : null));
  const [skillsHero, setSkillsHero] = useState<number | null>(null);
  const [skillRole, setSkillRole] = useState<number | null>(null);
  const [titles, setTitles] = useState(false);
  const [roleScroll, setRoleScroll] = useState(0);
  // the inventory (UIRestScene.ShowInventoryPage): hero or party tab, the item being upgraded and the upgrade picked
  const [inv, setInv] = useState<null | "hero" | "group">(null);
  const [up, setUp] = useState<ItemPlace | null>(null);
  const [upTo, setUpTo] = useState<number | null>(null);
  const [groupScroll, setGroupScroll] = useState(0);
  // UIRestScene.CoroutineEmbark: a title earned on the way out (Word Wielder) is announced before setting off
  const [award, setAward] = useState<{ s: CampaignSave; t: [number, number] } | null>(null);
  const show = useMemo(() => [findNode(ui.layout.root, "UI_Rest")].filter(Boolean) as UiNode[], [ui.layout]);
  const D = ui.db;
  const R = D.models.RoleModel ?? {};
  const H = D.models.HeroModel ?? {};
  const roles = useMemo(() => ownedRoles(D, save.products).sort((a, b) => ui.raw(R[String(a)]?.NameKey).localeCompare(ui.raw(R[String(b)]?.NameKey))), [D, save.products, ui]); // eslint-disable-line react-hooks/exhaustive-deps
  const n = save.heroes.length;
  const heroX = (k: number) => (k - (n - 1) / 2) * HERO_STEP;
  // UIRestScene.CoroutineRevealFirstMenu / SecondMenu: the heroes higher on the main page, lower over the roles
  const gridY = mode === "main" ? 235 : 135;
  const change = (f: (s: CampaignSave) => void) => { const s = structuredClone(save); f(s); onChange(s); };
  const allRoles = save.heroes.every((h) => h.role >= 0);
  const I = D.models.ItemModel ?? {};
  const places: ItemPlace[] = [...save.heroes.flatMap((h, k) => h.items.map((_, j) => ({ hero: k, slot: j }))), ...save.state.items.map((_, g) => ({ group: g }))];
  const anyUpgrade = places.some((at) => canUpgrade(D, save, at));
  /** ItemMiniView: picture, name, level, two-handed mark; the upgrade glow when it can be upgraded now */
  const miniView = (id: number | null, glow: boolean): Record<string, Bind> => {
    const m = id !== null ? I[String(id)] : null;
    return {
      Sprite_Image: { show: !!m, tex: id !== null ? ui.itemArt[String(id)]?.Icon : undefined },
      Label_ItemName: { show: !!m, html: m ? ui.say(m.NameKey) : "" },
      Label_NoneSelected: { show: !m },
      Sprite_Level: { show: !!m },
      Label_Level: { text: m ? roman(Number(m.Level ?? 1)) : "" },
      Sprite_IconType: { show: !!m && !!Number(m.Is2Handed ?? 0) },
      Sprite_SelectedHighlight: { show: glow },
    };
  };
  const scoped = (owner: string, binds: Record<string, Bind>): Record<string, Bind> =>
    Object.fromEntries(Object.entries(binds).map(([k, v]) => [`${owner}//${k}`, v]));

  const b: Binds = {
    UI_Rest: { show: true },
    "UI_Rest/Sprite_Options": { show: false },
    // MessagePopup.InitializePlacement (Top): label 750 wide from the top of the popup, background around it
    Panel_MessagePopup: { show: !!award, at: [0, 216], pin: "top" },
    "Panel_MessagePopup/Label_Message": { pv: 1, at: [0, 0], w: 750, al: 2, html: award ? ui.say("UI_AWARD_TITLE_FORMATTED", [ui.raw(D.models.TitleModel?.[String(award.t[1])]?.NameKey)]) : "" },
    "Panel_MessagePopup//Button_Continue": { show: !!award, onClick: () => { if (award) { setAward(null); onEmbark(award.s, award.t); } } },
    Panel_PopupTutorial: { show: false },

    "Panel_Heroes/z_InputBlocker": { show: false },
    // ---- main page
    Panel_Main: { show: mode === "main" && skillsHero === null },
    Sprite_LastStands: { show: false },
    "Sprite_Lore/Label_LoreValue": { text: String(save.state.lore) },
    Button_Inventory: { onClick: () => { setInv("hero"); setUp(null); } },
    // UIRestScene.IsAnyItemUpgradable
    "Button_Inventory/Sprite_Highlight": { show: anyUpgrade },
    Button_Epilogue: { onClick: onMap },
    "Table_Buttons/Button_Continue": { onClick: () => { setMode("roles"); setRoleHero(save.heroes.findIndex((h) => h.role < 0)); } },
    Button_SaveQuit: { onClick: onQuit },
    // ---- heroes
    // Table_Heroes' TweenPosition (0.75 s) between the main page and the role selection
    Table_Heroes: { at: [-2.1, gridY], move: 0.75 },
    // the chosen hero's glow (skills page, or whose role is being picked)
    Offset_Highlight: skillsHero !== null ? { show: true, at: [heroX(skillsHero) - 2.1, gridY] }
      : mode === "roles" && roleHero !== null && roleHero >= 0 ? { show: true, at: [heroX(roleHero) - 2.1, gridY] } : { show: false },
    Sprite_SelectHighlight: { show: false },
    // ---- role selection
    Panel_RoleSelection: { show: mode === "roles" },
    "Panel_RoleSelection/Label_Title": { html: ui.say(first ? "UI_SELECT_ROLES" : "UI_CHANGE_ROLES") },
    "Panel_RoleSelection/Button_Back": { show: !first, onClick: () => { setMode("main"); setRoleHero(null); } },
    Button_Embark: { disabled: !allRoles, onClick: () => { const s = structuredClone(save); const t = embark(s); if (t) setAward({ s, t }); else onEmbark(s, t); } },
    Label_Embark: { html: ui.say("UI_EMBARK") },
    Button_CloseRoleSelection: { onClick: () => setRoleHero(null) },
    Sprite_Roles: roleHero !== null && roleHero >= 0 ? { show: true, at: [heroX(roleHero) - 2.1, gridY - 245 * 1.1] } : { show: false },
    "Role_Miniview_2 (0)": {
      dy: roleScroll,
      step: [0, -ROLE_ROW],
      clones: roles.map((r): Record<string, Bind> => {
        const ok = roleHero !== null && roleHero >= 0 && canTakeRole(D, save, roleHero, r);
        return {
          "Role_Miniview_2 (0)": {
            disabled: !ok,
            onClick: () => {
              if (roleHero === null || roleHero < 0) return;
              const s = structuredClone(save);
              setRole(s, roleHero, r);
              onChange(s);
              // UIRestScene.OnRoleSelected: on to the next hero without a role
              const nextHero = s.heroes.findIndex((h) => h.role < 0);
              setRoleHero(nextHero >= 0 ? nextHero : null);
            },
          },
          "Role_Miniview_2 (0)//Label_Role": { html: ui.say(R[String(r)]?.NameKey) },
        };
      }),
    },
    // ---- skills page
    Panel_Skills: { show: skillsHero !== null },
    "Panel_Skills/Z_Darkening": { onClick: () => { setSkillsHero(null); setTitles(false); } },
  };
  for (let k = 1; k < 24; k++) b[`Role_Miniview_2 (${k})`] = { show: false };


  // ---- inventory: each hero's three items, the party's items; an upgradable one opens the upgrade choice
  b.Panel_Inventory = { show: inv !== null };
  b["Panel_Inventory/Z_Darkening"] = { onClick: () => { setInv(null); setUp(null); } };
  b["Panel_Inventory//Label_LoreValue"] = { text: String(save.state.lore) };
  b["Sprite_Tabs/Sprite_Selected"] = { at: [inv === "group" ? 60 : -60, 1] };
  b.Option_Hero = { onClick: () => setInv("hero") };
  b.Option_Group = { onClick: () => { setInv("group"); setGroupScroll(0); } };
  b.Label_Hero = { color: inv !== "group" ? [1, 0.75, 0.227, 1] : [1, 1, 1, 1] };
  b.Label_Group = { color: inv === "group" ? [1, 0.75, 0.227, 1] : [1, 1, 1, 1] };
  b.Content_HeroInventory = { show: inv === "hero" };
  b.Content_GroupInventory = { show: inv === "group" };
  b["Hero_Items (0)"] = {
    step: [0, -HERO_ITEMS_ROW],
    clones: save.heroes.map((h, k): Record<string, Bind> => {
      const out: Record<string, Bind> = { "Hero_Items (0)": { tex: ui.heroArt[String(h.hero)]?.icon } };
      ["Item_MiniView", "Item_MiniView (1)", "Item_MiniView (2)"].forEach((mv, j) => {
        const at: ItemPlace = { hero: k, slot: j };
        const id = h.items[j] ?? null;
        const ok = id !== null && canUpgrade(D, save, at);
        out[mv] = { show: id !== null, onClick: ok ? () => { setUp(at); setUpTo(null); } : undefined };
        Object.assign(out, scoped(mv, miniView(id, ok)));
      });
      return out;
    }),
  };
  for (let k = 1; k < 5; k++) b[`Hero_Items (${k})`] = { show: false };
  const groupRows = Math.ceil(save.state.items.length / 3);
  b["Grid_Equipment/Item_MiniView"] = {
    dy: groupScroll,
    clones: save.state.items.map((raw, g): Record<string, Bind> => {
      const id = Number(raw);
      const at: ItemPlace = { group: g };
      const ok = canUpgrade(D, save, at);
      return {
        Item_MiniView: { dx: (g % 3) * GROUP_CELL[0], dy: -Math.floor(g / 3) * GROUP_CELL[1], onClick: ok ? () => { setUp(at); setUpTo(null); } : undefined },
        ...scoped("Item_MiniView", miniView(id, ok)),
      };
    }),
  };
  for (let k = 1; k < 40; k++) b[`Grid_Equipment/Item_MiniView (${k})`] = { show: false };
  b.Label_NoItems = { show: inv === "group" && save.state.items.length === 0 };
  // UIRestScene.OnInventoryItemSelected / LoadUpgradesForItem / OnUpgradeItemConfirmed
  const upId = up ? ("group" in up ? Number(save.state.items[up.group]) : save.heroes[up.hero]?.items[up.slot] ?? null) : null;
  const opts = up ? upgradeOptions(D, save, up) : [];
  b.Panel_ItemUpgrade = { show: !!up };
  b.Panel_UpgradeFX = { show: false };
  b["Panel_ItemUpgrade/Z_Darkening"] = { onClick: () => setUp(null) };
  b["Sprite_Replacement/Sprite_SelectedHighlight"] = { show: false };
  b["Sprite_Replacement/Label_Instructions"] = { html: upId !== null ? ui.say("UI_UPGRADE_INSTRUCTION_FORMATTED", [I[String(upId)]?.NameKey ?? ""]) : "" };
  b["Table/Item_MiniView (0)"] = {
    step: [0, -UPGRADE_ROW],
    clones: opts.map((id): Record<string, Bind> => ({
      "Item_MiniView (0)": { onClick: () => setUpTo(id) },
      ...scoped("Item_MiniView (0)", miniView(id, upTo === id)),
    })),
  };
  for (let k = 1; k < 10; k++) b[`Table/Item_MiniView (${k})`] = { show: false };
  b["Sprite_Replacement/Button_Confirm"] = {
    disabled: upTo === null,
    onClick: () => { if (up && upTo !== null) { change((s) => { upgradeItem(D, s, up, upTo); }); setUp(null); setUpTo(null); } },
  };

  // the heroes (RestHeroView: XP on the main page, the role or "Select" on the roles)
  for (let k = 0; k < 5; k++) {
    const name = `HeroRestSlot (${k})`;
    const h = save.heroes[k];
    if (!h) { b[name] = { show: false }; continue; }
    const total = Object.values(h.xp).reduce((a, v) => a + Math.max(0, v), 0);
    const roleKey = h.role >= 0 ? R[String(h.role)]?.NameKey : "UI_SELECT";
    b[name] = {
      show: true, at: [heroX(k), 0], tex: ui.heroArt[String(h.hero)]?.icon,
      onClick: () => {
        if (mode === "roles") { setRoleScroll(0); setRoleHero(k); return; }
        setSkillsHero(k); setTitles(false);
        setSkillRole(h.role >= 0 && availableXP(save, k, h.role) >= 0 ? h.role : xpRoles(save, k)[0] ?? null);
      },
    };
    b[`${name}/Label_HeroName`] = { html: ui.say(H[String(h.hero)]?.NameKey) };
    b[`${name}/Widget_XP`] = { show: mode === "main" };
    b[`${name}//Label_XP_Amount`] = { text: String(total), color: total === 0 ? [0.5, 0.5, 0.5, 1] : undefined };
    b[`${name}/Label_Role`] = { show: mode === "roles", html: ui.say(roleKey), color: h.role >= 0 ? [0, 0, 0, 1] : [0.5, 0.5, 0.5, 1] };
    b[`${name}/Sprite_Corruption`] = { show: h.corruption > 0 };
    b[`${name}//Label_Corruption`] = { text: String(h.corruption) };
  }

  // the skills page of a hero: the roles it has XP in, then the role's upgrade skills (UIRestScene.DisplaySkillPage)
  if (skillsHero !== null) {
    const h = save.heroes[skillsHero]!;
    const rs = xpRoles(save, skillsHero).sort((a, c) => ui.raw(R[String(a)]?.NameKey).localeCompare(ui.raw(R[String(c)]?.NameKey)));
    const cur = skillRole !== null && rs.includes(skillRole) ? skillRole : rs[0] ?? null;
    const sel = titles ? rs.length : cur !== null ? rs.indexOf(cur) : -1;
    b["Role_Miniview (0)"] = {
      step: [0, -SKILL_ROLE_ROW],
      clones: rs.map((r): Record<string, Bind> => ({
        "Role_Miniview (0)": { onClick: () => { setSkillRole(r); setTitles(false); } },
        "Role_Miniview (0)//Label_Role": { html: ui.say(R[String(r)]?.NameKey) },
        "Role_Miniview (0)//Label_XP": { text: String(availableXP(save, skillsHero, r)) },
        "Role_Miniview (0)//Sprite_Highlight": { show: false },
      })),
    };
    for (let k = 1; k < 24; k++) b[`Role_Miniview (${k})`] = { show: false };
    b.Title_Button = { show: h.titles.length > 0, at: [0, -31 - SKILL_ROLE_ROW * rs.length], onClick: () => setTitles(true) };
    b["Sprite_BG/Sprite_Highlight"] = sel >= 0 ? { show: true, at: [-251.8, 170.7 - SKILL_ROLE_ROW * sel] } : { show: false };
    b.Grid_Skills = { show: !titles };
    b.Grid_Titles = { show: titles };
    b.Label_RollSkills = { show: !titles };
    const skills = !titles && cur !== null ? roleSkills(D, save, skillsHero, cur) : [];
    const S = D.models.SkillModel ?? {};
    for (let k = 0; k < 10; k++) {
      const name = `Skill_MiniView (${k})`;
      const sk = skills[k];
      if (!sk) { b[name] = { show: false }; continue; }
      // SkillMiniView.Refresh: learned (selected frame, highlight), taken by another hero, too dear (grey, orange cost)
      const owner = sk.available ? -1 : save.heroes.findIndex((o, i) => i !== skillsHero && o.skills.includes(sk.id));
      b[name] = {
        show: true, sprite: sk.learned ? "SkillSelected" : "SkillUnselected",
        color: sk.learned || (sk.available && sk.canLearn) ? undefined : [0.5, 0.5, 0.5, 1],
        onClick: () => change((s) => { toggleSkill(D, s, skillsHero, cur!, sk.id); }),
      };
      b[`${name}/Label_SkillName`] = { html: ui.say(S[String(sk.id)]?.NameKey) };
      b[`${name}//Label_Cost`] = { text: sk.available ? String(sk.cost) : "", color: sk.learned || sk.canLearn ? undefined : [1, 0.45, 0, 1] };
      b[`${name}/Sprite_Cost`] = { show: sk.available };
      b[`${name}/Texture_Occupied`] = owner >= 0 ? { show: true, tex: ui.heroArt[String(save.heroes[owner]!.hero)]?.icon } : { show: false };
      b[`${name}/Sprite_OwnedHighlight`] = { show: sk.learned };
    }
    const T = D.models.TitleModel ?? {};
    for (let k = 0; k < 10; k++) {
      const name = `Title_MiniView (${k})`;
      const t = h.titles[k];
      b[name] = { show: titles && t !== undefined };
      if (t !== undefined) {
        b[`${name}/Label_TitleName`] = { html: ui.say(T[String(t)]?.NameKey) };
        b[`${name}/Label_Cost`] = { text: "" };
      }
    }
  }

  // the layout's TweenAlphas: UIRestScene.CoroutineRevealFirstMenu (heroes and main page fade in after 0.5 s),
  // CoroutineToRoleSelection (the role panel after the heroes have moved), the skills / inventory pages (0.25 s), the
  // upgrade panel and messages (0.5 s), the role popup (0.2 s, rising 20)
  const anim = withEnter(b, null, {
    "UI_Rest/Panel_Heroes": SLIDE.fade(0.5, 0.5),
    "UI_Rest/Panel_Main": SLIDE.fade(0.5, 0.5),
    "Panel_Heroes/Panel_RoleSelection": SLIDE.fade(0.5, 0.5),
    "UI_Rest/Panel_Skills": SLIDE.fade(0.25),
    "UI_Rest/Panel_Inventory": SLIDE.fade(0.25),
    "Panel_Inventory/Panel_ItemUpgrade": SLIDE.fade(0.5),
    "UI_Rest/Panel_MessagePopup": SLIDE.fade(0.5),
    "Panel_RoleSelection/Sprite_Roles": { from: [0, -20], fade: true, dur: 0.2 },
  });
  return (
    <>
      <RestScene3D area={Number(ui.db.models.AdventureModel?.[String(save.current)]?.RestAreaType ?? 0)} />
      <div className="ngui-wheel" onWheel={(e) => {
        if (inv === "group" && !up) setGroupScroll((v) => Math.max(0, Math.min(Math.max(0, groupRows * GROUP_CELL[1] - 460), v + (e.deltaY > 0 ? GROUP_CELL[1] : -GROUP_CELL[1]))));
        else if (mode === "roles" && roleHero !== null) setRoleScroll((v) => Math.max(0, Math.min(Math.max(0, roles.length * ROLE_ROW - 316), v + (e.deltaY > 0 ? ROLE_ROW : -ROLE_ROW))));
      }}>
        <NguiView layout={ui.layout} atlas={ui.atlas} show={show} binds={anim} say={ui.say} className="ngui-page" />
      </div>
    </>
  );
}
