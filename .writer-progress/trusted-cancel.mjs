#!/usr/bin/env node
// Trusted-client turn cancel for B3 mid-turn stop. Connects to the channel-E2E
// dev daemon (127.0.0.1:6867) as a trusted session (password from
// ~/.clisbot-dev/.daemon-password — referenced by name, never printed) and
// sends a `cancel_agent_request` for the target agent, then prints the
// `cancel_agent_response` agent lifecycle + any turn_canceled stream events.
//
// Usage: node .writer-progress/trusted-cancel.mjs --agent <agentId>
// Also supports `--watch <seconds>`: stay attached after the cancel and report
// turn_completed / turn_canceled / lifecycle flips so the operator can confirm
// the agent actually went idle and emitted no further output.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import WebSocket from "ws";

const URL = process.env.TRUSTED_CLIENT_URL ?? "ws://127.0.0.1:6867/ws";
const DEV_HOME = process.env.CLISBOT_HOME ?? `${homedir()}/.clisbot-dev`;
const t0 = Date.now();
const stamp = (extra = "") => `[t+${Date.now() - t0}ms]${extra ? " " + extra : ""}`;

function password() {
  try {
    const raw = readFileSync(`${DEV_HOME}/.daemon-password`, "utf8").trim();
    const eq = raw.indexOf("=");
    return eq > 0 ? raw.slice(eq + 1).trim() : raw;
  } catch {
    return process.env.PASEO_PASSWORD?.trim() ?? "";
  }
}

const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const agentId = arg("--agent");
const watchSeconds = Number(arg("--watch") ?? "0");
if (!agentId) {
  console.error(`${stamp()} missing --agent <agentId>`);
  process.exit(2);
}
const passwordValue = password();
const socket = new WebSocket(
  URL,
  passwordValue !== "" ? [`paseo.bearer.${passwordValue}`] : undefined,
);
let cancelledSent = false;
let settled = false;

function done(code = 0) {
  if (settled) return;
  settled = true;
  console.log(stamp(`SUMMARY cancel_sent=${cancelledSent}`));
  socket.close();
  setTimeout(() => process.exit(code), 200);
}

function call(type, fields = {}, timeoutMs = 20000) {
  const requestId = randomUUID();
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
        `${stamp()} rpc_error ${type}: ${JSON.stringify(inner.error ?? inner.payload ?? inner).slice(0, 400)}`,
      );
      done(4);
      return;
    }
    const agent = inner.payload?.agent ?? inner.agent;
    console.log(
      `${stamp()} ${type} RESPONSE lifecycle=${agent?.lifecycle ?? agent?.status ?? "-"} pending=${Array.isArray(agent?.pendingPermissions) ? agent.pendingPermissions.length : "?"}`,
    );
    return inner;
  };
  socket.on("message", onMessage);
}

socket.on("open", () => {
  console.log(stamp("open -> hello"));
  socket.send(
    JSON.stringify({
      type: "hello",
      clientId: `trusted-cancel-${process.pid}`,
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
    console.log(stamp("server_info (trusted session established)"));
    call("agent.timeline.set_subscription.request", { agentIds: [agentId] }, 20000);
    console.log(stamp(`timeline subscribed for ${agentId}; sending cancel_agent_request`));
    socket.send(
      JSON.stringify({
        type: "session",
        message: { type: "cancel_agent_request", agentId, requestId: randomUUID() },
      }),
    );
    cancelledSent = true;
    if (watchSeconds > 0) setTimeout(() => done(0), watchSeconds * 1000);
    return;
  }
  if (type === "agent_stream") {
    const event = inner.payload?.event;
    const eventType = event?.type;
    if (
      eventType === "turn_canceled" ||
      eventType === "turn_completed" ||
      eventType === "turn_failed" ||
      eventType === "turn_started"
    ) {
      console.log(stamp(`STREAM ${eventType} ${event.reason ? `reason=${event.reason}` : ""}`));
      if (eventType === "turn_canceled" && !watchSeconds) done(0);
    } else if (eventType === "timeline:assistant_message") {
      const text =
        typeof event.item?.detail?.text === "string"
          ? event.item.detail.text.slice(0, 120).replace(/\n/g, " ")
          : JSON.stringify(event.item?.detail ?? {}).slice(0, 120);
      console.log(stamp(`STREAM assistant_message "${text}"`));
    }
    return;
  }
  if (type === "agent_update") {
    const state = inner.payload?.agent ?? inner.agent;
    console.log(stamp(`agent_update lifecycle=${state?.lifecycle ?? state?.status ?? "-"}`));
    return;
  }
  if (type === "rpc_error") {
    console.error(
      stamp(`RPC_ERROR ${JSON.stringify(inner.error ?? inner.payload ?? inner).slice(0, 300)}`),
    );
    return;
  }
});

socket.on("close", () => {
  if (!settled) done(5);
});
socket.on("error", (error) => {
  console.error(stamp(`socket error ${error.message}`));
  if (!settled) done(6);
});
