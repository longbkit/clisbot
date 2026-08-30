#!/usr/bin/env node
// Debug variant: log raw frames for 20s after sending list_available_providers_request.
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
let gotInfo = false;
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
    console.log("RAW(non-json):", raw.toString().slice(0, 300));
    return;
  }
  const inner = frame.type === "session" ? frame.message : frame;
  const t = inner?.type ?? frame.type;
  const line = JSON.stringify({ t, keys: Object.keys(inner ?? frame) }).slice(0, 200);
  if (t === "status") {
    console.log(
      "STATUS:",
      inner?.payload?.status,
      JSON.stringify(inner?.payload ?? {}).slice(0, 500),
    );
    if (inner?.payload?.status === "server_info" && !gotInfo) {
      gotInfo = true;
      const requestId = crypto.randomUUID();
      console.log("SENDING list_available_providers_request", requestId.slice(0, 8));
      socket.send(
        JSON.stringify({
          type: "session",
          message: { type: "list_available_providers_request", requestId },
        }),
      );
    }
  } else {
    console.log("FRAME:", line);
    if (String(t).includes("providers") || String(t).includes("rpc_error")) {
      console.log("PAYLOAD:", JSON.stringify(inner ?? frame).slice(0, 2000));
    }
  }
});
setTimeout(() => {
  console.log("done logging");
  process.exit(0);
}, 20000);
