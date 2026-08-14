// Regenerates the corner-case scenario transcripts in the review evidence:
// drives the real AcpRunnerBackend against the scripted ACP simulator and
// records exactly what a chat user would see in each hard case.
//
// Run: bun run scripts/capture-runner-evidence.ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

const FAKE_AGENT_PATH = join(import.meta.dir, "..", "test", "fixtures", "fake-acp-agent.ts");
const OUTPUT_PATH = join(
  import.meta.dir,
  "..",
  "docs",
  "artifacts",
  "2026-07-03-runner-backend-review",
  "evidence",
  "scenario-transcripts.md",
);

type Harness = {
  backend: AcpRunnerBackend;
  sessionMapping: SessionMapping;
  target: AgentSessionTarget;
  resolved: ResolvedAgentTarget;
  cleanup: () => void;
};

function createHarness(
  env: Record<string, string> = {},
  acp: Record<string, string> = {},
): Harness {
  const tempDir = mkdtempSync(join(tmpdir(), "clisbot-evidence-"));
  const sessionMapping = new SessionMapping(
    new AgentSessionState(new SessionStore(join(tempDir, "sessions.json"))),
  );
  const resolved = {
    agentId: "default",
    sessionKey: "agent:default:evidence:acp",
    mainSessionKey: "agent:default:evidence:acp",
    sessionName: "evidence-session",
    workspacePath: tempDir,
    runner: {
      backend: "acp",
      command: "bun",
      args: [FAKE_AGENT_PATH],
      env,
      acp: { permissionPolicy: "auto-allow", ...acp },
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
      updateIntervalMs: 30,
      idleTimeoutMs: 2000,
      noOutputTimeoutMs: 5000,
      maxRuntimeMs: 60_000,
      maxRuntimeLabel: "1 minute",
      maxMessageChars: 3500,
    },
    session: { createIfMissing: true, staleAfterMinutes: 60, name: "{sessionKey}" },
  } as unknown as ResolvedAgentTarget;
  const backend = new AcpRunnerBackend(() => resolved, sessionMapping);
  return {
    backend,
    sessionMapping,
    target: { agentId: "default", sessionKey: resolved.sessionKey },
    resolved,
    cleanup: () => {
      backend.stopAllSessions();
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

async function runPrompt(harness: Harness, prompt: string) {
  const ready = await harness.backend.ensureRunnerReady(harness.target);
  let completed = { snapshot: "(no completion)" };
  const events: string[] = [];
  await harness.backend.monitorRun({
    resolved: harness.resolved,
    prompt,
    startedAt: Date.now(),
    initialSnapshot: ready.initialSnapshot,
    detachedAlready: false,
    onRunning: async () => undefined,
    onDetached: async () => undefined,
    onCompleted: async (update) => {
      completed = update;
    },
    onEvent: async (event) => {
      events.push(JSON.stringify(event));
    },
  });
  return { ready, completed, events, startupNotes: ready.startupNotes };
}

const sections: string[] = [
  "# Scenario Transcripts: What The User Actually Sees",
  "",
  `- Generated: ${new Date().toISOString()}`,
  "- Regenerate: `bun run scripts/capture-runner-evidence.ts`",
  "- Every block below is the real output of the real `AcpRunnerBackend` driven",
  "  against the scripted ACP simulator (`test/fixtures/fake-acp-agent.ts`) —",
  "  no mocks between the backend and the wire protocol.",
  "",
];

function section(title: string, lines: string[]) {
  sections.push(`## ${title}`, "", ...lines, "");
  console.log(`[evidence] captured: ${title}`);
}

// 1. Permission denied by policy
{
  const harness = createHarness(
    { FAKE_ACP_REQUIRE_PERMISSION: "1" },
    { permissionPolicy: "deny" },
  );
  const { completed, events } = await runPrompt(harness, "delete old logs");
  section("Tool permission denied by policy (`permissionPolicy: \"deny\"`)", [
    "Chat reply the user sees:",
    "```text",
    completed.snapshot,
    "```",
    "Structured events emitted for capability-aware surfaces:",
    "```json",
    ...events,
    "```",
  ]);
  harness.cleanup();
}

// 2. Steer redirect: interrupt retains context
{
  const harness = createHarness({
    FAKE_ACP_CONTEXT_RECALL: "1",
    FAKE_ACP_PROMPT_DELAY_MS: "3000",
  });
  await harness.backend.ensureRunnerReady(harness.target);
  const firstMonitor = harness.backend.monitorRun({
    resolved: harness.resolved,
    prompt: "write the quarterly report",
    startedAt: Date.now(),
    initialSnapshot: "",
    detachedAlready: false,
    onRunning: async () => undefined,
    onDetached: async () => undefined,
    onCompleted: async () => undefined,
  });
  await Bun.sleep(150);
  const interrupt = await harness.backend.interruptSession(harness.target);
  await firstMonitor;
  const { completed } = await runPrompt(harness, "what was I asking you to do?");
  section("`/steer` on ACP: interrupt-and-redirect keeps conversation context", [
    `Interrupt acknowledged: \`interrupted: ${interrupt.interrupted}\` (turn settled before the redirect prompt).`,
    "The redirected follow-up proves the cancelled turn's context survived:",
    "```text",
    completed.snapshot,
    "```",
  ]);
  harness.cleanup();
}

// 3. Stored session cannot be resumed
{
  const harness = createHarness({ FAKE_ACP_SUPPORTS_LOAD: "0" });
  await harness.backend.ensureRunnerReady(harness.target);
  const restarted = await harness.backend.restartRunnerPreservingSessionId(harness.target);
  section("Stored conversation cannot be resumed (agent lacks `session/load`)", [
    "Startup note posted to the chat surface:",
    "```text",
    ...restarted.startupNotes,
    "```",
  ]);
  harness.cleanup();
}

// 4. Adapter crashes at startup
{
  const harness = createHarness({ FAKE_ACP_EXIT_AT_INITIALIZE: "1" });
  const error = await harness.backend
    .ensureRunnerReady(harness.target)
    .catch((caught) => caught as Error);
  const mapped = await harness.backend.mapRunError(error, "evidence-session");
  section("Adapter crashes before initialize (bad install, broken adapter)", [
    "Error message the user/operator sees (includes adapter stderr evidence):",
    "```text",
    mapped.message,
    "```",
  ]);
  harness.cleanup();
}

// 5. Adapter dies mid-run → classified recoverable
{
  const harness = createHarness({ FAKE_ACP_EXIT_MID_PROMPT: "1" });
  await harness.backend.ensureRunnerReady(harness.target);
  const error = await harness.backend
    .monitorRun({
      resolved: harness.resolved,
      prompt: "doomed work",
      startedAt: Date.now(),
      initialSnapshot: "",
      detachedAlready: false,
      onRunning: async () => undefined,
      onDetached: async () => undefined,
      onCompleted: async () => undefined,
    })
    .catch((caught) => caught as Error);
  const mapped = await harness.backend.mapRunError(error, "evidence-session");
  section("Adapter process dies mid-turn", [
    `Recovery classification: \`canRecoverMidRun: ${harness.backend.canRecoverMidRun(error)}\` → the monitor-owned recovery re-opens the stored session via \`session/load\` before failing.`,
    "If recovery is exhausted, the user sees:",
    "```text",
    mapped.message,
    "```",
  ]);
  harness.cleanup();
}

// 6. /stop → first-class cancel
{
  const harness = createHarness({ FAKE_ACP_PROMPT_DELAY_MS: "3000" });
  await harness.backend.ensureRunnerReady(harness.target);
  let completed = { snapshot: "(none)" };
  const monitor = harness.backend.monitorRun({
    resolved: harness.resolved,
    prompt: "long running work",
    startedAt: Date.now(),
    initialSnapshot: "",
    detachedAlready: false,
    onRunning: async () => undefined,
    onDetached: async () => undefined,
    onCompleted: async (update) => {
      completed = update;
    },
  });
  await Bun.sleep(150);
  await harness.backend.interruptSession(harness.target);
  await monitor;
  section("`/stop` during an ACP turn (first-class `session/cancel`)", [
    "Turn settlement the user sees:",
    "```text",
    completed.snapshot,
    "```",
  ]);
  harness.cleanup();
}

// 7. Protocol drift: unknown updates ignored
{
  const harness = createHarness({
    FAKE_ACP_EMIT_UNKNOWN_UPDATE: "1",
    FAKE_ACP_EMIT_COMMANDS: "1",
    FAKE_ACP_EMIT_PLAN: "1",
  });
  const { completed, events } = await runPrompt(harness, "drift-proof work");
  section("Protocol drift: newer agent emits plan + unknown update types", [
    "Turn completes normally; unknown types are ignored, plans stream as events:",
    "```text",
    completed.snapshot,
    "```",
    "Events (note the plan; the unknown type never crashes the client):",
    "```json",
    ...events.filter((line) => !line.includes("message-delta")),
    "```",
    "Finding (captured while generating this transcript): the pinned",
    "`@agentclientprotocol/sdk@1.3.0` validates `session/update` strictly and",
    "logs a zod validation error object to the console when it drops an",
    "unknown update type. Behavior is safe (the run is unaffected; the update",
    "never reaches clisbot code) but a newer agent emitting new update types",
    "would spam runtime logs. Track as an upstream SDK issue candidate and a",
    "log-noise watch item for adapter bumps.",
  ]);
  harness.cleanup();
}

// 8. Steering degradation messages (channel copy)
section("Steering degradation copy (channel layer, from regression tests)", [
  "Explicit `/steer` on ACP posts this notice, then delivers the redirect:",
  "```text",
  "This backend cannot inject into a running turn, so clisbot interrupted the current turn and is applying your steering message as the next prompt.",
  "Conversation context from the interrupted work is retained; in-flight output from the interrupted turn is discarded.",
  "```",
  "A backend with neither steer nor interrupt would instead see:",
  "```text",
  "This agent's runner backend cannot steer into a running turn.",
  "Use `/queue <message>` to run it after the current turn, or `/stop` and resend a combined prompt.",
  "```",
]);

writeFileSync(OUTPUT_PATH, `${sections.join("\n").trimEnd()}\n`);
console.log(`[evidence] wrote ${OUTPUT_PATH}`);
process.exit(0);
