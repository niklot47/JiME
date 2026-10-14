// The original's enemy dialog (UI_Game/Enemy_Banner/"Dialog_EnemyInfo/Combat") drawn from the exported layout and driven
// like FFG.JIME.EnemyInfoDialog + EnemyHealthBar (decompiled code): portrait medallion, name, bonuses, one health bar
// per unit the group started with (health, sorcery and armor fills over 350 / max ticks), the sword button sliding
// the card left and the combat card right (abilities, hits stepper, resolve), and the damage confirmation.
// The preview uses the engine's calculateHealth; the attack answers hits + 100 x the ability flags.
import { useState } from "react";
import { ATTACK_ABILITIES, calculateHealth, type AttackAbility, type GameView } from "@jime/engine";
import { sound } from "../../audio/sound.ts";
import { NguiView, type Binds } from "../../ngui/NguiView.tsx";
import type { UiLayoutFile, UiNode } from "../../ngui/types.ts";
import type { Atlas, Say } from "./ui.ts";

type EnemyView = GameView["enemies"][number];

const ABILITIES = Object.keys(ATTACK_ABILITIES) as AttackAbility[]; // Button_Ability_* / Sprite_Selected (n) order
const GREY_LABEL = [0.522, 0.522, 0.522, 1]; // TweenArmorDisabled / TweenSorceryDisabled targets
const BARS = 3; // Enemy_Healthbar (0..2)
const TICKS = 30; // Sprite_Tick, Sprite_Tick (1..29)
const BAR_W = 350;

function byName(n: UiNode, name: string): UiNode | null {
  if (n.n === name) return n;
  for (const c of n.ch ?? []) {
    const r = byName(c, name);
    if (r) return r;
  }
  return null;
}

// Table_Bonuses (UITable, 2 columns, centred, padding 6): the keyword plates of 1..3 bonuses
const PLATES: [number, number][][] = [[], [[0, 0]], [[-59, 0], [59, 0]], [[-59, 20.5], [59, 20.5], [0, -20.5]]];
// Table_Bonus_Descriptions (UITable, 1 column from the top, padding 8): text 22 px in 232 px, lines of ~26 px
const DESC_W_CHARS = 21, DESC_LINE = 26;

function bonusBinds(b: Binds, enemy: EnemyView, say: Say): void {
  const n = enemy.bonuses.length;
  for (let i = 0; i < 3; i++) {
    const bonus = enemy.bonuses[i];
    b[`Sprite_Bonus_${i}`] = bonus ? { show: true, at: PLATES[n]![i]! } : { show: false };
    if (bonus) b[`Label_Bonus_Name_${i}`] = { html: say(bonus.name) || bonus.name };
  }
  // LoadBonusDescriptions: UI_BONUS_FORMAT (name, description) per bonus; the border grows with the table
  let y = -8;
  for (let i = 0; i < 3; i++) {
    const bonus = enemy.bonuses[i];
    const key = `Table_Bonus_Descriptions/Label_Bonus_${i + 1}`;
    if (!bonus) { b[key] = { show: false }; continue; }
    const name = say(bonus.name) || bonus.name, desc = say(bonus.desc) || bonus.desc;
    const html = say("UI_BONUS_FORMAT", [name, desc]) || `<b>${name}</b> - ${desc}`;
    const chars = html.replace(/<[^>]+>/g, "").length;
    const h = Math.max(1, Math.ceil(chars / DESC_W_CHARS)) * DESC_LINE;
    b[key] = { show: true, html, h, at: [0, y - h / 2] };
    y -= h + 16;
  }
  b["Table_Bonus_Descriptions/Widget_Spacer"] = { at: [0, y - 1] };
  // Sprite_Border: top fixed, bottom anchored 19 below the spacer (the table starts 25 below the top)
  b["Panel_BonusInfo/Sprite_Border"] = { h: 25 - y + 2 + 19 };
}

export function NguiEnemy({ layout, atlas, say, art, enemy, canAttack, onAttack, onClose }: {
  layout: UiLayoutFile; atlas: Atlas; say: Say; art: Record<string, string>; enemy: EnemyView; canAttack: boolean;
  /** the attack answer: hits + 100 x AttackAbilityType flags */
  onAttack: (answer: number) => void; onClose: () => void;
}) {
  const [combat, setCombat] = useState(false);
  const [damage, setDamage] = useState(0);
  const [on, setOn] = useState<Set<AttackAbility>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [bonusInfo, setBonusInfo] = useState(false);
  const dialog = byName(layout.root, "Dialog_EnemyInfo/Combat");
  if (!dialog) return null;

  const start = enemy.units;
  const flags = [...on].reduce((f, a) => f | ATTACK_ABILITIES[a], 0);
  const units = combat ? calculateHealth(start, damage, flags) : start;
  const maxHp = enemy.unitHp, maxArmor = enemy.armor, maxSorc = enemy.sorcery;
  const total = Math.max(1, maxHp + maxArmor + maxSorc);
  const cell = BAR_W / total;
  // IsUnitTargeted: the first living unit, every living unit with Cleave
  const firstAlive = units.findIndex((u) => u.hp !== 0);
  const targeted = (i: number) => combat && units[i]!.hp !== 0 && (on.has("Cleave") || i === firstAlive);
  const stunned = enemy.exhausted || (combat && on.has("Stun"));
  const toggle = (a: AttackAbility) => setOn((s) => { const n = new Set(s); if (n.has(a)) n.delete(a); else n.add(a); return n; });

  const b: Binds = {
    "Dialog_EnemyInfo/Combat": { show: true },
    ZeroDamage: { show: false }, DealDamage: { show: false },
    // Show(): both cards at animStart; OnButtonCombatClicked plays the group 8 tweens (info left, combat right)
    Sprite_EnemyInfo: combat ? { at: [-225, 61] } : {},
    Sprite_Combat: { show: combat, at: [250, 61] },
    // EnemyMiniView: portrait (grey when exhausted), elite frame, ranged mark
    SpriteEnemy: { tex: art[String(enemy.model)], color: stunned ? [0.5, 0.5, 0.5, 1] : undefined },
    SpriteHighlight: { show: false },
    Sprite_UniqueId_Background: enemy.banner > 0 ? { show: true, sprite: `Banner${String(enemy.banner).padStart(2, "0")}` } : { show: false },
    Sprite_EliteFrame: { show: enemy.elite },
    Sprite_Ranged: { show: enemy.ranged },
    Label_Enemy_Name: { html: say(enemy.nameOne) || enemy.nameOne },
    // Load: one keyword plate per bonus (Table_Bonuses), "no bonuses" without any; a click opens the descriptions
    Label_NoBonuses: { show: enemy.bonuses.length === 0 },
    Button_OpenBonuses: { onClick: enemy.bonuses.length ? () => { void sound.sfx("InfoDrawerOpen", 0.6); setBonusInfo(true); } : undefined },
    Panel_BonusInfo: { show: bonusInfo },
    "Panel_BonusInfo/Button_CloseDialog": { onClick: () => setBonusInfo(false) },
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
        // CoroutineDisplayDamage: hit sound with damage, miss sound without
        void sound.sfx(damage > 0 ? "Axe Medium Hit" : "Hammer Medium Hit", 0.8);
        onAttack(damage + 100 * flags);
      },
    },
  };
  bonusBinds(b, enemy, say);
  ABILITIES.forEach((a, i) => {
    // abilities blocked by the group's bonuses are hidden (EnemyInfoDialog._blockedAbilities)
    if (enemy.blocked & ATTACK_ABILITIES[a]) { b[`Button_Ability_${a}`] = { show: false }; return; }
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
    s("Label_Sorcery", { show: start[j]!.sorcery > 0, text: String(u.sorcery), color: combat && on.has("Smite") ? GREY_LABEL : undefined });
    s("Sprite_Sorcery", { color: combat && on.has("Smite") ? GREY_LABEL : undefined });
    s("Label_Armor", { show: start[j]!.armor > 0, text: String(u.armor), color: combat && on.has("Pierce") ? GREY_LABEL : undefined });
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
