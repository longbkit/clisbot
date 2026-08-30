#!/usr/bin/env node
// Final pre-validation probe: the on-demand per-provider RPCs the write-script
// validator will use. Mirrors validateAgentConfiguration:
//   list_provider_models_request -> error "Unknown provider: X" (grok) / models (pi,codex)
//   list_provider_modes_request  -> modes (codex); error for providers w/o modes
// Read-only. Plain trusted /ws session. Usage: node .probe-validate2.mjs
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
function call(type, fields = {}, ms = 45000) {
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
    sock.send(JSON.stringify({ type: "session", message: { type, requestId: rid, ...fields } }));
  });
}
sock.on("open", async () => {
  try {
    sock.send(
      JSON.stringify({
        type: "hello",
        clientId: `probe-validate2-${process.pid}`,
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
    // grok: expect error "Unknown provider: grok" (not configured).
    for (const p of ["grok", "pi", "codex"]) {
      let models = null,
        modes = null;
      try {
        const r = await call("list_provider_models_request", { provider: p });
        models = r.payload;
      } catch (e) {
        models = { error: "CALL-ERR " + e.message };
      }
      st(
        `MODELS ${p}: ${models?.error ? "ERROR=" + models.error : "count=" + (Array.isArray(models?.models) ? models.models.length : "?")}`,
      );
      if (p === "codex" && !models?.error) {
        const ids = (models.models ?? []).map((m) => m.id ?? m.label);
        st(`    codex model ids: ${JSON.stringify(ids)}`);
      }
      try {
        const r = await call("list_provider_modes_request", { provider: p });
        modes = r.payload;
      } catch (e) {
        modes = { error: "CALL-ERR " + e.message };
      }
      st(
        `MODES ${p}: ${modes?.error ? "ERROR=" + modes.error : "count=" + (Array.isArray(modes?.modes) ? modes.modes.map((m) => m.id ?? m.name).join(",") : "?")}`,
      );
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
