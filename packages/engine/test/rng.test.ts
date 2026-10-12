import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng } from "../src/index.ts";

test("same seed -> same sequence", () => {
  const a = new Rng(42), b = new Rng(42);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
});

test("state round trip resumes the sequence", () => {
  const a = new Rng(7);
  a.next(); a.next();
  const b = new Rng(a.state);
  assert.equal(a.int(1, 6), b.int(1, 6));
});

test("int stays in range and covers it", () => {
  const r = new Rng(1), seen = new Set<number>();
  for (let i = 0; i < 1000; i++) {
    const v = r.int(1, 6);
    assert.ok(v >= 1 && v <= 6);
    seen.add(v);
  }
  assert.equal(seen.size, 6);
});
