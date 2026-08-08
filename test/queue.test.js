import test from "node:test";
import assert from "node:assert/strict";
import { JobQueue } from "../src/queue.js";

test("processes one job at a time and preserves queue order", async () => {
  const seen = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const queue = new JobQueue(2, async (job) => {
    seen.push(job.prompt);
    if (job.prompt === "first") await gate;
  });

  assert.equal(queue.enqueue({ chatId: 1, prompt: "first" }).accepted, true);
  assert.equal(queue.enqueue({ chatId: 1, prompt: "second" }).accepted, true);
  assert.equal(queue.enqueue({ chatId: 1, prompt: "third" }).accepted, true);
  assert.equal(queue.enqueue({ chatId: 1, prompt: "fourth" }).accepted, false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(seen, ["first"]);
  release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(seen, ["first", "second", "third"]);
});

test("cancels queued jobs for one chat without touching another", () => {
  const queue = new JobQueue(4, async () => {});
  queue.enqueue({ chatId: 1, prompt: "one" });
  queue.enqueue({ chatId: 2, prompt: "two" });
  queue.enqueue({ chatId: 1, prompt: "three" });
  const result = queue.cancelForChat(1);
  assert.equal(result.removed, 1);
  assert.equal(queue.statusForChat(1).queued, 0);
  assert.equal(queue.statusForChat(2).queued, 1);
});
