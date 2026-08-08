const API_ROOT = (token) => `https://api.telegram.org/bot${token}`;

export class TelegramClient {
  constructor(token) {
    this.root = API_ROOT(token);
  }

  async call(method, payload = {}, signal) {
    const response = await fetch(`${this.root}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(`Telegram ${method} failed: ${body.description || response.status}`);
    return body.result;
  }

  getUpdates(offset, signal) {
    return this.call("getUpdates", { offset, timeout: 30, allowed_updates: ["message"] }, signal);
  }

  sendMessage(chatId, text) {
    return this.call("sendMessage", { chat_id: chatId, text });
  }

  sendChatAction(chatId, action = "typing") {
    return this.call("sendChatAction", { chat_id: chatId, action });
  }

  async sendDocument(chatId, filename, content) {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("document", new Blob([content], { type: "text/markdown" }), filename);
    const response = await fetch(`${this.root}/sendDocument`, { method: "POST", body: form });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(`Telegram sendDocument failed: ${body.description || response.status}`);
    return body.result;
  }
}

export function splitMessage(text, maxChars) {
  if (text.length <= maxChars) return [text];
  const chunks = [];
  let rest = text;
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf("\n", maxChars);
    if (cut < Math.floor(maxChars * 0.5)) cut = maxChars;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, "");
  }
  if (rest) chunks.push(rest);
  return chunks;
}
