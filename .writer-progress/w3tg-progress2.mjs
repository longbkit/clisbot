// W3-TG case 3 (C2 progress) follow-through: the W3F agent (4f072ac8) is gated
// on out-of-sandbox exec for each of its 3 `sleep 34` steps. Approve each
// pending permission via the typed channel command (re-exercises E2 typed
// resolution on the TG lane), then confirm >=3 progress posts + exactly one
// final PONG-TG-W3F.
import process from "node:process";
import fs from "node:fs";
import { readFileSync } from "node:fs";
import WebSocket from "ws";

const TOKEN = process.env.TELEGRAM_MASTER_BOT_TOKEN;
const GROUP = process.env.TELEGRAM_TEST_GROUP_ID;
const API = `https://api.telegram.org/bot${TOKEN}`;
const AGENT = "4f072ac8-aff1-4d37-8008-dcc8ee50749d";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const raw = readFileSync("/home/node/.clisbot-dev/.daemon-password", "utf8").trim();
const eq = raw.indexOf("=");
const pw = eq > 0 ? raw.slice(eq + 1).trim() : raw;

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

function fetchPending() {
  return new Promise((resolve) => {
    const socket = new WebSocket("ws://127.0.0.1:6867/ws", [`paseo.bearer.${pw}`]);
    socket.on("open", () => {
      socket.send(
        JSON.stringify({
          type: "hello",
          clientId: `w3tg-approve-${process.pid}`,
          clientType: "cli",
          protocolVersion: 1,
          capabilities: { selective_agent_timeline: true },
        }),
      );
      setTimeout(
        () =>
          socket.send(
            JSON.stringify({
              type: "session",
              message: { type: "fetch_agents_request", requestId: "pend" },
            }),
          ),
        400,
      );
    });
    socket.on("message", (rawMsg) => {
      const f = JSON.parse(rawMsg.toString());
      const m = f.type === "session" ? f.message : f;
      if (m?.type === "fetch_agents_response") {
        const entries = m.payload?.entries ?? [];
        let out = [];
        for (const e of entries) {
          const a = e?.agent ?? e;
          if (a?.id === AGENT) out = a.pendingPermissions ?? a.state?.pendingPermissions ?? [];
        }
        try {
          socket.close();
        } catch {}
        resolve(out);
      }
    });
    setTimeout(() => {
      try {
        socket.close();
      } catch {}
      resolve([]);
    }, 7000);
  });
}

async function drain(baseline) {
  const ups = await tg("getUpdates", { offset: baseline, limit: 100 });
  const rows = ups.map((u) => {
    const m = u.message ?? {};
    return {
      msg_id: m.message_id ?? null,
      date: m.date ?? null,
      from: m.from?.username ?? null,
      text: (m.text ?? "").slice(0, 300),
    };
  });
  const maxUpdate = rows.length ? Math.max(...ups.map((u) => u.update_id)) : baseline - 1;
  return { rows, maxUpdate };
}

let offset = 0;
// Prime the read-back cursor with any backlog so far (consumes the prompt that
// was already posted; fine — the progress/final assertions only need post-now).
offset = (await drain(0)).maxUpdate + 1;
const botSinceDrive = [];

const approved = new Set();
const t0 = Date.now();
for (let i = 0; i < 60; i++) {
  await sleep(4000);
  const d = await drain(offset);
  offset = d.maxUpdate + 1;
  for (const r of d.rows) if (r.from === "longluong3bot") botSinceDrive.push(r);
  const finalSeen = botSinceDrive.some((r) => (r.text || "").includes("PONG-TG-W3F"));
  const pending = await fetchPending();
  const pendingExec = pending.find(
    (p) => p.id.startsWith("permission-exec-") && !approved.has(p.id),
  );
  if (pendingExec) {
    const cmd = `approve ${pendingExec.id}`;
    const sent = await tg("sendMessage", {
      chat_id: GROUP,
      text: cmd,
      disable_web_page_preview: true,
    });
    approved.add(pendingExec.id);
    console.log(
      `[+${Math.round((Date.now() - t0) / 1000)}s] APPROVE ${pendingExec.id} (master msg ${sent.message_id}) :: ${pendingExec.detail?.command?.slice(0, 60)}`,
    );
  }
  if (finalSeen) {
    console.log(`[+${Math.round((Date.now() - t0) / 1000)}s] final answer observed; settling…`);
    await sleep(15000);
    const d2 = await drain(offset);
    offset = d2.maxUpdate + 1;
    for (const r of d2.rows) if (r.from === "longluong3bot") botSinceDrive.push(r);
    break;
  }
  if (Date.now() - t0 > 270000) break;
}

console.log("bot messages since drive start:");
for (const r of botSinceDrive)
  console.log(`  msg ${r.msg_id} @${r.date} :: ${r.text.slice(0, 140)}`);
const final = botSinceDrive.filter((r) => (r.text || "").includes("PONG-TG-W3F"));
const progress = botSinceDrive.filter(
  (r) => !(r.text || "").includes("PONG-TG-W3F") && !(r.text || "").startsWith("approve "),
);
const gaps = [];
for (let i = 1; i < progress.length; i++) gaps.push(progress[i].date - progress[i - 1].date);
console.log(
  JSON.stringify({
    approved_ids: [...approved],
    final_count: final.length,
    final_rows: final,
    progress_count: progress.length,
    progress_gaps_sec: gaps,
    progress: progress.map((r) => ({ msg: r.msg_id, date: r.date, t: r.text.slice(0, 80) })),
  }),
);
