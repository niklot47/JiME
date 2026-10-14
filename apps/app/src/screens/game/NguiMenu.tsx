// The original's in-game menu (Page_Menu, UIMenuPageController) and options page (Panel_Options, UIOptionsPage) from
// the exported layout. Menu: rules, options, camera controls, surrender (confirmation), save and quit - plus this
// app's own entries as more buttons of the same kind (undo, save to a file, 2D / 3D board).
// Options: language, music and sound effects (slider + on/off toggle), the debug toggle shows token names; the
// rest of the original's options (font size, voice-over, camera speeds, zoom bar, graphics) are shown disabled.
import { useEffect, useState, type ReactNode } from "react";
import { sound } from "../../audio/sound.ts";
import { NguiView, type Bind, type Binds } from "../../ngui/NguiView.tsx";
import type { UiLayoutFile, UiNode } from "../../ngui/types.ts";
import type { Atlas, Say } from "./ui.ts";

const top = (layout: UiLayoutFile, name: string): UiNode | null => (layout.root.ch ?? []).find((c) => c.n === name) ?? null;
const LANG_NAMES: Record<string, string> = { en: "English", ru: "Русский", it: "Italiano", de: "Deutsch", fr: "Français", es: "Español", pl: "Polski" };

export interface MenuExtra { label: string; onClick: () => void; disabled?: boolean }

export function NguiMenu({ layout, atlas, say, extras, langs, lang, labels, onLang, onLabels, onSurrender, onQuit, onClose }: {
  layout: UiLayoutFile; atlas: Atlas; say: Say; extras: MenuExtra[];
  langs: string[]; lang: string; labels: boolean; onLang: (l: string) => void; onLabels: (v: boolean) => void;
  onSurrender: () => void; onQuit: () => void; onClose: () => void;
}) {
  const [page, setPage] = useState<"menu" | "options" | "camera" | "surrender">("menu");
  const [s, setS] = useState(sound.settings);
  useEffect(() => sound.onChange(() => setS(sound.settings)), []);
  const menu = top(layout, "Page_Menu");
  const options = top(layout, "Panel_Options");
  if (!menu || !options) return null;

  const STEP = 72;
  const b: Binds = {
    Page_Menu: { show: true },
    "Page_Menu/z_Darkening": { onClick: onClose },
    MenuRules: { disabled: true, title: "Правила (помощник по правилам — позже)" },
    MenuOptions: { onClick: () => setPage("options") },
    MenuCameraControls: { onClick: () => setPage("camera") },
    MenuSurrender: { onClick: () => setPage("surrender") },
    // this app's entries: more buttons below "save and quit", the panel grown to hold them
    MenuQuitCampaign: {
      onClick: onQuit, step: [0, -STEP],
      clones: [{}, ...extras.map((e): Record<string, Bind> => ({
        MenuQuitCampaign: { onClick: e.disabled ? undefined : e.onClick, disabled: e.disabled },
        Label_QuitCampaign: { html: e.label },
      }))],
    },
    // the panel grows around its centre; its title and buttons move up by half the growth
    "Page_Menu/Sprite_BG": { h: 474 + STEP * extras.length },
    "Sprite_BG/Sprite_BGFIll": { h: 474 + STEP * extras.length },
    "Sprite_BG/Label_Title": { dy: STEP * extras.length / 2 },
    Grid_Options: { dy: STEP * extras.length / 2 },
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
    "Panel_Options/z_Darkening": { onClick: () => setPage("menu") },
    Dialog_LanguageChangeConfirmation: { show: false },
    Panel_GraphicSettings: { show: false },
    Button_GraphicSettings: { disabled: true, title: "Настройки графики — позже" },
    Label_CurLanguage: { text: LANG_NAMES[lang] ?? lang },
    LanguageSelect: { onClick: () => onLang(langs[(langs.indexOf(lang) + 1) % langs.length] ?? lang), title: "Сменить язык" },
    FontSize: { disabled: true },
    Label_CurSize: { text: "—" },
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
  toggle("Toggle_BB_Classic", false);

  let view: ReactNode = <NguiView layout={layout} atlas={atlas} show={[menu]} binds={b} say={say} className="ngui-menu" />;
  if (page === "options") view = <NguiView layout={layout} atlas={atlas} show={[options]} binds={o} say={say} className="ngui-menu" />;
  return <div className="ngui-modal">{view}</div>;
}

/** an invisible range input over a slider's background (drag / click / keys) */
function RangeInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return <input className="ng-range" type="range" min={0} max={1} step={0.05} value={value} onChange={(e) => onChange(Number(e.target.value))} />;
}
