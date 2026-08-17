import fs from "node:fs/promises";
import path from "node:path";
import type { ChatId, InlineKeyboardMarkup, ReplyMarkup, TelegramUpdate } from "./types.js";

const API_ROOT = (token: string): string => `https://api.telegram.org/bot${token}`;
export type TelegramParseMode = "HTML";

export class TelegramClient {
  private readonly root: string;
  public constructor(private readonly token: string) { this.root = API_ROOT(token); }
  public async call<T>(method: string, payload: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${this.root}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal });
    const body = await response.json() as { ok: boolean; result?: T; description?: string };
    if (!response.ok || !body.ok) throw new Error(`Telegram ${method} failed: ${body.description || response.status}`);
    return body.result as T;
  }
  public getUpdates(offset: number, signal?: AbortSignal): Promise<TelegramUpdate[]> { return this.call("getUpdates", { offset, timeout: 30, allowed_updates: ["message", "callback_query"] }, signal); }
  public sendMessage(chatId: ChatId, text: string, replyMarkup?: ReplyMarkup, parseMode?: TelegramParseMode): Promise<{ message_id: number }> {
    return this.call<{ message_id: number }>("sendMessage", { chat_id: chatId, text, ...(parseMode ? { parse_mode: parseMode } : {}), ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });
  }
  public async editMessageText(
    chatId: ChatId,
    messageId: number,
    text: string,
    replyMarkup?: InlineKeyboardMarkup,
    parseMode?: TelegramParseMode
  ): Promise<void> {
    try {
      await this.call("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text,
        ...(parseMode ? { parse_mode: parseMode } : {}),
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      });
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
  public getFile(fileId: string): Promise<{ file_id: string; file_path?: string; file_size?: number }> {
    return this.call("getFile", { file_id: fileId });
  }
  public async downloadFile(filePath: string, destination: string): Promise<string> {
    const fileUrl = `https://api.telegram.org/file/bot${this.token}/${filePath}`;
    const response = await fetch(fileUrl);
    if (!response.ok) throw new Error(`Download file failed: ${response.statusText}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, buffer);
    return destination;
  }
}

export function splitMessage(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = []; let rest = text;
  while (rest.length > maxChars) { let cut = rest.lastIndexOf("\n", maxChars); if (cut < Math.floor(maxChars * 0.5)) cut = maxChars; chunks.push(rest.slice(0, cut)); rest = rest.slice(cut).replace(/^\n+/, ""); }
  if (rest) chunks.push(rest); return chunks;
}

/** Splits pre-formatted HTML text without re-escaping HTML tags. */
export function splitPreformattedHtml(htmlText: string, maxChars: number): string[] {
  if (maxChars < 1) return [];
  const normalized = htmlText.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const blocks = normalized.split("\n\n");
  const chunks: string[] = [];
  let current = "";

  for (const block of blocks) {
    if (!block.trim()) continue;
    const candidate = current ? `${current}\n\n${block}` : block;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      if (block.length <= maxChars) {
        current = block;
      } else {
        const lineParts = splitMessage(block, maxChars);
        chunks.push(...lineParts);
        current = "";
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Converts the Markdown-like output AGY commonly produces to safe Telegram HTML. */
export function formatTelegramHtml(text: string): string {
  return renderTelegramBlocks(text).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Formats a response into valid Telegram HTML messages under the size limit. */
export function formatTelegramHtmlChunks(text: string, maxChars: number): string[] {
  if (maxChars < 1) return [];
  const blocks = renderTelegramBlocks(text);
  const chunks: string[] = [];
  let current = "";
  const append = (piece: string): void => {
    if (!piece) return;
    const candidate = current ? `${current}\n${piece}` : piece;
    if (candidate.length <= maxChars) {
      current = candidate;
      return;
    }
    if (current) chunks.push(current);
    current = "";
    if (piece.length <= maxChars) current = piece;
    else chunks.push(...splitOversizedHtmlBlock(piece, maxChars));
  };
  for (const block of blocks) append(block);
  if (current) chunks.push(current);
  return chunks;
}

function renderTelegramBlocks(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];
  const lines = normalized.split("\n");
  const output: string[] = [];
  let codeLines: string[] | null = null;
  let codeLanguage = "";
  for (const line of lines) {
    const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/);
    if (fence) {
      if (codeLines) {
        const language = codeLanguage ? ` class="language-${escapeHtml(codeLanguage)}"` : "";
        output.push(`<pre><code${language}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = null;
        codeLanguage = "";
      } else {
        codeLines = [];
        codeLanguage = fence[1] || "";
      }
      continue;
    }
    if (codeLines) {
      codeLines.push(line);
      continue;
    }
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      output.push(`<b>${formatInlineHtml(heading[1])}</b>`);
      continue;
    }
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    if (bullet) {
      output.push(`• ${formatInlineHtml(bullet[1])}`);
      continue;
    }
    const numbered = line.match(/^\s*(\d+)[.)]\s+(.+)$/);
    if (numbered) {
      output.push(`${numbered[1]}. ${formatInlineHtml(numbered[2])}`);
      continue;
    }
    output.push(formatInlineHtml(line));
  }
  if (codeLines) output.push(`<pre><code${codeLanguage ? ` class="language-${escapeHtml(codeLanguage)}"` : ""}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  return output;
}

function splitOversizedHtmlBlock(block: string, maxChars: number): string[] {
  const code = block.match(/^<pre><code( class="[^"]+")?>([\s\S]*)<\/code><\/pre>$/);
  if (!code) return splitMessage(stripHtmlTags(block), maxChars).map(escapeHtml);
  const open = `<pre><code${code[1] || ""}>`;
  const close = "</code></pre>";
  const contentLimit = Math.max(1, maxChars - open.length - close.length);
  return splitMessage(code[2], contentLimit).map((part) => `${open}${part}${close}`);
}

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}

function formatInlineHtml(value: string): string {
  const tokens: string[] = [];
  const token = (html: string): string => {
    const marker = `\u0000${tokens.length}\u0000`;
    tokens.push(html);
    return marker;
  };
  let escaped = escapeHtml(value);
  escaped = escaped.replace(/`([^`\n]+)`/g, (_match, code: string) => token(`<code>${code}</code>`));
  escaped = escaped.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label: string, url: string) => token(`<a href="${url}">${label}</a>`));
  escaped = escaped.replace(/\[([^\]]+)\]\(file:\/\/\/[^\s)]+\)/g, (_match, label: string) => token(`<code>${label}</code>`));
  escaped = escaped.replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_match, boldA: string | undefined, boldB: string | undefined) => `<b>${boldA || boldB}</b>`);
  escaped = escaped.replace(/~~(.+?)~~/g, "<s>$1</s>");
  escaped = escaped.replace(/\*([^*\n]+)\*|_([^_\n]+)_/g, (_match, italicA: string | undefined, italicB: string | undefined) => `<i>${italicA || italicB}</i>`);
  return escaped.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => tokens[Number(index)] || "");
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
