import { readFileSync } from "node:fs";
import { Bot, InputFile } from "grammy";
const TOKEN = process.env.TELEGRAM_DEV_BOT_TOKEN;
const FORUM = process.env.TELEGRAM_TEST_TOPIC_GROUP_ID;
const T1 = process.env.TELEGRAM_TEST_TOPIC_1_ID;
const { apiThrottler } = await import("@grammyjs/transformer-throttler");
const bot = new Bot(TOKEN);
bot.api.config.use(apiThrottler());
try {
  const file = new InputFile(
    readFileSync("/home/node/.clisbot-dev/workspace/w3-media-64.png"),
    "w3-media-64.png",
  );
  const r = await bot.api.sendPhoto(Number(FORUM), file, { message_thread_id: Number(T1) });
  console.log("GRAMMY+THROTTLE OK message_id", r.message_id, "thread", r.message_thread_id);
} catch (e) {
  console.log(
    "GRAMMY+THROTTLE ERR name",
    e.name,
    "status",
    e.status,
    "code",
    e.code,
    "msg",
    e.message,
    "cause",
    e.cause ? String(e.cause).slice(0, 160) : "",
  );
}
