import process from "node:process";
import { loadConfig } from "./config.js";
import { runAgy } from "./agy-runner.js";
import { JobQueue } from "./queue.js";
import { StateStore } from "./state.js";
import { splitMessage, TelegramClient } from "./telegram.js";

const config = loadConfig();
const state = new StateStore(config.stateFile);
await state.load();
const telegram = new TelegramClient(config.telegram.token);
const controllers = new Map();

function authorized(message) {
  const userId = String(message.from?.id ?? "");
  const chatId = String(message.chat?.id ?? "");
  if (!config.telegram.allowedUserIds.includes(userId)) return false;
  if (config.telegram.allowedChatIds.length && !config.telegram.allowedChatIds.includes(chatId)) return false;
  if (config.telegram.privateOnly && message.chat?.type !== "private") return false;
  return true;
}

async function reply(chatId, text) {
  for (const chunk of splitMessage(text, config.telegram.maxMessageChars)) {
    await telegram.sendMessage(chatId, chunk);
  }
}

async function handleCommand(message, command) {
  const chatId = message.chat.id;
  if (command === "/start" || command === "/help") {
    await reply(chatId, "AGY bot aktif.\n\nKirim prompt untuk diproses AGY.\n/new - percakapan baru\n/status - status job\n/cancel - batalkan job\n/help - bantuan\n\nWorkspace dibatasi oleh konfigurasi server.");
    return true;
  }
  if (command === "/new") {
    await state.resetSession(chatId);
    await reply(chatId, "Percakapan AGY direset.");
    return true;
  }
  if (command === "/status") {
    const status = queue.statusForChat(chatId);
    await reply(chatId, `Status: ${status.active ? `aktif (${status.active.id})` : "idle"}\nAntrian chat: ${status.queued}\nTotal antrian: ${status.totalQueued}`);
    return true;
  }
  if (command === "/cancel") {
    const cancelled = queue.cancelForChat(chatId);
    await reply(chatId, `Dibatalkan: ${cancelled.removed} queued, active=${cancelled.activeCancelled ? "yes" : "no"}.`);
    return true;
  }
  return false;
}

async function processJob(job, isCancelled) {
  const controller = new AbortController();
  controllers.set(job.chatId, controller);
  try {
    await telegram.sendChatAction(job.chatId);
    const session = state.session(job.chatId);
    const result = await runAgy(config.agy, job.prompt, session?.conversationId, { signal: controller.signal });
    if (isCancelled()) return;
    if (result.conversationId) {
      await state.setSession(job.chatId, { conversationId: result.conversationId, updatedAt: new Date().toISOString() });
    }
    if (result.text.length > config.telegram.maxMessageChars * 2) {
      await telegram.sendDocument(job.chatId, `agy-${job.id}.md`, result.text);
    } else {
      await reply(job.chatId, result.text);
    }
  } catch (error) {
    if (!isCancelled()) await reply(job.chatId, `AGY gagal: ${error.message}`);
  } finally {
    controllers.delete(job.chatId);
  }
}

const queue = new JobQueue(config.queue.maxSize, processJob);
const originalCancel = queue.cancelForChat.bind(queue);
queue.cancelForChat = (chatId) => {
  const result = originalCancel(chatId);
  controllers.get(chatId)?.abort();
  return result;
};

async function handleUpdate(update) {
  const message = update.message;
  if (!message?.text || !authorized(message)) return;
  const chatId = message.chat.id;
  const text = message.text.trim();
  const command = text.split(/\s+/, 1)[0].toLowerCase().split("@")[0];
  if (command.startsWith("/") && await handleCommand(message, command)) return;
  if (text.startsWith("/")) {
    await reply(chatId, "Command tidak dikenal. Gunakan /help.");
    return;
  }
  const result = queue.enqueue({ chatId, prompt: text });
  if (!result.accepted) {
    await reply(chatId, "Antrian penuh. Coba lagi beberapa saat lagi.");
    return;
  }
  await reply(chatId, result.position > 1 ? `Prompt masuk antrian (#${result.position}).` : "Prompt diterima, AGY sedang bekerja...");
}

async function main() {
  console.log(`agy-telegram started; workspace=${config.agy.workspace}; privateOnly=${config.telegram.privateOnly}`);
  let offset = state.offset;
  while (true) {
    try {
      const updates = await telegram.getUpdates(offset);
      for (const update of updates) {
        await handleUpdate(update);
        offset = update.update_id + 1;
        await state.setOffset(offset);
      }
    } catch (error) {
      console.error(`polling error: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
await main();
