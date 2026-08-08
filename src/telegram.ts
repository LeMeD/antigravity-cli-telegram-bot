import type { ChatId, InlineKeyboardMarkup, ReplyMarkup, TelegramUpdate } from "./types.js";

const API_ROOT = (token: string): string => `https://api.telegram.org/bot${token}`;

export class TelegramClient {
  private readonly root: string;
  public constructor(token: string) { this.root = API_ROOT(token); }
  public async call<T>(method: string, payload: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${this.root}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal });
    const body = await response.json() as { ok: boolean; result?: T; description?: string };
    if (!response.ok || !body.ok) throw new Error(`Telegram ${method} failed: ${body.description || response.status}`);
    return body.result as T;
  }
  public getUpdates(offset: number, signal?: AbortSignal): Promise<TelegramUpdate[]> { return this.call("getUpdates", { offset, timeout: 30, allowed_updates: ["message", "callback_query"] }, signal); }
  public sendMessage(chatId: ChatId, text: string, replyMarkup?: ReplyMarkup): Promise<{ message_id: number }> { return this.call<{ message_id: number }>("sendMessage", { chat_id: chatId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }); }
  public async editMessageText(chatId: ChatId, messageId: number, text: string, replyMarkup?: InlineKeyboardMarkup): Promise<void> {
    try {
      await this.call("editMessageText", { chat_id: chatId, message_id: messageId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });
    } catch (error) {
      if (error instanceof Error && error.message.includes("message is not modified")) return;
      throw error;
    }
  }
  public answerCallbackQuery(callbackQueryId: string, text?: string): Promise<boolean> { return this.call<boolean>("answerCallbackQuery", { callback_query_id: callbackQueryId, ...(text ? { text } : {}) }); }
  public setMyCommands(commands: Array<{ command: string; description: string }>): Promise<boolean> { return this.call<boolean>("setMyCommands", { commands }); }
  public sendChatAction(chatId: ChatId, action = "typing"): Promise<boolean> { return this.call<boolean>("sendChatAction", { chat_id: chatId, action }); }
  public async sendDocument(chatId: ChatId, filename: string, content: string): Promise<unknown> {
    const form = new FormData(); form.append("chat_id", String(chatId)); form.append("document", new Blob([content], { type: "text/markdown" }), filename);
    const response = await fetch(`${this.root}/sendDocument`, { method: "POST", body: form });
    const body = await response.json() as { ok: boolean; result?: unknown; description?: string };
    if (!response.ok || !body.ok) throw new Error(`Telegram sendDocument failed: ${body.description || response.status}`);
    return body.result;
  }
}

export function splitMessage(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = []; let rest = text;
  while (rest.length > maxChars) { let cut = rest.lastIndexOf("\n", maxChars); if (cut < Math.floor(maxChars * 0.5)) cut = maxChars; chunks.push(rest.slice(0, cut)); rest = rest.slice(cut).replace(/^\n+/, ""); }
  if (rest) chunks.push(rest); return chunks;
}
