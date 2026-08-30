// Lean daemon probe: list providers + validate pi/grok (no model).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
const URL = process.env.TRUSTED_CLIENT_URL ?? "ws://127.0.0.1:6867/ws";
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
function call(type, fields = {}, ms = 90000) {
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
    st("open -> hello");
    sock.send(
      JSON.stringify({
        type: "hello",
        clientId: `probe-${process.pid}`,
        clientType: "cli",
        protocolVersion: 1,
        capabilities: { selective_agent_timeline: true },
      }),
    );
    await new Promise((res) => {
      sock.once("message", () => res());
      setTimeout(res, 5000);
    });
    st("server_info received");
    let r;
    try {
      r = await call("list_available_providers_request", {});
      st("LIST_AVAILABLE " + JSON.stringify(r.payload ?? r).slice(0, 600));
    } catch (e) {
      st("LIST_AVAILABLE ERR " + e.message);
    }
    for (const p of ["pi", "grok"]) {
      st(`--- validate ${p} (no model) ---`);
      try {
        const v = await call("hub.execution.agent.validate.request", { provider: p }, 120000);
        st(`VALIDATE ${p}: ` + JSON.stringify(v.payload ?? v).slice(0, 700));
      } catch (e) {
        st(`VALIDATE ${p} ERR: ` + e.message);
      }
    }
    st("DONE");
    done(0);
  } catch (e) {
    st("FATAL " + (e?.stack ?? e));
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
  if (rid && pending.has(rid)) {
    pending.get(rid).cb(i);
    return;
  }
});
sock.on("error", (e) => st("SOCKET_ERROR " + e.message));
setTimeout(() => {
  st("GLOBAL_TIMEOUT");
  done(5);
}, 200000);
