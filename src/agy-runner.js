import { spawn } from "node:child_process";

const CONVERSATION_KEYS = new Set([
  "conversationId",
  "conversation_id",
  "conversationID",
  "sessionId",
  "session_id",
]);

export function buildArgs(config, prompt, conversationId) {
  const args = ["--print", prompt, "--output-format", "json", "--print-timeout", `${Math.ceil(config.timeoutMs / 1000)}s`];
  if (config.project) args.push("--project", config.project);
  if (config.mode) args.push("--mode", config.mode);
  if (config.model) args.push("--model", config.model);
  if (config.effort) args.push("--effort", config.effort);
  if (config.sandbox) args.push("--sandbox");
  if (conversationId) args.push("--conversation", conversationId);
  return args;
}

export function extractConversationId(value) {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractConversationId(item);
      if (found) return found;
    }
    return null;
  }
  for (const [key, candidate] of Object.entries(value)) {
    if (CONVERSATION_KEYS.has(key) && typeof candidate === "string" && candidate) return candidate;
    const found = extractConversationId(candidate);
    if (found) return found;
  }
  return null;
}

export function parseOutput(stdout) {
  const text = stdout.trim();
  if (!text) return { text: "AGY returned no output.", parsed: null, conversationId: null };
  try {
    const parsed = JSON.parse(text);
    return {
      text: pickText(parsed) || JSON.stringify(parsed, null, 2),
      parsed,
      conversationId: extractConversationId(parsed),
    };
  } catch {
    return { text, parsed: null, conversationId: null };
  }
}

function pickText(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  for (const key of ["response", "result", "output", "finalOutput", "final_output", "message", "text", "content"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return "";
}

export function runAgy(config, prompt, conversationId, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const {
      TELEGRAM_BOT_TOKEN: _telegramBotToken,
      TELEGRAM_ALLOWED_USER_IDS: _allowedUserIds,
      TELEGRAM_ALLOWED_CHAT_IDS: _allowedChatIds,
      ...childEnvironment
    } = process.env;
    const child = spawn(config.bin, buildArgs(config, prompt, conversationId), {
      cwd: config.workspace,
      env: { ...childEnvironment, NO_COLOR: "1", TERM: "dumb" },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    let outputLimited = false;
    let timedOut = false;
    let settled = false;
    const startedAt = Date.now();
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      callback(value);
    };
    const stop = () => {
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {}
        setTimeout(() => {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {}
        }, 5000).unref();
      }
    };
    const abort = () => {
      stop();
      finish(reject, new Error("AGY job cancelled"));
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, config.timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes <= config.maxOutputBytes) stdout += chunk;
      else {
        outputLimited = true;
        stop();
      }
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 4000) stderr += chunk.toString();
    });
    child.on("error", (error) => finish(reject, error));
    child.on("close", (code, signalName) => {
      if (timedOut) {
        finish(reject, new Error(`AGY timed out after ${config.timeoutMs}ms`));
        return;
      }
      if (outputLimited) {
        finish(reject, new Error(`AGY output exceeded ${config.maxOutputBytes} bytes`));
        return;
      }
      if (code !== 0) {
        const detail = stderr.trim().replace(/\s+/g, " ").slice(0, 1000);
        finish(reject, new Error(`AGY exited with ${code ?? signalName}${detail ? `: ${detail}` : ""}`));
        return;
      }
      finish(resolve, { ...parseOutput(stdout), durationMs: Date.now() - startedAt });
    });
  });
}
