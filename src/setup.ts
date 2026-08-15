import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export function defaultEnvFile(): string {
  return path.join(os.homedir() || process.env.HOME || "/root", ".config", "agy-telegram", ".env");
}

export async function loadEnvFile(filePath = defaultEnvFile()): Promise<Record<string, string>> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    const values: Record<string, string> = {};
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    }
    return values;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

function validUserIds(value: string): boolean {
  return value.split(",").every((id) => /^-?\d+$/.test(id.trim())) && value.trim().length > 0;
}

export async function runSetup(existing: Record<string, string | undefined> = process.env, filePath = defaultEnvFile()): Promise<Record<string, string>> {
  if (!input.isTTY || !output.isTTY) throw new Error(`TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_USER_IDS are required. Run "agy-telegram --setup" in an interactive terminal, or configure ${filePath}.`);
  const terminal = createInterface({ input, output });
  try {
    let token = existing.TELEGRAM_BOT_TOKEN?.trim() || "";
    let userIds = existing.TELEGRAM_ALLOWED_USER_IDS?.trim() || "";
    while (!token) token = (await terminal.question("Telegram bot token: ")).trim();
    while (!validUserIds(userIds)) userIds = (await terminal.question("Allowed Telegram user ID(s), comma-separated: ")).trim();
    const values = { TELEGRAM_BOT_TOKEN: token, TELEGRAM_ALLOWED_USER_IDS: userIds };
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    await fs.writeFile(filePath, `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n")}\n`, { mode: 0o600 });
    await fs.chmod(filePath, 0o600);
    console.log(`Configuration saved to ${filePath}`);
    return values;
  } finally {
    terminal.close();
  }
}
