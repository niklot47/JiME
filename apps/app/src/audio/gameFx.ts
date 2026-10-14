// Game sounds from view changes (the engine has no audio events: we compare two snapshots, like the original's UI reacts)
import type { GameView, LogEntry } from "@jime/engine";
import { sound } from "./sound.ts";

const HITS = ["Axe Medium Hit", "Hammer Medium Hit", "Pierce02", "Smite02", "Cleave01", "Sunder02", "Sword Two-Handed Stab"];
const REVEALS = ["Reveal01", "Reveal02", "Reveal03", "Reveal04"];
/** Log keys of phase changes (also used for the phase banner) */
export const PHASE_KEYS = new Set(["UI_PHASE_HERO", "UI_PHASE_SHADOW", "UI_RALLY_PHASE"]);

/** Play the sounds for prev -> next (newLog: the entries added by this step) */
export function gameSounds(prev: GameView, next: GameView, newLog: readonly LogEntry[]): void {
  const explored = (v: GameView) => v.tiles.filter((t) => t.explored).length;
  const shown = (v: GameView) => v.nodes.filter((n) => n.visible).length;
  if (explored(next) > explored(prev)) void sound.sfx("TileReveal02", 0.9);
  if (next.campaign.lore > prev.campaign.lore) void sound.sfx("GainLore05", 0.9); // AudioController.PlayGainLore
  else if (shown(next) > shown(prev)) sound.any(REVEALS, 0.5);
  if (next.threat > prev.threat) void sound.sfx("Threat02", 0.8);
  const before = new Map(prev.enemies.map((e) => [e.uid, e]));
  let hit = false;
  for (const e of next.enemies) {
    const p = before.get(e.uid);
    if (!p) void sound.enemy(e.model);
    else if (e.damage > p.damage || e.size < p.size) hit = true;
  }
  if (prev.enemies.some((e) => !next.enemies.some((n) => n.uid === e.uid))) hit = true;
  if (hit) sound.any(HITS, 0.8);
  if (next.heroes.some((h, i) => h.defeated && !prev.heroes[i]?.defeated)) void sound.sfx("HeroDefeat05");
  if (newLog.some(([, , k]) => k === "UI_PHASE_SHADOW")) void sound.sfx("DifficultyHit01", 0.6);
  else if (newLog.some(([, , k]) => PHASE_KEYS.has(k))) void sound.sfx("UISlideIn", 0.7);
  if (next.ended && !prev.ended)
    void sound.sfx(next.result === "victory" ? "FFG_LotR_Palantir(Stinger)_v2.0" : "FFG_LotR_SpiritHeroDeath(Stinger)_v1.1");
}
