import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentPermissionRequestPayloadSchema } from "@clisbot/protocol/messages";
import { SessionEventLog } from "../../session-storage/session-event-log.js";
import { FileAgentTimelineStore } from "../../session-storage/file-agent-timeline-store.js";
import { expect, test } from "vitest";
import type { CanUseTool, PermissionMode, Query } from "@anthropic-ai/claude-agent-sdk";
import { createTestLogger } from "../../../../test-utils/test-logger.js";
import type { AgentPermissionRequest } from "../../agent-sdk-types.js";
import { ClaudeAgentClient } from "./agent.js";

// The injected SDK adapter supplies requests through Claude's permission callback.
async function createPlanApproval(mode: PermissionMode) {
  let requestPermission: CanUseTool | undefined;
  let sdkMode: PermissionMode = mode;
  const query = Object.assign((async function* () {})(), {
    async setPermissionMode(next: PermissionMode) {
      sdkMode = next;
    },
    close() {},
  });
  const client = new ClaudeAgentClient({
    logger: createTestLogger(),
    resolveBinary: async () => "/test/claude",
    queryFactory: ({ options }) => {
      requestPermission = options.canUseTool;
      return query as Query;
    },
  });
  const session = await client.createSession({
    provider: "claude",
    cwd: process.cwd(),
    modeId: mode,
  });
  let request: AgentPermissionRequest | undefined;
  session.subscribe((event) => {
    if (event.type === "permission_requested") request = event.request;
  });
  await session.setMode("plan");
  if (!requestPermission) throw new Error("SDK permission callback was not installed");
  const resolution = requestPermission(
    "ExitPlanMode",
    { plan: "Implement the plan" },
    {
      signal: new AbortController().signal,
      toolUseID: "plan-approval",
    },
  );
  if (!request) throw new Error("No plan approval request was emitted");
  return { session, request, resolution, sdkMode: () => sdkMode };
}

test.each([
  ["auto", "Implement with Auto mode"],
  ["bypassPermissions", "Implement with Bypass"],
] as const)("plan approval offers an explicit return to %s", async (mode, label) => {
  const plan = await createPlanApproval(mode);
  try {
    expect(plan.request.actions).toContainEqual(
      expect.objectContaining({
        id: "implement_resume",
        label,
        behavior: "allow",
        intent: "implement_resume",
      }),
    );
  } finally {
    await plan.session.respondToPermission(plan.request.id, { behavior: "deny" });
    await plan.resolution;
    await plan.session.close();
  }
});

test.each([
  ["auto", "implement_resume", "auto"],
  ["bypassPermissions", "implement_resume", "bypassPermissions"],
  ["auto", "implement", "acceptEdits"],
  ["bypassPermissions", "implement", "acceptEdits"],
  ["default", "implement_resume", "acceptEdits"],
  ["acceptEdits", "implement_resume", "acceptEdits"],
] as const)("approving from %s with %s enters %s", async (mode, action, expected) => {
  const plan = await createPlanApproval(mode);
  try {
    await plan.session.respondToPermission(plan.request.id, {
      behavior: "allow",
      selectedActionId: action,
    });
    await expect(plan.resolution).resolves.toMatchObject({ behavior: "allow" });
    expect(plan.sdkMode()).toBe(expected);
    expect(await plan.session.getCurrentMode()).toBe(expected);
    if (mode === "default" || mode === "acceptEdits") {
      expect(plan.request.actions?.some((entry) => entry.id === "implement_resume")).toBe(false);
    }
  } finally {
    await plan.session.close();
  }
});

test.each([true, false])(
  "preserves SDK approval context through events, wire and storage (provided: %s)",
  async (provided) => {
    let requestPermission: CanUseTool | undefined;
    const query = Object.assign((async function* () {})(), {
      async setPermissionMode() {},
      close() {},
    });
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      resolveBinary: async () => "/test/claude",
      queryFactory: ({ options }) => {
        requestPermission = options.canUseTool;
        return query as Query;
      },
    });
    const session = await client.createSession({
      provider: "claude",
      cwd: process.cwd(),
      modeId: "bypassPermissions",
    });
    const directory = await mkdtemp(path.join(os.tmpdir(), "approval-context-"));
    let emitted: AgentPermissionRequest | undefined;
    session.subscribe((event) => {
      if (event.type === "permission_requested") emitted = event.request;
    });
    await session.setMode("bypassPermissions");
    if (!requestPermission) throw new Error("SDK permission callback was not installed");
    const context = provided
      ? {
          decisionReason: "Synthetic policy requires approval for this path.",
          blockedPath: "/synthetic/protected/config.json",
        }
      : {};
    const resolution = requestPermission(
      "Bash",
      { command: "printf synthetic" },
      {
        signal: new AbortController().signal,
        toolUseID: "synthetic-tool",
        ...context,
      },
    );
    try {
      if (!emitted) throw new Error("No permission request was emitted");
      expect(emitted.metadata).toEqual({ toolUseId: "synthetic-tool", ...context });
      expect(session.getPendingPermissions()).toEqual([emitted]);
      expect(await session.getCurrentMode()).toBe("bypassPermissions");
      const transported = AgentPermissionRequestPayloadSchema.parse(
        JSON.parse(JSON.stringify(emitted)),
      );
      expect(transported).toEqual(emitted);
      const store = new FileAgentTimelineStore(async () => directory);
      await store.appendPermissionResponse("agent", {
        id: "response",
        timestamp: "2026-10-27T00:00:00Z",
        request: transported,
        response: { behavior: "deny" },
        status: "pending",
      });
      await store.flush();
      SessionEventLog.forgetAll();
      const reopened = new FileAgentTimelineStore(async () => directory);
      expect((await reopened.readPermissionResponse("agent", "response"))?.request).toEqual(
        emitted,
      );
    } finally {
      const pending = session.getPendingPermissions();
      for (const request of pending)
        await session.respondToPermission(request.id, { behavior: "deny" });
      await resolution;
      await session.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
