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
const t0 = Date.now();
const st = (x) => console.log(`[t+${Date.now() - t0}ms] ${x}`);
const pw = password();
const sock = new WebSocket(URL, pw ? [`paseo.bearer.${pw}`] : undefined);
let n = 0;
sock.on("open", () => {
  st("OPEN, sending hello");
  sock.send(
    JSON.stringify({
      type: "hello",
      clientId: `dump-${process.pid}`,
      clientType: "cli",
      protocolVersion: 1,
      capabilities: { selective_agent_timeline: true },
    }),
  );
});
sock.on("message", (raw) => {
  n++;
  const s = raw.toString();
  st(`MSG#${n} len=${s.length} head=${s.slice(0, 140)}`);
  if (n >= 12) {
    st("stop");
    process.exit(0);
  }
});
sock.on("error", (e) => {
  st("SOCKET_ERROR " + e.message);
  process.exit(7);
});
setTimeout(() => {
  st("TIMEOUT 15s");
  process.exit(5);
}, 15000);
