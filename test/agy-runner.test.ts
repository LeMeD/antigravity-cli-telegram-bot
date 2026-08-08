import test from "node:test";
import assert from "node:assert/strict";
import { buildArgs, extractConversationId, formatStepUpdate, normalizeUsage, parseStreamOutput } from "../src/agy-runner.js";
import type { AgyConfig } from "../src/types.js";

const config: AgyConfig = { timeoutMs: 60000, project: "project", mode: "plan", model: "model", effort: "high", sandbox: true, allowSandboxDisable: false, allowedModels: [], bin: "agy", workspace: "/tmp" , maxOutputBytes: 2000000 };

test("builds non-interactive safe AGY arguments", () => {
  assert.deepEqual(buildArgs(config, "hello", "conv-1"), ["--print", "hello", "--output-format", "stream-json", "--print-timeout", "60s", "--project", "project", "--mode", "plan", "--model", "model", "--effort", "high", "--sandbox", "--conversation", "conv-1"]);
});

test("builds per-session overrides without unsafe flags", () => {
  assert.deepEqual(buildArgs(config, "hello", null, { model: "claude-sonnet-4-6", effort: "low", mode: "accept-edits", sandbox: false }), ["--print", "hello", "--output-format", "stream-json", "--print-timeout", "60s", "--project", "project", "--mode", "accept-edits", "--model", "claude-sonnet-4-6", "--effort", "low"]);
});

test("extracts nested conversation IDs", () => {
  assert.equal(extractConversationId({ result: { conversation_id: "conv-2" } }), "conv-2");
  assert.equal(extractConversationId({ output: "text" }), null);
});

test("parses stream events, response drafts, and usage", () => {
  const output = [
    JSON.stringify({ event: "init", conversation_id: "conv-4", init: { model: "gemini-3.6-flash-low" } }),
    JSON.stringify({ event: "step_update", step_update: { step_type: "agent_response", text_delta: "partial " } }),
    JSON.stringify({ event: "step_update", step_update: { step_type: "run_command", tool_info: { name: "run_command" } } }),
    JSON.stringify({ event: "result", result: { conversation_id: "conv-4", status: "SUCCESS", response: "done\n", duration_seconds: 2.5, num_turns: 1, usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 } } }),
  ].join("\n");
  const parsed = parseStreamOutput(output);
  assert.equal(parsed.text, "done"); assert.equal(parsed.conversationId, "conv-4"); assert.equal(parsed.model, "gemini-3.6-flash-low");
  assert.deepEqual(parsed.usage, { input_tokens: 10, output_tokens: 4, total_tokens: 14 }); assert.equal(parsed.durationMs, 2500); assert.equal(parsed.numTurns, 1); assert.equal(parsed.toolCalls, 1); assert.equal(parsed.status, "SUCCESS");
});

test("normalizes usage and formats progress", () => {
  assert.deepEqual(normalizeUsage({ input_tokens: "5", output_tokens: -1, total_tokens: "bad" }), { input_tokens: 5 });
  assert.equal(normalizeUsage(null), null);
  assert.equal(formatStepUpdate({ tool_info: { name: "run_command" } }), "Tool: run_command");
  assert.equal(formatStepUpdate({ step_type: "agent_response" }), "Generating response...");
});
