// "Load game" (SavedGameController / SaveSlot): the saved campaigns as slots - party name, campaign and chapter, date,
// difficulty, hero icons. A click selects a slot and slides its tabs out: resume, delete (with a warning) and, when an
// adventure is in progress, "reset adventure" (back to before it, with a warning).
import { useMemo, useState } from "react";
import { chapterOf, type CampaignSave } from "@jime/engine";
import { NguiView, type Bind, type Binds } from "../../ngui/NguiView.tsx";
import { findNode, prefabOf, type UiNode } from "../../ngui/types.ts";
import type { TitleUi } from "./common.ts";

const DIFF_KEY: Record<string, string> = { normal: "UI_DIFFICULTY_NORMAL", hard: "UI_DIFFICULTY_HARD", adventure: "UI_DIFFICULTY_ADVENTURE" };
const ROW = 114;
const IN_VIEW = 4;

function when(iso: string, lang: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  // SaveSlot: MM/dd for English, dd/MM otherwise
  const date = lang === "en" ? `${p(d.getMonth() + 1)}/${p(d.getDate())}` : `${p(d.getDate())}/${p(d.getMonth() + 1)}`;
  return `${date}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function SaveSlotsPage({ ui, saves, onBack, onResume, onDelete, onReset }: {
  ui: TitleUi; saves: CampaignSave[]; onBack: () => void; onResume: (s: CampaignSave) => void; onDelete: (s: CampaignSave) => void; onReset: (s: CampaignSave) => void;
}) {
  const [sel, setSel] = useState<string | null>(null);
  const [ask, setAsk] = useState<null | "delete" | "reset">(null);
  const [first, setFirst] = useState(0);
  const show = useMemo(() => [findNode(ui.layout.root, "Panel_SaveSlots")].filter(Boolean) as UiNode[], [ui.layout]);
  const slot = prefabOf(ui.layout, "Widget_SaveSlots/PrefabPool.Prefab");
  const C = ui.db.models.CampaignModel ?? {};
  const chosen = saves.find((s) => s.slot === sel) ?? null;
  const visible = saves.slice(first, first + IN_VIEW);
  const b: Binds = {
    Panel_SaveSlots: { show: true },
    Label_SelectSaveSlot: { html: ui.say("UI_SAVESLOT_LOAD") },
    Grid_SaveSlots: slot ? { extra: [slot] } : {},
    SaveSlotItem: {
      dy: 0,
      clones: visible.map((s, i): Record<string, Bind> => {
        const on = s.slot === sel;
        const camp = C[String(s.campaign)];
        const out: Record<string, Bind> = {
          SaveSlotItem: { onClick: () => setSel(on ? null : s.slot), dy: -ROW * i },
          Label_Empty: { show: false },
          TweenHighlightInterior: { show: on },
          TweenDarkener: { show: on },
          Label_PartyName: { text: s.partyName },
          Label_Campaign: { html: `${camp ? ui.say(camp.TitleKey) : ""} - ${ui.say("UI_CHAPTER_ABBREVIATED")}${chapterOf(s)}` },
          Label_DateTime: { text: when(s.savedAt, ui.lang) },
          Label_Difficulty: { html: ui.say(DIFF_KEY[s.difficulty] ?? "UI_DIFFICULTY_NORMAL") },
          AsmoConnectAssistance: { show: false },
          "SlotInformation/Sprite_AsmoConnect": { show: false },
          "Label_SlotNum (0)": { show: false },
          MiddleContent: { show: true },
          // the tabs wait outside the slot (cut off by the list's clipping) and slide in over the selected one
          Button_ResumeTab: on ? { onClick: () => onResume(s) } : { at: [489, 0] },
          Button_DeleteTab: on ? { onClick: () => setAsk("delete") } : { at: [-489, 0] },
          Button_ResetTab: { show: !!s.game, ...(on ? { onClick: () => setAsk("reset") } : { at: [-489, 0] }) },
        };
        for (let k = 0; k < 5; k++) {
          const name = k ? `HeroMiniView (${k})` : "HeroMiniView";
          const h = s.heroes[k];
          out[name] = { show: !!h };
          out[`${name}/SpriteHero`] = { tex: h ? ui.heroArt[String(h.hero)]?.icon : undefined };
        }
        return out;
      }),
    },
    Sprite_Selected: { show: false },
    "Widget_SaveSlots/Button_Continue": { show: false },
    "Widget_SaveSlots/Button_Back": { onClick: onBack },
    Panel_MissingProducts: { show: false }, Panel_AddProductsToSave: { show: false },
    Dialog_DeleteWarning: { show: ask === "delete" },
    "Dialog_DeleteWarning/Button_Cancel": { onClick: () => setAsk(null) },
    "Dialog_DeleteWarning/Button_Confirm": { onClick: () => { setAsk(null); setSel(null); if (chosen) onDelete(chosen); } },
    Dialog_ResetWarning: { show: ask === "reset" },
    "Dialog_ResetWarning/Button_Cancel": { onClick: () => setAsk(null) },
    "Dialog_ResetWarning/Button_Confirm": { onClick: () => { setAsk(null); if (chosen) onReset(chosen); } },
  };
  return (
    <div className="ngui-wheel" onWheel={(e) => setFirst((f) => Math.max(0, Math.min(Math.max(0, saves.length - IN_VIEW), f + (e.deltaY > 0 ? 1 : -1))))}>
      <NguiView layout={ui.layout} atlas={ui.atlas} show={show} binds={b} say={ui.say} className="ngui-page" />
    </div>
  );
}
