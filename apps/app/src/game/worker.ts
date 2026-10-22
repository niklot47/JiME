// Game worker: owns the content source and the Session, so map generation and replays never block the UI
import { Session, finishAdventure } from "@jime/engine";
import { BrowserSource } from "../data/source.ts";
import { applyPackConfig } from "../data/pack.ts";
import type { GameState, Reply, Request } from "./protocol.ts";

let src: BrowserSource | null = null;
let session: Session | null = null;

const state = (s: Session): GameState => ({
  view: s.view(), pending: s.pending, log: [...s.log], answers: s.answers.length, save: s.save(),
});

async function handle(req: Request): Promise<Omit<Extract<Reply, { ok: true }>, "id">> {
  if (req.type === "start") {
    if (applyPackConfig(req.packConfig)) src = null;
    src ??= await BrowserSource.create();
    const board = await src.prepare(req.setup);
    session = req.save ? Session.load(src, req.save, { board }) : new Session(src, req.setup, [], { board });
    return { ok: true, state: state(session), board };
  }
  if (!session) throw new Error("no game started");
  if (req.type === "finish") {
    const campaign = structuredClone(req.campaign);
    finishAdventure(campaign, session.game);
    return { ok: true, state: state(session), campaign };
  }
  if (req.type === "answer") session.answer(req.answer);
  else session.undo(req.n ?? 1);
  return { ok: true, state: state(session) };
}

// requests are handled one at a time, in order
const ctx = self as unknown as { onmessage: ((e: MessageEvent<{ id: number; req: Request }>) => void) | null; postMessage(m: Reply): void };
let queue: Promise<unknown> = Promise.resolve();
ctx.onmessage = (e) => {
  const { id, req } = e.data;
  queue = queue.then(async () => {
    let reply: Reply;
    try {
      reply = { id, ...(await handle(req)) };
    } catch (err) {
      reply = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    ctx.postMessage(reply);
  });
};
