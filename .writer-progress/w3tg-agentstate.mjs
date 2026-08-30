// Shared helper: fetch pending permission ids for one agent on the dev daemon.
// Usage: node .writer-progress/w3tg-agentstate.mjs <agentIdPrefix> [list|pending]
import { readFileSync } from "node:fs";
import WebSocket from "ws";

const agentPrefix = process.argv[2];
const raw = readFileSync("/home/node/.clisbot-dev/.daemon-password", "utf8").trim();
const eq = raw.indexOf("=");
const pw = eq > 0 ? raw.slice(eq + 1).trim() : raw;
const socket = new WebSocket("ws://127.0.0.1:6867/ws", [`paseo.bearer.${pw}`]);
socket.on("open", () => {
  socket.send(
    JSON.stringify({
      type: "hello",
      clientId: `w3tg-state-${process.pid}`,
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
          message: { type: "fetch_agents_request", requestId: "s1" },
        }),
      ),
    400,
  );
});
socket.on("message", (rawMsg) => {
  const f = JSON.parse(rawMsg.toString());
  const m = f.type === "session" ? f.message : f;
  if (m?.type === "fetch_agents_response") {
    for (const e of m.payload?.entries ?? []) {
      const a = e?.agent ?? e;
      if (agentPrefix && !a?.id?.startsWith(agentPrefix)) continue;
      const pending = a.pendingPermissions ?? a.state?.pendingPermissions ?? [];
      console.log(
        JSON.stringify({
          agent: a.id,
          status: a.status,
          pending: pending.map((p) => ({
            id: p.id,
            kind: p.kind,
            name: p.name,
            command: p.detail?.command ?? p.input?.command ?? null,
          })),
        }),
      );
    }
    process.exit(0);
  }
});
setTimeout(() => process.exit(2), 8000);
