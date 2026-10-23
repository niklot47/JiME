// The original's title screen (Panel_Titlescreen/Titlescreen: StartUpMenuController) and what its buttons open: the
// new-game pages (GameSetupController), the saved games (SavedGameController) and the options. A new campaign is
// written to a save slot and handed to the app to play.
import { useEffect, useMemo, useState } from "react";
import { ENGINE_VERSION, newCampaignSave, resetAdventure, type CampaignSave, type ContentSource } from "@jime/engine";
import type { TextDb } from "@jime/content-tools/text";
import { NguiView, type Binds } from "../../ngui/NguiView.tsx";
import { findNode, type UiLayoutFile, type UiNode } from "../../ngui/types.ts";
import { NguiMenu } from "../game/NguiMenu.tsx";
import { installFonts, loadDb, loadHeroArt, loadModelArt, loadPackSet, loadText, loadUiArt, loadUiAtlas, loadUiLayout, assetUrl, type AtlasSprite, type HeroArt, type ModelArt } from "../../data/pack.ts";
import { quitApp, inTauri, openUrl } from "../../data/host.ts";
import { setLang, useLang } from "../../data/lang.ts";
import { textHtml } from "../../text/markup.ts";
import { sound } from "../../audio/sound.ts";
import { MAX_SAVES, deleteSave, listSaves, ownedProducts, putSave, setOwnedProducts } from "../../campaign/store.ts";
import { SLIDE, textOf, withEnter, type TitleUi } from "./common.ts";

/** StartUpMenuController: the long animation once per run (CoroutineStartUpAnimation), later a short fade */
let titleShown = false;
import { CampaignPage, DifficultyPage, HeroesPage, ItemsPage, PartyNamePage, defaultItems, newDraft, type Draft } from "./NewGamePages.tsx";
import { SaveSlotsPage } from "./SaveSlotsPage.tsx";
import { CollectionPage } from "./CollectionPage.tsx";
import { TitleScene3D } from "../../board/TitleScene3D.tsx";
import { MapRoom3D } from "../../board/MapRoom3D.tsx";
import { sceneTransition, useLeave } from "../../ui/curtain.tsx";

type Page = "title" | "campaign" | "difficulty" | "heroes" | "items" | "party" | "load" | "options" | "collection";

export function TitleScreen({ onPlay, onTools }: {
  /** play a campaign save (new or loaded) */
  onPlay: (s: CampaignSave, intro?: boolean) => void;
  /** this app's developer screens (packs, map, interface preview ...) */
  onTools: () => void;
}) {
  const lang = useLang();
  const [layout, setLayout] = useState<UiLayoutFile | null>(null);
  const [atlas, setAtlas] = useState<Record<string, AtlasSprite>>({});
  const [db, setDb] = useState<any>(null);
  const [text, setText] = useState<TextDb | null>(null);
  const [english, setEnglish] = useState<TextDb | null>(null);
  const [heroArt, setHeroArt] = useState<Record<string, HeroArt>>({});
  const [art, setArt] = useState<{ campaigns: ModelArt; items: ModelArt; products: ModelArt }>({ campaigns: {}, items: {}, products: {} });
  const [langs, setLangs] = useState(["ru", "en", "it"]);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<Page>("title");
  const [draft, setDraft] = useState<Draft>(newDraft);
  const [saves, setSaves] = useState<CampaignSave[]>(() => listSaves());
  const [owned, setOwned] = useState<number[] | undefined>(() => ownedProducts());
  const [back, setBack] = useState<Page>("title");
  const [leaving, leave] = useLeave();
  // LevelLoader.TitlescreenToRestScene: the curtain, then the campaign
  const play = (s: CampaignSave, intro?: boolean) => { void sceneTransition(() => onPlay(s, intro)); };

  useEffect(() => {
    void installFonts();
    Promise.all([loadUiLayout(), loadUiAtlas(), loadDb(), loadHeroArt(), loadModelArt("campaigns"), loadModelArt("items"), loadModelArt("products")])
      .then(([l, a, d, h, c, i, p]) => { setLayout(l); setAtlas(a); setDb(d); setHeroArt(h); setArt({ campaigns: c, items: i, products: p }); })
      .catch((e) => setError(String(e)));
    loadPackSet().then((s) => { if (s.langs.length) setLangs(s.langs); }).catch(() => {});
    loadText("en").then(setEnglish).catch(() => setEnglish(null));
  }, []);
  useEffect(() => { loadText(lang).then(setText).catch((e) => setError(String(e))); }, [lang]);
  // the title music; the new-game pages have their own (AudioController.PlayNewGameMusic)
  useEffect(() => { sound.music(page === "title" || page === "load" || page === "options" || page === "collection" ? "TitlescreenMusic" : "NewGameMusic"); }, [page]);

  const ui = useMemo((): TitleUi | null => {
    if (!layout || !db || !text) return null;
    return {
      layout, atlas, db, heroArt, lang, products: owned,
      campaignArt: art.campaigns, itemArt: art.items, productArt: art.products,
      say: (k, ins = []) => (k ? textHtml(text, k, ins, lang === "en" ? null : english) : ""),
      raw: textOf(text, english),
    };
  }, [layout, atlas, db, text, english, heroArt, art, lang, owned]);

  if (error) return <div className="shell"><p className="error">{error}</p><button onClick={onTools}>Инструменты</button></div>;
  // (dark while loading: the original opens on black, then its scene)
  if (!ui) return <div className="title-screen" />;

  // the page's elements leave (SlidingElement forward: false), then the next page comes in
  const go = (p: Page) => (p === "options" || page === "options" ? setPage(p) : leave(() => setPage(p)));
  // the title's own scene on these pages, the map room on the new-game ones (each fades through the dark)
  const titlePage = page === "title" || page === "options" || page === "load" || page === "collection";
  // what is drawn under the options: the page they were opened from
  const shown: Page = page === "options" ? back : page;
  const start = () => {
    // GameSetupController.PartyNameInput -> StartNewGame: the campaign's first adventure next, written to a slot
    const src = { db: () => db } as unknown as ContentSource;
    const s = newCampaignSave(src, {
      campaign: draft.campaign!, heroes: draft.heroes, difficulty: draft.difficulty ?? "normal", partyName: draft.partyName.trim(),
      heroItems: draft.items.map((r) => r.filter((x): x is number => x !== null)), language: lang,
      ...(ui.products ? { products: ui.products } : {}),
    });
    putSave(s);
    // (the draft stays as it is: a new game starts from a fresh one, see onNew)
    play(s, true);
  };

  let body;
  const props = { ui, draft, setDraft };
  if (shown === "campaign") body = <CampaignPage {...props} savesFull={saves.length >= MAX_SAVES} onBack={() => go("title")} onNext={() => go("difficulty")} />;
  else if (shown === "difficulty") body = <DifficultyPage {...props} leaving={leaving} onBack={() => go("campaign")} onNext={() => go("heroes")} />;
  else if (shown === "heroes") body = <HeroesPage {...props} onBack={() => go("difficulty")} onNext={() => { setDraft((d) => ({ ...d, items: defaultItems(ui, d.heroes) })); go("items"); }} />;
  else if (shown === "items") body = <ItemsPage {...props} onBack={() => go("heroes")} onNext={() => go("party")} />;
  else if (shown === "party") body = <PartyNamePage {...props} onBack={() => go("items")} onNext={start} />;
  else if (shown === "load") {
    body = <SaveSlotsPage ui={ui} saves={saves} onBack={() => go("title")} onResume={(s) => play(s)}
      onDelete={(s) => { deleteSave(s.slot); setSaves(listSaves()); }}
      onReset={(s) => { const c = structuredClone(s); resetAdventure(c); putSave(c); setSaves(listSaves()); play(c); }} />;
  } else if (shown === "collection") {
    body = <CollectionPage ui={ui} onBack={() => go("title")} onOptions={() => { setBack("collection"); go("options"); }}
      onToggle={(ids) => { setOwnedProducts(ids); setOwned(ids); }} />;
  } else {
    body = <TitleMenu ui={ui} hasSaves={saves.length > 0} onNew={() => { setDraft(newDraft()); go("campaign"); }} onLoad={() => go("load")}
      onOptions={() => { setBack("title"); go("options"); }} onCollection={() => go("collection")} />;
  }
  return (
    <div className="title-screen">
      {/* the map room behind the new-game pages (MenuTransitioner.MapSceneVisibility: MapVisual + SetBlur); the title's
          own scene over it on the title pages (TitlescreenVisuals), fading out to the map room */}
      <MapRoom3D view="setup" className={titlePage ? "maproom-off" : "maproom-on"} />
      <TitleScene3D shown={titlePage} />
      {shown !== "title" && <div className="title-dim" />}
      <div className={leaving ? "ng-leaving" : undefined} style={{ display: "contents" }}>{body}</div>
      {page === "options" && (
        <NguiMenu layout={ui.layout} atlas={ui.atlas} say={ui.say} extras={[]} langs={langs} lang={lang} labels={false}
          onLang={setLang} onLabels={() => {}} onSurrender={() => {}} onQuit={() => {}} onClose={() => go(back)} optionsOnly />
      )}
      {/* this app's own screens (packs, map, interface preview, battleboard): not in the original */}
      {page === "title" && <button className="title-tools" onClick={onTools}>Инструменты</button>}
    </div>
  );
}

/** Titlescreen/TitleMenu: logo, the menu buttons, version, gear */
function TitleMenu({ ui, hasSaves, onNew, onLoad, onOptions, onCollection }: {
  ui: TitleUi; hasSaves: boolean; onNew: () => void; onLoad: () => void; onOptions: () => void; onCollection: () => void;
}) {
  const show = useMemo(() => [findNode(ui.layout.root, "Titlescreen")].filter(Boolean) as UiNode[], [ui.layout]);
  const b: Binds = {
    Button_NewCampaign: { onClick: onNew },
    Sprite_DLC_Available: { show: false },
    Button_LoadCampaign: { onClick: onLoad, disabled: !hasSaves },
    Button_Collection: { onClick: onCollection },
    // StartUpMenuController.OpenWebRules: the rules on the publisher's site
    Button_Rules: { onClick: () => { void openUrl(ui.raw("JIME_RULES_URL")); } },
    Button_Quit: { onClick: () => { void quitApp(); }, disabled: !inTauri() },
    "Fade_In/Sprite_Options": { onClick: onOptions },
    Sprite_AsmoConnect_BG: { show: false },
    Sprite_FFGLogo: { show: false },
    Sprite_MELogo: { color: [1, 1, 1, 0] },
    Label_License: { show: false },
    Label_Version: { text: `JiME Reborn ${ENGINE_VERSION}` },
  };
  // CoroutineAnimateButtons: the menu buttons slide in from the left one after another (0.2 s apart); afterwards
  // CoroutineShortAnimation fades the whole menu in
  const [long] = useState(() => !titleShown);
  useEffect(() => { titleShown = true; }, []);
  const anim = long
    ? withEnter(b, null, {
      "TitleMenu/Widget_Logo": SLIDE.fade(1.0, 0.2),
      "Table/Button_NewCampaign": SLIDE.left(true, 0.8),
      "Table/Button_LoadCampaign": SLIDE.left(true, 1.0),
      "Table/Button_Collection": SLIDE.left(true, 1.2),
      "Table/Button_Rules": SLIDE.left(true, 1.4),
      "Menu_BG/Button_Quit": SLIDE.left(true, 1.6),
    })
    : withEnter(b, null, { Titlescreen: SLIDE.fade(0.7) });
  return <NguiView layout={ui.layout} atlas={ui.atlas} show={show} binds={anim} say={ui.say} className="ngui-page" />;
}
