import { parseAgyModelsOutput, setActiveModels, modelLabel } from "../models.js";
import { runAgyCommand } from "../agy-runner.js";
import type { AppContext } from "../context.js";
import { isEffort } from "../config.js";
import { escapeHtml } from "../telegram.js";
import { isModelAllowed, saveSettings, settingsFor } from "../domain/settings.js";
import { button } from "../ui/inline-keyboards.js";
import type { ChatId, InlineKeyboardMarkup, SessionSettings } from "../types.js";

export async function refreshModels(context: AppContext): Promise<void> {
  try {
    const output = await runAgyCommand(context.config.agy, ["models"], 15_000);
    const parsed = parseAgyModelsOutput(output);
    if (parsed.length > 0) {
      setActiveModels(parsed);
    }
  } catch {
    // Keep fallback models if agy models is unavailable
  }
}

export interface ModelSelectionOutcome {
  settings: SessionSettings;
  text: string;
  defaultOfferKeyboard: InlineKeyboardMarkup;
}

/**
 * Shared by the `/model` command and the `set:model:*` callback: validates the
 * model, derives effort suffixes, persists settings and builds the
 * "set as permanent default?" prompt.
 */
export async function selectModel(context: AppContext, chatId: ChatId, modelId: string): Promise<ModelSelectionOutcome | null> {
  if (!isModelAllowed(context, modelId)) return null;
  const settings = settingsFor(context, chatId);
  settings.model = modelId;
  const match = modelId.match(/-(low|medium|high)$/i);
  if (match) {
    const eff = match[1].toLowerCase();
    if (isEffort(eff)) settings.effort = eff;
  }
  await saveSettings(context, chatId, settings);
  const text = `Model set to <b>${escapeHtml(modelLabel(modelId))}</b>.\n\nWould you like to set this as your permanent default?`;
  const defaultOfferKeyboard: InlineKeyboardMarkup = {
    inline_keyboard: [
      [button("⭐ Yes, set as Default", "action:setdefault"), button("👌 Only this session", "menu:main")],
    ],
  };
  return { settings, text, defaultOfferKeyboard };
}
