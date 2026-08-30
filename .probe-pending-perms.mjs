import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
const DEV_HOME = process.env.CLISBOT_HOME ?? `${homedir()}/.clisbot-dev`;
function password() {
  try {
    const r = readFileSync(`${DEV_HOME}/.daemon-password`, "utf8").trim();
    const e = r.indexOf("=");
    return e > 0 ? r.slice(e + 1).trim() : r;
  } catch {
    return process.env.PASEO_PASSWORD?.trim() ?? "";
  }
}
const TARGETS = [
  "46151772-8a6c-4078-bc03-b00e4177dd2d",
  "c9952fa3-d17d-411b-bc47-427fed1be404",
  "fddcee33-9145-4dcc-9b8f-c4d3c0a6e4d9",
];
const pw = password();
const sock = new WebSocket("ws://127.0.0.1:6867/ws", pw ? [`paseo.bearer.${pw}`] : undefined);
const pending = new Map();
function findReqId(m) {
  return m?.message?.requestId ?? m?.message?.payload?.requestId;
}
function call(type, fields = {}, ms = 20000) {
  return new Promise((res, rej) => {
    const rid = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(rid);
      rej(new Error(`timeout ${type}`));
    }, ms);
    pending.set(rid, {
      timer,
      cb: (i) => {
        clearTimeout(timer);
        pending.delete(rid);
        res(i);
      },
    });
    sock.send(JSON.stringify({ type: "session", message: { type, requestId: rid, ...fields } }));
  });
}
sock.on("open", async () => {
  sock.send(
    JSON.stringify({
      type: "hello",
      clientId: `probe-${process.pid}`,
      clientType: "cli",
      protocolVersion: 1,
      capabilities: { selective_agent_timeline: true },
    }),
  );
  await new Promise((res) => setTimeout(res, 1000));
  try {
    const agents = await call("fetch_agents_request", {});
    const entries =
      agents?.payload?.entries ?? (Array.isArray(agents?.entries) ? agents.entries : []);
    console.log("=== agents ===");
    for (const e of entries) {
      const a = e.agent ?? e;
      const t = TARGETS.includes(a.id);
      console.log(
        `${t ? ">>>" : "   "} ${(a.id || "").slice(0, 8)} ${a.provider} status=${a.status} pending=${JSON.stringify(a.pendingPermissions ?? null)?.slice(0, 160)}`,
      );
    }
    await call("agent.timeline.set_subscription.request", { agentIds: TARGETS });
    console.log("=== watching 25s for permission events ===");
  } catch (e) {
    console.error("ERROR", e.message);
    process.exit(1);
  }
});
sock.on("message", (raw) => {
  let m;
  try {
    m = JSON.parse(raw.toString());
  } catch {
    return;
  }
  const reqId = findReqId(m);
  if (reqId && pending.has(reqId)) {
    pending.get(reqId).cb(m.message?.payload ?? m.message);
    return;
  }
  if (m.type === "agent_stream") {
    const ev = m.payload?.event;
    const id = m.payload?.agentId;
    if (
      ev &&
      [
        "permission_requested",
        "permission_resolved",
        "attention_required",
        "turn_started",
        "turn_completed",
        "turn_failed",
      ].includes(ev.type)
    ) {
      console.log(
        `[stream ${(id || "").slice(0, 8)}] ${new Date().toISOString()} ${ev.type} :: ${JSON.stringify(ev).slice(0, 300)}`,
      );
    }
  }
});
setTimeout(() => {
  console.log("=== done ===");
  process.exit(0);
}, 25000);
sock.on("error", (e) => {
  console.error("ws error", e.message);
  process.exit(2);
});
