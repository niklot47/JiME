// The new-game pages of the original (GameSetupController): campaign -> difficulty -> heroes -> starting items -> party
// name, each drawn from its panel in the exported layout and driven like its controller (CampaignSelectController,
// CampaignDifficultySelection, HeroSelectController, StartingItemController, PartyNameController).
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { itemCounts, itemSubstitutes, type Difficulty } from "@jime/engine";
import { NguiView, type Bind, type Binds } from "../../ngui/NguiView.tsx";
import { findNode, prefabOf, type UiNode } from "../../ngui/types.ts";
import { owns, ownedHeroes, refId, roman, withEnter, type TitleUi } from "./common.ts";

export interface Draft {
  campaign: number | null;
  difficulty: Difficulty | null;
  heroes: number[];
  /** per hero: armor, weapon, second weapon (null = none) */
  items: (number | null)[][];
  partyName: string;
}

export const newDraft = (): Draft => ({ campaign: null, difficulty: null, heroes: [], items: [], partyName: "" });

interface PageProps {
  ui: TitleUi;
  draft: Draft;
  setDraft: (f: (d: Draft) => Draft) => void;
  onBack: () => void;
  onNext: () => void;
}

/** a page: its panel plus the setup's options gear */
function Page({ ui, panel, binds }: { ui: TitleUi; panel: string; binds: Binds }): ReactNode {
  const show = useMemo(() => [findNode(ui.layout.root, panel), findNode(ui.layout.root, "GameSetup/Sprite_Options")].filter(Boolean) as UiNode[], [ui.layout, panel]);
  const all = withEnter({ "GameSetup/Sprite_Options": { show: false }, ...binds }, show[0] ?? null);
  return <NguiView layout={ui.layout} atlas={ui.atlas} show={show} binds={all} say={ui.say} className="ngui-page" />;
}

// ---------------------------------------------------------------- campaign
export function CampaignPage({ ui, draft, setDraft, onBack, onNext, savesFull }: PageProps & { savesFull: boolean }) {
  const C = ui.db.models.CampaignModel ?? {};
  const list = useMemo(() => Object.keys(C).map(Number).sort((a, b) => a - b), [C]);
  const sel = draft.campaign ?? list[0] ?? null;
  const index = sel === null ? -1 : list.indexOf(sel);
  // CampaignSelectController.TranslateCampaignSelection: three cards in view, the bar follows the selection
  const [first, setFirst] = useState(0);
  const start = index < first ? index : index > first + 2 ? index - 2 : first;
  if (start !== first) setFirst(start);
  const select = (id: number) => setDraft((d) => ({ ...d, campaign: id }));
  const m = sel !== null ? C[String(sel)] : null;
  const req = refId(m?.RequiredProduct);
  const reqOk = owns(ui.products, req);
  const card = prefabOf(ui.layout, "CampaignSelectionPrefab");
  const panel = findNode(ui.layout.root, "Panel_CampaignSelection");
  const reqNode = panel ? findNode(panel, "Warning_ProductRequired") : null;
  const reqLabel = reqNode?.ch?.find((c) => c.n === "Label_ProductRequired");
  const productName = req !== null ? ui.raw(ui.db.models.ProductModel?.[String(req)]?.NameKey) : "";
  const b: Binds = {
    Panel_CampaignSelection: { show: true },
    DEBUG_MissionSelect: { show: false }, Restoring_Purchases: { show: false }, CampaignDisplayTest: { show: false },
    Button_RestorePurchase: { show: false }, Button_ClearPurchase: { show: false },
    Sprite_MaxSaves: { show: savesFull },
    Table_CampaignList: card ? { extra: [card] } : {},
    CampaignSelection: {
      clones: list.slice(first, first + 3).map((id, i): Record<string, Bind> => {
        const on = id === sel;
        return {
          CampaignSelection: { onClick: () => select(id), dx: 120 + 240 * i },
          Sprite_CampaignImage: { tex: ui.campaignArt[String(id)]?.ThumbnailImage ?? ui.campaignArt[String(id)]?.Image },
          Sprite_Border: { onClick: () => select(id) },
          Sprite_New: { show: false }, Sprite_Debug: { show: false }, Sprite_Locked: { show: false },
          Sprite_Tutorial: { show: !!Number(C[String(id)]?.HasTutorial ?? 0) },
          // the chosen card: its glows pulse, the sparks of the interior glow's particle system fly off its edges
          Sprite_Highlight_Interior: { show: on, pulse: [1, 0.65, 1.15], particles: SPARKS }, Sprite_Highlight_Exterior: { show: on, pulse: [1, 0.6, 1.15] },
        };
      }),
    },
    // CampaignDisplay (each campaign shown anew): the art fades in (FadeInDisplay), the text's backing slides in from
    // the left (SlideInFrame: TweenPosition -530 -> -205, 0.4 s), then the title and the description fade in
    "CampaignDisplay//Sprite_CampaignImage": { tex: sel !== null ? ui.campaignArt[String(sel)]?.Image : undefined,
      enterKey: sel ?? -1, enter: { fade: true, dur: 0.35, linear: true } },
    "CampaignDisplay//Sprite_Frame": { enterKey: sel ?? -1, enter: { from: [-325, 0], dur: 0.4, delay: 0.2 } },
    "CampaignDisplay//Label_Title": { html: m ? ui.say(m.TitleKey) : "", enterKey: sel ?? -1, enter: { fade: true, dur: 0.35, delay: 0.6, linear: true } },
    "CampaignDisplay//Label_Description": { html: m ? ui.say(m.DescriptionKey) : "", enterKey: sel ?? -1, enter: { fade: true, dur: 0.35, delay: 0.95, linear: true } },
    "CampaignDisplay//Label_Purchase": { show: false },
    "CampaignDisplay//Sprite_Locked": { show: false }, "CampaignDisplay//Sprite_New": { show: false }, "CampaignDisplay//Sprite_Debug": { show: false },
    "CampaignDisplay//Sprite_Tutorial": { show: !!Number(m?.HasTutorial ?? 0) },
    Warning_LanguageUnavailable: { show: false },
    // CampaignDisplay: the required product's box is the warning's own picture (its glow sits behind it)
    Warning_ProductRequired: { show: req !== null, tex: req !== null ? ui.productArt[String(req)]?.Image : undefined },
    ...(reqLabel ? { "Warning_ProductRequired/Label_ProductRequired": { html: ui.say(reqLabel.loc ?? "").replace("PRODUCT_NAME", productName), color: reqOk ? undefined : [1, 0.45, 0.4, 1] } } : {}),
    // CampaignSelectController.SetArrowVisibility
    Sprite_LeftArrow: { show: list.length > 3 && index > 0, onClick: () => select(list[index - 1]!) },
    Sprite_RightArrow: { show: list.length > 3 && index < list.length - 1, onClick: () => select(list[index + 1]!) },
    "Panel_CampaignSelection/Button_Back": { onClick: onBack },
    "Panel_CampaignSelection/Button_Continue": { onClick: () => { if (sel !== null && draft.campaign === null) select(sel); onNext(); }, disabled: sel === null || !reqOk || savesFull },
  };
  return <Page ui={ui} panel="Panel_CampaignSelection" binds={b} />;
}

// ---------------------------------------------------------------- difficulty
const DIFF: { d: Difficulty; node: string; key: string }[] = [
  { d: "normal", node: "Difficulty_Normal", key: "UI_DIFFICULTY_NORMAL" },
  { d: "hard", node: "Difficulty_Hard", key: "UI_DIFFICULTY_HARD" },
  { d: "adventure", node: "Difficulty_Adventure", key: "UI_DIFFICULTY_ADVENTURE" },
];

/** CoroutineShow's entrances: where each comes from and where it meets the others (offsets from its place) */
const ENTRY: Record<Difficulty, { from: [number, number]; via: [number, number] }> = {
  // the two below come straight across and meet edge to edge, the top one comes down onto them
  normal: { from: [-665, 0], via: [16, 0] },
  hard: { from: [665, 0], via: [-16, 0] },
  adventure: { from: [0, 670], via: [0, -40] },
};
/** the sparks around a chosen campaign / difficulty: a little sparser and slower than the system's own numbers, behind
 *  the picture */
const SPARKS = { rate: 0.8, speed: 0.6, behind: true };
/** the difficulties' entrance (CoroutineShow), the effects stay hidden until it is over */
const ENTRY_S = 1.5;

export function DifficultyPage({ ui, draft, setDraft, onBack, onNext }: PageProps) {
  const d = draft.difficulty;
  const [landed, setLanded] = useState(false);
  useEffect(() => { const t = setTimeout(() => setLanded(true), ENTRY_S * 1000); return () => clearTimeout(t); }, []);
  const cur = DIFF.find((x) => x.d === d);
  // clicking the chosen one again unselects it (CampaignDifficultySelection.OnNormalClicked ...)
  const pick = (x: Difficulty) => setDraft((s) => ({ ...s, difficulty: s.difficulty === x ? null : x }));
  const b: Binds = {
    Panel_DifficultySelection: { show: true },
    Label_Difficulty: { show: !!cur, html: cur ? ui.say(cur.key) : "" },
    Label_Description: { html: ui.say(cur ? `${cur.key}_DESC` : "UI_DIFFICULTY_DESCRIPTION") },
    "Widget_DifficultySelection/Button_Back": { onClick: onBack },
    "Widget_DifficultySelection/Button_Continue": { onClick: onNext, disabled: !d },
  };
  for (const x of DIFF) {
    const on = d === x.d;
    // CoroutineShow: the three fly in (TweenPosition, 0.9 s) - from the left, the right and the top - meet near the
    // middle with a shake (CoroutineKnockingAnimation: iTween.ShakeRotation) and settle on their places.
    // DifficultyToggle: the chosen one grows (TweenScale 1.6 -> 1.75, 0.35 s) above the others, its effects fade in
    const e = ENTRY[x.d];
    b[x.node] = { depth: on ? 9 : x.d === "normal" ? 8 : 7, scale: on ? 1.75 : 1.6, move: 0.35,
      enter: { from: e.from, via: e.via, viaAt: 0.4, holdTo: 0.62, dur: 1.4, delay: 0.1, shake: { deg: 3, delay: 0.56, dur: 0.4 } } };
    // the pictures are layered pieces: no hover tint (one piece lighting up at a time looks like flicker)
    b[`${x.node}//#art`] = { onClick: () => pick(x.d), className: "ng-nohover" };
    b[`${x.node}/Effects`] = { show: on && landed, enter: { fade: true, dur: 0.35, linear: true }, particles: x.d === "hard" ? true : SPARKS };
  }
  // the materials' motion: the light behind the orc falls through its mask (down, a little to the left), the clouds
  // drift left and a little down, lighter
  b["Main_Mask//#art"] = { onClick: () => pick("normal"), className: "ng-nohover", fxScroll: { dx: -1, dy: 3, dur: 45 } };
  b["Clouds//#art"] = { onClick: () => pick("adventure"), className: "ng-nohover", fxScroll: { dx: -2, dy: 1, dur: 80, opacity: 0.7, tile: 0.6 } };
  return <Page ui={ui} panel="Panel_DifficultySelection" binds={b} />;
}

// ---------------------------------------------------------------- heroes
const MAX_PARTY = 5;
const IN_VIEW = 5;

export function HeroesPage({ ui, draft, setDraft, onBack, onNext }: PageProps) {
  const heroes = useMemo(() => ownedHeroes(ui), [ui]);
  const [first, setFirst] = useState(0);
  const H = ui.db.models.HeroModel ?? {};
  const toggle = (id: number) => setDraft((d) => {
    if (d.heroes.includes(id)) return { ...d, heroes: d.heroes.filter((x) => x !== id) };
    return d.heroes.length >= MAX_PARTY ? d : { ...d, heroes: [...d.heroes, id] };
  });
  const slot = prefabOf(ui.layout, "SelectionSlotPrefab");
  const b: Binds = {
    Panel_HeroSelection: { show: true },
    "Widget_HeroSelection/Scroll View": slot ? { extra: [slot] } : {},
    HeroSelectionSlot: {
      clones: heroes.slice(first, first + IN_VIEW).map((id, i): Record<string, Bind> => ({
        // UICenterOnChild keeps the portraits around the middle of the view (the prefab's art sits 93 left of its root)
        // the slot's root sits 93 right of its art and overlaps the next portrait: the frame and portrait take the clicks
        HeroSelectionSlot: { dx: (i - (IN_VIEW - 1) / 2) * 186 + 93, dy: 70 },
        Sprite_Border: { onClick: () => toggle(id) },
        Label_HeroName: { html: ui.say(H[String(id)]?.NameKey) },
        Hero_Image: { tex: ui.heroArt[String(id)]?.portrait, onClick: () => toggle(id) },
        Sprite_GlowInterior: { show: draft.heroes.includes(id) },
      })),
    },
    Button_Left: { onClick: () => setFirst((f) => Math.max(0, f - 1)), disabled: first <= 0 },
    Button_Right: { onClick: () => setFirst((f) => Math.min(Math.max(0, heroes.length - IN_VIEW), f + 1)), disabled: first >= heroes.length - IN_VIEW },
    "Widget_HeroSelection/Button_Back": { onClick: onBack },
    // HeroSelectController: at least two heroes
    "Widget_HeroSelection/Button_Continue": { onClick: onNext, disabled: draft.heroes.length < 2 },
  };
  for (let k = 0; k < MAX_PARTY; k++) {
    const name = k ? `HeroPartySlot (${k})` : "HeroPartySlot";
    const id = draft.heroes[k];
    b[name] = { onClick: id !== undefined ? () => toggle(id) : undefined };
    b[`${name}/Hero_Image`] = { show: id !== undefined, tex: id !== undefined ? ui.heroArt[String(id)]?.icon : undefined };
  }
  return <Page ui={ui} panel="Panel_HeroSelection" binds={b} />;
}

// ---------------------------------------------------------------- starting items
/** ItemSelectionSlot.DisplayHero: the hero's default armor / weapon / second weapon while copies are left */
export function defaultItems(ui: TitleUi, heroes: number[]): (number | null)[][] {
  const max = itemCounts(ui.db, ui.products);
  const used = new Map<number, number>();
  const take = (id: number | null) => {
    if (id === null) return null;
    if ((used.get(id) ?? 0) >= (max.get(id) ?? 0)) return null;
    used.set(id, (used.get(id) ?? 0) + 1);
    return id;
  };
  return heroes.map((h) => {
    const m = ui.db.models.HeroModel?.[String(h)] ?? {};
    return [take(refId(m.DefaultArmor)), take(refId(m.DefaultWeapon)), take(refId(m.DefaultSecondWeapon))];
  });
}

/** row height of the replacement list (the saved item views' spacing) */
const ROW_REP = 79.74;

const isHobbit = (ui: TitleUi, h: number) => (Number(ui.db.models.HeroModel?.[String(h)]?.Traits ?? 0) & 8) !== 0;

export function ItemsPage({ ui, draft, setDraft, onBack, onNext }: PageProps) {
  const I = ui.db.models.ItemModel ?? {};
  const H = ui.db.models.HeroModel ?? {};
  const [rep, setRep] = useState<{ hero: number; slot: number } | null>(null);
  const [scroll, setScroll] = useState(0);
  const items = draft.items;
  const n = draft.heroes.length;
  const twoHanded = (id: number | null) => id !== null && !!Number(I[String(id)]?.Is2Handed ?? 0);
  const miniView = (id: number | null): Record<string, Bind> => {
    const m = id !== null ? I[String(id)] : null;
    return {
      Sprite_Image: { show: !!m, tex: id !== null ? ui.itemArt[String(id)]?.Icon : undefined },
      Label_ItemName: { show: !!m, html: m ? ui.say(m.NameKey) : "" },
      Label_NoneSelected: { show: !m },
      Sprite_Level: { show: !!m },
      Label_Level: { text: m ? roman(Number(m.Level ?? 1)) : "" },
      Sprite_IconType: { show: twoHanded(id) },
      Sprite_SelectedHighlight: { show: false },
    };
  };
  // StartingItemController.OnReplacementSelected
  const choose = (hero: number, slot: number, id: number) => {
    setDraft((d) => {
      const all = d.items.map((r) => [...r]);
      const row = all[hero]!;
      if (slot > 0 && twoHanded(id)) { row[1] = id; row[2] = null; }
      else row[slot] = id;
      return { ...d, items: all };
    });
    setRep(null);
  };
  const subs = rep ? itemSubstitutes(ui.db, items.map((r) => r.filter((x): x is number => x !== null)), draft.heroes[rep.hero]!,
    rep.slot === 0 ? "armor" : "weapon", items[rep.hero]?.[rep.slot] ?? null, ui.products) : [];
  const repItem = rep ? items[rep.hero]?.[rep.slot] ?? null : null;
  // the heroes' columns centred on the screen for fewer than five (the saved layout holds five)
  const shift = ((5 - n) * 186) / 2;
  const b: Binds = {
    Panel_StartingItems: { show: true },
    ItemSelectionSlot: {
      clones: draft.heroes.map((h, i): Record<string, Bind> => ({
        ItemSelectionSlot: { dx: i * 186.1 + shift },
        Label_HeroName: { html: ui.say(H[String(h)]?.NameKey) },
        Hero_Image: { tex: ui.heroArt[String(h)]?.portrait },
      })),
    },
    ItemSlot: {
      clones: draft.heroes.map((h, i): Record<string, Bind> => {
        const row = items[i] ?? [null, null, null];
        const out: Record<string, Bind> = { ItemSlot: { dx: i * 186.07 + shift } };
        // the second weapon: hidden while the first is two-handed, and for hobbits without one
        const second = !twoHanded(row[1] ?? null) && (row[2] !== null || !isHobbit(ui, h));
        ["Item_MiniView", "Item_MiniView (1)", "Item_MiniView (2)"].forEach((mv, j) => {
          const v = miniView(row[j] ?? null);
          out[mv] = { onClick: () => { setScroll(0); setRep({ hero: i, slot: j }); }, show: j < 2 || second };
          for (const [k, bind] of Object.entries(v)) out[`${mv}//${k}`] = bind;
        });
        return out;
      }),
    },
    Panel_ItemReplacement: { show: !!rep },
    "Panel_ItemReplacement//Z_Darkening": { onClick: () => setRep(null) },
    Label_Instructions: {
      html: rep && repItem === null ? ui.say(rep.slot === 0 ? "UI_REPLACE_ARMOR" : "UI_REPLACE_ITEM")
        : repItem !== null ? ui.say("UI_REPLACE_ITEM_FORMAT", [I[String(repItem)]?.NameKey ?? ""]) : "",
    },
    // the replacement list: the table's first (inactive) item view repeated per substitute, scrolled by the wheel
    "Table/Item_MiniView": {
      show: true,
      dy: scroll,
      step: [0, -ROW_REP],
      clones: subs.map((id): Record<string, Bind> => {
        const v = miniView(id);
        const out: Record<string, Bind> = { Item_MiniView: { onClick: () => choose(rep!.hero, rep!.slot, id) } };
        for (const [k, bind] of Object.entries(v)) out[`Item_MiniView//${k}`] = bind;
        return out;
      }),
    },
    "Panel_StartingItems/Button_Back": { onClick: onBack },
    "Panel_StartingItems/Button_Continue": { onClick: onNext },
  };
  for (let k = 1; k < 5; k++) { b[`ItemSelectionSlot (${k})`] = { show: false }; b[`ItemSlot (${k})`] = { show: false }; }
  return (
    <div className="ngui-wheel" onWheel={(e) => { if (rep) setScroll((s) => Math.max(0, Math.min(Math.max(0, subs.length * ROW_REP - 390), s + (e.deltaY > 0 ? ROW_REP : -ROW_REP)))); }}>
      <Page ui={ui} panel="Panel_StartingItems" binds={b} />
    </div>
  );
}

// ---------------------------------------------------------------- party name
export function PartyNamePage({ ui, draft, setDraft, onBack, onNext }: PageProps) {
  const [warn, setWarn] = useState(false);
  // confirmed: the field goes at once (the page stays under the curtain a moment longer)
  const [done, setDone] = useState(false);
  const confirm = () => { if (!draft.partyName.trim()) { setWarn(true); return; } setDone(true); onNext(); };
  const b: Binds = {
    Panel_PartyName: { show: true },
    Label_GroupName: {
      html: "",
      content: done ? null : <input className="ng-input" maxLength={24} autoFocus value={draft.partyName} placeholder={ui.raw("UI_ENTER_PARTY_NAME")}
        onChange={(e) => { setWarn(false); setDraft((d) => ({ ...d, partyName: e.target.value })); }}
        onKeyDown={(e) => { if (e.key === "Enter") confirm(); }} />,
    },
    Name_Warning: { show: warn, onClick: () => setWarn(false) },
    "Panel_PartyName/Button_Back": { onClick: onBack },
    // PartyNameController.OnButtonContinue: the default name is not accepted
    "Panel_PartyName/Button_Continue": { onClick: done ? undefined : confirm },
  };
  return <Page ui={ui} panel="Panel_PartyName" binds={b} />;
}
