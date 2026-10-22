// The travel map between adventures (UI_Map, UIMapScene over the map room): chapter and the coming adventure (or the
// alternatives to pick from), Continue zooms to its location with its story and art, Confirm goes to the rest.
import { useMemo, useState } from "react";
import { adventureChoices, chapterOf, type CampaignSave } from "@jime/engine";
import { NguiView, type Binds } from "../../ngui/NguiView.tsx";
import { findNode, type UiNode } from "../../ngui/types.ts";
import { MapRoom3D } from "../../board/MapRoom3D.tsx";
import type { TitleUi } from "../title/common.ts";
import type { ModelArt } from "../../data/pack.ts";

export function MapPage({ ui, save, advArt, onConfirm, onQuit }: {
  ui: TitleUi; save: CampaignSave; advArt: ModelArt;
  /** the chosen adventure (UIMapScene.SwapMainUpcomingAdventure is the caller's) */
  onConfirm: (adv: number) => void;
  onQuit: () => void;
}) {
  const choices = adventureChoices(save);
  const [sel, setSel] = useState(Math.max(0, choices.indexOf(save.current)));
  const [zoomed, setZoomed] = useState(false);
  const [px, setPx] = useState<[number, number] | null>(null);
  const show = useMemo(() => [findNode(ui.layout.root, "UI_Map")].filter(Boolean) as UiNode[], [ui.layout]);
  const adv = choices[sel] ?? save.current;
  const A = ui.db.models.AdventureModel?.[String(adv)] ?? {};
  const many = choices.length > 1;
  const step = (d: number) => setSel((i) => (i + d + choices.length) % choices.length);
  const next = () => (zoomed ? onConfirm(adv) : setZoomed(true));
  const b: Binds = {
    UI_Map: { show: true },
    Widget_TitleCard: { show: !zoomed },
    Label_AdventureTitle: { html: ui.say(A.NameKey) },
    Label_ChapterTitle: { html: ui.say(`UI_CHAPTER_${chapterOf(save)}`) },
    Button_Left: { show: many, onClick: () => step(-1) },
    Button_Right: { show: many, onClick: () => step(1) },
    Widget_AdventureDetails: { show: zoomed },
    Button_LeftDetailed: { show: many, onClick: () => step(-1) },
    Button_RightDetailed: { show: many, onClick: () => step(1) },
    Label_AdventureName: { html: ui.say(A.NameKey) },
    // the rest text a scenario left (SetRestEpilogue), else the adventure's own story
    Label_Epilogue: { html: save.restText ? ui.say(save.restText.key, save.restText.inserts) : ui.say(A.RestStoryKey) },
    Texture_Location: { tex: advArt[String(adv)]?.LocationArt },
    Widget_MapMarker: px && zoomed ? { show: true, atPx: [px[0], px[1] + 30] } : { show: false },
    Label_Location: { html: ui.say(A.LocationKey) },
    Button_Continue: { html: ui.say(zoomed ? "UI_CONFIRM" : "UI_CONTINUE"), onClick: next },
    "Button_Continue/Sprite_Button": { onClick: next },
    "Button_Save&Quit": { onClick: onQuit },
    "Button_Save&Quit/Sprite_Button": { onClick: onQuit },
    Z_InputBlocker: { show: false },
  };
  return (
    <>
      <MapRoom3D view={zoomed ? "zoom" : "map"} focus={adv} completed={save.completed} showRecent={zoomed} onFocusPx={setPx} />
      <NguiView layout={ui.layout} atlas={ui.atlas} show={show} binds={b} say={ui.say} className="ngui-page" />
    </>
  );
}
