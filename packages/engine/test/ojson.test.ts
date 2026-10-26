// Order-preserving JSON: parse -> stringify -> parse keeps the file order of integer-like keys
import { test } from "node:test";
import assert from "node:assert/strict";
import { cloneOrdered, keysOf, parseOrdered, stringifyOrdered } from "../src/ojson.ts";

test("stringifyOrdered keeps integer-like keys in file order", () => {
  const text = '{"b":1,"gameObjects":{"918":{"name":"x"},"12":{"name":"y"},"3":[1,{"7":true,"2":null}]},"a":"q\\"uote"}';
  const o = parseOrdered(text) as any;
  assert.equal(stringifyOrdered(o), text);
  assert.deepEqual(keysOf(o.gameObjects), ["918", "12", "3"]);
  const c = cloneOrdered(o);
  assert.deepEqual(keysOf(c.gameObjects), ["918", "12", "3"]);
  assert.deepEqual(keysOf(c.gameObjects["3"][1]), ["7", "2"]);
});

test("stringifyOrdered: added keys after the ordered ones, deleted ones skipped, indent", () => {
  const o = parseOrdered('{"5":1,"1":2}') as any;
  o["0"] = 3;
  delete o["5"];
  assert.equal(stringifyOrdered(o), '{"1":2,"0":3}');
  assert.equal(stringifyOrdered({ a: [1], b: {} }, 1), '{\n "a": [\n  1\n ],\n "b": {}\n}');
});
