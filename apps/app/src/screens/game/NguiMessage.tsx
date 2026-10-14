// The original's message popup (UI_Game/MessagePopup) drawn from the exported layout, driven like
// FFG.Common.MessagePopup + MessageButtonController (decompiled code): one label 750 wide under the top of the screen,
// the background anchored around it, and one button set per mode (continue, confirm/cancel, multiple choice,
// challenge value, hero choice).
import { useEffect, useState } from "react";
import type { Answer, Decision, LogEntry } from "@jime/engine";
import { NguiView, type Binds } from "../../ngui/NguiView.tsx";
import { findNode, type UiLayoutFile } from "../../ngui/types.ts";
import type { Atlas, Say } from "./ui.ts";

/** MessagePopup.InitializePlacement for PopupOptions.PopupCenterOn.Top: LocalPositionTop (0, 215) + 0.5 * label.minHeight (2) */
const TOP: [number, number] = [0, 216];
const MAX_CHOICES = 5; // ButtonMultipleChoice0..4 (+ the cancel button) in the layout

/** MessageAdditionalInfo of an enemy attack: physical damage, fear, extra effect key */
export interface AttackInfo { physical: number; fear: number; effect: string | null }

export type PopupContent =
  | { kind: "message"; entry: LogEntry; left: number; info?: AttackInfo; onNext: () => void; onSkipAll: () => void }
  | { kind: "decision"; d: Decision; onAnswer: (a: Answer) => void };

export function NguiMessage({ layout, atlas, say, content, party = [] }: {
  layout: UiLayoutFile; atlas: Atlas; say: Say; content: PopupContent;
  /** the party's hero icons (Button_HeroChoice / Texture_HeroIcon) and names */
  party?: { name: string; icon?: string }[];
}) {
  // UI_Game.MessageDialogEnemyActivation for what an activating enemy does (log entries / decisions tagged with it)
  const enemy = content.kind === "message" ? content.entry[4]?.enemy !== undefined : content.d.kind === "choice" && content.d.enemy !== undefined;
  const popup = findNode(layout.root, enemy ? "UI_Game/MessagePopup_EnemyActivation" : "UI_Game/MessagePopup");
  const [value, setValue] = useState(0);
  const dKey = content.kind === "decision" ? content.d : null;
  useEffect(() => setValue(0), [dKey]);
  if (!popup) return null;

  const b: Binds = {
    MessagePopup: { at: TOP, pin: "top" },
    MessagePopup_EnemyActivation: { at: TOP, pin: "top" },
    // InitializePlacement: pivot Top at y = 0, width 750, centred (label.height > minHeight always holds)
    Label_Message: { pv: 1, at: [0, 0], w: 750, al: 2 },
    // InitializePopup: the extra icon (elite banner) only with PopupOptions.ExtraSpriteId > 0
    Sprite_ExtraIcon: content.kind === "message" && (content.entry[4]?.banner ?? 0) > 0
      ? { show: true, sprite: `Banner${String(content.entry[4]!.banner).padStart(2, "0")}` } : { show: false },
  };
  const btn = (name: string, onClick: () => void, label?: { node: string; html: string }) => {
    b[name] = { show: true, onClick };
    if (label) b[`${name}/${label.node}`] = { html: label.html };
  };

  if (content.kind === "message") {
    b.Label_Message!.html = say(content.entry[2], content.entry[3]);
    const info = content.info;
    if (info) {
      // MessageButtonController.InitializeAdditionalInfo: damage / fear icons with their values, the extra effect,
      // the background down to Widget_AnchorBottom (+37), the confirm button
      b.AdditionalInfo = { show: true };
      b.Sprite_Damage = { show: info.physical > 0 };
      b.Label_Damage_Value = { text: String(info.physical) };
      b.Sprite_Fear = { show: info.fear > 0 };
      b.Label_Fear_Value = { text: String(info.fear) };
      b.Label_Attack_AdditionalEffect = info.effect ? { show: true, html: say(info.effect) } : { show: false };
      b.Sprite_AdditionalInfo_Background = { h: (info.effect ? 139 : 111) + 37 };
      btn("Button_ConfirmAdditionalInfo", content.onNext, { node: "Label_Confirm", html: say("UI_CONFIRM") || "Подтвердить" });
    } else btn("Button_Continue", content.onNext);
  } else {
    const d = content.d;
    const prompt = "inserts" in d && d.key ? say(d.key, d.inserts) : "";
    b.Label_Message!.html = prompt;
    const yes = say("UI_CONFIRM") || "Подтвердить";
    switch (d.kind) {
      case "choice": {
        b.Grid_MultipleChoice = { show: true };
        d.choices.slice(0, MAX_CHOICES).forEach((c, i) =>
          btn(`ButtonMultipleChoice${i}`, () => content.onAnswer(i), { node: `Label_Choice${i}`, html: say(c.key, c.inserts) || `#${i + 1}` }));
        for (let i = d.choices.length; i < MAX_CHOICES; i++) b[`ButtonMultipleChoice${i}`] = { show: false };
        b.ButtonCancelMultipleChoice = d.canCancel ? { show: true, onClick: () => content.onAnswer(null) } : { show: false };
        break;
      }
      case "test":
        b.SpriteChallengeValue = { show: true };
        b.LabelChallengeValue = { show: true, text: String(value) };
        b.ButtonIncrease = { show: true, onClick: () => setValue((v) => v + 1) };
        b.ButtonDecrease = { show: true, onClick: () => setValue((v) => Math.max(0, v - 1)) };
        b.ButtonConfirmChallenge = { show: true, onClick: () => content.onAnswer(value) };
        b["ButtonConfirmChallenge/Label_Confirm"] = { html: yes };
        b.ButtonCancelChallenge = { show: false };
        break;
      case "confirm":
        // MessagePopup.ShowConfirmCancelMessage: the action's ConfirmLabel / CancelLabel
        btn("Button_Confirm", () => content.onAnswer(true), { node: "Label_Confirm", html: say(d.yes) || yes });
        btn("Button_Cancel", () => content.onAnswer(false), { node: "Label_Cancel", html: say(d.no) || "Отмена" });
        break;
      case "lastStand":
        // UIHeroMenuDialog.PerformLastStand: the test text with the difficulty, Pass / Fail
        b.Label_Message!.html = d.key ? say(d.key, d.inserts) : `Последний рубеж (${d.physical ? "урон" : "страх"})`;
        btn("Button_Confirm", () => content.onAnswer(true), { node: "Label_Confirm", html: say("UI_PASS") || "Пройден" });
        btn("Button_Cancel", () => content.onAnswer(false), { node: "Label_Cancel", html: say("UI_FAIL") || "Провален" });
        break;
      case "lastStandType":
        b.Label_Message!.html = say("UI_CHOOSE_LAST_STAND") || "От чего герой повержен?";
        btn("Button_Confirm", () => content.onAnswer(true), { node: "Label_Confirm", html: say("UI_PHYSICAL") || "Урон" });
        btn("Button_Cancel", () => content.onAnswer(false), { node: "Label_Cancel", html: say("UI_FEAR") || "Страх" });
        break;
      case "hero": {
        // HeroChoice: one icon frame per player (Texture_HeroIcon = Hero.Model.Icon; the number without icons)
        b.HeroChoice = { show: true };
        const names = ["Button_HeroChoice", "Button_HeroChoice (1)", "Button_HeroChoice (2)", "Button_HeroChoice (3)", "Button_HeroChoice (4)"];
        names.forEach((n, i) => {
          const h = party[i];
          b[n] = i < d.players
            ? { show: true, onClick: () => content.onAnswer({ player: i, skip: false }), title: (h?.name && say(h.name)) || `Герой ${i + 1}`,
                ...(h?.icon ? {} : { content: <span className="ng-hero-num">{i + 1}</span> }) }
            : { show: false };
          b[`${n}/Texture_HeroIcon`] = h?.icon ? { tex: h.icon } : { show: false };
        });
        b.ButtonConfirmPlayerChoice = { show: false };
        b.ButtonSkipPlayerChoice = d.canSkip ? { show: true, onClick: () => content.onAnswer({ player: 0, skip: true }) } : { show: false };
        break;
      }
      default:
        return null;
    }
  }
  return <NguiView layout={layout} atlas={atlas} show={[popup]} binds={b} say={say} className="ngui-popup" />;
}
