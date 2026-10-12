// ContentSource reading a scenario pack from disk (Node only; the app will use a Tauri-backed source)
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseOrdered } from "../ojson.ts";
import type { ContentSource } from "../game.ts";

const read = (p: string): any => parseOrdered(readFileSync(p, "utf8"));

export class PackDirSource implements ContentSource {
  private dbCache: any = null;
  private readonly enc = new Map<number, any>();
  readonly scenarioDir: string;
  readonly packDir: string;

  constructor(packDir: string) {
    this.packDir = packDir;
    this.scenarioDir = join(packDir, "scenario");
    if (!existsSync(join(this.scenarioDir, "db.json"))) throw new Error(`no scenario/db.json in ${packDir}`);
  }

  db(): any {
    return (this.dbCache ??= read(join(this.scenarioDir, "db.json")));
  }

  adventure(id: number | string): any {
    return read(join(this.scenarioDir, "adventures", `${id}.json`));
  }

  encounter(id: number): any | null {
    if (!this.enc.has(id)) {
      const p = join(this.scenarioDir, "encounters", `${id}.json`);
      this.enc.set(id, existsSync(p) ? read(p) : null);
    }
    return this.enc.get(id);
  }
}

/** core-ffg pack location: $JIME_PACKS or $JIME_WORK/packs or <repo>/data/packs */
export function defaultPackDir(id = "core-ffg"): string {
  const repo = resolve(import.meta.dirname, "../../../..");
  const packs = process.env.JIME_PACKS ?? join(process.env.JIME_WORK ?? join(repo, "data"), "packs");
  return join(packs, id);
}
