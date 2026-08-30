// Dump the W3F agent's pending permission requestIds from the dev daemon.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import WebSocket from "ws";

const URL = "ws://127.0.0.1:6867/ws";
const raw = readFileSync("/home/node/.clisbot-dev/.daemon-password", "utf8").trim();
const eq = raw.indexOf("=");
const pw = eq > 0 ? raw.slice(eq + 1).trim() : raw;
const socket = new WebSocket(URL, [`paseo.bearer.${pw}`]);

socket.on("open", () => {
  socket.send(
    JSON.stringify({
      type: "hello",
      clientId: `w3tg-pending-${process.pid}`,
      clientType: "cli",
      protocolVersion: 1,
      capabilities: { selective_agent_timeline: true },
    }),
  );
  setTimeout(() => {
    socket.send(
      JSON.stringify({
        type: "session",
        message: { type: "fetch_agents_request", requestId: "pend-1" },
      }),
    );
  }, 500);
});
socket.on("message", (rawMsg) => {
  const f = JSON.parse(rawMsg.toString());
  const m = f.type === "session" ? f.message : f;
  if (m?.type === "fetch_agents_response") {
    const entries = m.payload?.entries ?? [];
    for (const e of entries) {
      const a = e?.agent ?? e;
      if (a?.id?.startsWith("4f072ac8")) {
        console.log("agent", a.id, "status", a.status);
        console.log(
          JSON.stringify(a.pendingPermissions ?? a.state?.pendingPermissions, null, 1).slice(
            0,
            3000,
          ),
        );
      }
    }
    process.exit(0);
  }
});
setTimeout(() => {
  console.error("timeout");
  process.exit(2);
}, 8000);
