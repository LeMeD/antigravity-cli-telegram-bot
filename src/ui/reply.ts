import type { AppContext } from "../context.js";
import { formatTelegramHtmlChunks, splitMessage, splitPreformattedHtml } from "../telegram.js";
import type { ChatId, ReplyMarkup } from "../types.js";

const CHUNK_DELAY_MS = 800;

export async function reply(context: AppContext, chatId: ChatId, text: string, replyMarkup?: ReplyMarkup): Promise<void> {
  const chunks = splitMessage(text, context.config.telegram.maxMessageChars);
  for (let index = 0; index < chunks.length; index += 1) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, CHUNK_DELAY_MS));
    try {
      await context.telegram.sendMessage(chatId, chunks[index], index === chunks.length - 1 ? replyMarkup : undefined);
    } catch (error) {
      console.error(`[reply] Failed to send chunk ${index + 1}/${chunks.length} to ${chatId}:`, (error as Error).message);
    }
  }
}

export async function replyWithFormattedResponse(context: AppContext, chatId: ChatId, text: string, replyMarkup?: ReplyMarkup): Promise<void> {
  const chunks = formatTelegramHtmlChunks(text, context.config.telegram.maxMessageChars);
  if (!chunks.length) {
    await reply(context, chatId, text, replyMarkup);
    return;
  }
  try {
    for (let index = 0; index < chunks.length; index += 1) {
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, CHUNK_DELAY_MS));
      await context.telegram.sendMessage(chatId, chunks[index], index === chunks.length - 1 ? replyMarkup : undefined, "HTML");
    }
  } catch {
    await reply(context, chatId, text, replyMarkup);
  }
}

export async function replyWithHtml(context: AppContext, chatId: ChatId, html: string, replyMarkup?: ReplyMarkup): Promise<void> {
  const chunks = splitPreformattedHtml(html, context.config.telegram.maxMessageChars);
  for (let index = 0; index < chunks.length; index += 1) {
    const isLast = index === chunks.length - 1;
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, CHUNK_DELAY_MS));
    try {
      await context.telegram.sendMessage(chatId, chunks[index], isLast ? replyMarkup : undefined, "HTML");
    } catch {
      try {
        await context.telegram.sendMessage(chatId, chunks[index].replace(/<[^>]+>/g, ""), isLast ? replyMarkup : undefined);
      } catch (err) {
        console.error(`[replyWithHtml] Failed to send chunk to ${chatId}:`, (err as Error).message);
      }
    }
  }
}
