// The original's in-game menu (Page_Menu, UIMenuPageController) and options page (Panel_Options, UIOptionsPage) from
// the exported layout. Menu: rules, options, camera controls, surrender (confirmation), save and quit - plus this
// app's own entries as more buttons of the same kind (undo, save to a file, 2D / 3D board).
// Options: language, music and sound effects (slider + on/off toggle), the debug toggle shows token names; the
// rest of the original's options (font size, voice-over, camera speeds, zoom bar, graphics) are shown disabled.
import { useEffect, useState, type ReactNode } from "react";
import { sound } from "../../audio/sound.ts";
import { setBbClassic, useBbClassic } from "../../data/bbClassic.ts";
import { NguiView, getUiScale, setUiScale, type Bind, type Binds } from "../../ngui/NguiView.tsx";
import { openUrl } from "../../data/host.ts";
import type { UiLayoutFile, UiNode } from "../../ngui/types.ts";
import type { Atlas, Say } from "./ui.ts";

const top = (layout: UiLayoutFile, name: string): UiNode | null => (layout.root.ch ?? []).find((c) => c.n === name) ?? null;
const SCALES = [1, 0.9, 0.8, 0.7, 0.6];
/**
 * The options list scrolls inside the window (the layout has no scroll view there; more options will come): the region
 * in Grid_Option_Widgets' units (it sits at -320, -22), from the window's top border to above its bottom border, and
 * how far the list can move to show its last row
 */
const OPTIONS_CLIP: [number, number, number, number] = [320, 20, 900, 540];
const OPTIONS_SCROLL = 45;
const LANG_NAMES: Record<string, string> = { en: "English", ru: "Русский", it: "Italiano", de: "Deutsch", fr: "Français", es: "Español", pl: "Polski" };

export interface MenuExtra { label: string; onClick: () => void; disabled?: boolean }

export function NguiMenu({ layout, atlas, say, extras, langs, lang, labels, onLang, onLabels, onSurrender, onQuit, onClose, optionsOnly }: {
  layout: UiLayoutFile; atlas: Atlas; say: Say; extras: MenuExtra[];
  langs: string[]; lang: string; labels: boolean; onLang: (l: string) => void; onLabels: (v: boolean) => void;
  onSurrender: () => void; onQuit: () => void; onClose: () => void;
  /** only the options page (the title screen's gear, StartUpMenuController.OnOptionsButtonClicked) */
  optionsOnly?: boolean;
}) {
  const classic = useBbClassic();
  const [page, setPage] = useState<"menu" | "options" | "camera" | "surrender">(optionsOnly ? "options" : "menu");
  const back = () => (optionsOnly ? onClose() : setPage("menu"));
  const [s, setS] = useState(sound.settings);
  const [scroll, setScroll] = useState(0);
  const scrollBy = (d: number) => setScroll((v) => Math.max(0, Math.min(OPTIONS_SCROLL, v + d)));
  const [touchY, setTouchY] = useState<number | null>(null);
  useEffect(() => sound.onChange(() => setS(sound.settings)), []);
  const menu = top(layout, "Page_Menu");
  const options = top(layout, "Panel_Options");
  if (!menu || !options) return null;

  const STEP = 72;
  // the original's five buttons and this app's entries in two columns (one column no longer fits the screen):
  // the left column first, top to bottom; the grid stays centred, the panel wider and as tall as the rows
  const ORIG = ["MenuRules", "MenuOptions", "MenuCameraControls", "MenuSurrender", "MenuQuitCampaign"];
  const COL = 115;
  const count = ORIG.length + extras.length;
  const rows = Math.ceil(count / 2);
  const place = (k: number): [number, number] => {
    const col = k < rows ? 0 : 1, row = k < rows ? k : k - rows;
    return [col ? COL : -COL, STEP * (rows - 1) / 2 - STEP * row];
  };
  // offsets from a button's own place in the layout (144, 72, 0, -72, -144)
  const off = (k: number): Bind => { const [x, y] = place(k); return { dx: x, dy: y - (144 - STEP * Math.min(k, 4)) }; };
  const b: Binds = {
    Page_Menu: { show: true },
    "Page_Menu/z_Darkening": { onClick: onClose },
    // UIMenuPageController.OnRulesButtonClicked: the rules on the publisher's site
    MenuRules: { ...off(0), onClick: () => { void openUrl(say("JIME_RULES_URL").replace(/<[^>]+>/g, "")); } },
    MenuOptions: { ...off(1), onClick: () => setPage("options") },
    MenuCameraControls: { ...off(2), onClick: () => setPage("camera") },
    MenuSurrender: { ...off(3), onClick: () => setPage("surrender") },
    // this app's entries: more buttons after "save and quit" (copies of it)
    MenuQuitCampaign: {
      onClick: onQuit,
      clones: [{ MenuQuitCampaign: off(4) }, ...extras.map((e, i): Record<string, Bind> => ({
        MenuQuitCampaign: { ...off(5 + i), onClick: e.disabled ? undefined : e.onClick, disabled: e.disabled },
        Label_QuitCampaign: { html: e.label },
      }))],
    },
    // the panel around its centre: two buttons wide, as tall as the rows; the title follows its top edge
    "Page_Menu/Sprite_BG": { w: 268 + 2 * COL, h: 474 + STEP * (rows - 5) },
    "Sprite_BG/Sprite_BGFIll": { w: 268 + 2 * COL, h: 474 + STEP * (rows - 5) },
    "Sprite_BG/Label_Title": { dy: STEP * (rows - 5) / 2 },
    // camera controls: shown over the menu, any click closes it
    DialogCameraControls: { show: page === "camera" },
    "DialogCameraControls/Sprite_Darkening ": { onClick: () => setPage("menu") },
    // surrender confirmation
    DialogSurrenderConfirmation: { show: page === "surrender" },
    "DialogSurrenderConfirmation//Button_Confirm": { onClick: onSurrender },
    "DialogSurrenderConfirmation//Button_Cancel": { onClick: () => setPage("menu") },
  };

  // ---- options page
  const o: Binds = {
    Panel_Options: { show: true },
    // a scroll view over the options: the rows move, the region stays (clip offset against the scroll), soft edges
    Grid_Option_Widgets: { dy: scroll, clipPanel: { clip: OPTIONS_CLIP, off: [0, -scroll], soft: [0, 10] } },
    "Panel_Options/z_Darkening": { onClick: back },
    Dialog_LanguageChangeConfirmation: { show: false },
    Panel_GraphicSettings: { show: false },
    Button_GraphicSettings: { disabled: true, title: "Настройки графики — позже" },
    Label_CurLanguage: { text: LANG_NAMES[lang] ?? lang },
    LanguageSelect: { onClick: () => onLang(langs[(langs.indexOf(lang) + 1) % langs.length] ?? lang), title: "Сменить язык" },
    // the font size row sets this app's interface scale instead (smaller for desktop screens)
    Label_Title_FontSize: { html: "Масштаб интерфейса" },
    FontSize: { onClick: () => { const i = SCALES.indexOf(getUiScale()); setUiScale(SCALES[(i + 1) % SCALES.length]!); setS({ ...sound.settings }); }, title: "Сменить масштаб" },
    Label_CurSize: { text: `${Math.round(getUiScale() * 100)}%` },
    Toggle_Debug: { onClick: () => onLabels(!labels), title: "Названия жетонов на доске" },
    "Toggle_Debug/Sprite_State": { show: labels },
    "Toggle_Debug/Label_Title_DebugInfo": { html: "Названия жетонов", color: [0.94, 0.88, 0.72, 1] },
    Toggle_DebugFast: { show: false },
  };
  const slider = (name: string, value: number, set?: (v: number) => void): void => {
    // UISlider: thumb across the 310 wide foreground (x -152..152), the foreground filled to the value
    o[`${name}//Slider_Thumb`] = { at: [-152 + 304 * value, 0] };
    o[`${name}//Slider_Foreground`] = { w: 310 * value, dx: -155 * (1 - value), color: set ? undefined : [0.4, 0.4, 0.4, 1] };
    o[`${name}//Slider_Background`] = set ? { content: <RangeInput value={value} onChange={set} /> } : { className: "ng-disabled" };
  };
  const toggle = (name: string, on: boolean, set?: () => void): void => {
    o[name] = set ? { onClick: set } : { disabled: true };
    o[`${name}/Sprite_State`] = { show: on };
  };
  slider("Slider_Music", s.music, (v) => sound.set({ music: v }));
  slider("Slider_SoundEffects", s.sfx, (v) => sound.set({ sfx: v }));
  toggle("MusicToggle", s.music > 0, () => sound.set({ music: s.music > 0 ? 0 : 0.7 }));
  toggle("SoundEffectsToggle", s.sfx > 0, () => sound.set({ sfx: s.sfx > 0 ? 0 : 0.8 }));
  toggle("VoiceOverToggle", false);
  toggle("LocalizedVoiceOverToggle", false);
  for (const n of ["Slider_PanSpeed", "Slider_ZoomSpeed", "Slider_OrbitSpeed"]) slider(n, 0.5);
  toggle("Toggle_ShowZoomBar", false);
  toggle("Toggle_BB_Classic", classic, () => setBbClassic(!classic));

  // keyed: each page is its own view (hidden until its images are ready, no flash of untinted parts)
  let view: ReactNode = <NguiView key="menu" layout={layout} atlas={atlas} show={[menu]} binds={b} say={say} className="ngui-menu" />;
  if (page === "options") {
    view = (
      <div className="ngui-wheel" onWheel={(e) => scrollBy(e.deltaY > 0 ? 30 : -30)}
        onTouchStart={(e) => setTouchY(e.touches[0]?.clientY ?? null)}
        onTouchMove={(e) => { const y = e.touches[0]?.clientY; if (touchY !== null && y !== undefined) { scrollBy((touchY - y) * 0.6); setTouchY(y); } }}
        onTouchEnd={() => setTouchY(null)}>
        <NguiView key="options" layout={layout} atlas={atlas} show={[options]} binds={o} say={say} className="ngui-menu" />
      </div>
    );
  }
  return <div className="ngui-modal">{view}</div>;
}

/** an invisible range input over a slider's background (drag / click / keys) */
function RangeInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return <input className="ng-range" type="range" min={0} max={1} step={0.05} value={value} onChange={(e) => onChange(Number(e.target.value))} />;
}
