
import process from "node:process";

const TELEGRAM_SECRET_KEYS = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_ALLOWED_USER_IDS", "TELEGRAM_ALLOWED_CHAT_IDS"] as const;

/**
 * Environment for AGY child processes: Telegram secrets stripped so a
 * misbehaving CLI can never leak the bot token, plus deterministic TTY flags.
 */
export function childEnvironment(): NodeJS.ProcessEnv {
  const { ...environment } = process.env as Record<string, string | undefined>;
  for (const key of TELEGRAM_SECRET_KEYS) delete environment[key];
  return { ...environment, NO_COLOR: "1", TERM: "dumb" };
}
