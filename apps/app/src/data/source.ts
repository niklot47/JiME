// ContentSource for the browser: the engine is synchronous, so everything a game needs is fetched first.
// prepare(setup): db + adventure -> generate the board -> fetch only the encounters that board spawns.
import { boardEncounters, parseOrdered, sessionBoard, type ContentSource, type SessionSetup } from "@jime/engine";
import type { GeneratedMap } from "@jime/engine/map";
import { loadDb, packText } from "./pack.ts";

export class MissingContent extends Error {}

export class BrowserSource implements ContentSource {
  private readonly dbData: any;
  /** Raw JSON per adventure: every adventure() call parses a fresh copy (the engine mutates it) */
  private readonly advText = new Map<number, string>();
  private readonly enc = new Map<number, any | null>();

  private constructor(db: any) {
    this.dbData = db;
  }

  static async create(): Promise<BrowserSource> {
    return new BrowserSource(await loadDb());
  }

  db(): any {
    return this.dbData;
  }

  adventure(id: number | string): any {
    const t = this.advText.get(Number(id));
    if (t === undefined) throw new MissingContent(`adventure ${id} is not loaded`);
    return parseOrdered(t);
  }

  encounter(id: number): any | null {
    if (!this.enc.has(id)) throw new MissingContent(`encounter ${id} is not loaded`);
    return this.enc.get(id);
  }

  async loadAdventure(id: number): Promise<void> {
    if (!this.advText.has(id)) this.advText.set(id, await packText(`scenario/adventures/${id}.json`));
  }

  async loadEncounters(ids: number[]): Promise<void> {
    await Promise.all(ids.filter((id) => !this.enc.has(id)).map(async (id) => {
      try {
        this.enc.set(id, parseOrdered(await packText(`scenario/encounters/${id}.json`)));
      } catch {
        this.enc.set(id, null); // the engine warns and skips encounters without a prefab
      }
    }));
  }

  /** Load what a game with this setup needs and return its board (null: no generated map) */
  async prepare(setup: SessionSetup): Promise<GeneratedMap | null> {
    await this.loadAdventure(setup.adv);
    const board = sessionBoard(this, setup);
    if (board) await this.loadEncounters(boardEncounters(board));
    return board;
  }
}
