#!/usr/bin/env node
// READ-ONLY probe of the DEV daemon (127.0.0.1:6867, ~/.clisbot-dev) provider
// state: persisted mutable config (providers) + list_provider_models for the
// providers the H5/H6 matrix needs. No mutation, no restart.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

const DATA_DIR = process.env.CLISBOT_HOME || `${homedir()}/.clisbot-dev`;
const DAEMON_WS = process.env.TRUSTED_CLIENT_URL || "ws://127.0.0.1:6867/ws";
const t0 = Date.now();
const log = (x) => console.log(`[t+${Date.now() - t0}ms] ${x}`);

function password() {
  try {
    const raw = readFileSync(`${DATA_DIR}/.daemon-password`, "utf8").trim();
    const eq = raw.indexOf("=");
    return eq > 0 ? raw.slice(eq + 1).trim() : raw;
  } catch {
    return process.env.PASEO_PASSWORD?.trim() || "";
  }
}
function openTrusted() {
  return new Promise((res, rej) => {
    const pw = password();
    const sock = new WebSocket(DAEMON_WS, pw ? [`paseo.bearer.${pw}`] : undefined);
    const timer = setTimeout(() => rej(new Error("daemon /ws connect timeout")), 15000);
    sock.on("open", () => {
      sock.send(
        JSON.stringify({
          type: "hello",
          clientId: `w3-probe-${process.pid}`,
          clientType: "cli",
          protocolVersion: 1,
          capabilities: { selective_agent_timeline: true },
        }),
      );
    });
    sock.on("message", (raw) => {
      let f;
      try {
        f = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const m = f.type === "session" ? f.message : f;
      if (m?.type === "status" && m.payload?.status === "server_info") {
        clearTimeout(timer);
        res(sock);
      }
    });
    sock.on("error", (e) => {
      clearTimeout(timer);
      rej(e);
    });
  });
}
function rpc(sock, type, fields = {}, ms = 30000) {
  return new Promise((res, rej) => {
    const rid = randomUUID();
    const timer = setTimeout(() => rej(new Error(`timeout ${type}`)), ms);
    const onMsg = (raw) => {
      let f;
      try {
        f = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const m = f.type === "session" ? f.message : f;
      const r = m?.requestId ?? m?.payload?.requestId;
      if (r !== rid) return;
      clearTimeout(timer);
      sock.off("message", onMsg);
      res(m);
    };
    sock.on("message", onMsg);
    sock.send(JSON.stringify({ type: "session", message: { type, requestId: rid, ...fields } }));
  });
}

const main = async () => {
  const sock = await openTrusted();
  log("trusted /ws open");
  const cfg = await rpc(sock, "get_daemon_config_request");
  const cp = cfg.payload ?? cfg;
  log(
    `get_daemon_config: providers=${JSON.stringify(cp.providers ?? cp.config?.providers ?? null)}`,
  );
  for (const p of ["codex", "pi", "grok"]) {
    try {
      const r = await rpc(sock, "list_provider_models_request", { provider: p });
      const payload = r.payload ?? {};
      if (payload.error) log(`list_provider_models ${p}: ERROR ${payload.error}`);
      else
        log(
          `list_provider_models ${p}: ${payload.models?.length ?? 0} models -> ${payload.models
            ?.map((m) => m.id)
            .join(", ")}`,
        );
    } catch (e) {
      log(`list_provider_models ${p}: RPC FAIL ${e.message}`);
    }
  }
  sock.close();
};
main().catch((e) => {
  console.error("FATAL", e?.stack ?? String(e));
  process.exit(1);
});
