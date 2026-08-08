import test from "node:test";
import assert from "node:assert/strict";
import { buildArgs, extractConversationId, parseOutput } from "../src/agy-runner.js";

const config = {
  timeoutMs: 60000,
  project: "project",
  mode: "plan",
  model: "model",
  effort: "high",
  sandbox: true,
};

test("builds non-interactive safe AGY arguments", () => {
  assert.deepEqual(buildArgs(config, "hello", "conv-1"), [
    "--print", "hello", "--output-format", "json", "--print-timeout", "60s",
    "--project", "project", "--mode", "plan", "--model", "model", "--effort", "high",
    "--sandbox", "--conversation", "conv-1",
  ]);
});

test("extracts nested conversation IDs", () => {
  assert.equal(extractConversationId({ result: { conversation_id: "conv-2" } }), "conv-2");
  assert.equal(extractConversationId({ output: "text" }), null);
});

test("parses common AGY JSON result fields", () => {
  assert.deepEqual(parseOutput('{"response":"done","conversationId":"conv-3"}'), {
    text: "done",
    parsed: { response: "done", conversationId: "conv-3" },
    conversationId: "conv-3",
  });
});
