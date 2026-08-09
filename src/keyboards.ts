import type { ReplyKeyboardMarkup, SessionSettings } from "./types.js";

function modeLabel(mode: SessionSettings["mode"]): string { return mode === "accept-edits" ? "edit" : "plan"; }

/** Persistent keyboard shown immediately above Telegram's input field. */
export function createMainKeyboard(settings: SessionSettings): ReplyKeyboardMarkup {
  return {
    keyboard: [
      ["📋 Plan", `⚙ Mode: ${modeLabel(settings.mode)}`],
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: "Send a prompt to AGY...",
  };
}
