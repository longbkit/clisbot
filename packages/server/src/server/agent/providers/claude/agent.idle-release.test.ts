import type { HookInput, Options, Query } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import type { AgentSession } from "../../agent-sdk-types.js";
import { ClaudeAgentClient } from "./agent.js";
import type { ClaudeQueryInput } from "./query.js";

function createQueryMock(events: unknown[]): Query {
  let index = 0;
  return {
    next: vi.fn(async () =>
      index < events.length
        ? { done: false, value: events[index++] }
        : { done: true, value: undefined },
    ),
    return: vi.fn(async () => ({ done: true, value: undefined })),
    interrupt: vi.fn(async () => undefined),
    close: vi.fn(() => undefined),
    setPermissionMode: vi.fn(async () => undefined),
    setModel: vi.fn(async () => undefined),
    supportedModels: vi.fn(async () => [{ value: "opus", displayName: "Opus" }]),
    supportedCommands: vi.fn(async () => []),
    rewindFiles: vi.fn(async () => ({ canRewind: true })),
    [Symbol.asyncIterator]() {
      return this;
    },
  } as Query;
}

const INIT = {
  type: "system",
  subtype: "init",
  session_id: "claude-idle-release-session",
  permissionMode: "default",
  model: "opus",
};
const RESULT = {
  type: "result",
  subtype: "success",
  usage: { input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 },
  total_cost_usd: 0,
};

async function createSession(events: unknown[]): Promise<{
  session: AgentSession;
  stop: (backgroundTasks: unknown[], sessionCrons: unknown[]) => Promise<void>;
}> {
  let capturedOptions: Options | undefined;
  const client = new ClaudeAgentClient({
    logger: createTestLogger(),
    queryFactory: vi.fn(({ options }: ClaudeQueryInput) => {
      capturedOptions = options;
      return createQueryMock(events);
    }),
    resolveBinary: async () => "/test/claude/bin",
  });
  const session = await client.createSession({ provider: "claude", cwd: process.cwd() });
  const stop = async (backgroundTasks: unknown[], sessionCrons: unknown[]) => {
    const hook = capturedOptions?.hooks?.Stop?.[0]?.hooks[0];
    expect(hook).toBeDefined();
    const input = {
      hook_event_name: "Stop",
      background_tasks: backgroundTasks,
      session_crons: sessionCrons,
    } as unknown as HookInput;
    await expect(
      hook!(input, undefined, { signal: new AbortController().signal }),
    ).resolves.toEqual({});
  };
  return { session, stop };
}

describe("Claude idle release", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("certifies a session that has not run anything", async () => {
    const { session } = await createSession([]);
    try {
      expect(session.isIdleForRelease?.()).toBe(true);
    } finally {
      await session.close();
    }
  });

  test("certifies once the turn's Stop hook reports nothing left behind", async () => {
    const { session, stop } = await createSession([INIT, RESULT]);
    try {
      await session.run("hello");
      expect(session.isIdleForRelease?.()).toBe(false);

      await stop([], []);
      expect(session.isIdleForRelease?.()).toBe(true);
    } finally {
      await session.close();
    }
  });

  test("holds a session whose background shell outlives the turn", async () => {
    const { session, stop } = await createSession([
      INIT,
      {
        type: "system",
        subtype: "background_tasks_changed",
        tasks: [{ task_id: "b1", task_type: "local_bash", description: "sleep" }],
      },
      RESULT,
    ]);
    try {
      await session.run("start a background shell");
      await stop([{ id: "b1", type: "shell", status: "running" }], []);
      expect(session.isIdleForRelease?.()).toBe(false);
    } finally {
      await session.close();
    }
  });

  test("holds a session with a scheduled cron", async () => {
    const { session, stop } = await createSession([INIT, RESULT]);
    try {
      await session.run("check back every 30 minutes");
      await stop([], [{ id: "c1", schedule: "*/30 * * * *", recurring: true }]);
      expect(session.isIdleForRelease?.()).toBe(false);
    } finally {
      await session.close();
    }
  });

  test("never certifies a closed session", async () => {
    const { session } = await createSession([]);
    await session.close();
    expect(session.isIdleForRelease?.()).toBe(false);
  });
});
