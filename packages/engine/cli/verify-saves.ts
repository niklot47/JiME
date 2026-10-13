// Verify the map generator against the original game: BuildDump.dat (seed + campaign state of every build)
// and saved games (ordered UsedEncounterIds; mid-adventure saves also have tile positions and rotations).
// Usage: node cli/verify-saves.ts [dir with BuildDump.dat and slot*.json | the game's SavedGames folder]
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { MapGenerator } from "../src/map/mapgen.ts";
import { PackDirSource, defaultPackDir } from "../src/node/packSource.ts";

const dir = resolve(process.argv[2] ?? join(process.env.JIME_WORK ?? join(import.meta.dirname, "../../../data"), "ref", "saves"));
const src = new PackDirSource(defaultPackDir());
const list = (s: string) => (s.trim() ? s.split(",").map(Number) : []);

// saves: slot*.json files, or <n>/SavedGameA folders
const saves: any[] = [];
for (const n of readdirSync(dir)) {
  const p = join(dir, n);
  const f = statSync(p).isDirectory() ? join(p, "SavedGameA") : n.endsWith(".json") ? p : null;
  if (f && existsSync(f)) saves.push(JSON.parse(readFileSync(f, "utf8").replace(/^﻿/, "")));
}

const dump = readFileSync(join(dir, "BuildDump.dat"), "utf8");
const re = /Version: ([\d.]+), Adventure: (\d+), Seed: (-?\d+), Player Count: (\d+), Products: \[([^\]]*)\], UnlockedChainEncounterIds: \[([^\]]*)\], CampaignUsedEncounterIds: \[([^\]]*)\], CampaignUsedEncounterGroupIds: \[([^\]]*)\]/g;
let checks = 0, fails = 0;
const entries = [...dump.matchAll(re)];
const current = entries.length ? entries[entries.length - 1]![1] : "";
const startsWith = (a: number[], p: number[]) => p.every((x, i) => a[i] === x);
for (const m of entries) {
  const [, version, adv, seed, players, products, chain, used, groups] = m;
  const usedBefore = list(used!);
  const id = `A${adv} seed ${seed} (${players}p, v${version})`;
  // the save written after this build: same seed, or a later save of the campaign whose history continues it
  const cands = saves.filter((s) => s.LastUsedSeed === Number(seed)
    || (s.UsedEncounterIds.length > usedBefore.length && startsWith(s.UsedEncounterIds, usedBefore) && (s.CompletedAdventureIds ?? []).includes(Number(adv))));
  if (!cands.length) { console.log(`· ${id}: no save to compare with, skipped`); continue; }
  const save = cands.find((s) => s.LastUsedSeed === Number(seed)) ?? cands[0];
  // party inventory at build time is not in the dump: try the save's items, then subsets by prefix
  const items: number[] = save.ItemIds ?? [];
  const candidates = [...Array(items.length + 1).keys()].map((k) => items.slice(0, k));
  let best: { ok: boolean; msg: string } | null = null;
  for (const groupItems of candidates) {
    const g = new MapGenerator(src.db(), src.adventure(Number(adv)), {
      seed: Number(seed), players: Number(players), products: list(products!), language: "English",
      unlockedChain: list(chain!), usedEncounters: usedBefore, usedGroups: list(groups!), groupItems,
    });
    const r = g.generate();
    const truth: number[] = save.UsedEncounterIds.slice(0, r.usedEncounters.length);
    const encOk = JSON.stringify(r.usedEncounters) === JSON.stringify(truth);
    let tileMsg = "";
    let tilesOk = true;
    const tiles = save.AdventureData?.Tiles ?? [];
    if (tiles.length && save.CurrentAdventureId === Number(adv)) {
      const secs = (g as any).sections.map((sb: any) => sb.section);
      let n = 0;
      for (const st of tiles) {
        const sec = secs.find((s: any) => s.tiles.some((t: any) => t.hashId === st.Id));
        const t = sec?.tiles.find((t: any) => t.hashId === st.Id);
        const h = t?.hexes[0].globalCoords, e = st.StartHexGlobalCoord;
        if (t && sec.id === st.SectionId && t.localRotations === st.LocalRotations && h.x === e.x && h.y === e.y && h.z === e.z) n++;
      }
      tilesOk = n === tiles.length;
      tileMsg = `, tiles ${n}/${tiles.length} (position + rotation)`;
    }
    const ok = encOk && tilesOk;
    const msg = `encounters ${encOk ? "identical" : "differ"} (${r.usedEncounters.length - usedBefore.length} new)${tileMsg}${groupItems.length ? `, items ${groupItems}` : ""}`;
    if (ok || !best) best = { ok, msg };
    if (ok) break;
  }
  if (version !== current) { console.log(`${best!.ok ? "✓" : "·"} ${id}: ${best!.msg} — older game version, informational`); continue; }
  checks++;
  if (!best!.ok) fails++;
  console.log(`${best!.ok ? "✓" : "✗"} ${id}: ${best!.msg}`);
}
console.log(`\n${checks - fails}/${checks} builds of the current game version (${current}) reproduced exactly`);
process.exit(fails ? 1 : 0);
