// The original's enemy dialog (UI_Game/Enemy_Banner/"Dialog_EnemyInfo/Combat") drawn from the exported layout and driven
// like FFG.JIME.EnemyInfoDialog + EnemyHealthBar (decompiled code): portrait medallion, name, bonuses, one health bar
// per unit the group started with (health, sorcery and armor fills over 350 / max ticks), the sword button sliding
// the card left and the combat card right (abilities, hits stepper, resolve), and the damage confirmation.
// The engine keeps a group as size x unitHp with the damage on the front unit, so the units are rebuilt from that
// and the attack answers the health the units lose (CalculateHealth: armor, then sorcery, then health).
import { useState } from "react";
import type { GameView } from "@jime/engine";
import { sound } from "../../audio/sound.ts";
import { NguiView, type Binds } from "../../ngui/NguiView.tsx";
import type { UiLayoutFile, UiNode } from "../../ngui/types.ts";
import type { Atlas, Say } from "./ui.ts";

type EnemyView = GameView["enemies"][number];

/** AttackAbilityType flags, in the order of Button_Ability_* / Sprite_Selected (n) */
const ABILITIES = ["Pierce", "Smite", "Lethal", "Sunder", "Stun", "Cleave"] as const;
type Ability = (typeof ABILITIES)[number];
const GREY_LABEL = [0.522, 0.522, 0.522, 1]; // TweenArmorDisabled / TweenSorceryDisabled targets
const BARS = 3; // Enemy_Healthbar (0..2)
const TICKS = 30; // Sprite_Tick, Sprite_Tick (1..29)
const BAR_W = 350;

interface Unit { hp: number; armor: number; sorcery: number }

/** EnemyInfoDialog.ResetEnemyState from the engine's group: dead units first, the damage on the front unit */
export function unitsOf(e: EnemyView): Unit[] {
  const dead = e.startSize - e.size;
  return Array.from({ length: e.startSize }, (_, i) =>
    i < dead ? { hp: 0, armor: 0, sorcery: 0 }
    : { hp: i === dead ? Math.max(0, e.unitHp - e.damage) : e.unitHp, armor: e.armor, sorcery: e.sorcery });
}

/** EnemyInfoDialog.CalculateHealth */
export function calculateHealth(start: Unit[], damage: number, on: Set<Ability>): Unit[] {
  const u = start.map((x) => ({ ...x }));
  let num = damage;
  for (let i = 0; i < u.length; i++) {
    if (on.has("Cleave")) num = damage;
    if (on.has("Sunder") && (on.has("Cleave") || i === 0 || u[i - 1]!.hp <= 0)) u[i]!.armor = Math.max(0, u[i]!.armor - 1);
    if (num <= 0) continue;
    if (!on.has("Pierce")) { const a = Math.min(num, u[i]!.armor); u[i]!.armor -= a; num -= a; }
    if (!on.has("Smite")) { const s = Math.min(num, u[i]!.sorcery); u[i]!.sorcery -= s; num -= s; }
    const h = on.has("Lethal") ? Math.min(num, Math.floor(u[i]!.hp / 2 + 0.5)) : Math.min(num, u[i]!.hp);
    if (on.has("Lethal") && u[i]!.hp <= 2 * h) u[i]!.hp = 0;
    else u[i]!.hp -= h;
    num -= h;
  }
  return u;
}

function byName(n: UiNode, name: string): UiNode | null {
  if (n.n === name) return n;
  for (const c of n.ch ?? []) {
    const r = byName(c, name);
    if (r) return r;
  }
  return null;
}

export function NguiEnemy({ layout, atlas, say, art, enemy, canAttack, onAttack, onClose }: {
  layout: UiLayoutFile; atlas: Atlas; say: Say; art: Record<string, string>; enemy: EnemyView; canAttack: boolean;
  /** health the units lose (the engine's attack damage) */
  onAttack: (hpLost: number) => void; onClose: () => void;
}) {
  const [combat, setCombat] = useState(false);
  const [damage, setDamage] = useState(0);
  const [on, setOn] = useState<Set<Ability>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const dialog = byName(layout.root, "Dialog_EnemyInfo/Combat");
  if (!dialog) return null;

  const start = unitsOf(enemy);
  const units = combat ? calculateHealth(start, damage, on) : start;
  const maxHp = enemy.unitHp, maxArmor = enemy.armor, maxSorc = enemy.sorcery;
  const total = Math.max(1, maxHp + maxArmor + maxSorc);
  const cell = BAR_W / total;
  // IsUnitTargeted: the first living unit, every living unit with Cleave
  const firstAlive = units.findIndex((u) => u.hp !== 0);
  const targeted = (i: number) => combat && units[i]!.hp !== 0 && (on.has("Cleave") || i === firstAlive);
  const stunned = enemy.exhausted || (combat && on.has("Stun"));
  const toggle = (a: Ability) => setOn((s) => { const n = new Set(s); if (n.has(a)) n.delete(a); else n.add(a); return n; });

  const b: Binds = {
    "Dialog_EnemyInfo/Combat": { show: true },
    ZeroDamage: { show: false }, DealDamage: { show: false },
    // Show(): both cards at animStart; OnButtonCombatClicked plays the group 8 tweens (info left, combat right)
    Sprite_EnemyInfo: combat ? { at: [-225, 61] } : {},
    Sprite_Combat: { show: combat, at: [250, 61] },
    // EnemyMiniView: portrait (grey when exhausted), elite frame, ranged mark
    SpriteEnemy: { tex: art[String(enemy.model)], color: stunned ? [0.5, 0.5, 0.5, 1] : undefined },
    SpriteHighlight: { show: false },
    Sprite_UniqueId_Background: { show: false },
    Sprite_EliteFrame: { show: enemy.named },
    Sprite_Ranged: { show: enemy.ranged },
    Label_Enemy_Name: { html: say(enemy.nameOne) || enemy.nameOne },
    Label_NoBonuses: { show: true }, // bonuses are not modelled by the engine yet
    Panel_BonusInfo: { show: false },
    Button_OpenCombat: {
      disabled: !canAttack, title: canAttack ? say("UI_ATTACK") || "Атака" : "Сейчас атаковать нельзя",
      onClick: () => {
        if (combat) { setCombat(false); return; }
        setCombat(true); setDamage(0); setOn(new Set()); void sound.sfx("OpenAttackWindow01", 0.8);
      },
    },
    Button_CloseDialog: { onClick: () => (confirm ? setConfirm(false) : onClose()) },
    // combat card
    Label_DamageToApply: { text: String(damage) },
    Button_PlusDamage: { onClick: () => setDamage((d) => Math.min(99, d + 1)) },
    Button_MinusDamage: { onClick: () => setDamage((d) => Math.max(0, d - 1)) },
    "Sprite_Combat/Button_Confirm": { onClick: () => setConfirm(true) },
    // confirmation
    Sprite_ConfirmationDialog_Background: { show: confirm },
    Label_Confirm_Damage: { html: say("UI_CONFIRM_DAMAGE_FORMAT", [String(damage)]) || `Нанести ${damage}?` },
    "Sprite_ConfirmationDialog_Background/Button_Cancel": { onClick: () => setConfirm(false) },
    "Sprite_ConfirmationDialog_Background/Button_Confirm": {
      onClick: () => {
        const lost = start.reduce((s, u, i) => s + u.hp - units[i]!.hp, 0);
        void sound.sfx(lost > 0 ? "Axe Medium Hit" : "Hammer Medium Hit", 0.8);
        onAttack(lost);
      },
    },
  };
  ABILITIES.forEach((a, i) => {
    b[`Button_Ability_${a}`] = { onClick: () => toggle(a), className: on.has(a) ? "ng-on" : "" };
    b[`Sprite_Selected (${i})`] = { show: on.has(a) };
  });

  for (let j = 0; j < BARS; j++) {
    const bar = `Enemy_Healthbar (${j})`;
    if (j >= enemy.startSize) { b[bar] = { show: false }; continue; }
    const u = units[j]!;
    const s = (name: string, v: Binds[string]) => { b[`${bar}//${name}`] = v; };
    b[bar] = { show: true };
    // UpdateHealthBar: health, then sorcery and armor stacked after it (all empty once the unit is dead)
    const fh = u.hp / total;
    const fs = u.hp > 0 ? fh + u.sorcery / total : 0;
    const fa = u.hp > 0 ? fs + u.armor / total : 0;
    s("Label_Health", { text: `${u.hp}/${maxHp}` });
    s("Label_Sorcery", { show: maxSorc > 0, text: String(u.sorcery), color: combat && on.has("Smite") ? GREY_LABEL : undefined });
    s("Sprite_Sorcery", { color: combat && on.has("Smite") ? GREY_LABEL : undefined });
    s("Label_Armor", { show: maxArmor > 0, text: String(u.armor), color: combat && on.has("Pierce") ? GREY_LABEL : undefined });
    s("Sprite_Armor", { color: combat && on.has("Pierce") ? GREY_LABEL : undefined });
    s("Sprite_Health_FILL", { fill: fh });
    s("Sprite_Sorcery_FILL", { fill: fs, color: combat && on.has("Smite") ? [0.655, 0.655, 0.655, 1] : undefined });
    s("Sprite_Armor_FILL", { fill: fa, color: combat && on.has("Pierce") ? [0.58, 0.58, 0.58, 1] : undefined });
    s("Sprite_Dead", { show: u.hp <= 0 });
    s("Sprite_Targeted", { show: targeted(j) });
    // EnemyHealthBar.Initialize: ticks i < max, cellWidth 350 / max
    s("Grid_HealthTicks", { cell: [cell, 200] });
    s("Texture", { show: false });
    for (let i = 0; i < TICKS; i++) s(i ? `Sprite_Tick (${i})` : "Sprite_Tick", { show: i < total });
    // DisplayModifierFX: lethal shade over half the starting health, the line at that tick
    const half = Math.floor(start[j]!.hp / 2);
    const lethal = combat && on.has("Lethal") && u.hp > 0;
    s("Lethal_Visuals", { show: lethal });
    s("Sprite_Lethal_FILL", { fill: half / total });
    s("Transform_LethalVal", { at: [-BAR_W / 2 + Math.max(0, half - 1) * cell, 0] });
  }
  return <NguiView layout={layout} atlas={atlas} show={[dialog]} binds={b} say={say} className="ngui-enemy" />;
}
