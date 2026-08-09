import test from "node:test";
import assert from "node:assert/strict";
import { formatTelegramHtml, splitMessage } from "../src/telegram.js";
import { createMainKeyboard } from "../src/keyboards.js";

test("splits Telegram messages near line boundaries", () => { const chunks = splitMessage("one\ntwo\nthree\nfour", 8); assert.deepEqual(chunks, ["one\ntwo", "three", "four"]); assert.ok(chunks.every((chunk) => chunk.length <= 8)); });

test("builds a persistent model and mode reply keyboard beside the input", () => {
  const keyboard = createMainKeyboard({ model: "gemini-3.6-flash-high", effort: "high", mode: "plan", sandbox: true });
  assert.deepEqual(keyboard.keyboard, [["🤖 Model", "⚙ Mode: plan"]]);
  assert.equal(keyboard.resize_keyboard, true);
  assert.equal(keyboard.is_persistent, true);
  assert.equal("inline_keyboard" in keyboard, false);
});

test("labels accept-edits as edit in the persistent keyboard", () => {
  const keyboard = createMainKeyboard({ model: null, effort: "medium", mode: "accept-edits", sandbox: true });
  assert.deepEqual(keyboard.keyboard, [["🤖 Model", "⚙ Mode: edit"]]);
});

test("formats AGY Markdown-like responses as safe Telegram HTML", () => {
  const html = formatTelegramHtml('# Summary\n\n- **Ready**\n- Run `npm test`\n\n```ts\nconst ok = true;\n```\n\n[Docs](https://example.com?a=1&b=2)');
  assert.match(html, /<b>Summary<\/b>/);
  assert.match(html, /• <b>Ready<\/b>/);
  assert.match(html, /<code>npm test<\/code>/);
  assert.match(html, /<pre><code class="language-ts">const ok = true;<\/code><\/pre>/);
  assert.match(html, /<a href="https:\/\/example.com\?a=1&amp;b=2">Docs<\/a>/);
  assert.doesNotMatch(html, /<script|<img/);
});
