import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultEnvFile, loadEnvFile } from "../src/setup.js";

test("uses a private config path under the user's config directory", () => {
  assert.equal(defaultEnvFile(), path.join(os.homedir(), ".config", "agy-telegram", ".env"));
});

test("loads simple dotenv values without overriding process environment", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agy-setup-"));
  const file = path.join(directory, ".env");
  await fs.writeFile(file, "TELEGRAM_BOT_TOKEN=token\nexport TELEGRAM_ALLOWED_USER_IDS=123,456\n# comment\n");
  assert.deepEqual(await loadEnvFile(file), { TELEGRAM_BOT_TOKEN: "token", TELEGRAM_ALLOWED_USER_IDS: "123,456" });
  await fs.rm(directory, { recursive: true, force: true });
});
