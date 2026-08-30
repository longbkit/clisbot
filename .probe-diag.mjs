#!/usr/bin/env node
// Diagnostic: log EVERY inbound frame type + try both provider-catalog RPCs
// with a long window, to see whether get_providers_snapshot_request /
// list_available_providers_request ever respond on a plain trusted session.
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
function call(type, fields = {}, ms = 55000) {
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
    st(`-> send ${type}`);
    sock.send(JSON.stringify({ type: "session", message: { type, requestId: rid, ...fields } }));
  });
}
sock.on("open", async () => {
  try {
    st("open -> hello");
    sock.send(
      JSON.stringify({
        type: "hello",
        clientId: `probe-diag-${process.pid}`,
        clientType: "cli",
        protocolVersion: 1,
        capabilities: { selective_agent_timeline: true },
      }),
    );
    await new Promise((res) => {
      sock.once("message", () => res());
      setTimeout(res, 8000);
    });
    st("first message after hello received");
    // Fire both; log the list result (small) and wait for the snapshot.
    const listP = call("list_available_providers_request", {})
      .then((r) => {
        const p = r.payload ?? r;
        const provs = Array.isArray(p.providers) ? p.providers : (p ?? []);
        st("LIST_AVAILABLE providers: " + JSON.stringify(provs).slice(0, 500));
      })
      .catch((e) => st("LIST_AVAILABLE ERR " + e.message));
    const snapP = call("get_providers_snapshot_request", {})
      .then((r) => {
        const p = r.payload ?? r;
        const entries = Array.isArray(p.entries) ? p.entries : [];
        st(
          `SNAPSHOT entries=${entries.length} compact=${p.compactSnapshot ? "yes" : "no"} hash=${p.snapshotHash ?? "-"}`,
        );
        for (const e of entries) {
          const m = Array.isArray(e.models) ? e.models.length : 0;
          const md = Array.isArray(e.modes) ? e.modes.length : 0;
          st(
            `  ${e.provider}: status=${e.status} enabled=${e.enabled} source=${e.source ?? "-"} models=${m} modes=${md}` +
              (e.error ? ` ERR=${e.error}` : ""),
          );
        }
      })
      .catch((e) => st("SNAPSHOT ERR " + e.message));
    await Promise.allSettled([listP, snapP]);
    st("DONE");
    done(0);
  } catch (e) {
    st("FATAL " + (e?.stack ?? e));
    done(6);
  }
});
let frameCount = 0;
sock.on("message", (raw) => {
  let f;
  try {
    f = JSON.parse(raw.toString());
  } catch {
    return;
  }
  const i = f.type === "session" ? f.message : f;
  frameCount++;
  if (frameCount <= 40) st(`  <frame ${i?.type ?? "?"}`);
  // requestId is nested in payload for provider-catalog responses (top-level
  // only for some other frames) — correlate on either.
  const rid = i?.requestId ?? i?.payload?.requestId;
  if (rid && pending.has(rid)) pending.get(rid).cb(i);
});
sock.on("error", (e) => st("SOCKET_ERROR " + e.message));
setTimeout(() => {
  st("GLOBAL_TIMEOUT 70s frames=" + frameCount);
  done(5);
}, 70000);
