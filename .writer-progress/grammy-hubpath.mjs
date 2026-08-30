import { readFileSync } from "node:fs";
import { Bot, InputFile } from "grammy";
const TOKEN = process.env.TELEGRAM_DEV_BOT_TOKEN;
const FORUM = process.env.TELEGRAM_TEST_TOPIC_GROUP_ID;
const T1 = process.env.TELEGRAM_TEST_TOPIC_1_ID;
// Replicate createTelegramClientFetch({timeoutSeconds:20}) EXACTLY as telegram-policy.ts does
function createTelegramClientFetch(options) {
  const base = options.transport?.fetch ?? globalThis.fetch;
  const timeoutSeconds = options.timeoutSeconds;
  if (typeof timeoutSeconds !== "number" || !Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0)
    return base;
  const timeoutMs = Math.round(timeoutSeconds * 1000);
  return async (input, init) => {
    const controller = new AbortController();
    const external = init?.signal ?? null;
    if (external !== null) {
      if (external.aborted) controller.abort(external.reason);
      else
        external.addEventListener("abort", () => controller.abort(external.reason), { once: true });
    }
    const timer = setTimeout(
      () => controller.abort(new Error(`Telegram request timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    try {
      return await base(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };
}
// Exact hub construction: new Bot(token, { client: { fetch: wrapped, timeoutSeconds } })
const fetchImpl = createTelegramClientFetch({ timeoutSeconds: 20 });
const bot = new Bot(TOKEN, { client: { fetch: fetchImpl, timeoutSeconds: 20 } });
try {
  const file = new InputFile(
    readFileSync("/home/node/.clisbot-dev/workspace/w3-media-64.png"),
    "w3-media-64.png",
  );
  const r = await bot.api.sendPhoto(Number(FORUM), file, { message_thread_id: Number(T1) });
  console.log("HUB-PATH OK message_id", r.message_id, "thread", r.message_thread_id);
} catch (e) {
  console.log(
    "HUB-PATH ERR name",
    e.name,
    "status",
    e.status,
    "code",
    e.code,
    "msg",
    JSON.stringify(e.message).slice(0, 160),
    "cause",
    e.cause ? String(e.cause).slice(0, 160) : "",
  );
}
