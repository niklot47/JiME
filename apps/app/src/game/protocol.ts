// Messages between the UI thread and the game worker (the engine replays the whole game on every answer)
import type { Answer, Decision, GameView, LogEntry, SaveData, SessionSetup } from "@jime/engine";
import type { GeneratedMap } from "@jime/engine/map";

export type Request =
  /** packsRoot: URL of the packs folder (the worker cannot ask the Tauri host itself) */
  | { type: "start"; setup: SessionSetup; save?: SaveData; packsRoot: string }
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
