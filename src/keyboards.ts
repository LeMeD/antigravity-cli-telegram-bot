import { modelLabel } from "./models.js";
import type { ReplyKeyboardMarkup, SessionSettings } from "./types.js";

function compactModelLabel(model: string | null): string {
  const label = modelLabel(model).replace(/\s+\([^)]*\)$/, "");
  return label.length > 24 ? `${label.slice(0, 22)}...` : label;
}

/** Persistent keyboard shown immediately above Telegram's input field. */
export function createMainKeyboard(settings: SessionSettings): ReplyKeyboardMarkup {
  return {
    keyboard: [
      [`🤖 ${compactModelLabel(settings.model)}`, `🧠 Effort: ${settings.effort}`],
      [`⚙ Mode: ${settings.mode}`, `🔒 Sandbox: ${settings.sandbox ? "on" : "off"}`],
      ["📊 Usage / Quota", "🧾 Session"],
      ["🆕 New session", "⛔ Cancel"],
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: "Send a prompt to AGY...",
  };
}
