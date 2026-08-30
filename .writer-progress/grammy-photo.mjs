import { readFileSync } from "node:fs";
import { Api, InputFile } from "grammy";
const TOKEN = process.env.TELEGRAM_DEV_BOT_TOKEN;
const FORUM = process.env.TELEGRAM_TEST_TOPIC_GROUP_ID;
const T1 = process.env.TELEGRAM_TEST_TOPIC_1_ID;
const api = new Api(TOKEN);
try {
  const file = new InputFile(
    readFileSync("/home/node/.clisbot-dev/workspace/w3-media-64.png"),
    "w3-media-64.png",
  );
  const r = await api.sendPhoto(Number(FORUM), file, {
    message_thread_id: Number(T1),
    caption: "grammy-direct-test",
  });
  console.log(
    "GRAMMY OK message_id",
    r.message_id,
    "thread",
    r.message_thread_id ?? "(from chat)",
    JSON.stringify(r.chat).slice(0, 80),
  );
} catch (e) {
  console.log(
    "GRAMMY ERR name",
    e.name,
    "status",
    e.status,
    "code",
    e.code,
    "msg",
    e.message,
    "cause",
    e.cause ? String(e.cause).slice(0, 120) : "",
  );
}
