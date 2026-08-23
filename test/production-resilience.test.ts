import test from "node:test";
import assert from "node:assert/strict";
import { asAppContext, createHarness, textUpdate } from "./helpers/fixtures.js";
import { processUpdates } from "../src/bot.js";

test("production resilience: a failing update never blocks the offset or later updates", async () => {
  const harness = createHarness({ TELEGRAM_MAX_MESSAGE_CHARS: "50" });
  const ctx = asAppContext(harness);
  try {
    // Update A: /help triggers cliOutput whose editMessageText will fail -> handleUpdate throws
    harness.telegram.failNext("editMessageText", new Error("Telegram HTTP 500"));
    const poisoned = textUpdate(777, "/help");
    const healthy = textUpdate(777, "healthy prompt");

    await processUpdates(ctx, [
      { ...poisoned, update_id: 100 },
      { ...healthy, update_id: 101 },
    ]);

    assert.equal(ctx.state.offset, 102, "offset must advance past the failing update");
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(harness.capturedJobs.filter((j) => j.prompt === "healthy prompt").length, 1, "later updates still processed");
  } finally {
    harness.cleanup();
  }
});

test("production resilience: reply() survives chunk failures and keeps sending the rest", async () => {
  const harness = createHarness({ TELEGRAM_MAX_MESSAGE_CHARS: "20" });
  const ctx = asAppContext(harness);
  try {
    const longText = Array.from({ length: 4 }, (_, i) => `chunkline${i}xxxxx`).join("\n");
    harness.telegram.failNext("sendMessage", new Error("network blip"));

    const { reply } = await import("../src/ui/reply.js");
    await reply(ctx, 777, longText); // must not throw

    assert.equal(harness.telegram.calls.filter((c) => c.method === "sendMessage").length >= 3, true, "remaining chunks still sent");
  } finally {
    harness.cleanup();
  }
});

test("production resilience: queue keeps draining after a worker crash", async () => {
  const harness = createHarness();
  const ctx = asAppContext(harness);
  try {
    let attempts = 0;
    const processed: string[] = [];
    harness.setWorker(async (job) => {
      attempts += 1;
      if (attempts === 1) throw new Error("worker exploded");
      processed.push(String(job.prompt));
    });

    await handleCommandEnqueue(ctx, "first");
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    await handleCommandEnqueue(ctx, "second");
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    assert.deepEqual(processed, ["second"], "next job after worker crash is processed");
    assert.equal(harness.queue.statusForChat(777).active, null);
  } finally {
    harness.cleanup();
  }
});

async function handleCommandEnqueue(ctx: ReturnType<typeof asAppContext>, prompt: string): Promise<void> {
  const { handleUpdate } = await import("../src/router/updates.js");
  await handleUpdate(ctx, textUpdate(777, prompt));
}
