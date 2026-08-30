// Master-bot test driver (EXTERNAL SENDER only). Reads TELEGRAM_MASTER_BOT_TOKEN
// from env; NEVER prints it. Two subcommands:
//   node master-driver.mjs send "<text>" [chat_id] [--thread <id>]
//   node master-driver.mjs updates [offset] [--limit 50]
// chat_id defaults to TELEGRAM_TEST_GROUP_ID. --thread sets message_thread_id.
import process from "node:process";

const TOKEN = process.env.TELEGRAM_MASTER_BOT_TOKEN;
const GROUP = process.env.TELEGRAM_TEST_GROUP_ID;
const API = `https://api.telegram.org/bot${TOKEN}`;
const sub = process.argv[2];

function err(msg) {
  console.error(msg);
  process.exit(1);
}

if (!TOKEN) err("TELEGRAM_MASTER_BOT_TOKEN not set (source .env first)");

async function tg(method, params) {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params ?? {}),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`TG ${method} not ok: ${JSON.stringify(json)}`);
  return json.result;
}

if (sub === "send") {
  const text = process.argv[3];
  const chat = process.argv[4] ?? GROUP;
  if (!text) err("usage: send <text> [chat_id] [--thread <id>]");
  const params = { chat_id: chat, text };
  const ti = process.argv.indexOf("--thread");
  if (ti !== -1) params.message_thread_id = Number(process.argv[ti + 1]);
  const r = await tg("sendMessage", params);
  // Per-observer ids: record the master's own message_id for the driver only.
  console.log(
    JSON.stringify({
      sent: true,
      master_message_id: r.message_id,
      chat: r.chat?.id,
      thread: params.message_thread_id ?? null,
      date: r.date,
      len: text.length,
    }),
  );
} else if (sub === "updates") {
  const offsetArg = process.argv[3];
  const limitArg = process.argv.includes("--limit")
    ? Number(process.argv[process.argv.indexOf("--limit") + 1])
    : 50;
  const params = { limit: limitArg, allowed_updates: ["message"] };
  if (offsetArg !== undefined && offsetArg !== "") params.offset = Number(offsetArg);
  const ups = await tg("getUpdates", params);
  const rows = ups.map((u) => {
    const m = u.message ?? u.edited_message ?? {};
    return {
      update_id: u.update_id,
      from: m.from?.username ?? m.from?.first_name ?? null,
      chat: m.chat?.id ?? null,
      msg_id: m.message_id ?? null,
      date: m.date ?? null,
      thread: m.message_thread_id ?? null,
      text: (m.text ?? "").slice(0, 300),
    };
  });
  // Highest observed update_id (for next drain).
  const maxUpdate = rows.length ? Math.max(...rows.map((r) => r.update_id)) : null;
  console.log(JSON.stringify({ count: rows.length, max_update_id: maxUpdate, rows }, null, 1));
} else {
  err("unknown subcommand");
}
