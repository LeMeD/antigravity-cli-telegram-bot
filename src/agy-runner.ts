import { spawn } from "node:child_process";
import type { AgyConfig, AgyResult, RunnerOptions, StreamEvent, Usage } from "./types.js";

const CONVERSATION_KEYS = new Set(["conversationId", "conversation_id", "conversationID", "sessionId", "session_id"]);

export function buildArgs(config: AgyConfig, prompt: string, conversationId: string | null, overrides: RunnerOptions = {}): string[] {
  const effective = { ...config, ...overrides };
  const outputFormat = effective.outputFormat || "stream-json";
  const args = ["--print", prompt, "--output-format", outputFormat, "--print-timeout", `${Math.ceil(effective.timeoutMs / 1000)}s`];
  if (effective.project) args.push("--project", effective.project);
  if (effective.mode) args.push("--mode", effective.mode);
  if (effective.model) args.push("--model", effective.model);
  if (effective.effort) args.push("--effort", effective.effort);
  if (effective.sandbox) args.push("--sandbox");
  if (conversationId) args.push("--conversation", conversationId);
  return args;
}

export function extractConversationId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) { const found = extractConversationId(item); if (found) return found; }
    return null;
  }
  for (const [key, candidate] of Object.entries(value)) {
    if (CONVERSATION_KEYS.has(key) && typeof candidate === "string" && candidate) return candidate;
    const found = extractConversationId(candidate);
    if (found) return found;
  }
  return null;
}

export function normalizeUsage(value: unknown): Usage | null {
  if (!value || typeof value !== "object") return null;
  const usage: Usage = {};
  for (const key of ["input_tokens", "output_tokens", "thinking_tokens", "cache_read_tokens", "total_tokens"] as const) {
    const number = Number((value as Record<string, unknown>)[key]);
    if (Number.isFinite(number) && number >= 0) usage[key] = number;
  }
  return Object.keys(usage).length ? usage : null;
}

export function parseStreamOutput(stdout: string): AgyResult {
  const events: StreamEvent[] = [];
  let finalEvent: StreamEvent | null = null;
  let conversationId: string | null = null;
  let model: string | null = null;
  let response = "";
  let streamedResponse = "";
  let usage: Usage | null = null;
  let durationMs: number | null = null;
  let numTurns: number | null = null;
  let toolCalls = 0;

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event: StreamEvent;
    try { event = JSON.parse(line) as StreamEvent; } catch { continue; }
    events.push(event);
    conversationId ||= extractConversationId(event);
    const init = asRecord(event.init);
    const step = asRecord(event.step_update);
    const result = asRecord(event.result);
    if (event.event === "init") model ||= stringValue(init?.model) || stringValue(event.model);
    if (event.event === "step_update") {
      model ||= stringValue(event.model) || stringValue(step?.model);
      if (step?.tool_info || step?.subagent_info || isToolStep(stringValue(step?.step_type))) toolCalls += 1;
      const stepUsage = normalizeUsage(step?.usage);
      if (stepUsage) usage = stepUsage;
      streamedResponse += stringValue(step?.text_delta) || "";
    }
    if (event.event === "result") {
      finalEvent = event;
      model ||= stringValue(result?.model);
      response = pickText(result) || response;
      usage = normalizeUsage(result?.usage) || usage;
      durationMs = numberOrNull(result?.duration_seconds, (value) => value * 1000);
      numTurns = numberOrNull(result?.num_turns);
      if (Number.isSafeInteger(result?.tool_calls)) toolCalls = result?.tool_calls as number;
    }
  }
  return {
    text: response.trim() || streamedResponse.trim() || "AGY returned no output.", parsed: finalEvent, events,
    conversationId, model, usage, durationMs, numTurns, toolCalls, status: stringValue(asRecord(finalEvent?.result)?.status),
  };
}

export function formatStepUpdate(stepUpdate: Record<string, unknown> | undefined): string | null {
  if (!stepUpdate) return null;
  const tool = asRecord(stepUpdate.tool_info);
  if (tool) return `Tool: ${stringValue(tool.name) || stringValue(tool.tool_name) || stringValue(tool.tool) || stringValue(stepUpdate.step_type) || "tool"}`;
  if (stepUpdate.subagent_info) return "Delegating to a subagent...";
  if (stepUpdate.step_type === "agent_response") return "Generating response...";
  if (stepUpdate.step_type === "checkpoint") return "Saving checkpoint...";
  if (typeof stepUpdate.step_type === "string" && !["user_input", "unknown"].includes(stepUpdate.step_type)) return `Step: ${stepUpdate.step_type}`;
  return null;
}

export function runAgy(config: AgyConfig, prompt: string, conversationId: string | null, options: RunnerOptions = {}): Promise<AgyResult> {
  return new Promise((resolve, reject) => {
    const { signal, onEvent, ...overrides } = options;
    const { TELEGRAM_BOT_TOKEN: _token, TELEGRAM_ALLOWED_USER_IDS: _users, TELEGRAM_ALLOWED_CHAT_IDS: _chats, ...childEnvironment } = process.env;
    const outputFormat = overrides.outputFormat || "stream-json";
    const child = spawn(config.bin, buildArgs(config, prompt, conversationId, { ...overrides, outputFormat }), {
      cwd: config.workspace, env: { ...childEnvironment, NO_COLOR: "1", TERM: "dumb" }, detached: true, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = ""; let stderr = ""; let pendingLine = ""; let bytes = 0;
    let outputLimited = false; let timedOut = false; let settled = false; let callbackError: Error | null = null;
    const startedAt = Date.now();
    const finish = (callback: (value: never) => void, value: never): void => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort); callback(value);
    };
    const emit = (line: string): void => {
      if (!line.trim()) return;
      try { onEvent?.(JSON.parse(line) as StreamEvent); } catch (error) { if (error instanceof Error) callbackError ||= error; }
    };
    const stop = (): void => {
      if (!child.pid) return;
      try { process.kill(-child.pid, "SIGTERM"); } catch { /* already exited */ }
      setTimeout(() => { try { process.kill(-child.pid!, "SIGKILL"); } catch { /* already exited */ } }, 5000).unref();
    };
    const abort = (): void => { stop(); finish(reject as (value: never) => void, new Error("AGY job cancelled") as never); };
    const timer = setTimeout(() => { timedOut = true; stop(); }, config.timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > config.maxOutputBytes) { outputLimited = true; stop(); return; }
      const text = chunk.toString(); stdout += text;
      if (outputFormat !== "stream-json") return;
      pendingLine += text; const lines = pendingLine.split(/\r?\n/); pendingLine = lines.pop() || ""; lines.forEach(emit);
    });
    child.stderr.on("data", (chunk: Buffer) => { if (stderr.length < 4000) stderr += chunk.toString(); });
    child.on("error", (error) => finish(reject as (value: never) => void, error as never));
    child.on("close", (code, signalName) => {
      if (outputFormat === "stream-json") emit(pendingLine);
      if (timedOut) return finish(reject as (value: never) => void, new Error(`AGY timed out after ${config.timeoutMs}ms`) as never);
      if (outputLimited) return finish(reject as (value: never) => void, new Error(`AGY output exceeded ${config.maxOutputBytes} bytes`) as never);
      if (code !== 0) {
        const detail = stderr.trim().replace(/\s+/g, " ").slice(0, 1000);
        return finish(reject as (value: never) => void, new Error(`AGY exited with ${code ?? signalName}${detail ? `: ${detail}` : ""}`) as never);
      }
      if (callbackError) return finish(reject as (value: never) => void, callbackError as never);
      const result = outputFormat === "stream-json" ? parseStreamOutput(stdout) : parseJsonOutput(stdout);
      finish(resolve as (value: never) => void, { ...result, durationMs: result.durationMs ?? Date.now() - startedAt } as never);
    });
  });
}

function parseJsonOutput(stdout: string): AgyResult {
  try {
    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    return { text: pickText(parsed) || JSON.stringify(parsed, null, 2), parsed, events: [], conversationId: extractConversationId(parsed), model: stringValue(parsed.model), usage: normalizeUsage(parsed.usage), durationMs: numberOrNull(parsed.duration_seconds, (value) => value * 1000), numTurns: numberOrNull(parsed.num_turns), toolCalls: Number.isSafeInteger(parsed.tool_calls) ? parsed.tool_calls as number : 0, status: stringValue(parsed.status) };
  } catch { return { text: stdout.trim() || "AGY returned no output.", parsed: null, events: [], conversationId: null, model: null, usage: null, durationMs: null, numTurns: null, toolCalls: 0, status: null }; }
}

function pickText(value: Record<string, unknown> | undefined): string { if (!value) return ""; for (const key of ["response", "result", "output", "finalOutput", "final_output", "message", "text", "content"]) { if (typeof value[key] === "string" && (value[key] as string).trim()) return value[key] as string; } return ""; }
function asRecord(value: unknown): Record<string, unknown> | undefined { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function stringValue(value: unknown): string | null { return typeof value === "string" && value ? value : null; }
function numberOrNull(value: unknown, transform: (value: number) => number = (item) => item): number | null { const number = Number(value); return Number.isFinite(number) ? transform(number) : null; }
function isToolStep(stepType: string | null): boolean { return !!stepType && /tool|command|browser|mcp/i.test(stepType); }
