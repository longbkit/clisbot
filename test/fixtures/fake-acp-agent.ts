// Scripted fake ACP agent — the ACP simulator — speaking raw ndjson JSON-RPC
// 2.0 on stdio. It exists so the ACP backend is validated against the wire
// protocol itself, not against the SDK's own agent implementation, and so
// hard behaviors (approvals, cancels, crashes, protocol drift) are testable
// without a real agent or model.
//
// Behavior knobs (env vars):
// - FAKE_ACP_SUPPORTS_LOAD=0        advertise no session/load capability
// - FAKE_ACP_REQUIRE_AUTH=1         reject session/new until authenticate
// - FAKE_ACP_REQUIRE_PERMISSION=1   request permission before finishing
// - FAKE_ACP_PROMPT_DELAY_MS=<n>    hold the turn open (cancel testing)
// - FAKE_ACP_GO_SILENT=1            go silent mid-turn for prompts containing
//                                   "stall" and ignore cancels (stalled-turn
//                                   testing); other prompts behave normally
// - FAKE_ACP_EXIT_MID_PROMPT=1      die mid-turn (adapter-loss testing)
// - FAKE_ACP_EXIT_AT_INITIALIZE=1   die before answering initialize
// - FAKE_ACP_EMIT_PLAN=1            emit plan updates during the turn
// - FAKE_ACP_EMIT_COMMANDS=1        emit available_commands_update after new
// - FAKE_ACP_EMIT_UNKNOWN_UPDATE=1  emit an unknown update type (drift test)
// - FAKE_ACP_CONTEXT_RECALL=1       reply with the previous prompt when a
//                                   prompt contains "what was I asking"
//                                   (simulates post-cancel context retention)

type JsonRpcMessage = {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
};

const supportsLoad = process.env.FAKE_ACP_SUPPORTS_LOAD !== "0";
const requireAuth = process.env.FAKE_ACP_REQUIRE_AUTH === "1";
const requirePermission = process.env.FAKE_ACP_REQUIRE_PERMISSION === "1";
const promptDelayMs = Number(process.env.FAKE_ACP_PROMPT_DELAY_MS ?? "0");
const goSilent = process.env.FAKE_ACP_GO_SILENT === "1";
const exitMidPrompt = process.env.FAKE_ACP_EXIT_MID_PROMPT === "1";
const exitAtInitialize = process.env.FAKE_ACP_EXIT_AT_INITIALIZE === "1";
const emitPlan = process.env.FAKE_ACP_EMIT_PLAN === "1";
const emitCommands = process.env.FAKE_ACP_EMIT_COMMANDS === "1";
const emitUnknownUpdate = process.env.FAKE_ACP_EMIT_UNKNOWN_UPDATE === "1";
const contextRecall = process.env.FAKE_ACP_CONTEXT_RECALL === "1";

let nextSessionNumber = 1;
let nextRequestId = 1;
let authenticatedMethodId = "";
const lastPromptBySession = new Map<string, string>();
const cancelledSessions = new Set<string>();
const pendingResponses = new Map<number | string, (message: JsonRpcMessage) => void>();

function send(message: JsonRpcMessage) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function respond(id: number | string, result: unknown) {
  send({ jsonrpc: "2.0", id, result });
}

function notify(method: string, params: Record<string, unknown>) {
  send({ jsonrpc: "2.0", method, params });
}

function request(method: string, params: Record<string, unknown>) {
  const id = nextRequestId++;
  return new Promise<JsonRpcMessage>((resolve) => {
    pendingResponses.set(id, resolve);
    send({ jsonrpc: "2.0", id, method, params });
  });
}

function sessionUpdate(sessionId: string, update: Record<string, unknown>) {
  notify("session/update", { sessionId, update });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handlePrompt(id: number | string, params: Record<string, unknown>) {
  const sessionId = String(params.sessionId);
  cancelledSessions.delete(sessionId);
  const promptBlocks = params.prompt as Array<{ type: string; text?: string }>;
  const promptText = promptBlocks?.find((block) => block.type === "text")?.text ?? "";

  if (contextRecall && /what was i asking/i.test(promptText)) {
    const previous = lastPromptBySession.get(sessionId) ?? "(nothing)";
    sessionUpdate(sessionId, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: `You were asking: ${previous}` },
    });
    respond(id, { stopReason: "end_turn" });
    return;
  }
  lastPromptBySession.set(sessionId, promptText);

  if (emitUnknownUpdate) {
    // Protocol drift: newer agents may emit update types this client does
    // not know. A conservative client must ignore them and keep going.
    sessionUpdate(sessionId, {
      sessionUpdate: "totally_unknown_update_type",
      payload: { anything: true },
    });
  }
  if (emitPlan) {
    sessionUpdate(sessionId, {
      sessionUpdate: "plan",
      entries: [
        { content: "Analyze the request", priority: "high", status: "in_progress" },
        { content: "Apply the change", priority: "medium", status: "pending" },
      ],
    });
  }

  sessionUpdate(sessionId, {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "Working on: " },
  });
  await sleep(10);

  if (goSilent && /stall/i.test(promptText)) {
    // Simulate a wedged agent (provider failure it never reported): the turn
    // never settles and cancel is ignored, like the real-world stall.
    return;
  }
  sessionUpdate(sessionId, {
    sessionUpdate: "tool_call",
    toolCallId: "call-1",
    title: "Read project files",
    status: "in_progress",
  });
  await sleep(10);

  if (exitMidPrompt) {
    process.exit(1);
  }

  if (requirePermission) {
    const permission = await request("session/request_permission", {
      sessionId,
      toolCall: { toolCallId: "call-1", title: "Read project files" },
      options: [
        { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
        { optionId: "reject-once", name: "Reject", kind: "reject_once" },
      ],
    });
    const outcome = (permission.result as { outcome?: { outcome?: string; optionId?: string } })
      ?.outcome;
    if (outcome?.outcome !== "selected" || outcome.optionId !== "allow-once") {
      sessionUpdate(sessionId, {
        sessionUpdate: "tool_call_update",
        toolCallId: "call-1",
        status: "failed",
      });
      respond(id, { stopReason: "refusal" });
      return;
    }
  }

  sessionUpdate(sessionId, {
    sessionUpdate: "tool_call_update",
    toolCallId: "call-1",
    status: "completed",
  });

  if (promptDelayMs > 0) {
    const deadline = Date.now() + promptDelayMs;
    while (Date.now() < deadline) {
      if (cancelledSessions.has(sessionId)) {
        respond(id, { stopReason: "cancelled" });
        return;
      }
      await sleep(10);
    }
  }

  if (cancelledSessions.has(sessionId)) {
    respond(id, { stopReason: "cancelled" });
    return;
  }

  sessionUpdate(sessionId, {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: `done -> ${promptText}` },
  });
  respond(id, { stopReason: "end_turn" });
}

async function handleMessage(message: JsonRpcMessage) {
  if (message.id !== undefined && message.method === undefined) {
    pendingResponses.get(message.id)?.(message);
    pendingResponses.delete(message.id);
    return;
  }

  const params = message.params ?? {};
  switch (message.method) {
    case "initialize":
      if (exitAtInitialize) {
        process.stderr.write("fake adapter refused to start: simulated init crash\n");
        process.exit(7);
      }
      respond(message.id!, {
        protocolVersion: params.protocolVersion ?? 1,
        agentCapabilities: {
          loadSession: supportsLoad,
        },
        authMethods: [
          { id: "fake-auth", name: "Fake auth", description: "Test auth method" },
        ],
      });
      return;
    case "authenticate":
      authenticatedMethodId = String(params.methodId ?? "");
      respond(message.id!, {});
      return;
    case "session/new": {
      if (requireAuth && authenticatedMethodId !== "fake-auth") {
        send({
          jsonrpc: "2.0",
          id: message.id!,
          error: { code: -32000, message: "Authentication required" },
        });
        return;
      }
      const sessionId = `fake-session-${nextSessionNumber++}`;
      respond(message.id!, { sessionId });
      if (emitCommands) {
        sessionUpdate(sessionId, {
          sessionUpdate: "available_commands_update",
          availableCommands: [
            { name: "review", description: "Review the current changes" },
            { name: "compact", description: "Compact the conversation" },
          ],
        });
      }
      return;
    }
    case "session/load": {
      const sessionId = String(params.sessionId);
      sessionUpdate(sessionId, {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: `restored ${sessionId}` },
      });
      respond(message.id!, {});
      return;
    }
    case "session/prompt":
      await handlePrompt(message.id!, params);
      return;
    case "session/cancel":
      cancelledSessions.add(String(params.sessionId));
      return;
    default:
      if (message.id !== undefined) {
        send({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: `Method not found: ${message.method}` },
        });
      }
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  let newlineIndex = buffer.indexOf("\n");
  while (newlineIndex >= 0) {
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (line) {
      void handleMessage(JSON.parse(line) as JsonRpcMessage);
    }
    newlineIndex = buffer.indexOf("\n");
  }
});
process.stdin.on("end", () => process.exit(0));
