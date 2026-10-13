// Messages between the UI thread and the game worker (the engine replays the whole game on every answer)
import type { Answer, Decision, GameView, LogEntry, SaveData, SessionSetup } from "@jime/engine";
import type { GeneratedMap } from "@jime/engine/map";
import type { PackConfig } from "../data/pack.ts";

export type Request =
  /** packConfig: packs folder URL and disabled packs (the worker has no localStorage and cannot ask the host) */
  | { type: "start"; setup: SessionSetup; save?: SaveData; packConfig: PackConfig }
  | { type: "answer"; answer: Answer }
  | { type: "undo"; n?: number };

export interface GameState {
  view: GameView;
  pending: Decision | null;
  log: LogEntry[];
  answers: number;
  save: SaveData;
}

export type Reply =
  | { id: number; ok: true; state: GameState; board?: GeneratedMap | null }
  | { id: number; ok: false; error: string };
