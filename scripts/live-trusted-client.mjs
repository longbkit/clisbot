#!/usr/bin/env node
// The scripted trusted client for the two-surface approval live wave — the
// Paseo-side answerer. It connects to the channel-E2E dev daemon
// (~/.clisbot-dev, 127.0.0.1:6867; NEVER ~/.paseo / 6767) exactly like the
// Hub's own trusted session: hello -> trusted session, scopes ["*"], the
// daemon password on the `paseo.bearer.<password>` WS subprotocol (read from
// ~/.clisbot-dev/.daemon-password — referenced by name, never printed).
//
// Usage (repo root; `ws` resolves from the root node_modules):
//   node scripts/live-trusted-client.mjs list
//   node scripts/live-trusted-client.mjs answer --agent <agentId> --request <requestId> --decision allow
//   node scripts/live-trusted-client.mjs watch --agent <agentId> [--seconds 120]
//
// `answer` subscribes the agent's timeline FIRST, then sends the
// fire-and-forget agent_permission_response, then stays attached so the run
// proves the resolution fanout (permission_resolved on the stream +
// agent_permission_resolved top-level) and, for the second-surface race,
// surfaces the daemon's rpc_error for a response the daemon can no longer
// apply. Every line is stamped t+ms (shared clock, per the 2026-08-26
// integration-seams lesson) so the hub log can be interleaved by timestamp.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import WebSocket from "ws";

// The daemon's WS path is `/ws` (hub daemon discovery: `ws://<host>:<port>/ws`).
const URL = process.env.TRUSTED_CLIENT_URL ?? "ws://127.0.0.1:6867/ws";
const DEV_HOME = process.env.CLISBOT_HOME ?? `${homedir()}/.clisbot-dev`;
const t0 = Date.now();
const stamp = (extra = "") => `[t+${Date.now() - t0}ms]${extra ? " " + extra : ""}`;

function password() {
  // The dev-home file is a single `PASEO_PASSWORD=<value>` line (same shape the
  // repo .env carries), not the bare value — split on the first `=`.
  try {
    const raw = readFileSync(`${DEV_HOME}/.daemon-password`, "utf8").trim();
    const eq = raw.indexOf("=");
    return eq > 0 ? raw.slice(eq + 1).trim() : raw;
  } catch {
    return process.env.PASEO_PASSWORD?.trim() ?? "";
  }
}

const mode = process.argv[2] ?? "watch";
const args = process.argv.slice(3);
function arg(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const agentId = arg("--agent");
const requestId = arg("--request");
const decision = arg("--decision") ?? "allow";
const seconds = Number(arg("--seconds") ?? "120");

if (mode !== "list" && agentId === undefined) {
  console.error(`${stamp()} missing --agent <agentId> (mode ${mode})`);
  process.exit(2);
}

const passwordValue = password();
const socket = new WebSocket(
  URL,
  passwordValue !== "" ? [`paseo.bearer.${passwordValue}`] : undefined,
);
const seen = { permissionResolved: 0, agentPermissionResolved: 0, rpcErrors: 0 };
let settled = false;

function done(code = 0) {
  settled = true;
  console.log(
    `${stamp()} SUMMARY permission_resolved=${seen.permissionResolved} agent_permission_resolved=${seen.agentPermissionResolved} rpc_errors=${seen.rpcErrors}`,
  );
  socket.close();
  process.exit(code);
}

function call(type, fields = {}, timeoutMs = 15000) {
  const requestId = crypto.randomUUID();
  const timer = setTimeout(() => {
    console.error(`${stamp()} rpc_error(timeout) ${type}`);
    done(3);
  }, timeoutMs);
  timer.unref();
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
    if (inner.type === "rpc_error") {
      console.error(
        `${stamp()} rpc_error ${type}: ${JSON.stringify(inner.error ?? inner.payload ?? inner)}`,
      );
      done(4);
      return;
    }
    return inner;
  };
  socket.on("message", onMessage);
}

socket.on("open", () => {
  console.log(`${stamp()} open -> hello`);
  socket.send(
    JSON.stringify({
      type: "hello",
      clientId: `live-trusted-client-${process.pid}`,
      clientType: "cli",
      protocolVersion: 1,
      capabilities: { selective_agent_timeline: true },
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
  if (frame.type !== "session" || typeof frame.message !== "object") return;
  const inner = frame.message;
  const type = inner.type;
  if (type === "status" && inner.payload?.status === "server_info") {
    console.log(`${stamp()} server_info (trusted session established)`);
    if (mode === "list") {
      call("fetch_agents_request", {}, 10000);
      socket.on("message", (raw2) => {
        const f2 = JSON.parse(raw2.toString());
        const m2 = f2.type === "session" ? f2.message : f2;
        if (
          m2?.type === "fetch_agents_response" ||
          m2?.type === "agent_created" ||
          (m2?.type === "status" && m2.payload?.status === "server_info")
        ) {
          if (m2.type === "fetch_agents_response" || m2.entries) {
            const entries = Array.isArray(m2.payload?.entries)
              ? m2.payload.entries
              : (m2.entries ?? []);
            for (const entry of entries) {
              const a = entry?.agent ?? entry;
              if (!a?.id) continue;
              const pending =
                a.pendingPermissions ??
                (Array.isArray(a.state?.pendingPermissions)
                  ? a.state.pendingPermissions
                  : undefined);
              console.log(
                `${stamp()} agent ${a.id} title=${JSON.stringify(a.title ?? a.name ?? "-")} status=${a.status ?? a.lifecycle ?? "-"} pending=${Array.isArray(pending) ? pending.length : "?"}`,
              );
            }
          }
          done(0);
        }
      });
      return;
    }
    call("agent.timeline.set_subscription.request", { agentIds: [agentId] }, 10000);
    console.log(`${stamp()} timeline subscribed for ${agentId}`);
    if (mode === "answer") {
      const response =
        decision === "allow"
          ? { behavior: "allow" }
          : { behavior: "deny", message: "denied by the scripted trusted client" };
      console.log(`${stamp()} sending agent_permission_response ${decision} request=${requestId}`);
      socket.send(
        JSON.stringify({
          type: "session",
          message: { type: "agent_permission_response", agentId, requestId, response },
        }),
      );
    }
    return;
  }
  if (type === "agent_stream") {
    const event = inner.payload?.event;
    const eventType = event?.type;
    if (eventType === "permission_requested") {
      console.log(
        `${stamp()} STREAM permission_requested id=${event.requestId ?? event.id} name=${event.name ?? event.toolName ?? "?"}`,
      );
    } else if (eventType === "permission_resolved") {
      seen.permissionResolved += 1;
      console.log(
        `${stamp()} STREAM permission_resolved id=${event.requestId} resolution=${JSON.stringify(event.resolution ?? "-")}`,
      );
      if (mode === "answer" && seen.permissionResolved >= 1) done(0);
    }
    return;
  }
  if (type === "agent_permission_resolved") {
    seen.agentPermissionResolved += 1;
    console.log(
      `${stamp()} FANOUT agent_permission_resolved agent=${inner.payload?.agentId} request=${inner.payload?.requestId} resolution=${JSON.stringify(inner.payload?.resolution ?? "-")}`,
    );
    if (mode === "answer" && seen.permissionResolved >= 1) done(0);
    return;
  }
  if (type === "rpc_error") {
    seen.rpcErrors += 1;
    console.log(
      `${stamp()} RPC_ERROR ${JSON.stringify(inner.error ?? inner.payload ?? inner).slice(0, 300)}`,
    );
    return;
  }
  if (type === "agent_update" || type === "agent_attention_required") {
    const state = inner.payload?.agent ?? inner.agent;
    const pending = state?.pendingPermissions;
    const attention =
      type === "agent_attention_required" ? ` reason=${inner.payload?.reason ?? "-"}` : "";
    console.log(
      `${stamp()} ${type} agent=${state?.id ?? inner.payload?.agentId ?? "-"} lifecycle=${state?.lifecycle ?? state?.status ?? "-"} pending=${Array.isArray(pending) ? pending.length : "?"}${attention}`,
    );
    return;
  }
});

socket.on("close", () => {
  if (!settled) done(5);
});
socket.on("error", (error) => {
  console.error(`${stamp()} socket error ${error.message}`);
  if (!settled) done(6);
});

if (mode === "watch") {
  setTimeout(() => done(0), seconds * 1000);
}
