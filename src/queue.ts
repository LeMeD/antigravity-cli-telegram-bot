import type { ChatId } from "./types.js";

export interface QueueJob {
  chatId: ChatId;
  prompt?: string;
  kind?: "prompt" | "usage" | "credits" | "context";
  id?: string;
  enqueuedAt?: number;
  imagePath?: string;
  documentPath?: string;
  documentName?: string;
}
export interface QueueStatus { active: (QueueJob & { cancel: () => boolean }) | null; queued: number; totalQueued: number }
type Worker = (job: QueueJob, isCancelled: () => boolean) => Promise<void>;

export interface JobQueueOptions {
  /** Invoked on every cancelForChat so owners can abort associated work. */
  onCancel?: (chatId: ChatId) => void;
}

export class JobQueue {
  private readonly pending: QueueJob[] = [];
  private active: (QueueJob & { cancel: () => boolean }) | null = null;
  private sequence = 0;
  private isDraining = false;
  public constructor(private readonly maxSize: number, private readonly worker: Worker, private readonly options: JobQueueOptions = {}) {}
  public enqueue(job: QueueJob): { accepted: boolean; reason?: string; jobId?: string; position?: number } {
    if (this.pending.length >= this.maxSize) return { accepted: false, reason: "queue_full" };
    const queued = { ...job, id: `job-${++this.sequence}`, enqueuedAt: Date.now() };
    this.pending.push(queued);
    void this.drain().catch((err) => console.error("[queue] Drain unhandled error:", err));
    return { accepted: true, jobId: queued.id, position: this.pending.length };
  }
  public cancelForChat(chatId: ChatId): { removed: number; activeCancelled: boolean } {
    const before = this.pending.length;
    this.pending.splice(0, this.pending.length, ...this.pending.filter((job) => String(job.chatId) !== String(chatId)));
    const activeCancelled = this.active && String(this.active.chatId) === String(chatId) ? this.active.cancel() : false;
    this.options.onCancel?.(chatId);
    return { removed: before - this.pending.length, activeCancelled };
  }
  public pendingForChat(chatId: ChatId): QueueJob[] {
    return this.pending.filter((job) => String(job.chatId) === String(chatId));
  }
  public statusForChat(chatId: ChatId): QueueStatus {
    return { active: this.active && String(this.active.chatId) === String(chatId) ? this.active : null, queued: this.pending.filter((job) => String(job.chatId) === String(chatId)).length, totalQueued: this.pending.length };
  }
  private async drain(): Promise<void> {
    if (this.active || this.isDraining || this.pending.length === 0) return;
    this.isDraining = true;
    try {
      while (this.pending.length > 0) {
        const job = this.pending.shift()!; let cancelled = false;
        this.active = { ...job, cancel: () => { cancelled = true; return true; } };
        try {
          await this.worker(job, () => cancelled);
        } catch (workerError) {
          console.error(`[queue] Worker execution error for chat ${job.chatId}:`, workerError);
        } finally {
          this.active = null;
        }
      }
    } catch (drainError) {
      console.error("[queue] Drain loop error:", drainError);
    } finally {
      this.isDraining = false;
    }
  }
}
