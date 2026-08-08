import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StateStore } from "../src/state.js";

test("merges session updates and persists them with restricted permissions", async () => { const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agy-state-")); const file = path.join(directory, "state.json"); const state = new StateStore(file); await state.load(); await state.setSession("123", { conversationId: "conv-1", settings: { mode: "plan" } }); await state.setSession("123", { lastRun: { status: "SUCCESS" } }); assert.deepEqual(state.session("123"), { conversationId: "conv-1", settings: { mode: "plan" }, lastRun: { status: "SUCCESS" } }); assert.equal((await fs.stat(file)).mode & 0o777, 0o600); });
