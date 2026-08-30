// W3-TG case 4 wait: drain the forum topic-2 dev-bot replies (read-back),
// check hub.log for the subagent relay + exec gates, surface pending perms.
import process from "node:process";
import fs from "node:fs";

const TOKEN = process.env.TELEGRAM_MASTER_BOT_TOKEN;
const FORUM = process.env.TELEGRAM_TEST_TOPIC_GROUP_ID;
const API = `https://api.telegram.org/bot${TOKEN}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
function hubLogTail(n = 400) {
  return fs
    .readFileSync("/home/node/.clisbot-dev/hub.log", "utf8")
    .split("\n")
    .slice(-n)
    .join("\n");
}

async function main() {
  let offset = 0;
  const rows = [];
  const t0 = Date.now();
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    const d = await tg("getUpdates", { offset, limit: 100 });
    offset = d.length ? Math.max(...d.map((u) => u.update_id)) + 1 : offset;
    for (const u of d) {
      const m = u.message ?? {};
      if (m.chat?.id === Number(FORUM) && m.from?.username === "longluong3bot")
        rows.push({
          msg_id: m.message_id,
          date: m.date,
          thread: m.message_thread_id ?? null,
          text: (m.text ?? "").slice(0, 300),
        });
    }
    const finalSeen = rows.some((r) => (r.text || "").includes("PONG-TG-W3G"));
    if (finalSeen) {
      await sleep(12000);
      break;
    }
    if (Date.now() - t0 > 285000) break;
  }
  console.log(`dev-bot topic-2 replies over ${Math.round((Date.now() - t0) / 1000)}s:`);
  for (const r of rows)
    console.log(`  msg ${r.msg_id} @${r.date} thread=${r.thread} :: ${r.text.slice(0, 150)}`);
  const sub = rows.find((r) => (r.text || "").includes("(subagent):"));
  const final = rows.filter((r) => (r.text || "").includes("PONG-TG-W3G"));
  const finalIdx = rows.length ? rows.lastIndexOf(final[0]) : -1;
  const subIdx = rows.length ? rows.findIndex((r) => (r.text || "").includes("(subagent):")) : -1;
  console.log(
    JSON.stringify({
      subagent_labeled_post: sub ?? null,
      final_answer: final.length ? final[0] : null,
      subagent_before_final: subIdx !== -1 && finalIdx !== -1 && subIdx < finalIdx,
    }),
  );
  // hub.log evidence: subagent relay / steer / approval lines in the window
  const tail = hubLogTail(500);
  const interesting = tail
    .split("\n")
    .filter((l) =>
      /subagent|Sub-agent|steered|bound|approval answered|answered an approval|provider_subagents/i.test(
        l,
      ),
    )
    .slice(-25);
  console.log("hub.log tail (subagent/steer/approval lines):");
  console.log(interesting.join("\n"));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
