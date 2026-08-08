import process from "node:process";
import { formatStepUpdate, runAgy } from "./agy-runner.js";
import { loadConfig, isEffort, isMode } from "./config.js";
import { modelLabel } from "./models.js";
import { createMainKeyboard } from "./keyboards.js";
import { JobQueue, type QueueJob } from "./queue.js";
import { StateStore } from "./state.js";
import { splitMessage, TelegramClient } from "./telegram.js";
import type { AppConfig, ChatId, InlineKeyboardMarkup, ReplyMarkup, SessionSettings, StreamEvent, TelegramCallbackQuery, TelegramMessage, TelegramUpdate, Usage } from "./types.js";

const config = loadConfig();
const state = new StateStore(config.stateFile);
await state.load();
const telegram = new TelegramClient(config.telegram.token);
const controllers = new Map<string, AbortController>();

function authorizedMessage(message: TelegramMessage | undefined): boolean {
  if (!message) return false;
  return authorizedUser(message.from?.id, message.chat.id, message.chat.type);
}

function authorizedCallback(callback: TelegramCallbackQuery): boolean {
  return authorizedUser(callback.from?.id, callback.message?.chat.id, callback.message?.chat.type);
}

function authorizedUser(userId: number | undefined, chatId: number | undefined, chatType: string | undefined): boolean {
  if (userId === undefined || chatId === undefined) return false;
  if (!config.telegram.allowedUserIds.includes(String(userId))) return false;
  if (config.telegram.allowedChatIds.length && !config.telegram.allowedChatIds.includes(String(chatId))) return false;
  return !config.telegram.privateOnly || chatType === "private";
}

async function reply(chatId: ChatId, text: string, replyMarkup?: ReplyMarkup): Promise<void> {
  const chunks = splitMessage(text, config.telegram.maxMessageChars);
  for (let index = 0; index < chunks.length; index += 1) {
    await telegram.sendMessage(chatId, chunks[index], index === chunks.length - 1 ? replyMarkup : undefined);
  }
}

function button(text: string, callback_data: string): { text: string; callback_data: string } { return { text, callback_data }; }

function backKeyboard(): InlineKeyboardMarkup { return { inline_keyboard: [[button("‹ Back", "menu:main")]] }; }

function settingsFor(chatId: ChatId): SessionSettings {
  const defaults: SessionSettings = { model: config.agy.model || null, effort: config.agy.effort, mode: config.agy.mode, sandbox: config.agy.sandbox };
  const stored = state.session(chatId)?.settings || {};
  const settings: SessionSettings = {
    model: typeof stored.model === "string" && config.agy.allowedModels.includes(stored.model) ? stored.model : defaults.model,
    effort: typeof stored.effort === "string" && isEffort(stored.effort) ? stored.effort : defaults.effort,
    mode: typeof stored.mode === "string" && isMode(stored.mode) ? stored.mode : defaults.mode,
    sandbox: typeof stored.sandbox === "boolean" ? stored.sandbox : defaults.sandbox,
  };
  if (config.agy.sandbox && !config.agy.allowSandboxDisable) settings.sandbox = true;
  return settings;
}

function settingsText(settings: SessionSettings): string {
  return [`Model: ${modelLabel(settings.model)}`, `Effort: ${settings.effort}`, `Mode: ${settings.mode}`, `Sandbox: ${settings.sandbox ? "enabled" : "disabled"}`].join("\n");
}

async function saveSettings(chatId: ChatId, settings: SessionSettings): Promise<void> {
  await state.setSession(chatId, { settings, updatedAt: new Date().toISOString() });
}

function usageText(usage: Usage | null | undefined): string {
  if (!usage) return "Usage data was not provided by AGY.";
  const labels: Array<[keyof Usage, string]> = [["input_tokens", "Input"], ["output_tokens", "Output"], ["thinking_tokens", "Thinking"], ["cache_read_tokens", "Cache-read"], ["total_tokens", "Total"]];
  return labels.filter(([key]) => usage[key] !== undefined).map(([key, label]) => `${label}: ${usage[key]!.toLocaleString()}`).join("\n") || "Usage data was not provided by AGY.";
}

function sessionText(chatId: ChatId): string {
  const session = state.session(chatId);
  const status = queue.statusForChat(chatId);
  return `Session\n\nConversation: ${session?.conversationId || "new"}\nWorkspace: ${config.agy.workspace}\n${settingsText(settingsFor(chatId))}\nStatus: ${status.active ? "running" : "idle"}`;
}

function usageReport(chatId: ChatId): string {
  const session = state.session(chatId);
  const last = session?.lastRun;
  const lastText = last ? [`Last run: ${last.status}`, last.model ? `Model: ${modelLabel(last.model)}` : null, last.durationMs ? `Duration: ${(last.durationMs / 1000).toFixed(1)}s` : null, last.numTurns !== null ? `Turns: ${last.numTurns}` : null, last.toolCalls ? `Tool calls: ${last.toolCalls}` : null, usageText(last.usage)].filter(Boolean).join("\n") : "Last run: no completed run yet.";
  return `Usage / Quota\n\n${lastText}\n\nAccumulated usage:\n${usageText(session?.usageTotals)}\n\nSubscription quota is not exposed by AGY stream-json.`;
}

function modelKeyboard(chatId: ChatId, page = 0): InlineKeyboardMarkup {
  const pageSize = 5;
  const totalPages = Math.max(1, Math.ceil(config.agy.allowedModels.length / pageSize));
  const normalizedPage = Math.min(Math.max(page, 0), totalPages - 1);
  const selected = settingsFor(chatId).model;
  const rows = config.agy.allowedModels.slice(normalizedPage * pageSize, normalizedPage * pageSize + pageSize).map((id) => [button(`${id === selected ? "✅ " : ""}${modelLabel(id)}`, `set:model:${id}`)]);
  const navigation = [];
  if (normalizedPage > 0) navigation.push(button("‹", `menu:models:${normalizedPage - 1}`));
  navigation.push(button(`${normalizedPage + 1}/${totalPages}`, "noop"));
  if (normalizedPage < totalPages - 1) navigation.push(button("›", `menu:models:${normalizedPage + 1}`));
  rows.push(navigation);
  rows.push([button("‹ Back", "menu:main")]);
  return { inline_keyboard: rows };
}

function effortKeyboard(chatId: ChatId): InlineKeyboardMarkup {
  const selected = settingsFor(chatId).effort;
  const choices = ["low", "medium", "high"].map((value) => button(`${value === selected ? "✅ " : ""}${value}`, `set:effort:${value}`));
  return { inline_keyboard: [choices, [button("‹ Back", "menu:main")]] };
}

function modeKeyboard(chatId: ChatId): InlineKeyboardMarkup {
  const selected = settingsFor(chatId).mode;
  const choices = ["plan", "accept-edits"].map((value) => button(`${value === selected ? "✅ " : ""}${value}`, `set:mode:${value}`));
  return { inline_keyboard: [choices, [button("‹ Back", "menu:main")]] };
}

function sandboxKeyboard(chatId: ChatId): InlineKeyboardMarkup {
  const selected = settingsFor(chatId).sandbox;
  const disableAllowed = config.agy.allowSandboxDisable || !config.agy.sandbox;
  return { inline_keyboard: [[button(`${selected ? "✅ " : ""}On`, "set:sandbox:on"), button(`${!selected ? "✅ " : ""}Off${disableAllowed ? "" : " (locked)"}`, disableAllowed ? "set:sandbox:off" : "noop")], [button("‹ Back", "menu:main")]] };
}

async function showMain(chatId: ChatId, messageId?: number): Promise<void> {
  const settings = settingsFor(chatId);
  const text = `AGY Telegram\n\n${settingsText(settings)}\n\nThe control keyboard is available beside the message input. You can also send a prompt directly.`;
  if (messageId) {
    await telegram.editMessageText(chatId, messageId, text, { inline_keyboard: [] });
    await telegram.sendMessage(chatId, "Controls updated.", createMainKeyboard(settings));
  } else {
    await reply(chatId, text, createMainKeyboard(settings));
  }
}

async function showMenu(chatId: ChatId, messageId: number, kind: string, page = 0): Promise<void> {
  if (kind === "main") return showMain(chatId, messageId);
  if (kind === "model" || kind === "models") return telegram.editMessageText(chatId, messageId, "Select a model:", modelKeyboard(chatId, page));
  if (kind === "effort") return telegram.editMessageText(chatId, messageId, "Select reasoning effort:", effortKeyboard(chatId));
  if (kind === "mode") return telegram.editMessageText(chatId, messageId, "Select execution mode:", modeKeyboard(chatId));
  if (kind === "sandbox") return telegram.editMessageText(chatId, messageId, `Sandbox is ${settingsFor(chatId).sandbox ? "enabled" : "disabled"}.`, sandboxKeyboard(chatId));
  if (kind === "session") return telegram.editMessageText(chatId, messageId, sessionText(chatId), backKeyboard());
  if (kind === "usage") return telegram.editMessageText(chatId, messageId, usageReport(chatId), backKeyboard());
}

async function handleCallback(callback: TelegramCallbackQuery): Promise<void> {
  if (!authorizedCallback(callback) || !callback.message || !callback.data) return;
  const chatId = callback.message.chat.id;
  const messageId = callback.message.message_id;
  const data = callback.data;
  await telegram.answerCallbackQuery(callback.id).catch(() => undefined);
  if (data === "noop") return;
  if (data.startsWith("menu:")) {
    const parts = data.split(":");
    await showMenu(chatId, messageId, parts[1], parts[2] ? Number(parts[2]) : 0);
    return;
  }
  if (data === "action:new") {
    await state.resetSession(chatId);
    await telegram.editMessageText(chatId, messageId, "New AGY conversation started.", { inline_keyboard: [] });
    await telegram.sendMessage(chatId, "Controls ready.", createMainKeyboard(settingsFor(chatId)));
    return;
  }
  if (data === "action:cancel") {
    const result = queue.cancelForChat(chatId);
    await telegram.editMessageText(chatId, messageId, `Cancelled: ${result.removed} queued, active=${result.activeCancelled ? "yes" : "no"}.`, { inline_keyboard: [] });
    await telegram.sendMessage(chatId, "Controls ready.", createMainKeyboard(settingsFor(chatId)));
    return;
  }
  if (data.startsWith("set:")) {
    const [, key, value] = data.split(":");
    const settings = settingsFor(chatId);
    if (key === "model" && config.agy.allowedModels.includes(value)) settings.model = value;
    if (key === "effort" && isEffort(value)) settings.effort = value;
    if (key === "mode" && isMode(value)) settings.mode = value;
    if (key === "sandbox" && ["on", "off"].includes(value) && (value === "on" || config.agy.allowSandboxDisable || !config.agy.sandbox)) settings.sandbox = value === "on";
    await saveSettings(chatId, settings);
    await showMain(chatId, messageId);
  }
}

async function handleCommand(message: TelegramMessage, command: string, args: string[]): Promise<boolean> {
  const chatId = message.chat.id;
  if (["/start", "/help", "/menu"].includes(command)) { await showMain(chatId); return true; }
  if (command === "/new") { await state.resetSession(chatId); await reply(chatId, "New AGY conversation started.", createMainKeyboard(settingsFor(chatId))); return true; }
  if (command === "/models") { await reply(chatId, "Select a model:", modelKeyboard(chatId)); return true; }
  if (command === "/model" && args[0]) { if (config.agy.allowedModels.includes(args[0])) { const settings = settingsFor(chatId); settings.model = args[0]; await saveSettings(chatId, settings); await reply(chatId, `Model changed to ${modelLabel(args[0])}.`, createMainKeyboard(settings)); } else await reply(chatId, "Unknown or disallowed model. Use /models.", createMainKeyboard(settingsFor(chatId))); return true; }
  if (command === "/effort" && args[0]) { if (isEffort(args[0])) { const settings = settingsFor(chatId); settings.effort = args[0]; await saveSettings(chatId, settings); await reply(chatId, `Effort changed to ${args[0]}.`, createMainKeyboard(settings)); } else await reply(chatId, "Effort must be low, medium, or high.", createMainKeyboard(settingsFor(chatId))); return true; }
  if (command === "/mode" && args[0]) { if (isMode(args[0])) { const settings = settingsFor(chatId); settings.mode = args[0]; await saveSettings(chatId, settings); await reply(chatId, `Mode changed to ${args[0]}.`, createMainKeyboard(settings)); } else await reply(chatId, "Mode must be plan or accept-edits.", createMainKeyboard(settingsFor(chatId))); return true; }
  if (command === "/sandbox" && args[0]) { const settings = settingsFor(chatId); if (args[0] === "on" || (args[0] === "off" && (config.agy.allowSandboxDisable || !config.agy.sandbox))) { settings.sandbox = args[0] === "on"; await saveSettings(chatId, settings); await reply(chatId, `Sandbox ${settings.sandbox ? "enabled" : "disabled"}.`, createMainKeyboard(settings)); } else await reply(chatId, "Sandbox is enforced by the server.", createMainKeyboard(settings)); return true; }
  if (command === "/session") { await reply(chatId, sessionText(chatId), createMainKeyboard(settingsFor(chatId))); return true; }
  if (command === "/usage" || command === "/quota") { await reply(chatId, usageReport(chatId), createMainKeyboard(settingsFor(chatId))); return true; }
  if (command === "/status") { const status = queue.statusForChat(chatId); await reply(chatId, `Status: ${status.active ? `running (${status.active.id})` : "idle"}\nQueued for this chat: ${status.queued}\nTotal queued: ${status.totalQueued}`, createMainKeyboard(settingsFor(chatId))); return true; }
  if (command === "/cancel") { const result = queue.cancelForChat(chatId); await reply(chatId, `Cancelled: ${result.removed} queued, active=${result.activeCancelled ? "yes" : "no"}.`, createMainKeyboard(settingsFor(chatId))); return true; }
  return false;
}

function addUsage(previous: Usage | null | undefined, current: Usage | null): Usage | null {
  if (!current) return previous || null;
  const total: Usage = { ...(previous || {}) };
  for (const [key, value] of Object.entries(current) as Array<[keyof Usage, number]>) total[key] = (total[key] || 0) + value;
  return total;
}

async function processJob(job: QueueJob, isCancelled: () => boolean): Promise<void> {
  const controller = new AbortController();
  controllers.set(String(job.chatId), controller);
  let progressMessage: { message_id: number } | null = null;
  let lastProgressAt = 0;
  let progressUpdate = Promise.resolve();
  let responseDraft = "";
  try {
    await telegram.sendChatAction(job.chatId);
    const session = state.session(job.chatId);
    const settings = settingsFor(job.chatId);
    progressMessage = await telegram.sendMessage(job.chatId, `AGY is starting...\n${settingsText(settings)}`);
    const startedAt = Date.now();
    const updateProgress = (text: string): void => {
      if (!progressMessage || Date.now() - lastProgressAt < 1200) return;
      lastProgressAt = Date.now();
      progressUpdate = progressUpdate.then(() => telegram.editMessageText(job.chatId, progressMessage!.message_id, text)).catch(() => undefined);
    };
    const result = await runAgy(config.agy, job.prompt, session?.conversationId || null, {
      ...settings,
      onEvent: (event: StreamEvent) => {
        const step = event.step_update as Record<string, unknown> | undefined;
        const textDelta = typeof step?.text_delta === "string" ? step.text_delta : "";
        if (textDelta) responseDraft += textDelta;
        const update = formatStepUpdate(step);
        if (responseDraft.trim()) {
          const draft = responseDraft.length > 3000 ? `...${responseDraft.slice(-3000)}` : responseDraft;
          updateProgress(`AGY is responding...\nModel: ${modelLabel(settings.model)}\n\n${draft}`);
        } else if (update) {
          updateProgress(`${update}\nModel: ${modelLabel(settings.model)}\nElapsed: ${((Date.now() - startedAt) / 1000).toFixed(0)}s`);
        }
      },
    });
    if (isCancelled()) return;
    const latestSession = state.session(job.chatId);
    const lastRun = { model: result.model || settings.model, usage: result.usage, durationMs: result.durationMs, numTurns: result.numTurns, toolCalls: result.toolCalls, status: result.status || "SUCCESS", completedAt: new Date().toISOString() };
    await state.setSession(job.chatId, { ...(result.conversationId ? { conversationId: result.conversationId } : {}), settings: latestSession?.settings || settings, lastRun, usageTotals: addUsage(latestSession?.usageTotals, result.usage), updatedAt: new Date().toISOString() });
    await progressUpdate;
    if (progressMessage) await telegram.editMessageText(job.chatId, progressMessage.message_id, `AGY completed in ${((result.durationMs || Date.now() - startedAt) / 1000).toFixed(1)}s.\nModel: ${modelLabel(result.model || settings.model)}\n${usageText(result.usage)}`);
    if (result.text.length > config.telegram.maxMessageChars * 2) await telegram.sendDocument(job.chatId, `agy-${job.id}.md`, result.text);
    else await reply(job.chatId, result.text, createMainKeyboard(settingsFor(job.chatId)));
  } catch (error) {
    if (!isCancelled()) { if (progressMessage) await telegram.editMessageText(job.chatId, progressMessage.message_id, `AGY failed: ${(error as Error).message}`).catch(() => undefined); await reply(job.chatId, `AGY failed: ${(error as Error).message}`, createMainKeyboard(settingsFor(job.chatId))); }
  } finally { controllers.delete(String(job.chatId)); }
}

const queue = new JobQueue(config.queue.maxSize, processJob);
const originalCancel = queue.cancelForChat.bind(queue);
queue.cancelForChat = (chatId: ChatId) => { const result = originalCancel(chatId); controllers.get(String(chatId))?.abort(); return result; };

async function handleUpdate(update: TelegramUpdate): Promise<void> {
  if (update.callback_query) { await handleCallback(update.callback_query); return; }
  const message = update.message;
  if (!authorizedMessage(message) || !message?.text) return;
  const text = message.text.trim(); const parts = text.split(/\s+/); const command = parts[0].toLowerCase().split("@")[0];
  if (command.startsWith("/") && await handleCommand(message, command, parts.slice(1))) return;
  const buttonText = text;
  if (buttonText.startsWith("🤖 ")) { await reply(message.chat.id, "Select a model:", modelKeyboard(message.chat.id)); return; }
  if (buttonText.startsWith("🧠 Effort")) { await reply(message.chat.id, "Select reasoning effort:", effortKeyboard(message.chat.id)); return; }
  if (buttonText.startsWith("⚙ Mode")) { await reply(message.chat.id, "Select execution mode:", modeKeyboard(message.chat.id)); return; }
  if (buttonText.startsWith("🔒 Sandbox")) { await reply(message.chat.id, `Sandbox is ${settingsFor(message.chat.id).sandbox ? "enabled" : "disabled"}.`, sandboxKeyboard(message.chat.id)); return; }
  if (buttonText === "📊 Usage / Quota") { await reply(message.chat.id, usageReport(message.chat.id), createMainKeyboard(settingsFor(message.chat.id))); return; }
  if (buttonText === "🧾 Session") { await reply(message.chat.id, sessionText(message.chat.id), createMainKeyboard(settingsFor(message.chat.id))); return; }
  if (buttonText === "🆕 New session") { await state.resetSession(message.chat.id); await reply(message.chat.id, "New AGY conversation started.", createMainKeyboard(settingsFor(message.chat.id))); return; }
  if (buttonText === "⛔ Cancel") { const result = queue.cancelForChat(message.chat.id); await reply(message.chat.id, `Cancelled: ${result.removed} queued, active=${result.activeCancelled ? "yes" : "no"}.`, createMainKeyboard(settingsFor(message.chat.id))); return; }
  if (text.startsWith("/")) { await reply(message.chat.id, "Unknown command. Use /menu.", createMainKeyboard(settingsFor(message.chat.id))); return; }
  const result = queue.enqueue({ chatId: message.chat.id, prompt: text });
  if (!result.accepted) await reply(message.chat.id, "Queue is full. Try again shortly.", createMainKeyboard(settingsFor(message.chat.id)));
  else await reply(message.chat.id, result.position && result.position > 1 ? `Prompt queued (#${result.position}).` : "Prompt accepted. AGY is working...", createMainKeyboard(settingsFor(message.chat.id)));
}

async function main(): Promise<void> {
  console.log(`agy-telegram started; workspace=${config.agy.workspace}; privateOnly=${config.telegram.privateOnly}`);
  await telegram.setMyCommands([
    { command: "menu", description: "Show the bottom control keyboard" },
    { command: "new", description: "Start a new AGY conversation" },
    { command: "usage", description: "Show usage and quota" },
    { command: "quota", description: "Show usage and quota" },
    { command: "status", description: "Show current job status" },
    { command: "cancel", description: "Cancel the active or queued job" },
    { command: "help", description: "Show available commands" },
  ]).catch((error: unknown) => console.error(`setMyCommands failed: ${(error as Error).message}`));
  let offset = state.offset;
  while (true) {
    try { const updates = await telegram.getUpdates(offset); for (const update of updates) { await handleUpdate(update); offset = update.update_id + 1; await state.setOffset(offset); } }
    catch (error) { console.error(`polling error: ${(error as Error).message}`); await new Promise((resolve) => setTimeout(resolve, 5000)); }
  }
}

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
await main();
