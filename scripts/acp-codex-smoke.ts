// Live smoke: drive AcpRunnerBackend against the real codex-acp adapter and
// a real model. Costs one tiny prompt of quota; no chat surfaces involved.
//
// Auth (pick the shape matching this machine, see docs/user-guide/runner-backends.md):
//   OPENAI_API_KEY=<key> bun run scripts/acp-codex-smoke.ts        # gateway/api-key machines
//   ACP_SMOKE_AUTH_METHOD=chat-gpt bun run scripts/acp-codex-smoke.ts  # ChatGPT-login machines
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentSessionTarget,
  ResolvedAgentTarget,
} from "../src/agents/routing/resolved-target.ts";
import { SessionMapping } from "../src/agents/session/session-mapping.ts";
import { AgentSessionState } from "../src/agents/session/session-state.ts";
import { SessionStore } from "../src/agents/session/session-store.ts";
import { AcpRunnerBackend } from "../src/runners/acp/backend.ts";
import { getCliProvider } from "../src/runners/catalog/index.ts";

const authMethodId = process.env.ACP_SMOKE_AUTH_METHOD?.trim() || undefined;
if (!authMethodId && !process.env.OPENAI_API_KEY?.trim()) {
  console.error(
    "Set OPENAI_API_KEY (gateway/api-key machines) or ACP_SMOKE_AUTH_METHOD=chat-gpt (ChatGPT-login machines).",
  );
  process.exit(2);
}

const acpPreset = getCliProvider("codex").acp!;
const tempDir = mkdtempSync(join(tmpdir(), "clisbot-acp-smoke-"));
const sessionMapping = new SessionMapping(
  new AgentSessionState(new SessionStore(join(tempDir, "sessions.json"))),
);
const resolved = {
  agentId: "default",
  sessionKey: "acp-smoke",
  mainSessionKey: "acp-smoke",
  sessionName: "acp-smoke",
  workspacePath: tempDir,
  runner: {
    backend: "acp",
    command: acpPreset.launch.command,
    args: acpPreset.launch.args,
    env: process.env.OPENAI_API_KEY
      ? { OPENAI_API_KEY: process.env.OPENAI_API_KEY }
      : {},
    acp: { permissionPolicy: "auto-allow", authMethodId },
    sessionId: {
      create: { mode: "runner", args: [] },
      capture: {
        mode: "off",
        statusCommand: "/status",
        pattern: "",
        timeoutMs: 1000,
        pollIntervalMs: 100,
      },
      resume: { mode: "off", args: [] },
    },
  },
  stream: {
    captureLines: 160,
    updateIntervalMs: 500,
    idleTimeoutMs: 6000,
    noOutputTimeoutMs: 20000,
    maxRuntimeMs: 120_000,
    maxRuntimeLabel: "2 minutes",
    maxMessageChars: 3500,
  },
  session: { createIfMissing: true, staleAfterMinutes: 60, name: "{sessionKey}" },
} as unknown as ResolvedAgentTarget;
const target: AgentSessionTarget = { agentId: "default", sessionKey: "acp-smoke" };
const backend = new AcpRunnerBackend(() => resolved, sessionMapping);

try {
  console.log(`[smoke] adapter: ${acpPreset.adapterPin}; auth: ${authMethodId ?? "env OPENAI_API_KEY"}`);
  const ready = await backend.ensureRunnerReady(target);
  const entry = await sessionMapping.get(target.sessionKey);
  console.log("[smoke] session id:", entry?.sessionId);

  let completedSnapshot = "";
  const eventTypes = new Set<string>();
  await backend.monitorRun({
    resolved,
    prompt: "Reply with exactly: ACP_SMOKE_OK",
    startedAt: Date.now(),
    initialSnapshot: ready.initialSnapshot,
    detachedAlready: false,
    onRunning: async (update) => {
      console.log("[smoke] running:", JSON.stringify(update.snapshot.slice(0, 120)));
    },
    onDetached: async () => console.log("[smoke] detached"),
    onCompleted: async (update) => {
      completedSnapshot = update.snapshot;
    },
    onEvent: async (event) => {
      eventTypes.add(event.type);
    },
  });
  console.log("[smoke] completed snapshot:", JSON.stringify(completedSnapshot));
  console.log("[smoke] event types:", [...eventTypes].join(", "));

  console.log("[smoke] restart + session/load resume...");
  const restarted = await backend.restartRunnerPreservingSessionId(target);
  console.log("[smoke] resume notes:", restarted.startupNotes);
  console.log(
    "[smoke] resumed transcript contains prior prompt:",
    restarted.initialSnapshot.includes("ACP_SMOKE_OK"),
  );
  const entryAfter = await sessionMapping.get(target.sessionKey);
  console.log("[smoke] session id preserved:", entryAfter?.sessionId === entry?.sessionId);
  console.log(
    "[smoke] RESULT:",
    completedSnapshot.includes("ACP_SMOKE_OK") ? "PASS" : "CHECK-OUTPUT",
  );
} finally {
  backend.stopAllSessions();
  rmSync(tempDir, { recursive: true, force: true });
}
process.exit(0);
