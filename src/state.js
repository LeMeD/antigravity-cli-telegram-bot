import fs from "node:fs/promises";
import path from "node:path";

export class StateStore {
  constructor(file) {
    this.file = file;
    this.data = { updateOffset: 0, sessions: {} };
    this.writeChain = Promise.resolve();
  }

  async load() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, "utf8"));
      if (parsed && typeof parsed === "object") {
        this.data = {
          updateOffset: Number.isSafeInteger(parsed.updateOffset) ? parsed.updateOffset : 0,
          sessions: parsed.sessions && typeof parsed.sessions === "object" ? parsed.sessions : {},
        };
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  async save() {
    this.writeChain = this.writeChain.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      const temporary = `${this.file}.${process.pid}.tmp`;
      await fs.writeFile(temporary, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
      await fs.rename(temporary, this.file);
      await fs.chmod(this.file, 0o600);
    });
    return this.writeChain;
  }

  session(chatId) {
    return this.data.sessions[String(chatId)] || null;
  }

  async resetSession(chatId) {
    delete this.data.sessions[String(chatId)];
    await this.save();
  }

  async setSession(chatId, session) {
    this.data.sessions[String(chatId)] = session;
    await this.save();
  }

  async setOffset(offset) {
    this.data.updateOffset = offset;
    await this.save();
  }

  get offset() {
    return this.data.updateOffset;
  }
}
