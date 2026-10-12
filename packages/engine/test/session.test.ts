// Session: pause on decisions, answer, undo, save/load (synthetic scenario, no FFG data)
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ContentSource } from "../src/game.ts";
import { AnswerError, Session, recordBotGame } from "../src/session.ts";

const st = (name: string, actions: any[], transitions: Record<string, string> = {}) => ({ name, transitions, actions });
const act = (action: string, params: any = {}) => ({ action, enabled: true, params });

const src: ContentSource = {
  db: () => ({ models: { EnemyModel: {}, TileModel: {}, EncounterModel: {}, EncounterGroupModel: {}, LastStandModel: {} }, standardTiles: {}, globals: {} }),
  adventure: () => ({
    root: 1,
    model: { _id: 99, ThreatLimit: 100 },
    gameObjects: { "1": { name: "Adventure", parent: null, components: { Adventure: {} } } },
    fsms: [{
      name: "FSM", start: "Ask", go: 1, variables: {}, global: {},
      states: [
        st("Ask", [act("DisplayMessageMultipleChoice", {
          Message: "«Q»", Choices: [{ Localization: "«A»", Event: "A" }, { Localization: "«B»", Event: "B" }], CancelChoice: {},
        })], { A: "Test", B: "Lose" }),
        st("Test", [act("DisplayMessageChallenge", { Message: "«T»", ResultPairs: [{ Sum: 1, Event: "FAIL" }, { Sum: 3, Event: "OK" }] })],
          { FAIL: "Lose", OK: "Win" }),
        st("Win", [act("EndGame", { Success: 1 })]),
        st("Lose", [act("EndGame", { Success: 0 })]),
      ],
    }],
  }),
  encounter: () => null,
};

test("session pauses on each decision and resumes after an answer", () => {
  const s = new Session(src, { adv: 99, seed: 1 });
  assert.equal(s.status, "waiting");
  assert.deepEqual(s.pending, { kind: "choice", key: "Q", choices: [{ key: "A" }, { key: "B" }], canCancel: false });
  s.answer(0);
  assert.deepEqual(s.pending, { kind: "test", key: "T", top: 3 });
  s.answer(2);
  assert.equal(s.status, "ended");
  assert.equal(s.game.result, "victory");
  assert.deepEqual(s.log.map((e) => e[2]), ["Q", "A", "T"]);
});

test("undo takes back answers", () => {
  const s = new Session(src, { adv: 99, seed: 1 }, [0, 2]);
  assert.equal(s.game.result, "victory");
  s.undo();
  assert.equal(s.pending?.kind, "test");
  s.answer(0);
  assert.equal(s.game.result, "defeat");
});

test("invalid answers are rejected without changing the game", () => {
  const s = new Session(src, { adv: 99, seed: 1 });
  assert.throws(() => s.answer(5), AnswerError);
  assert.throws(() => s.answer(null), AnswerError); // cancel not allowed here
  assert.throws(() => s.answer(true), AnswerError);
  assert.deepEqual(s.answers, []);
  assert.equal(s.pending?.kind, "choice");
});

test("save/load round trip through JSON", () => {
  const s = new Session(src, { adv: 99, seed: 1 }, [0]);
  const data = JSON.parse(JSON.stringify(s.save({ id: "test", version: "1.0.0" })));
  assert.equal(data.format, "jime-save");
  const t = Session.load(src, data);
  assert.deepEqual(t.pending, s.pending);
  t.answer(3);
  assert.equal(t.game.result, "victory");
});

test("recorded bot game replays identically", () => {
  const { game, answers } = recordBotGame(src, { adv: 99, seed: 7 });
  const s = new Session(src, { adv: 99, seed: 7 }, answers);
  assert.equal(s.status, "ended");
  assert.deepEqual(s.log, game.log);
  assert.equal(s.game.result, game.result);
});
