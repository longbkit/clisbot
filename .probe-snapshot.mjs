#!/usr/bin/env node
// READ-ONLY provider-snapshot probe against the channel-E2E dev daemon
// (127.0.0.1:6867, ~/.clisbot-dev; NEVER ~/.paseo / 6767). Mirrors the
// live-trusted-client handshake: hello (clientType cli) -> trusted session,
// then the plain-session RPC `get_providers_snapshot_request` — the
// authoritative standalone substitute for `hub.execution.agent.validate.request`
// (which is ONLY handled on the daemon's hub-relationship socket and is
// silently dropped on a plain /ws session). The hello advertises ONLY
// `selective_agent_timeline` (NOT compact_provider_snapshots), so the response
// carries the full `entries` array rather than a compact blob.
//
// Purpose: pre-validate agent targets (H5 grok, H6 pi) + capture the provider
// registry state. Prints, per target, status/enabled/error + model/mode counts.
// No writes. No hub interaction. Usage: node .probe-snapshot.mjs
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
const targets = ["grok", "pi", "codex", "opencode", "claude", "copilot"];
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
function call(type, fields = {}, ms = 30000) {
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
    st("open -> hello (advertiseselective_agent_timeline only, NOT compact)");
    sock.send(
      JSON.stringify({
        type: "hello",
        clientId: `probe-snapshot-${process.pid}`,
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
    const r = await call("get_providers_snapshot_request", {});
    const payload = r.payload ?? r;
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    if (entries.length === 0 && payload.compactSnapshot) {
      st(
        "WARNING: got compactSnapshot instead of entries (capability leak?); compact len=" +
          String(payload.compactSnapshot).length,
      );
    }
    st(`SNAPSHOT: ${entries.length} providers: ` + entries.map((e) => e.provider).join(", "));
    for (const p of targets) {
      const e = entries.find((x) => x.provider === p);
      if (!e) {
        st(`  ${p}: ABSENT from registry (validate -> "Provider '${p}' is not configured")`);
        continue;
      }
      const models = Array.isArray(e.models) ? e.models.length : 0;
      const modes = Array.isArray(e.modes) ? e.modes.length : 0;
      st(
        `  ${p}: status=${e.status} enabled=${e.enabled} source=${e.source ?? "-"} models=${models} modes=${modes}` +
          (e.error ? ` ERROR=${e.error}` : ""),
      );
      if (p === "pi") {
        // pi has a dynamic model list; confirm no static list is required.
        const modelIds = Array.isArray(e.models)
          ? e.models.map((m) => m.id ?? m.label ?? JSON.stringify(m)).slice(0, 12)
          : [];
        if (modelIds.length) st(`    pi model ids (first 12): ${modelIds.join(", ")}`);
      }
      if (p === "codex") {
        const modelIds = Array.isArray(e.models)
          ? e.models.map((m) => m.id ?? m.label).slice(0, 20)
          : [];
        st(`    codex model ids (first 20): ${modelIds.join(", ")}`);
        const modeIds = Array.isArray(e.modes)
          ? e.modes.map((m) => m.id ?? m.name).slice(0, 20)
          : [];
        st(`    codex mode ids: ${modeIds.join(", ")}`);
      }
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
  const rid = i?.requestId;
  if (rid && pending.has(rid)) pending.get(rid).cb(i);
});
sock.on("error", (e) => st("SOCKET_ERROR " + e.message));
setTimeout(() => {
  st("GLOBAL_TIMEOUT 45s");
  done(5);
}, 45000);
