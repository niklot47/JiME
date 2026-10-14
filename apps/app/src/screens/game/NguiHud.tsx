// Top and bottom of the original's game screen (UI_Game) from the exported layout, driven like UIThreatMeter /
// UI_Game (decompiled code): threat value "cur/max" (UI_THREAT_VALUE_FORMATTED), markers at percentage * 594 along
// Widget_ThreatEvents (yellow until reached, then red), darkness token, objective; party, settings, end-round and
// provoke buttons; the enemy bar with one EnemyMiniView per group (UI_Game.EnemyMenu: the miniview prefab is not in
// the scene, the enemy dialog's one is reused in Grid_Enemies). The threat fill itself is a 3D mesh in the game: drawn here inside the meter.
import { useState } from "react";
import type { GameView } from "@jime/engine";
import { assetUrl } from "../../data/pack.ts";
import { NguiView, type Binds } from "../../ngui/NguiView.tsx";
import { findNode, type UiLayoutFile, type UiNode } from "../../ngui/types.ts";
import type { Atlas, Say } from "./ui.ts";

const TRACK = 594; // UIThreatMeter.GetXPositionOnTracker
const RED = [191 / 255, 28 / 255, 28 / 255, 1];
// the fill's span inside the 744-wide meter: Widget_ThreatEvents (-335.4) .. +594
const FILL_LEFT = (372 - 335.4) / 744, FILL_W = TRACK / 744;

/** The layout with the enemy dialog's EnemyMiniView copied into the enemy bar's (runtime-filled) Grid_Enemies */
const withMiniView = new WeakMap<UiLayoutFile, UiLayoutFile>();
function hudLayout(layout: UiLayoutFile): UiLayoutFile {
  let l = withMiniView.get(layout);
  if (l) return l;
  const mini = findNode(layout.root, "Sprite_TopInfo/EnemyMiniView");
  const copy = (n: UiNode): UiNode => n.n === "Grid_Enemies" && mini
    ? { ...n, ch: [{ ...structuredClone(mini), p: [0, 0], tw: undefined, on: true }] }
    : n.ch ? { ...n, ch: n.ch.map(copy) } : n;
  l = { ...layout, root: copy(layout.root) };
  withMiniView.set(layout, l);
  return l;
}

export function NguiHud({ layout: base, atlas, art, enemyArt, say, view, canEndRound, endTitle, attackable, activating, canProvoke, provoking, onProvoke, loreGain, canInfo, onParty, onSettings, onEndRound, onEnemy }: {
  layout: UiLayoutFile; atlas: Atlas; art: Record<string, string>; enemyArt: Record<string, string>; say: Say; view: GameView;
  canEndRound: boolean; endTitle: string; attackable: Set<number>; activating?: number;
  /** provoke: the button is enabled / provoke mode is on (Dialog_Provoke shown) */
  canProvoke: boolean; provoking: boolean; onProvoke: () => void;
  /** UI_Game.AnimateLoreGain: the last change of lore (key restarts the animation) */
  loreGain?: { key: number; amount: number } | null;
  /** threat markers can be clicked for their info (not while a message is up) */
  canInfo: boolean;
  onParty: () => void; onSettings: () => void; onEndRound: () => void; onEnemy: (uid: number) => void;
}) {
  const layout = hudLayout(base);
  // UIThreatMeter.OnThreatEventClicked: info dialog of the clicked event, paged through all of them
  const [info, setInfo] = useState<number | null>(null);
  const game = findNode(layout.root, "UI_Game");
  if (!game) return null;
  const pick = (name: string) => (game.ch ?? []).find((c) => c.n === name) ?? findNode(game, name);
  const show = ["Panel_Threat", "Sprite_Options", "Button_HeroMenu", "Button_EndRound", "Sprite_EnemyBar", "Button_Provoke", "Dialog_Provoke", "Panel_GainAnimation"]
    .map(pick).filter((n): n is UiNode => !!n);

  const max = view.threatMax;
  const frac = max > 0 ? Math.min(1, view.threat / max) : 0;
  const url = (p?: string) => (p ? `url("${assetUrl(p)}")` : undefined);
  const value = (say("UI_THREAT_VALUE_FORMATTED", [String(view.threat), String(max)]) || `${view.threat}/${max}`).replace(/<[^>]+>/g, "");
  const marks = max > 0 ? view.threatEvents.filter((t) => t <= max) : [];

  const b: Binds = {
    Dialog_ThreatEventInfo: { show: info !== null && canInfo },
    "Dialog_ThreatEventInfo/Dialog_ThreatEventInfo": {},
    Label_ThreatEventInfo: { html: info !== null ? say(view.threatInfo.filter((t) => t.threshold <= max)[info]?.info) : "" },
    Button_PageLeft: { show: marks.length > 1, onClick: () => setInfo((i) => ((i ?? 0) + marks.length - 1) % marks.length) },
    Button_PageRight: { show: marks.length > 1, onClick: () => setInfo((i) => ((i ?? 0) + 1) % marks.length) },
    "Dialog_ThreatEventInfo/z_Darkening": { onClick: () => setInfo(null) },
    Sprite_ThreatMeterBackground: {
      title: `Угроза ${view.threat}${max > 0 ? ` из ${max}` : ""}`,
      content: (
        <>
        <div className="ng-threat-track" style={{ left: `${FILL_LEFT * 100}%`, width: `${FILL_W * 100}%` }}>
          <div className="fill" style={{ width: `${100 * frac}%` }}>
            <div className="ramp" style={{ width: frac > 0 ? `${100 / frac}%` : "100%", backgroundImage: url(art.threatGradient) }} />
            {art.threatLiquid && <div className="liquid" style={{ backgroundImage: url(art.threatLiquid) }} />}
          </div>
          {/* the burning edge of the fill: the flame sprite turned so it licks back along the fill (data/ref/video) */}
          {frac > 0 && art.threatFire && <span key={view.threat} className="flame" style={{ left: `${100 * frac}%` }}><i style={{ backgroundImage: url(art.threatFire) }} /></span>}
        </div>
        {art.threatMeter && <img className="ng-threat-img" src={assetUrl(art.threatMeter)} alt="" />}
        </>
      ),
    },
    "Sprite_ThreatMeterBackground/Label_ThreatValue": { text: value },
    Label_Objective: { html: view.objective ? say(view.objective, view.objectiveInserts) : say("UI_DEFAULT_OBJECTIVE") },
    Table_AdventureRules: { show: false },
    Sprite_Darkness: { show: view.darkness, title: "Тьма" },
    Widget_ThreatEventSelected: info !== null && marks[info] !== undefined ? { show: true, at: [TRACK * (marks[info]! / max), 4.9] } : { show: false },
    // one marker per threat event (the layout has 10; clones of the first keep it simple)
    Widget_ThreatMarker: {
      show: marks.length > 0,
      clones: marks.map((t, i) => ({
        Widget_ThreatMarker: { at: [TRACK * (t / max), 4.9], ...(view.threat >= t ? { color: RED } : {}), title: `Событие угрозы на ${t}`,
          onClick: canInfo ? () => setInfo(i) : undefined },
        "Widget_ThreatMarker/Label_ThreatValue": { text: String(t) },
      })),
    },
    Sprite_Options: { onClick: onSettings, title: "Меню" },
    Button_HeroMenu: { onClick: onParty, title: "Отряд: статус, хроника, снаряжение" },
    Button_EndRound: { onClick: onEndRound, disabled: !canEndRound, title: endTitle, className: canEndRound ? "ng-ready" : "" },
    // UI_Game.OnProvokeButtonClicked toggles provoke mode: instructions, glowing button, red vignette
    Button_Provoke: { disabled: !canProvoke && !provoking, title: say("UI_PROVOKE") || "Провокация", onClick: onProvoke },
    Dialog_Provoke: { show: provoking },
    // CoroutineAnimateGained: "+N Lore" rises from Widget_GainStartPos to Widget_GainEndPos (TweenTransform) and fades
    // (TweenAlpha 2.5 s); a loss turns red (TweenColor)
    Label_LoreGain: loreGain
      ? { show: true, at: [-620, -306], className: `ng-lore-gain g${loreGain.key % 2}`, color: loreGain.amount < 0 ? [1, 0, 0, 1] : undefined,
          html: say("UI_LORE_GAIN", [loreGain.amount >= 0 ? "+" : "", String(loreGain.amount)]) || `${loreGain.amount >= 0 ? "+" : ""}${loreGain.amount} Сведения` }
      : { show: false },
    z_Darkening: { onClick: onProvoke },
    // EnemyMiniView per group: portrait (grey when exhausted), elite frame, ranged mark, highlight while attackable
    EnemyMiniView: {
      show: view.enemies.length > 0, step: [105, 0],
      clones: view.enemies.map((e) => ({
        EnemyMiniView: { onClick: () => onEnemy(e.uid), title: `${say(e.name) || e.name}${e.size > 1 ? ` ×${e.size}` : ""}` },
        SpriteEnemy: { tex: enemyArt[String(e.model)], color: e.exhausted ? [0.5, 0.5, 0.5, 1] : undefined },
        SpriteHighlight: { show: activating !== undefined ? activating === e.uid : provoking ? !e.exhausted : attackable.has(e.uid) },
        Sprite_UniqueId_Background: { show: false },
        Sprite_EliteFrame: { show: e.named },
        Sprite_Ranged: { show: e.ranged },
      })),
    },
  };
  for (let i = 1; i < 10; i++) b[`Widget_ThreatMarker (${i})`] = { show: false };
  return <NguiView layout={layout} atlas={atlas} show={show} binds={b} say={say} className="ngui-hud" />;
}
