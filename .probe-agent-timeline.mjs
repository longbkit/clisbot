import { readFileSync } from "node:fs";
import { homedir } from "node:os";
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
const AGENT = "fddcee33-9145-4dcc-9b8f-c4d3c0a6e4d9";
const pw = password();
const sock = new WebSocket("ws://127.0.0.1:6867/ws", pw ? [`paseo.bearer.${pw}`] : undefined);
sock.on("open", () => {
  sock.send(
    JSON.stringify({
      type: "hello",
      clientId: `tl-${process.pid}`,
      clientType: "cli",
      protocolVersion: 1,
      capabilities: {},
    }),
  );
  setTimeout(() => {
    sock.send(
      JSON.stringify({
        type: "session",
        message: { type: "fetch_agent_timeline_request", agentId: AGENT, requestId: "tl-1" },
      }),
    );
    setTimeout(() => {
      console.log("done");
      process.exit(0);
    }, 2500);
  }, 800);
});
sock.on("message", (raw) => {
  let m;
  try {
    m = JSON.parse(raw.toString());
  } catch {
    return;
  }
  const msg = m.message ?? m;
  if (msg.requestId === "tl-1" || msg.type === "fetch_agent_timeline_response") {
    const items = msg.items ?? msg.payload?.items ?? msg.timeline ?? [];
    console.log("TIMELINE ITEMS:", items.length);
    for (const it of items) {
      const t = it.type ?? it.kind;
      const det = JSON.stringify(it.detail ?? it).slice(0, 200);
      console.log(`- ${t}: ${det}`);
    }
  }
});
sock.on("error", (e) => {
  console.error("ws error", e.message);
  process.exit(2);
});
