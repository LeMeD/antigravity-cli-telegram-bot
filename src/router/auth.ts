import type { AppConfig } from "../types.js";
import type { TelegramCallbackQuery, TelegramMessage } from "../types.js";

export function authorizedUser(config: AppConfig, userId: number | undefined, chatId: number | string | undefined, chatType: string | undefined): boolean {
  if (config.telegram.privateOnly && chatType !== "private") return false;
  if (!userId || !config.telegram.allowedUserIds.includes(String(userId))) return false;
  if (config.telegram.allowedChatIds?.length && (!chatId || !config.telegram.allowedChatIds.includes(String(chatId)))) return false;
  return true;
}

export function authorizedMessage(config: AppConfig, message: TelegramMessage | undefined): boolean {
  if (!message) return false;
  return authorizedUser(config, message.from?.id, message.chat.id, message.chat.type);
}

export function authorizedCallback(config: AppConfig, callback: TelegramCallbackQuery): boolean {
  return authorizedUser(config, callback.from?.id, callback.message?.chat.id, callback.message?.chat.type);
}
