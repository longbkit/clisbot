#!/usr/bin/env node
// Probe the dev daemon (127.0.0.1:6867/ws) for the claude provider id + models.
// Trusted session like scripts/live-trusted-client.mjs; password read from
// ~/.clisbot-dev/.daemon-password (never printed).
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

function call(type, fields = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => reject(new Error(`timeout ${type}`)), timeoutMs);
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
      capabilities: {},
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
      const providers = await call("list_available_providers_request", {});
      const list = Array.isArray(providers?.providers) ? providers.providers : (providers ?? []);
      console.log(
        "PROVIDERS:",
        JSON.stringify(
          list.map((p) => p.provider ?? p.id ?? p),
          null,
          2,
        ),
      );
      const claudeId = (list.find((p) => /claude/i.test(p.provider ?? p.id ?? "")) ?? {}).provider;
      const cid = claudeId ?? "claude";
      console.log(`\nusing provider id: ${cid}`);
      try {
        const models = await call("list_provider_models_request", { provider: cid });
        if (models?.error) {
          console.log("models error:", models.error);
          // try the other alias
          const alt = cid === "claude" ? "claude-code" : "claude";
          const m2 = await call("list_provider_models_request", { provider: alt });
          if (m2?.error) console.log(`alt ${alt} error:`, m2.error);
          else
            console.log(
              `\nMODELS(${alt}):`,
              JSON.stringify(
                m2.models.map((m) => m.id ?? m),
                null,
                2,
              ),
            );
        } else {
          console.log(
            `\nMODELS(${cid}):`,
            JSON.stringify(
              models.models.map((m) => m.id ?? m),
              null,
              2,
            ),
          );
        }
      } catch (e) {
        console.log("model call failed:", e.message);
      }
      socket.close();
      process.exit(0);
    })().catch((e) => {
      console.error("probe error:", e.message);
      socket.close();
      process.exit(1);
    });
  }
});

setTimeout(() => {
  console.error("probe: 30s elapsed without server_info");
  process.exit(2);
}, 30000);
