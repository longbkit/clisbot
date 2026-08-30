import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
const URL = "ws://127.0.0.1:6867/ws";
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
let sid = false;
const pending = new Map();
function call(type, fields = {}, ms = 30000) {
  return new Promise((res, rej) => {
    const rid = randomUUID();
    const t = setTimeout(() => {
      pending.delete(rid);
      rej(new Error(`timeout ${type}`));
    }, ms);
    pending.set(rid, {
      t,
      cb: (i) => {
        clearTimeout(t);
        pending.delete(rid);
        res(i);
      },
    });
    sock.send(JSON.stringify({ type: "session", message: { type, requestId: rid, ...fields } }));
  });
}
sock.on("open", async () => {
  try {
    st("hello");
    sock.send(
      JSON.stringify({
        type: "hello",
        clientId: `pv-${process.pid}`,
        clientType: "cli",
        protocolVersion: 1,
        capabilities: { selective_agent_timeline: true },
      }),
    );
    await new Promise((r) => {
      sock.once("message", () => r());
      setTimeout(r, 4000);
    });
    let a;
    try {
      a = await call("list_available_providers_request", {});
    } catch (e) {
      st("LIST_ERR " + e.message);
    }
    if (a) st("LIST_AVAILABLE " + JSON.stringify(a.payload ?? a).slice(0, 500));
    let s;
    try {
      s = await call("get_providers_snapshot_request", { cwd: `${DEV_HOME}/workspace` }, 120000);
    } catch (e) {
      st("SNAP_ERR " + e.message);
    }
    if (s) {
      const p = s.payload ?? s;
      const entries =
        p.providers ?? p.entries ?? (Array.isArray(p) ? p : (p.snapshot?.providers ?? []));
      if (Array.isArray(entries))
        st(
          "SNAPSHOT " +
            JSON.stringify(
              entries.map((e) => ({
                provider: e.provider,
                status: e.status,
                enabled: e.enabled,
                source: e.source,
                err: e.error || null,
                nModels: (e.models || []).length,
              })),
            ),
        );
      else st("SNAP_RAW " + JSON.stringify(s).slice(0, 800));
    }
    st("DONE");
    process.exit(0);
  } catch (e) {
    st("FATAL " + (e?.stack ?? e));
    process.exit(6);
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
  st("GLOBAL_TIMEOUT");
  process.exit(5);
}, 180000);
