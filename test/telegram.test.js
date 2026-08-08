import test from "node:test";
import assert from "node:assert/strict";
import { splitMessage } from "../src/telegram.js";

test("splits Telegram messages near line boundaries", () => {
  const chunks = splitMessage("one\ntwo\nthree\nfour", 8);
  assert.deepEqual(chunks, ["one\ntwo", "three", "four"]);
  assert.ok(chunks.every((chunk) => chunk.length <= 8));
});
