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
const b = new Bot(TOKEN, {
  client: {
    fetch: (i, init) => {
      const body = init?.body;
      console.log(
        "body type:",
        body && body.constructor && body.constructor.name,
        "typeof:",
        typeof body,
      );
      console.log("body instanceof global FormData:", body instanceof globalThis.FormData);
      console.log(
        "body has [Symbol.asyncIterator]:",
        !!body && typeof body[Symbol.asyncIterator] === "function",
      );
      console.log(
        "headers content-type:",
        init?.headers &&
          (init.headers["content-type"] ??
            init.headers.get?.("content-type") ??
            JSON.stringify(init.headers).slice(0, 120)),
      );
      throw new Error("stop");
    },
  },
});
try {
  await b.api.sendPhoto(Number(FORUM), file(), {});
} catch {}
process.exit(0);
