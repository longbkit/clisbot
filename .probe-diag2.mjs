#!/usr/bin/env node
// Authoritative per-provider check via provider_diagnostic_request (forces a
// single-provider refresh+warm on the daemon) + a forced global refresh for pi
// to confirm status. Mirrors validateAgentConfiguration's gates:
//   hasProvider -> "not configured"; enabled; status ready; model/mode.
// Read-only. Plain trusted /ws session (NOT the hub-relationship socket).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
const URL = process.env.TRUSTED_CLIENT_URL ?? "ws://127.0.0.1:6867/ws";
const DEV_HOME = process.env.CLISBOT_HOME ?? `${homedir()}/.clisbot-dev`;
function password() {
  try {
    const raw = readFileSync(`${DEV_HOME}/.daemon-password`, "utf8").trim();
    const eq = raw.indexOf("=");
    return eq > 0 ? raw.slice(eq + 1).trim() : raw;
  } catch {
    return process.env.PASEO_PASSWORD?.trim() ?? "";
  }
}
const t0 = Date.now();
const st = (x) => console.log(`[t+${Date.now() - t0}ms] ${x}`);
const pw = password();
const sock = new WebSocket(URL, pw ? [`paseo.bearer.${pw}`] : undefined);
let settled = false;
function done(c = 0) {
  if (settled) return;
  settled = true;
  setTimeout(() => process.exit(c), 200);
}
const pending = new Map();
function call(type, fields = {}, ms = 40000) {
  return new Promise((res, rej) => {
    const rid = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(rid);
      rej(new Error(`timeout ${type}`));
    }, ms);
    pending.set(rid, {
      timer,
      cb: (i) => {
        clearTimeout(timer);
        pending.delete(rid);
        res(i);
      },
    });
    st(`-> ${type} ${fields.provider ? "(" + fields.provider + ")" : ""}`);
    sock.send(JSON.stringify({ type: "session", message: { type, requestId: rid, ...fields } }));
  });
}
sock.on("open", async () => {
  try {
    sock.send(
      JSON.stringify({
        type: "hello",
        clientId: `probe-diag2-${process.pid}`,
        clientType: "cli",
        protocolVersion: 1,
        capabilities: { selective_agent_timeline: true },
      }),
    );
    await new Promise((res) => {
      sock.once("message", () => res());
      setTimeout(res, 8000);
    });
    st("server_info received");
    // grok: expect "not configured" (no override in config.json, not builtin).
    for (const p of ["grok", "pi"]) {
      try {
        const r = await call("provider_diagnostic_request", { provider: p });
        const d = r.payload?.diagnostic ?? r.payload ?? r;
        st(`DIAG ${p}: ${JSON.stringify(d).slice(0, 900)}`);
      } catch (e) {
        st(`DIAG ${p} ERR: ${e.message}`);
      }
    }
    // Force-warm pi globally, then re-read the settings snapshot entry.
    try {
      await call("refresh_providers_snapshot_request", { providers: ["pi"] }, 40000);
      st("refresh pi acked");
      const r = await call("get_providers_snapshot_request", {});
      const entries = r.payload?.entries ?? [];
      for (const e of entries) {
        if (e.provider === "pi" || e.provider === "codex") {
          st(
            `SNAP ${e.provider}: status=${e.status} enabled=${e.enabled} models=${Array.isArray(e.models) ? e.models.length : 0} modes=${Array.isArray(e.modes) ? e.modes.length : 0}` +
              (e.error ? ` ERR=${e.error}` : ""),
          );
        }
      }
    } catch (e) {
      st("REFRESH/SNAP pi ERR: " + e.message);
    }
    st("DONE");
    done(0);
  } catch (e) {
    st("FATAL " + (e?.message ?? e));
    done(6);
  }
});
sock.on("message", (raw) => {
  let f;
  try {
    f = JSON.parse(raw.toString());
  } catch {
    return;
  }
  const i = f.type === "session" ? f.message : f;
  const rid = i?.requestId ?? i?.payload?.requestId;
  if (rid && pending.has(rid)) pending.get(rid).cb(i);
});
sock.on("error", (e) => st("SOCKET_ERROR " + e.message));
setTimeout(() => {
  st("GLOBAL_TIMEOUT 120s");
  done(5);
}, 120000);
