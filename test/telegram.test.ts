import test from "node:test";
import assert from "node:assert/strict";
import { splitMessage } from "../src/telegram.js";
import { createMainKeyboard } from "../src/keyboards.js";

test("splits Telegram messages near line boundaries", () => { const chunks = splitMessage("one\ntwo\nthree\nfour", 8); assert.deepEqual(chunks, ["one\ntwo", "three", "four"]); assert.ok(chunks.every((chunk) => chunk.length <= 8)); });

test("builds a persistent reply keyboard beside the input", () => {
  const keyboard = createMainKeyboard({ model: "gemini-3.6-flash-high", effort: "high", mode: "plan", sandbox: true });
  assert.deepEqual(keyboard.keyboard[2], ["📊 Usage / Quota", "🧾 Session"]);
  assert.equal(keyboard.resize_keyboard, true);
  assert.equal(keyboard.is_persistent, true);
  assert.equal("inline_keyboard" in keyboard, false);
});
