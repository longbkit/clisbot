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
const REQ = "permission-exec-8715ee5b-0d50-4a9d-9981-49f0deb85967";
const pw = password();
const sock = new WebSocket("ws://127.0.0.1:6867/ws", pw ? [`paseo.bearer.${pw}`] : undefined);
sock.on("open", () => {
  sock.send(
    JSON.stringify({
      type: "hello",
      clientId: `resolve-stuck-${process.pid}`,
      clientType: "cli",
      protocolVersion: 1,
      capabilities: {},
    }),
  );
  setTimeout(() => {
    sock.send(
      JSON.stringify({
        type: "session",
        message: {
          type: "agent_permission_response",
          agentId: AGENT,
          requestId: REQ,
          response: { behavior: "allow" },
        },
      }),
    );
    console.log("sent agent_permission_response (allow) for", REQ);
    setTimeout(() => {
      console.log("done");
      process.exit(0);
    }, 3000);
  }, 1000);
});
sock.on("message", (raw) => {
  const s = raw.toString();
  if (s.includes("permission") || s.includes("error")) console.log("recv:", s.slice(0, 300));
});
sock.on("error", (e) => {
  console.error("ws error", e.message);
  process.exit(2);
});
