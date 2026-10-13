// UI-side handle of the game worker: request -> promise of the new state
import type { GeneratedMap } from "@jime/engine/map";
import type { GameState, Reply, Request } from "./protocol.ts";

export class GameClient {
  private readonly worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  private next = 1;
  private readonly waiting = new Map<number, { ok: (r: Extract<Reply, { ok: true }>) => void; fail: (e: Error) => void }>();

  constructor() {
    this.worker.onmessage = (e: MessageEvent<Reply>) => {
      const w = this.waiting.get(e.data.id);
      if (!w) return;
      this.waiting.delete(e.data.id);
      if (e.data.ok) w.ok(e.data);
      else w.fail(new Error(e.data.error));
    };
    this.worker.onerror = (e) => {
      for (const w of this.waiting.values()) w.fail(new Error(e.message || "game worker failed"));
      this.waiting.clear();
    };
  }

  request(req: Request): Promise<{ state: GameState; board?: GeneratedMap | null }> {
    const id = this.next++;
    return new Promise((ok, fail) => {
      this.waiting.set(id, { ok, fail });
      this.worker.postMessage({ id, req });
    });
  }

  dispose(): void {
    this.worker.terminate();
  }
}
