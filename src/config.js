import path from "node:path";

export function loadConfig(env = process.env) {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const allowedUserIds = numericCsvFrom(env, "TELEGRAM_ALLOWED_USER_IDS");
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");
  if (allowedUserIds.length === 0) {
    throw new Error("TELEGRAM_ALLOWED_USER_IDS must contain at least one ID");
  }

  const workspace = (env.AGY_WORKSPACE || "/srv/agy-workspaces/default").trim();
  if (!path.isAbsolute(workspace)) throw new Error("AGY_WORKSPACE must be absolute");

  const mode = (env.AGY_MODE || "plan").trim();
  if (!["plan", "accept-edits"].includes(mode)) {
    throw new Error("AGY_MODE must be plan or accept-edits");
  }

  return {
    telegram: {
      token,
      allowedUserIds,
      allowedChatIds: numericCsvFrom(env, "TELEGRAM_ALLOWED_CHAT_IDS"),
      privateOnly: booleanFrom(env, "TELEGRAM_PRIVATE_ONLY", true),
      maxMessageChars: positiveIntegerFrom(env, "TELEGRAM_MAX_MESSAGE_CHARS", 3900),
    },
    agy: {
      bin: (env.AGY_BIN || "/root/.local/bin/agy").trim(),
      workspace,
      project: (env.AGY_PROJECT || "").trim(),
      mode,
      sandbox: booleanFrom(env, "AGY_SANDBOX", true),
      model: (env.AGY_MODEL || "").trim(),
      effort: (env.AGY_EFFORT || "high").trim(),
      timeoutMs: positiveIntegerFrom(env, "AGY_TIMEOUT_MS", 1_800_000),
      maxOutputBytes: positiveIntegerFrom(env, "AGY_MAX_OUTPUT_BYTES", 20_000_000),
    },
    queue: {
      maxSize: positiveIntegerFrom(env, "MAX_QUEUE_SIZE", 8),
    },
    stateFile: (env.STATE_FILE || "/var/lib/agy-telegram/state.json").trim(),
    tempDir: (env.TEMP_DIR || "/var/lib/agy-telegram/tmp").trim(),
    logLevel: (env.LOG_LEVEL || "info").trim(),
  };
}

function numericCsvFrom(env, name) {
  return (env[name] || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      if (!/^-?\d+$/.test(value)) throw new Error(`${name} must contain numeric Telegram IDs`);
      return value;
    });
}

function positiveIntegerFrom(env, name, fallback) {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function booleanFrom(env, name, fallback) {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(raw.toLowerCase())) return false;
  throw new Error(`${name} must be a boolean value`);
}
