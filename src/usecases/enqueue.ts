import type { AppContext } from "../context.js";
import { createMainKeyboard } from "../keyboards.js";
import { settingsFor } from "../domain/settings.js";
import { reply } from "../ui/reply.js";
import type { QueueJob } from "../queue.js";
import type { ChatId } from "../types.js";

export function enqueueJob(context: AppContext, chatId: ChatId, job: Partial<QueueJob>): void {
  const status = context.queue.statusForChat(chatId);
  let effectivePrompt = job.prompt;
  if (context.config.telegram.autoInterrupt) {
    if (status.active && status.active.prompt && (job.kind === "prompt" || !job.kind) && job.prompt) {
      effectivePrompt = `${status.active.prompt}\n\n[Update / Follow-up]: ${job.prompt}`;
    }
    if (status.active || status.queued > 0) {
      context.queue.cancelForChat(chatId);
    }
  }
  const result = context.queue.enqueue({
    chatId,
    kind: job.kind || "prompt",
    prompt: effectivePrompt,
    imagePath: job.imagePath || status.active?.imagePath,
    documentPath: job.documentPath || status.active?.documentPath,
    documentName: job.documentName || status.active?.documentName,
  });
  if (!result.accepted) {
    void reply(context, chatId, "Queue is full. Try again shortly.", createMainKeyboard(settingsFor(context, chatId)));
  } else if (result.position !== undefined && result.position > 1) {
    void reply(context, chatId, `⏳ Queued at position #${result.position}.`, createMainKeyboard(settingsFor(context, chatId)));
  }
}
