// The travel map between adventures (UI_Map, UIMapScene over the map room): chapter and the coming adventure (or the
// alternatives to pick from), Continue zooms to its location with its story and art, Confirm goes to the rest.
import { useEffect, useMemo, useState } from "react";
import { adventureChoices, chapterOf, type CampaignSave } from "@jime/engine";
import { NguiView, type Binds } from "../../ngui/NguiView.tsx";
import { findNode, type UiNode } from "../../ngui/types.ts";
import { MapRoom3D } from "../../board/MapRoom3D.tsx";
import { SLIDE, withEnter, type TitleUi } from "../title/common.ts";
import { assetUrl, type ModelArt } from "../../data/pack.ts";

/** pictures loaded and decoded ahead, kept (an unreferenced Image may be dropped before it is ever shown) */
const warm = new Map<string, HTMLImageElement>();
function preload(src: string): void {
  if (warm.has(src)) return;
  const i = new Image();
  i.decoding = "async";
  i.src = src;
  warm.set(src, i);
  void i.decode?.().catch(() => {});
}

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
  // UIMapScene.CoroutineDisplayLocationName: "Confirm" 2 s after the zoom, the location marker 1.25 s later
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!zoomed) return;
    const t = setTimeout(() => setConfirm(true), 2000);
    return () => clearTimeout(t);
  }, [zoomed]);
  // the alternatives' pictures loaded ahead (the arrows switch them without a gap under the text)
  useEffect(() => {
    for (const a of choices) {
      const t = advArt[String(a)]?.LocationArt;
      if (t) preload(assetUrl(t));
    }
  }, [choices.join(","), advArt]); // eslint-disable-line react-hooks/exhaustive-deps
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
    // (black under the picture while it loads)
    Texture_Location: { tex: advArt[String(adv)]?.LocationArt, className: "ng-black" },
    Widget_MapMarker: px && zoomed ? { show: true, atPx: [px[0], px[1] + 30] } : { show: false },
    Label_Location: { html: ui.say(A.LocationKey) },
    Button_Continue: { html: ui.say(confirm ? "UI_CONFIRM" : "UI_CONTINUE"), onClick: next },
    "Button_Continue/Sprite_Button": { onClick: next },
    "Button_Save&Quit": { onClick: onQuit },
    "Button_Save&Quit/Sprite_Button": { onClick: onQuit },
    Z_InputBlocker: { show: false },
  };
  // the map's UI fades in over the map room; zooming in (Map_UI_ZoomIn) brings the adventure's details in while the
  // camera flies, the location marker fades in last (its TweenAlpha, 0.5 s)
  const anim = withEnter(b, null, {
    "UI_Map/Widget_TitleCard": SLIDE.fade(0.5, 0.3),
    "UI_Map/Widget_AdventureDetails": { from: [-60, 0], fade: true, dur: 0.6, delay: 0.6 },
    "UI_Map/Widget_MapMarker": SLIDE.fade(0.5, 3.25),
  });
  return (
    <>
      <MapRoom3D view={zoomed ? "zoom" : "map"} focus={adv} completed={save.completed} showRecent={zoomed} onFocusPx={setPx} />
      <NguiView layout={ui.layout} atlas={ui.atlas} show={show} binds={anim} say={ui.say} className="ngui-page" />
    </>
  );
}
