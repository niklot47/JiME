// A campaign being played (LevelLoader's scenes): the travel map, the rest, the adventure in progress (GameScreen with
// the campaign), the end of the campaign. Every change is written to the campaign's save slot.
import { useEffect, useState } from "react";
import { beginAdventure, chooseAdventure, type CampaignSave } from "@jime/engine";
import { GameScreen } from "./GameScreen.tsx";
import { useLang } from "../data/lang.ts";
import { sound } from "../audio/sound.ts";
import { putSave } from "../campaign/store.ts";
import { useTitleUi } from "./title/useTitleUi.ts";
import { MapPage } from "./campaign/MapPage.tsx";
import { RestPage } from "./campaign/RestPage.tsx";
import { CutscenePage, endingCutscene } from "./campaign/CutscenePage.tsx";
import { sceneTransition } from "../ui/curtain.tsx";
import { useLook } from "./menu/look.ts";
import { useMenuData } from "./menu/useMenuData.ts";
import { PlainCutscene, PlainEnding, PlainMap, PlainRest } from "./menu/PlainCampaign.tsx";

interface CampaignProps {
  save: CampaignSave;
  /** a new campaign: its prologue first (LevelLoader.CoroutineTitlescreenToRestScene) */
  intro?: boolean;
  onBack: () => void;
}

/** The original's pages or this app's own (screens/menu/PlainCampaign.tsx) */
export function CampaignScreen(props: CampaignProps) {
  const look = useLook();
  if (look === "loading") return <div className="title-screen" />;
  return look === "original" ? <OriginalCampaign {...props} /> : <PlainCampaignScreen {...props} />;
}

function PlainCampaignScreen({ save: initial, intro = false, onBack }: CampaignProps) {
  const [save, setSave] = useState(initial);
  const [scene, setScene] = useState<"prologue" | "map" | "rest">(intro ? "prologue" : "map");
  const lang = useLang();
  const { ui, error } = useMenuData(lang);
  const keep = (s: CampaignSave) => { putSave(s); setSave(s); };
  const fade = (f: () => void) => { void sceneTransition(f); };
  const toTitle = () => fade(onBack);
  const resting = save.status === "rest";
  useEffect(() => {
    if (!resting || scene === "prologue") return;
    sound.music(scene === "map" ? "NewGameMusic" : "RestsceneMusic");
    sound.ambient(scene === "rest" ? "ForestAmbient" : null);
  }, [resting, scene]);
  if (save.status === "adventure" && save.game) {
    return <GameScreen key={`${save.slot}:${save.completed.length}:${save.game.seed}`} onBack={toTitle}
      campaign={{ save, onSave: putSave, onFinish: (s) => fade(() => { keep(s); setScene("map"); }) }} />;
  }
  if (error) return <div className="shell"><p className="error">{error}</p><button className="link" onClick={onBack}>← Меню</button></div>;
  if (!ui) return <div className="pm-screen" />;
  const C = ui.db.models.CampaignModel?.[String(save.campaign)];
  const title = ui.raw(C?.TitleKey);
  if (!resting) {
    const id = endingCutscene(C, save.status === "victory", save.cutscene);
    return id !== null ? <PlainCutscene ui={ui} cutscene={id} title={title} onDone={toTitle} /> : <PlainEnding won={save.status === "victory"} onDone={toTitle} />;
  }
  const prologue = C?.CutscenePrologue?.id;
  if (scene === "prologue" && prologue !== undefined) return <PlainCutscene ui={ui} cutscene={Number(prologue)} title={title} onDone={() => fade(() => setScene("map"))} />;
  return scene === "map"
    ? <PlainMap ui={ui} save={save} onQuit={toTitle}
        onConfirm={(adv) => fade(() => { const s = structuredClone(save); chooseAdventure(s, adv); s.savedAt = new Date().toISOString(); keep(s); setScene("rest"); })} />
    : <PlainRest ui={ui} save={save} onChange={keep} onMap={() => fade(() => setScene("map"))} onQuit={toTitle}
        onEmbark={(s) => fade(() => { beginAdventure(s); keep(s); })} />;
}

function OriginalCampaign({ save: initial, intro = false, onBack }: CampaignProps) {
  const [save, setSave] = useState(initial);
  // LevelLoader.CoroutineGameToRestScene / TitlescreenToRestScene: the map first, then the rest
  const [scene, setScene] = useState<"prologue" | "map" | "rest">(intro ? "prologue" : "map");
  const lang = useLang();
  const { ui, adventures, cutscenes, error } = useTitleUi(lang);
  const keep = (s: CampaignSave) => { putSave(s); setSave(s); };
  // LevelLoader's scene changes go through the black curtain (SceneTransitioner)
  const fade = (f: () => void) => { void sceneTransition(f); };
  const toTitle = () => fade(onBack);
  const resting = save.status === "rest";
  // AudioController.PlayMapMusic / PlayRestsceneAmbient
  useEffect(() => {
    if (!resting || scene === "prologue") return;
    const cave = Number(ui?.db.models.AdventureModel?.[String(save.current)]?.RestAreaType ?? 0) === 1;
    sound.music(scene === "map" ? "NewGameMusic" : "RestsceneMusic");
    sound.ambient(scene === "rest" ? (cave ? "CaveAmbient" : "ForestAmbient") : null);
  }, [resting, scene, save.current, ui]); // eslint-disable-line react-hooks/exhaustive-deps

  if (save.status === "adventure" && save.game) {
    return <GameScreen key={`${save.slot}:${save.completed.length}:${save.game.seed}`} onBack={toTitle}
      campaign={{ save, onSave: putSave, onFinish: (s) => fade(() => { keep(s); setScene("map"); }) }} />;
  }
  if (error) return <div className="shell"><p className="error">{error}</p><button className="link" onClick={onBack}>← Меню</button></div>;
  if (!ui) return <div className="title-screen" />;
  const C = ui.db.models.CampaignModel?.[String(save.campaign)];
  if (!resting) {
    // LevelLoader.CoroutineGameToTitlescreen: the campaign's ending, then the title screen
    const id = endingCutscene(C, save.status === "victory", save.cutscene);
    return (
      <div className="title-screen">
        {id !== null && <CutscenePage ui={ui} cutscene={id} titleKey={C?.TitleKey ?? ""} isNew={false} art={cutscenes} onDone={toTitle} />}
        {id === null && <div className="shell"><h3>{save.status === "victory" ? "Победа" : "Поражение"}</h3><button className="link" onClick={onBack}>← Меню</button></div>}
      </div>
    );
  }
  const prologue = C?.CutscenePrologue?.id;
  if (scene === "prologue" && prologue !== undefined) {
    return (
      <div className="title-screen">
        <CutscenePage ui={ui} cutscene={Number(prologue)} titleKey={C?.TitleKey ?? ""} isNew art={cutscenes} onDone={() => fade(() => setScene("map"))} />
      </div>
    );
  }
  return (
    <div className="title-screen">
      {scene === "map"
        ? <MapPage ui={ui} save={save} advArt={adventures} onQuit={toTitle}
            onConfirm={(adv) => fade(() => { const s = structuredClone(save); chooseAdventure(s, adv); s.savedAt = new Date().toISOString(); keep(s); setScene("rest"); })} />
        : <RestPage ui={ui} save={save} onChange={keep} onMap={() => fade(() => setScene("map"))} onQuit={toTitle}
            onEmbark={(s) => fade(() => { beginAdventure(s); keep(s); })} />}
    </div>
  );
}
