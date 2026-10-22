// A campaign cutscene (UI_Cutscene, FFG.JIME.CutsceneController): the picture across the screen, the campaign title
// and the story on the left, its music; Continue ("Embark" for the prologue, "Ending" at the end of the campaign).
import { useEffect, useMemo } from "react";
import { NguiView, type Binds } from "../../ngui/NguiView.tsx";
import { findNode, type UiNode } from "../../ngui/types.ts";
import { sound } from "../../audio/sound.ts";
import { SLIDE, withEnter, type TitleUi } from "../title/common.ts";
import type { ModelArt } from "../../data/pack.ts";

/** CampaignModel cutscene id for the end of a campaign: SetNextCutsceneId's override (among CutsceneExtras), else victory / defeat */
export function endingCutscene(campaign: any, victory: boolean, override: number): number | null {
  const ref = (v: any) => (v && v.id !== undefined ? Number(v.id) : null);
  const extra = (campaign?.CutsceneExtras ?? []).map(ref).find((id: number | null) => id === override && override >= 0);
  return extra ?? ref(victory ? campaign?.CutsceneVictory : campaign?.CutsceneDefeat);
}

export function CutscenePage({ ui, cutscene, titleKey, isNew, art, onDone }: {
  ui: TitleUi; cutscene: number; titleKey: string; isNew: boolean; art: ModelArt; onDone: () => void;
}) {
  const m = ui.db.models.CutsceneModel?.[String(cutscene)];
  const show = useMemo(() => [findNode(ui.layout.root, "UI_Cutscene")].filter(Boolean) as UiNode[], [ui.layout]);
  // AudioController.PlayCutsceneMusic: the cutscene's own clip
  const clip = String(m?.MusicClip?.Path ?? "").split("/").pop()?.replace(/\.[a-z0-9]+$/i, "") ?? "";
  useEffect(() => { if (clip) sound.music(`clip:${clip}`); }, [clip]);
  const b: Binds = {
    UI_Cutscene: { show: true },
    Cutscene_Image: { tex: art[String(cutscene)]?.Texture },
    Cutscene_Title: { html: ui.say(titleKey) },
    // the title font is tight for long text: a little more room between letters
    Cutscene_Text: { html: m ? ui.say(m.TextKey) : "", className: "ng-loose" },
    Label_Continue: { html: ui.say(isNew ? "UI_EMBARK" : "UI_ENDING") },
    "UI_Cutscene/Button_Continue": { onClick: onDone },
  };
  // CutsceneController: the text panel slides in from the left (farther), its text fades in, then Continue from the right
  const anim = withEnter(b, null, {
    "UI_Cutscene/Panel_Art": SLIDE.fade(0.7),
    "UI_Cutscene/Sprite_Text_BG": SLIDE.left(true, 0.3),
    "Sprite_Text_BG/WidgetContainer": SLIDE.fade(0.7, 1.0),
    "UI_Cutscene/Button_Continue": SLIDE.right(1.7),
  });
  return <NguiView layout={ui.layout} atlas={ui.atlas} show={show} binds={anim} say={ui.say} className="ngui-page" />;
}
