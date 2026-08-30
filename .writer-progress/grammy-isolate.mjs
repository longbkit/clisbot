import { readFileSync } from "node:fs";
import { Bot, InputFile } from "grammy";
const TOKEN = process.env.TELEGRAM_DEV_BOT_TOKEN;
const FORUM = process.env.TELEGRAM_TEST_TOPIC_GROUP_ID;
const T1 = process.env.TELEGRAM_TEST_TOPIC_1_ID;
function wrappedFetch() {
  const base = globalThis.fetch;
  const timeoutMs = 20000;
  return async (input, init) => {
    const controller = new AbortController();
    const external = init?.signal ?? null;
    if (external !== null) {
      if (external.aborted) controller.abort(external.reason);
      else
        external.addEventListener("abort", () => controller.abort(external.reason), { once: true });
    }
    const timer = setTimeout(() => controller.abort(new Error(`timeout ${timeoutMs}`)), timeoutMs);
    try {
      return await base(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };
}
const file = () =>
  new InputFile(
    readFileSync("/home/node/.clisbot-dev/workspace/w3-media-64.png"),
    "w3-media-64.png",
  );
async function attempt(label, build) {
  try {
    const r = await build();
    console.log(label, "OK msg", r.message_id, "thread", r.message_thread_id);
  } catch (e) {
    console.log(label, "ERR", e.name, "status", e.status, JSON.stringify(e.message).slice(0, 90));
  }
}
await attempt("A: fetch-only (no timeoutSeconds)", async () => {
  const b = new Bot(TOKEN, { client: { fetch: wrappedFetch() } });
  return b.api.sendPhoto(Number(FORUM), file(), { message_thread_id: Number(T1) });
});
await attempt("B: timeoutSeconds-only (no custom fetch)", async () => {
  const b = new Bot(TOKEN, { client: { timeoutSeconds: 20 } });
  return b.api.sendPhoto(Number(FORUM), file(), { message_thread_id: Number(T1) });
});
await attempt("C: both (the hub path)", async () => {
  const b = new Bot(TOKEN, { client: { fetch: wrappedFetch(), timeoutSeconds: 20 } });
  return b.api.sendPhoto(Number(FORUM), file(), { message_thread_id: Number(T1) });
});
// control: JSON sendMessage through the hub path (should still work)
await attempt("D: hub path but sendMessage (JSON)", async () => {
  const b = new Bot(TOKEN, { client: { fetch: wrappedFetch(), timeoutSeconds: 20 } });
  return b.api.sendMessage(Number(FORUM), "w3-isolate-json-test", {
    message_thread_id: Number(T1),
  });
});
