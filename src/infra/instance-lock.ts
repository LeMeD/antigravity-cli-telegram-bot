import fs from "node:fs";
import path from "node:path";

export interface InstanceLockResult {
  acquired: boolean;
  holderPid?: number;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Ensures only one bot instance polls a given Telegram token. A second
 * instance otherwise runs forever against Telegram's 409 Conflict responses.
 * Stale locks from crashed processes are taken over automatically.
 */
export function acquireInstanceLock(lockPath: string): InstanceLockResult {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      try {
        fs.writeFileSync(fd, String(process.pid), { encoding: "utf8" });
      } finally {
        fs.closeSync(fd);
      }
      return { acquired: true };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      let holderPid = 0;
      try {
        holderPid = Number.parseInt(fs.readFileSync(lockPath, "utf8").trim(), 10) || 0;
      } catch {
        holderPid = 0;
      }
      if (holderPid && pidAlive(holderPid)) {
        return { acquired: false, holderPid };
      }
      // Stale lock from a crashed process — take it over.
      try {
        fs.unlinkSync(lockPath);
      } catch {
        /* another racer removed it first; retry open */
      }
    }
  }
  return { acquired: false, holderPid: 0 };
}

export function releaseInstanceLock(lockPath: string): void {
  try {
    const pid = Number.parseInt(fs.readFileSync(lockPath, "utf8").trim(), 10) || 0;
    if (pid === process.pid) fs.unlinkSync(lockPath);
  } catch {
    /* nothing to release */
  }
}
