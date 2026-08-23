import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { acquireInstanceLock, releaseInstanceLock } from "../src/infra/instance-lock.js";
import { isRetryableTransportErrorMessage } from "../src/telegram/client.js";

function tmpLockDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agy-lock-"));
}

test("instance lock: second start is rejected while the first holder lives", () => {
  const dir = tmpLockDir();
  try {
    const lockPath = path.join(dir, "agy-telegram.lock");
    const first = acquireInstanceLock(lockPath);
    assert.equal(first.acquired, true);

    // Holder must still be alive for the guard to trigger; this test process is alive.
    const second = acquireInstanceLock(lockPath.replace(/\.lock$/, ".lock2"));
    void second;

    fs.writeFileSync(lockPath, String(process.pid), { encoding: "utf8" });
    const refused = acquireInstanceLock(lockPath);
    assert.equal(refused.acquired, false);
    assert.equal(refused.holderPid, process.pid);

    releaseInstanceLock(lockPath);
    const reacquired = acquireInstanceLock(lockPath);
    assert.equal(reacquired.acquired, true, "lock released on shutdown allows restart");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("instance lock: stale lock from a crashed process is taken over", () => {
  const dir = tmpLockDir();
  try {
    // Produce a genuinely dead PID.
    const dead = spawnSync("true");
    const deadPid = dead.pid ?? -1;
    const lockPath = path.join(dir, "agy-telegram.lock");
    fs.writeFileSync(lockPath, String(deadPid), { encoding: "utf8" });

    const result = acquireInstanceLock(lockPath);
    assert.equal(result.acquired, true, "dead holder pid must be taken over");
    assert.equal(fs.readFileSync(lockPath, "utf8"), String(process.pid));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("stale callback queries are never retried (no more journal spam)", () => {
  const stale = "Telegram answerCallbackQuery failed: Bad Request: query is too old and response timeout expired or query ID is invalid";
  assert.equal(isRetryableTransportErrorMessage(stale), false);

  assert.equal(isRetryableTransportErrorMessage("fetch failed"), true);
  assert.equal(isRetryableTransportErrorMessage("connect ETIMEDOUT 1.2.3.4:443"), true);
  assert.equal(isRetryableTransportErrorMessage("read ECONNRESET"), true);
  // Faithful to production: DNS failures are NOT retried by the patched client.
  assert.equal(isRetryableTransportErrorMessage("getaddrinfo ENOTFOUND api.telegram.org"), false);
  assert.equal(isRetryableTransportErrorMessage("Telegram sendMessage failed: Bad Request: chat not found"), false);
});
