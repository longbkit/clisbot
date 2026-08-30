import { readFileSync } from "node:fs";
import { Bot, InputFile } from "grammy";
const TOKEN = process.env.TELEGRAM_DEV_BOT_TOKEN;
const FORUM = process.env.TELEGRAM_TEST_TOPIC_GROUP_ID;
const T1 = process.env.TELEGRAM_TEST_TOPIC_1_ID;
const file = () =>
  new InputFile(
    readFileSync("/home/node/.clisbot-dev/workspace/w3-media-64.png"),
    "w3-media-64.png",
  );
async function attempt(label, fetchImpl) {
  try {
    const b = new Bot(TOKEN, { client: { fetch: fetchImpl } });
    const r = await b.api.sendPhoto(Number(FORUM), file(), { message_thread_id: Number(T1) });
    console.log(label, "OK msg", r.message_id, "thread", r.message_thread_id);
  } catch (e) {
    console.log(label, "ERR", e.name, "status", e.status, JSON.stringify(e.message).slice(0, 90));
  }
}
await attempt("E: identity passthrough fetch", (i, init) => globalThis.fetch(i, init));
// F: inspect what grammy passes to the custom fetch for a multipart call
await (async () => {
  const b = new Bot(TOKEN, {
    client: {
      fetch: (i, init) => {
        console.log(
          "F: input type:",
          i && i.constructor.name,
          "isRequest:",
          i instanceof Request,
          "init keys:",
          init ? Object.keys(init) : null,
          "init.signal?",
          !!(init && init.signal),
          "input.signal?",
          !!(i && i.signal),
        );
        if (i instanceof Request) {
          console.log("F: input.body?", i.body, "input.method:", i.method, "input.url:", i.url);
        }
        throw new Error("stop");
      },
    },
  });
  try {
    await b.api.sendPhoto(Number(FORUM), file(), {});
  } catch {}
})();
