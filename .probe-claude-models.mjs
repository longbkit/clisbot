#!/usr/bin/env node
// List models for provider "claude" on the dev daemon.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import WebSocket from "ws";
const URL = "ws://127.0.0.1:6867/ws";
const DEV_HOME = process.env.CLISBOT_HOME ?? `${homedir()}/.clisbot-dev`;
function password() {
  const raw = readFileSync(`${DEV_HOME}/.daemon-password`, "utf8").trim();
  const eq = raw.indexOf("=");
  return eq > 0 ? raw.slice(eq + 1).trim() : raw;
}
const socket = new WebSocket(URL, [`paseo.bearer.${password()}`]);
function call(type, fields = {}) {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => reject(new Error(`timeout ${type}`)), 20000);
    socket.send(JSON.stringify({ type: "session", message: { type, requestId, ...fields } }));
    const onMessage = (raw) => {
      let frame;
      try {
        frame = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const inner = frame.type === "session" ? frame.message : frame;
      if (!inner || inner.requestId !== requestId) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      if (inner.type === "rpc_error") reject(new Error(JSON.stringify(inner.error ?? inner)));
      else resolve(inner.payload ?? inner);
    };
    socket.on("message", onMessage);
  });
}
socket.on("open", () => {
  socket.send(
    JSON.stringify({
      type: "hello",
      clientId: `provider-probe-${process.pid}`,
      clientType: "cli",
      protocolVersion: 1,
      capabilities: { selective_agent_timeline: true },
    }),
  );
});
socket.on("message", (raw) => {
  let frame;
  try {
    frame = JSON.parse(raw.toString());
  } catch {
    return;
  }
  const inner = frame.type === "session" ? frame.message : frame;
  if (inner?.type === "status" && inner.payload?.status === "server_info") {
    (async () => {
      const models = await call("list_provider_models_request", { provider: "claude" });
      if (models?.error) {
        console.log("models error:", models.error);
        process.exit(1);
      }
      for (const m of models.models ?? []) {
        const s = JSON.stringify(m);
        console.log("-", m.id ?? m.name, s.includes("deprecated") ? `[${s.slice(0, 120)}]` : "");
      }
      process.exit(0);
    })().catch((e) => {
      console.error("probe error:", e.message);
      process.exit(1);
    });
  }
});
setTimeout(() => process.exit(2), 40000);
