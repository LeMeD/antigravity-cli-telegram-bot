import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { getModelMaxContext, renderContextProgressBar } from "../src/models.js";

const base = { TELEGRAM_BOT_TOKEN: "token", TELEGRAM_ALLOWED_USER_IDS: "123,456", AGY_WORKSPACE: "/srv/workspace" };
test("loads full-control defaults and allowlist", () => { const config = loadConfig(base); assert.deepEqual(config.telegram.allowedUserIds, ["123", "456"]); assert.equal(config.telegram.privateOnly, true); assert.equal(config.agy.mode, "plan"); assert.equal(config.agy.sandbox, false); assert.equal(config.agy.allowSandboxDisable, true); assert.equal(config.agy.allowDangerouslySkipPermissions, true); assert.equal(config.agy.effort, "high"); assert.ok(config.agy.allowedModels.includes("gemini-3.7-flash-high")); assert.ok(config.agy.allowedModels.includes("claude-sonnet-4-6")); });
test("rejects invalid configuration", () => { assert.throws(() => loadConfig({ ...base, TELEGRAM_ALLOWED_USER_IDS: "" }), /at least one ID/); assert.throws(() => loadConfig({ ...base, AGY_WORKSPACE: "workspace" }), /absolute/); assert.throws(() => loadConfig({ ...base, AGY_MODE: "dangerously-skip-permissions" }), /AGY_MODE/); assert.throws(() => loadConfig({ ...base, AGY_EFFORT: "extreme" }), /AGY_EFFORT/); assert.throws(() => loadConfig({ ...base, AGY_ALLOWED_MODELS: "not-a-model" }), /AGY_ALLOWED_MODELS/); });
test("allows sandbox disable", () => { assert.equal(loadConfig({ ...base, AGY_ALLOW_SANDBOX_DISABLE: "0" }).agy.allowSandboxDisable, false); });
test("allows the dangerous permission flag to be disabled", () => { assert.equal(loadConfig({ ...base, AGY_ALLOW_DANGEROUSLY_SKIP_PERMISSIONS: "0" }).agy.allowDangerouslySkipPermissions, false); });
test("loads and resolves AGY_DB_PATH with home directory expansion", () => {
  const config = loadConfig({ ...base, AGY_DB_PATH: "~/custom_conv.db" });
  assert.ok(!config.agy.dbPath.startsWith("~"));
  assert.ok(config.agy.dbPath.endsWith("custom_conv.db"));
});

test("calculates max context limits and renders progress bar", () => {
  assert.equal(getModelMaxContext("gemini-3.7-flash-high"), 1_000_000);
  assert.equal(getModelMaxContext("gemini-3.6-flash-high"), 1_000_000);
  assert.equal(getModelMaxContext("claude-sonnet-4-6"), 200_000);
  const bar = renderContextProgressBar(150000, 1000000);
  assert.ok(bar.includes("15.0%"));
  assert.ok(bar.includes("150,000 / 1M"));
});
