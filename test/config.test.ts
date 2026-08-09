import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";

const base = { TELEGRAM_BOT_TOKEN: "token", TELEGRAM_ALLOWED_USER_IDS: "123,456", AGY_WORKSPACE: "/srv/workspace" };
test("loads safe defaults and allowlist", () => { const config = loadConfig(base); assert.deepEqual(config.telegram.allowedUserIds, ["123", "456"]); assert.equal(config.telegram.privateOnly, true); assert.equal(config.agy.mode, "plan"); assert.equal(config.agy.sandbox, true); assert.equal(config.agy.allowSandboxDisable, false); assert.equal(config.agy.allowDangerouslySkipPermissions, false); assert.equal(config.agy.effort, "high"); assert.ok(config.agy.allowedModels.includes("claude-sonnet-4-6")); });
test("rejects invalid configuration", () => { assert.throws(() => loadConfig({ ...base, TELEGRAM_ALLOWED_USER_IDS: "" }), /at least one ID/); assert.throws(() => loadConfig({ ...base, AGY_WORKSPACE: "workspace" }), /absolute/); assert.throws(() => loadConfig({ ...base, AGY_MODE: "dangerously-skip-permissions" }), /AGY_MODE/); assert.throws(() => loadConfig({ ...base, AGY_EFFORT: "extreme" }), /AGY_EFFORT/); assert.throws(() => loadConfig({ ...base, AGY_ALLOWED_MODELS: "not-a-model" }), /AGY_ALLOWED_MODELS/); });
test("allows sandbox disable only when explicitly configured", () => { assert.equal(loadConfig({ ...base, AGY_ALLOW_SANDBOX_DISABLE: "1" }).agy.allowSandboxDisable, true); });
test("allows the dangerous permission flag only when explicitly configured", () => { assert.equal(loadConfig({ ...base, AGY_ALLOW_DANGEROUSLY_SKIP_PERMISSIONS: "1" }).agy.allowDangerouslySkipPermissions, true); });
test("loads and resolves AGY_DB_PATH with home directory expansion", () => {
  const config = loadConfig({ ...base, AGY_DB_PATH: "~/custom_conv.db" });
  assert.ok(!config.agy.dbPath.startsWith("~"));
  assert.ok(config.agy.dbPath.endsWith("custom_conv.db"));
});
