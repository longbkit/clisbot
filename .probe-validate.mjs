import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
const URL = "ws://127.0.0.1:6867/ws";
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
const provider = process.argv[2] || "pi";
const t0 = Date.now();
const st = (x) => console.log(`[t+${Date.now() - t0}ms] ${x}`);
const pw = password();
const sock = new WebSocket(URL, pw ? [`paseo.bearer.${pw}`] : undefined);
sock.on("open", () => {
  st("OPEN, sending hello");
  sock.send(
    JSON.stringify({
      type: "hello",
      clientId: `val-${process.pid}`,
      clientType: "cli",
      protocolVersion: 1,
      capabilities: { selective_agent_timeline: true },
    }),
  );
});
let gotServerInfo = false;
sock.on("message", (raw) => {
  const s = raw.toString();
  let f;
  try {
    f = JSON.parse(s);
  } catch {
    return;
  }
  const i = f.type === "session" ? f.message : f;
  if (!gotServerInfo && i?.type === "status" && i.payload?.status === "server_info") {
    gotServerInfo = true;
    st("server_info OK -> sending validate for " + provider);
    const rid = randomUUID();
    sock.send(
      JSON.stringify({
        type: "session",
        message: { type: "hub.execution.agent.validate.request", requestId: rid, provider },
      }),
    );
    st("validate sent rid=" + rid.slice(0, 8));
    setTimeout(() => {
      st("VALIDATE TIMEOUT 60s - no reply");
      process.exit(4);
    }, 60000);
    return;
  }
  if (i?.type === "hub.execution.agent.validate.response") {
    st("VALIDATE " + provider + " REPLY: " + JSON.stringify(i.payload ?? i).slice(0, 700));
    process.exit(0);
  }
  if (i?.type === "rpc_error") {
    st("RPC_ERROR: " + JSON.stringify(i.error ?? i.payload ?? {}).slice(0, 500));
  }
});
sock.on("error", (e) => {
  st("SOCKET_ERROR " + e.message);
  process.exit(7);
});
setTimeout(() => {
  st("GLOBAL_TIMEOUT");
  process.exit(5);
}, 80000);
