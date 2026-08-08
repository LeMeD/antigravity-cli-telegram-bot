import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";

const base = {
  TELEGRAM_BOT_TOKEN: "token",
  TELEGRAM_ALLOWED_USER_IDS: "123,456",
  AGY_WORKSPACE: "/srv/workspace",
};

test("loads safe defaults and allowlist", () => {
  const config = loadConfig(base);
  assert.deepEqual(config.telegram.allowedUserIds, ["123", "456"]);
  assert.equal(config.telegram.privateOnly, true);
  assert.equal(config.agy.mode, "plan");
  assert.equal(config.agy.sandbox, true);
});

test("rejects an empty Telegram allowlist", () => {
  assert.throws(() => loadConfig({ ...base, TELEGRAM_ALLOWED_USER_IDS: "" }), /at least one ID/);
});

test("rejects a relative workspace", () => {
  assert.throws(() => loadConfig({ ...base, AGY_WORKSPACE: "workspace" }), /absolute/);
});

test("rejects dangerous unsupported AGY mode", () => {
  assert.throws(() => loadConfig({ ...base, AGY_MODE: "dangerously-skip-permissions" }), /AGY_MODE/);
});
