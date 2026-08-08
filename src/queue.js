export class JobQueue {
  constructor(maxSize, worker) {
    this.maxSize = maxSize;
    this.worker = worker;
    this.pending = [];
    this.active = null;
    this.sequence = 0;
  }

  enqueue(job) {
    if (this.pending.length >= this.maxSize) {
      return { accepted: false, reason: "queue_full" };
    }
    const queued = { ...job, id: `job-${++this.sequence}`, enqueuedAt: Date.now() };
    this.pending.push(queued);
    void this.#drain();
    return { accepted: true, jobId: queued.id, position: this.pending.length };
  }

  cancelForChat(chatId) {
    const before = this.pending.length;
    this.pending = this.pending.filter((job) => job.chatId !== chatId);
    const removed = before - this.pending.length;
    const activeCancelled = this.active?.chatId === chatId ? this.active.cancel() : false;
    return { removed, activeCancelled };
  }

  statusForChat(chatId) {
    const queued = this.pending.filter((job) => job.chatId === chatId);
    return {
      active: this.active?.chatId === chatId ? this.active : null,
      queued: queued.length,
      totalQueued: this.pending.length,
    };
  }

  get status() {
    return { active: this.active, queued: this.pending.length };
  }

  async #drain() {
    if (this.active || this.pending.length === 0) return;
    const job = this.pending.shift();
    let cancelled = false;
    this.active = {
      id: job.id,
      chatId: job.chatId,
      cancel: () => {
        cancelled = true;
        return true;
      },
    };
    try {
      await this.worker(job, () => cancelled);
    } catch (error) {
      job.onError?.(error);
    } finally {
      this.active = null;
      void this.#drain();
    }
  }
}
