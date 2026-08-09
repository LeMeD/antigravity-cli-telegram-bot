#!/usr/bin/env node

import process from "node:process";
import { formatStepUpdate, parseCommandArgs, runAgy, runAgyCommand, validateCustomArgs } from "./agy-runner.js";
import { loadConfig, isEffort, isMode } from "./config.js";
import { modelLabel } from "./models.js";
import { createMainKeyboard } from "./keyboards.js";
import { JobQueue, type QueueJob } from "./queue.js";
import { StateStore } from "./state.js";
import { formatTelegramHtml, splitMessage, TelegramClient } from "./telegram.js";
import type { AppConfig, ChatId, InlineKeyboardMarkup, ReplyMarkup, SessionSettings, StreamEvent, TelegramCallbackQuery, TelegramMessage, TelegramUpdate, Usage } from "./types.js";

const config = loadConfig();
const state = new StateStore(config.stateFile);
await state.load();
const telegram = new TelegramClient(config.telegram.token);
const controllers = new Map<string, AbortController>();
const pendingDangerousCommands = new Map<string, string[]>();

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

async function replyWithFormattedResponse(chatId: ChatId, text: string, replyMarkup?: ReplyMarkup): Promise<void> {
  const html = formatTelegramHtml(text);
  if (!html || html.length > config.telegram.maxMessageChars) {
    await reply(chatId, text, replyMarkup);
    return;
  }
  try {
    await telegram.sendMessage(chatId, html, replyMarkup, "HTML");
  } catch {
    await reply(chatId, text, replyMarkup);
  }
}

function button(text: string, callback_data: string): { text: string; callback_data: string } { return { text, callback_data }; }

function backKeyboard(): InlineKeyboardMarkup { return { inline_keyboard: [[button("‹ Back", "menu:main")]] }; }

function settingsFor(chatId: ChatId): SessionSettings {
  const defaults: SessionSettings = {
    model: config.agy.model || null, effort: config.agy.effort, mode: config.agy.mode, sandbox: config.agy.sandbox,
    agent: config.agy.agent || null, project: config.agy.project || null, addDirs: [], continueSession: false,
    newProject: false, disableSlashCommands: false, jsonSchema: null, logFile: null, outputFormat: "stream-json",
    printTimeout: null, dangerouslySkipPermissions: false,
  };
  const stored = state.session(chatId)?.settings || {};
  const settings: SessionSettings = {
    model: typeof stored.model === "string" && config.agy.allowedModels.includes(stored.model) ? stored.model : defaults.model,
    effort: typeof stored.effort === "string" && isEffort(stored.effort) ? stored.effort : defaults.effort,
    mode: typeof stored.mode === "string" && isMode(stored.mode) ? stored.mode : defaults.mode,
    sandbox: typeof stored.sandbox === "boolean" ? stored.sandbox : defaults.sandbox,
    agent: typeof stored.agent === "string" && stored.agent.trim() ? stored.agent.trim() : defaults.agent,
    project: typeof stored.project === "string" && stored.project.trim() ? stored.project.trim() : defaults.project,
    addDirs: Array.isArray(stored.addDirs) ? stored.addDirs.filter((value): value is string => typeof value === "string" && !!value.trim()).map((value) => value.trim()) : [],
    continueSession: stored.continueSession === true,
    newProject: stored.newProject === true,
    disableSlashCommands: stored.disableSlashCommands === true,
    jsonSchema: typeof stored.jsonSchema === "string" && stored.jsonSchema.trim() ? stored.jsonSchema : null,
    logFile: typeof stored.logFile === "string" && stored.logFile.trim() ? stored.logFile : null,
    outputFormat: stored.outputFormat === "text" || stored.outputFormat === "json" || stored.outputFormat === "stream-json" ? stored.outputFormat : defaults.outputFormat,
    printTimeout: typeof stored.printTimeout === "string" && stored.printTimeout.trim() ? stored.printTimeout.trim() : null,
    dangerouslySkipPermissions: false,
  };
  if (config.agy.sandbox && !config.agy.allowSandboxDisable) settings.sandbox = true;
  return settings;
}

function settingsText(settings: SessionSettings): string {
  return [
    `Model: ${modelLabel(settings.model)}`, `Effort: ${settings.effort}`, `Mode: ${settings.mode}`,
    `Agent: ${settings.agent || "default"}`, `Project: ${settings.project || "default"}`,
    `Sandbox: ${settings.sandbox ? "enabled" : "disabled"}`, `Output: ${settings.outputFormat}`,
    `Add dirs: ${settings.addDirs?.length || 0}`, `Slash commands: ${settings.disableSlashCommands ? "disabled" : "enabled"}`,
  ].join("\n");
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

function isOutputFormat(value: string): value is NonNullable<SessionSettings["outputFormat"]> {
  return value === "text" || value === "json" || value === "stream-json";
}

function sessionOptionUsage(option: string): string {
  return [
    `/project ID|clear`, `/add-dir PATH|clear`, `/output-format text|json|stream-json`,
    `/json-schema JSON_OR_PATH|clear`, `/log-file PATH|clear`, `/print-timeout DURATION|clear`,
    `/continue on|off`, `/new-project on|off`, `/disable-slash-commands on|off`,
  ].find((line) => line.startsWith(`/${option} `)) || `Usage: /${option} VALUE`;
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

function mainInlineKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [button("Models", "menu:models"), button("Effort", "menu:effort")],
      [button("Mode", "menu:mode"), button("Sandbox", "menu:sandbox")],
      [button("Session", "menu:session"), button("Usage / Quota", "menu:usage")],
      [button("AGY models", "cli:models"), button("AGY agents", "cli:agents")],
      [button("Changelog", "cli:changelog"), button("Plugins", "cli:plugins")],
      [button("CLI help", "cli:help"), button("CLI version", "cli:version")],
      [button("CLI options", "menu:cli"), button("Custom /agy", "menu:custom")],
      [button("Plugin actions", "menu:plugins"), button("Update CLI", "cli:update")],
      [button("New session", "action:new"), button("Cancel", "action:cancel")],
    ],
  };
}

type CliCommand = "models" | "agents" | "changelog" | "plugins" | "help" | "version";

function cliCommandArgs(command: CliCommand): string[] {
  if (command === "models") return ["models"];
  if (command === "agents") return ["agents"];
  if (command === "changelog") return ["changelog"];
  if (command === "plugins") return ["plugins", "list"];
  if (command === "version") return ["--version"];
  return ["--help"];
}

async function cliOutput(chatId: ChatId, messageId: number, command: CliCommand): Promise<void> {
  await telegram.editMessageText(chatId, messageId, `Running agy ${cliCommandArgs(command).join(" ")}...`);
  try {
    const output = await runAgyCommand(config.agy, cliCommandArgs(command));
    const title = command === "help" ? "AGY CLI help" : `AGY ${command}`;
    await reply(chatId, `${title}\n\n${output}`, createMainKeyboard(settingsFor(chatId)));
  } catch (error) {
    await reply(chatId, `Could not read AGY ${command}: ${(error as Error).message}`, createMainKeyboard(settingsFor(chatId)));
  }
}

async function showMain(chatId: ChatId, messageId?: number): Promise<void> {
  const settings = settingsFor(chatId);
  const text = `AGY Telegram\n\n${settingsText(settings)}\n\nUse the two controls beside the input for Model and Mode. Use /menu for the full control panel.`;
  if (messageId) {
    await telegram.editMessageText(chatId, messageId, text, mainInlineKeyboard());
    await telegram.sendMessage(chatId, "Controls updated.", createMainKeyboard(settings));
  } else {
    await reply(chatId, text, mainInlineKeyboard());
    await telegram.sendMessage(chatId, "Model and mode controls are ready.", createMainKeyboard(settings));
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
  if (kind === "cli") return telegram.editMessageText(chatId, messageId, "All AGY CLI flags are available with /agy. Common session flags can be set here; options that need a path or value have a command example.", cliOptionsKeyboard(chatId));
  if (kind === "output") return telegram.editMessageText(chatId, messageId, "Select the output format used by future normal prompts:", outputFormatKeyboard(chatId));
  if (kind === "custom") return telegram.editMessageText(chatId, messageId, "Custom AGY command\n\nUse /agy followed by any non-interactive AGY arguments. Example:\n/agy --print \"Explain this project\" --output-format text\n\nInteractive TTY mode is unavailable through Telegram.", backKeyboard());
  if (kind === "plugins") return telegram.editMessageText(chatId, messageId, "Plugin commands\n\nRead-only:\n/agy plugin list\n\nMutating commands require /agy-confirm after the bot asks for confirmation:\n/agy plugin install NAME\n/agy plugin uninstall NAME\n/agy plugin enable NAME\n/agy plugin disable NAME\n/agy update", backKeyboard());
}

function cliOptionsKeyboard(chatId: ChatId): InlineKeyboardMarkup {
  const settings = settingsFor(chatId);
  return {
    inline_keyboard: [
      [button("Project", "cli:project"), button("Agent", "cli:agent")],
      [button(`Continue: ${settings.continueSession ? "on" : "off"}`, "toggle:continue"), button(`New project: ${settings.newProject ? "on" : "off"}`, "toggle:new-project")],
      [button(`Output: ${settings.outputFormat}`, "menu:output"), button(`Slash cmds: ${settings.disableSlashCommands ? "off" : "on"}`, "toggle:disable-slash")],
      [button("Add directory", "cli:add-dir"), button("JSON schema", "cli:json-schema")],
      [button("Log file", "cli:log-file"), button("Print timeout", "cli:print-timeout")],
      [button("Conversation ID", "cli:conversation"), button("Prompt flags", "cli:prompt")],
      [button("‹ Back", "menu:main")],
    ],
  };
}

function outputFormatKeyboard(chatId: ChatId): InlineKeyboardMarkup {
  const selected = settingsFor(chatId).outputFormat;
  return {
    inline_keyboard: [
      ["text", "json", "stream-json"].map((value) => button(`${selected === value ? "✅ " : ""}${value}`, `set:output:${value}`)),
      [button("‹ Back", "menu:cli")],
    ],
  };
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
  if (data.startsWith("cli:")) {
    const command = data.slice(4);
    if (["models", "agents", "changelog", "plugins", "help", "version"].includes(command)) await cliOutput(chatId, messageId, command as CliCommand);
    else if (command === "update") await runCustomAgy(chatId, ["update"]);
    else await showCliOption(chatId, messageId, command);
    return;
  }
  if (data.startsWith("toggle:")) {
    const option = data.slice(7);
    const settings = settingsFor(chatId);
    if (option === "continue") settings.continueSession = !settings.continueSession;
    if (option === "new-project") settings.newProject = !settings.newProject;
    if (option === "disable-slash") settings.disableSlashCommands = !settings.disableSlashCommands;
    await saveSettings(chatId, settings);
    await telegram.editMessageText(chatId, messageId, "CLI options updated.", cliOptionsKeyboard(chatId));
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
    if (key === "output" && isOutputFormat(value)) settings.outputFormat = value;
    await saveSettings(chatId, settings);
    if (key === "output") await telegram.editMessageText(chatId, messageId, "Output format updated.", cliOptionsKeyboard(chatId));
    else await showMain(chatId, messageId);
  }
}

async function showCliOption(chatId: ChatId, messageId: number, option: string): Promise<void> {
  const examples: Record<string, string> = {
    project: "/agy --project PROJECT --print \"prompt\"",
    agent: "/agy --agent NAME --print \"prompt\"",
    continue: "/agy --continue --print \"prompt\"",
    "new-project": "/agy --new-project --print \"prompt\"",
    "output-format": "/agy --output-format text --print \"prompt\"",
    "disable-slash": "/agy --disable-slash-commands --print \"prompt\"",
    "add-dir": "/agy --add-dir /path --print \"prompt\"",
    "json-schema": "/agy --json-schema '{\"type\":\"object\"}' --print \"prompt\"",
    "log-file": "/agy --log-file /path/log --print \"prompt\"",
    "print-timeout": "/agy --print-timeout 10m --print \"prompt\"",
    conversation: "/agy --conversation CONVERSATION_ID --print \"prompt\"",
    prompt: "/agy --print \"prompt\" --output-format stream-json",
  };
  await telegram.editMessageText(chatId, messageId, `Use this custom command:\n\n${examples[option] || "/agy --help"}`, backKeyboard());
}

function isDangerousCustomCommand(args: string[]): boolean {
  const subcommand = args[0];
  const pluginAction = ["install", "uninstall", "enable", "disable", "import", "link"].includes(args[1] || "");
  return args.includes("--dangerously-skip-permissions") || subcommand === "update" || subcommand === "install" ||
    ((subcommand === "plugin" || subcommand === "plugins") && pluginAction);
}

function customArgsForExecution(args: string[]): string[] {
  const isPrintCommand = args.includes("--print") || args.includes("-p") || args.includes("--prompt");
  if (isPrintCommand && config.agy.sandbox && !config.agy.allowSandboxDisable && !args.includes("--sandbox")) return [...args, "--sandbox"];
  return args;
}

async function runCustomAgy(chatId: ChatId, args: string[], confirmed = false): Promise<void> {
  const validation = validateCustomArgs(args);
  if (validation) { await reply(chatId, validation, createMainKeyboard(settingsFor(chatId))); return; }
  if (args.includes("--dangerously-skip-permissions") && !config.agy.allowDangerouslySkipPermissions) {
    await reply(chatId, "--dangerously-skip-permissions is disabled by server policy.", createMainKeyboard(settingsFor(chatId))); return;
  }
  if (isDangerousCustomCommand(args) && !confirmed) {
    pendingDangerousCommands.set(String(chatId), args);
    await reply(chatId, `This command can change the AGY installation, plugins, or permission policy:\n\nagy ${args.join(" ")}\n\nSend /agy-confirm to execute it, or /cancel to discard it.`, createMainKeyboard(settingsFor(chatId)));
    return;
  }
  const executionArgs = customArgsForExecution(args);
  pendingDangerousCommands.delete(String(chatId));
  await reply(chatId, `Running agy ${executionArgs.join(" ")}...`, createMainKeyboard(settingsFor(chatId)));
  try {
    const output = await runAgyCommand(config.agy, executionArgs, config.agy.timeoutMs);
    await reply(chatId, `AGY command result\n\n${output}`, createMainKeyboard(settingsFor(chatId)));
  } catch (error) {
    await reply(chatId, `AGY command failed: ${(error as Error).message}`, createMainKeyboard(settingsFor(chatId)));
  }
}

async function handleCommand(message: TelegramMessage, command: string, args: string[]): Promise<boolean> {
  const chatId = message.chat.id;
  if (["/start", "/menu"].includes(command)) { await showMain(chatId); return true; }
  if (command === "/help") { await showMain(chatId); await cliOutput(chatId, await telegram.sendMessage(chatId, "Loading AGY CLI help...") .then((result) => result.message_id), "help"); return true; }
  if (command === "/new") { await state.resetSession(chatId); await reply(chatId, "New AGY conversation started.", createMainKeyboard(settingsFor(chatId))); return true; }
  if (command === "/models") { await reply(chatId, "Select a model:", modelKeyboard(chatId)); return true; }
  if (command === "/model") { if (!args[0]) await reply(chatId, `Current model: ${modelLabel(settingsFor(chatId).model)}\nUse /models to change it.`, createMainKeyboard(settingsFor(chatId))); else if (config.agy.allowedModels.includes(args[0])) { const settings = settingsFor(chatId); settings.model = args[0]; await saveSettings(chatId, settings); await reply(chatId, `Model changed to ${modelLabel(args[0])}.`, createMainKeyboard(settings)); } else await reply(chatId, "Unknown or disallowed model. Use /models.", createMainKeyboard(settingsFor(chatId))); return true; }
  if (command === "/effort") { if (!args[0]) await reply(chatId, `Current effort: ${settingsFor(chatId).effort}\nUse /effort low|medium|high.`, createMainKeyboard(settingsFor(chatId))); else if (isEffort(args[0])) { const settings = settingsFor(chatId); settings.effort = args[0]; await saveSettings(chatId, settings); await reply(chatId, `Effort changed to ${args[0]}.`, createMainKeyboard(settings)); } else await reply(chatId, "Effort must be low, medium, or high.", createMainKeyboard(settingsFor(chatId))); return true; }
  if (command === "/mode") { if (!args[0]) await reply(chatId, `Current mode: ${settingsFor(chatId).mode}\nUse /mode plan|accept-edits.`, createMainKeyboard(settingsFor(chatId))); else if (isMode(args[0])) { const settings = settingsFor(chatId); settings.mode = args[0]; await saveSettings(chatId, settings); await reply(chatId, `Mode changed to ${args[0]}.`, createMainKeyboard(settings)); } else await reply(chatId, "Mode must be plan or accept-edits.", createMainKeyboard(settingsFor(chatId))); return true; }
  if (command === "/sandbox") { if (!args[0]) await reply(chatId, `Sandbox: ${settingsFor(chatId).sandbox ? "enabled" : "disabled"}\nUse /sandbox on|off.`, createMainKeyboard(settingsFor(chatId))); else { const settings = settingsFor(chatId); if (args[0] === "on" || (args[0] === "off" && (config.agy.allowSandboxDisable || !config.agy.sandbox))) { settings.sandbox = args[0] === "on"; await saveSettings(chatId, settings); await reply(chatId, `Sandbox ${settings.sandbox ? "enabled" : "disabled"}.`, createMainKeyboard(settings)); } else await reply(chatId, "Sandbox is enforced by the server.", createMainKeyboard(settings)); } return true; }
  if (command === "/agent") { const settings = settingsFor(chatId); if (!args[0]) await reply(chatId, `Current agent: ${settings.agent || "default"}\nUse /agents to list agents or /agent NAME to select one.`, createMainKeyboard(settings)); else { settings.agent = args.join(" "); await saveSettings(chatId, settings); await reply(chatId, `Agent changed to ${settings.agent}.`, createMainKeyboard(settings)); } return true; }
  if (command === "/project") { const settings = settingsFor(chatId); if (!args[0]) await reply(chatId, `Current project: ${settings.project || "default"}\n${sessionOptionUsage("project")}`, createMainKeyboard(settings)); else { settings.project = args[0].toLowerCase() === "clear" ? null : args.join(" "); await saveSettings(chatId, settings); await reply(chatId, `Project set to ${settings.project || "default"}.`, createMainKeyboard(settings)); } return true; }
  if (command === "/add-dir") { const settings = settingsFor(chatId); if (!args[0]) await reply(chatId, `Additional directories: ${settings.addDirs?.join(", ") || "none"}\n${sessionOptionUsage("add-dir")}`, createMainKeyboard(settings)); else { settings.addDirs = args[0].toLowerCase() === "clear" ? [] : [...(settings.addDirs || []), args.join(" ")]; await saveSettings(chatId, settings); await reply(chatId, `Additional directories: ${settings.addDirs.join(", ") || "none"}.`, createMainKeyboard(settings)); } return true; }
  if (command === "/output-format") { const settings = settingsFor(chatId); if (!args[0]) await reply(chatId, `Current output format: ${settings.outputFormat}\n${sessionOptionUsage("output-format")}`, createMainKeyboard(settings)); else if (isOutputFormat(args[0])) { settings.outputFormat = args[0]; await saveSettings(chatId, settings); await reply(chatId, `Output format set to ${settings.outputFormat}.`, createMainKeyboard(settings)); } else await reply(chatId, `Output format must be text, json, or stream-json.`, createMainKeyboard(settings)); return true; }
  if (command === "/json-schema") { const settings = settingsFor(chatId); if (!args[0]) await reply(chatId, `JSON schema: ${settings.jsonSchema || "none"}\n${sessionOptionUsage("json-schema")}`, createMainKeyboard(settings)); else { settings.jsonSchema = args[0].toLowerCase() === "clear" ? null : args.join(" "); await saveSettings(chatId, settings); await reply(chatId, `JSON schema ${settings.jsonSchema ? "set" : "cleared"}.`, createMainKeyboard(settings)); } return true; }
  if (command === "/log-file") { const settings = settingsFor(chatId); if (!args[0]) await reply(chatId, `Log file: ${settings.logFile || "AGY default"}\n${sessionOptionUsage("log-file")}`, createMainKeyboard(settings)); else { settings.logFile = args[0].toLowerCase() === "clear" ? null : args.join(" "); await saveSettings(chatId, settings); await reply(chatId, `Log file ${settings.logFile ? `set to ${settings.logFile}` : "cleared"}.`, createMainKeyboard(settings)); } return true; }
  if (command === "/print-timeout") { const settings = settingsFor(chatId); if (!args[0]) await reply(chatId, `Print timeout: ${settings.printTimeout || "gateway default"}\n${sessionOptionUsage("print-timeout")}`, createMainKeyboard(settings)); else { settings.printTimeout = args[0].toLowerCase() === "clear" ? null : args[0]; await saveSettings(chatId, settings); await reply(chatId, `Print timeout ${settings.printTimeout ? `set to ${settings.printTimeout}` : "cleared"}.`, createMainKeyboard(settings)); } return true; }
  if (["/continue", "/new-project", "/disable-slash-commands"].includes(command)) { const key = command === "/continue" ? "continueSession" : command === "/new-project" ? "newProject" : "disableSlashCommands"; const settings = settingsFor(chatId); if (!args[0]) await reply(chatId, `${command}: ${settings[key] ? "on" : "off"}\n${sessionOptionUsage(command.slice(1))}`, createMainKeyboard(settings)); else if (["on", "off"].includes(args[0].toLowerCase())) { settings[key] = args[0].toLowerCase() === "on"; await saveSettings(chatId, settings); await reply(chatId, `${command} ${settings[key] ? "enabled" : "disabled"}.`, createMainKeyboard(settings)); } else await reply(chatId, `Use on or off.\n${sessionOptionUsage(command.slice(1))}`, createMainKeyboard(settings)); return true; }
  if (command === "/agents") { await reply(chatId, "Loading AGY agents...", createMainKeyboard(settingsFor(chatId))); const output = await runAgyCommand(config.agy, ["agents"]).catch((error) => `Could not read AGY agents: ${(error as Error).message}`); await reply(chatId, `AGY agents\n\n${output || "No custom agents available."}`, createMainKeyboard(settingsFor(chatId))); return true; }
  if (command === "/changelog") { const output = await runAgyCommand(config.agy, ["changelog"]).catch((error) => `Could not read AGY changelog: ${(error as Error).message}`); await reply(chatId, `AGY changelog\n\n${output}`, createMainKeyboard(settingsFor(chatId))); return true; }
  if (command === "/plugins") { const output = await runAgyCommand(config.agy, ["plugins", "list"]).catch((error) => `Could not read AGY plugins: ${(error as Error).message}`); await reply(chatId, `AGY plugins\n\n${output || "No imported plugins."}`, createMainKeyboard(settingsFor(chatId))); return true; }
  if (command === "/cli-help") { const output = await runAgyCommand(config.agy, ["--help"]).catch((error) => `Could not read AGY help: ${(error as Error).message}`); await reply(chatId, `AGY CLI help\n\n${output}`, createMainKeyboard(settingsFor(chatId))); return true; }
  if (command === "/version") { const output = await runAgyCommand(config.agy, ["--version"]).catch((error) => `Could not read AGY version: ${(error as Error).message}`); await reply(chatId, `AGY version: ${output}`, createMainKeyboard(settingsFor(chatId))); return true; }
  if (command === "/session") { await reply(chatId, sessionText(chatId), createMainKeyboard(settingsFor(chatId))); return true; }
  if (command === "/usage" || command === "/quota") { await reply(chatId, usageReport(chatId), createMainKeyboard(settingsFor(chatId))); return true; }
  if (command === "/status") { const status = queue.statusForChat(chatId); await reply(chatId, `Status: ${status.active ? `running (${status.active.id})` : "idle"}\nQueued for this chat: ${status.queued}\nTotal queued: ${status.totalQueued}`, createMainKeyboard(settingsFor(chatId))); return true; }
  if (command === "/cancel") { pendingDangerousCommands.delete(String(chatId)); const result = queue.cancelForChat(chatId); await reply(chatId, `Cancelled: ${result.removed} queued, active=${result.activeCancelled ? "yes" : "no"}.`, createMainKeyboard(settingsFor(chatId))); return true; }
  if (command === "/agy-confirm") { const pending = pendingDangerousCommands.get(String(chatId)); if (!pending) await reply(chatId, "There is no pending dangerous AGY command.", createMainKeyboard(settingsFor(chatId))); else await runCustomAgy(chatId, pending, true); return true; }
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
    else await replyWithFormattedResponse(job.chatId, result.text, createMainKeyboard(settingsFor(job.chatId)));
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
  const text = message.text.trim(); const parts = text.split(/\s+/); const command = parts[0].toLowerCase().split("@")[0].replace(/_/g, "-");
  if (command === "/agy") { try { await runCustomAgy(message.chat.id, parseCommandArgs(text.slice(parts[0].length))); } catch (error) { await reply(message.chat.id, `Invalid /agy command: ${(error as Error).message}`, createMainKeyboard(settingsFor(message.chat.id))); } return; }
  if (command.startsWith("/") && await handleCommand(message, command, parts.slice(1))) return;
  const buttonText = text;
  if (buttonText === "🤖 Model") { await reply(message.chat.id, "Select a model:", modelKeyboard(message.chat.id)); return; }
  if (buttonText.startsWith("⚙ Mode:")) { const settings = settingsFor(message.chat.id); settings.mode = settings.mode === "plan" ? "accept-edits" : "plan"; await saveSettings(message.chat.id, settings); await reply(message.chat.id, `Mode changed to ${settings.mode}.`, createMainKeyboard(settings)); return; }
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
    { command: "models", description: "Choose the Telegram model" },
    { command: "model", description: "Show or choose the model" },
    { command: "effort", description: "Show or change reasoning effort" },
    { command: "mode", description: "Show or change plan/edit mode" },
    { command: "sandbox", description: "Show or change sandbox mode" },
    { command: "session", description: "Show session settings" },
    { command: "help", description: "Show available commands" },
    { command: "agents", description: "List available AGY agents" },
    { command: "agent", description: "Select an AGY agent" },
    { command: "project", description: "Set the AGY project" },
    { command: "add_dir", description: "Add an AGY workspace directory" },
    { command: "output_format", description: "Set AGY output format" },
    { command: "json_schema", description: "Set AGY JSON schema" },
    { command: "log_file", description: "Set AGY log file" },
    { command: "print_timeout", description: "Set AGY print timeout" },
    { command: "continue", description: "Toggle AGY conversation continuation" },
    { command: "new_project", description: "Toggle new AGY project mode" },
    { command: "disable_slash_commands", description: "Toggle AGY slash expansion" },
    { command: "changelog", description: "Show AGY changelog" },
    { command: "plugins", description: "List imported AGY plugins" },
    { command: "cli_help", description: "Show AGY CLI help" },
    { command: "version", description: "Show AGY CLI version" },
    { command: "agy", description: "Run a custom non-interactive AGY command" },
    { command: "agy_confirm", description: "Confirm a pending AGY command" },
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
