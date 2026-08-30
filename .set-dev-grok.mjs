#!/usr/bin/env node
// Dev-daemon grok provider toggle (H5 unblock, wave-3 2026-08-28).
//
// The user toggled the grok ACP provider ON manually on the PRODUCTION daemon
// (~/.paseo; persisted as agents.providers.grok = { extends: "acp",
// command: ["grok","agent","stdio"] }). The DEV daemon (127.0.0.1:6867,
// ~/.clisbot-dev — the channel-E2E home) had no agents.providers key at all,
// so H5 was BLOCKED ("Unknown provider: grok"). This script applies the same
// override to the DEV daemon only, over a trusted /ws session, using the
// daemon's own supported set_daemon_config RPC:
//   - it PERSISTS to ~/.clisbot-dev/config.json (agents.providers.grok)
//   - it is HOT-APPLIED (config store applyListeners -> snapshot manager
//     applyMutableProviderConfig -> registry rebuild) — NO daemon restart
//   - it touches nothing under ~/.paseo and nothing on port 6767
//
// Usage: node .set-dev-grok.mjs apply | remove | probe
//   apply  -> set providers.grok = { extends:"acp", label, command, enabled:true }
//   remove -> removeProviders: ["grok"] (rollback to the pre-toggle state)
//   probe  -> get_daemon_config + list_provider_models(grok), retried until
//             the ACP warm-up settles (loading -> ready/error) or 60s elapses

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

const DATA_DIR = process.env.CLISBOT_HOME || `${homedir()}/.clisbot-dev`;
const DAEMON_WS = process.env.TRUSTED_CLIENT_URL || "ws://127.0.0.1:6867/ws";
const GROK_OVERRIDE = {
  extends: "acp",
  label: "Grok",
  command: ["grok", "agent", "stdio"],
  enabled: true,
};
const mode = process.argv[2];
const t0 = Date.now();
const log = (x) => console.log(`[t+${Date.now() - t0}ms] ${x}`);

function fail(msg, code = 1) {
  console.error(`FATAL: ${msg}`);
  process.exit(code);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
          clientId: `w3-grok-${process.pid}`,
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

async function grokState(sock) {
  try {
    const r = await rpc(sock, "list_provider_models_request", { provider: "grok" }, 8000);
    const p = r.payload ?? {};
    if (p.error) return `ERROR ${p.error}`;
    const models = p.models ?? [];
    return `status=${p.status ?? "?"} ${models.length} models -> ${models.map((m) => m.id).join(", ")}`;
  } catch (e) {
    return `RPC FAIL ${e.message}`;
  }
}

const main = async () => {
  const sock = await openTrusted();
  log(`trusted /ws open (dev daemon ${DAEMON_WS})`);
  if (mode === "probe") {
    for (let i = 0; i < 12; i++) {
      let cfgKeys = "?";
      try {
        const c = await rpc(sock, "get_daemon_config_request");
        cfgKeys = JSON.stringify(Object.keys((c.payload ?? c).providers ?? {}));
      } catch {
        /* keep polling */
      }
      const grok = await grokState(sock);
      log(`probe ${i + 1}: config.providers=${cfgKeys} | grok: ${grok}`);
      if (!/RPC FAIL|loading/.test(grok)) break; // settled: configured+status, or unknown
      await sleep(5000);
    }
  } else if (mode === "apply") {
    const r = await rpc(sock, "set_daemon_config_request", {
      config: { providers: { grok: GROK_OVERRIDE } },
    });
    const p = r.payload ?? r;
    log(
      `set_daemon_config applied: providers now ${JSON.stringify(
        Object.keys(p.config?.providers ?? p.providers ?? {}),
      )}`,
    );
  } else if (mode === "remove") {
    const r = await rpc(sock, "set_daemon_config_request", {
      config: { removeProviders: ["grok"] },
    });
    const p = r.payload ?? r;
    log(
      `removeProviders applied: providers now ${JSON.stringify(
        Object.keys(p.config?.providers ?? p.providers ?? {}),
      )}`,
    );
  } else {
    fail(`unknown mode ${mode} (apply|remove|probe)`);
  }
  sock.close();
};

main().catch((e) => fail(e?.stack ?? String(e)));
