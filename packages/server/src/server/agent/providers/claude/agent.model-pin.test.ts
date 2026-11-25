import { afterEach, describe, expect, test } from "vitest";
import type { Query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { createTestLogger } from "../../../../test-utils/test-logger.js";
import type { AgentSession, AgentStreamEvent } from "../../agent-sdk-types.js";
import { ClaudeAgentClient } from "./agent.js";
import type { ClaudeQueryInput } from "./query.js";

// Claude Code's own record of the field failure: the main thread was refused on Opus 5.5,
// retried on Opus 4.8, and the session stayed on 4.8 with no user switch.
const fallback = (scope?: "session" | "local") =>
  ({
    type: "system",
    subtype: "model_refusal_fallback",
    trigger: "refusal",
    direction: "retry",
    ...(scope ? { scope } : {}),
    original_model: "claude-opus-5-5",
    fallback_model: "claude-opus-4-8",
    request_id: "req_1",
    api_refusal_category: "cyber",
    content: "Switched to Opus 4.8",
    uuid: "fallback-uuid",
    session_id: "pinned-session",
  }) as SDKMessage;

const init = (model: string) =>
  ({
    type: "system",
    subtype: "init",
    session_id: "pinned-session",
    model,
    permissionMode: "default",
  }) as SDKMessage;

const reply = (text: string) => ({ type: "assistant", message: { content: text } }) as SDKMessage;
const done = {
  type: "result",
  subtype: "success",
  usage: { input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 },
  total_cost_usd: 0,
} as SDKMessage;

/** A provider double that answers each prompt with a scripted turn and records controls. */
class ScriptedQuery {
  readonly log: string[] = [];
  /** Controls Claude Code refuses, for failure-order tests. */
  readonly refuse = { model: false, flags: false };
  readonly prompts: SDKUserMessage[] = [];
  private readonly output: AsyncGenerator<SDKMessage>;

  constructor(
    readonly input: ClaudeQueryInput,
    turns: SDKMessage[][],
  ) {
    this.output = this.events(turns);
  }

  private async *events(turns: SDKMessage[][]): AsyncGenerator<SDKMessage> {
    if (typeof this.input.prompt === "string") throw new Error("Expected streaming input");
    let index = 0;
    for await (const prompt of this.input.prompt) {
      this.prompts.push(prompt);
      this.log.push(`prompt:${index}`);
      for (const message of turns[index] ?? [reply("ok"), done]) yield message;
      index += 1;
    }
  }

  next() {
    return this.output.next();
  }
  return() {
    return this.output.return(undefined);
  }
  close() {}
  async interrupt() {}
  async setPermissionMode() {}
  async setModel(model?: string) {
    if (this.refuse.model) throw new Error("model refused");
    this.log.push(`setModel:${model}`);
  }
  async applyFlagSettings(settings: Record<string, unknown>) {
    if (this.refuse.flags) throw new Error("flags refused");
    this.log.push(`flags:${JSON.stringify(settings)}`);
  }
  async supportedCommands() {
    return [];
  }
  async getContextUsage() {
    return undefined;
  }
  [Symbol.asyncIterator]() {
    return this;
  }
}

/** Prompts and model changes in the order the provider saw them. */
const sends = (query: ScriptedQuery) =>
  query.log.filter((entry) => entry.startsWith("prompt:") || entry.startsWith("setModel:"));

/** Model and pin controls after launch, in order. */
const controls = (query: ScriptedQuery) =>
  query.log.filter(
    (entry) => entry.startsWith("setModel:") || entry.includes("switchModelsOnFlag"),
  );

const sessions: AgentSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
});

async function start(turns: SDKMessage[][], config: { model?: string } = {}) {
  const queries: ScriptedQuery[] = [];
  const client = new ClaudeAgentClient({
    logger: createTestLogger(),
    resolveBinary: async () => "/test/claude",
    queryFactory: (input) => {
      const query = new ScriptedQuery(input, turns);
      queries.push(query);
      return query as unknown as Query;
    },
  });
  const session = await client.createSession({
    provider: "claude",
    cwd: process.cwd(),
    modeId: "default",
    ...config,
  } as Parameters<typeof client.createSession>[0]);
  sessions.push(session);
  const events: AgentStreamEvent[] = [];
  session.subscribe((event) => events.push(event));
  const turn = async (text: string) => {
    const finished = new Promise<string>((resolve) => {
      const stop = session.subscribe((event) => {
        if (["turn_completed", "turn_failed", "turn_canceled"].includes(event.type)) {
          stop();
          resolve(event.type);
        }
      });
    });
    await session.startTurn(text);
    return finished;
  };
  return { session, queries, events, turn };
}

const notices = (events: AgentStreamEvent[]) =>
  events.flatMap((event) =>
    event.type === "timeline" && event.item.type === "notification" ? [event.item] : [],
  );

describe("a chosen Claude model", () => {
  test("launches with Claude Code's automatic model switch on refusal turned off", async () => {
    const pinned = await start([], { model: "claude-opus-5-5" });
    await pinned.turn("hello");
    expect(pinned.queries[0]!.input.options.model).toBe("claude-opus-5-5");
    expect(pinned.queries[0]!.input.options.settings).toMatchObject({ switchModelsOnFlag: false });

    const unchosen = await start([]);
    await unchosen.turn("hello");
    expect(unchosen.queries[0]!.input.options.settings ?? {}).not.toHaveProperty(
      "switchModelsOnFlag",
    );
  });

  test("a model chosen during the session also turns the switch off", async () => {
    const { session, queries, turn } = await start([]);
    await turn("hello");
    await session.setModel("claude-opus-5-5");
    expect(queries[0]!.log).toContain("setModel:claude-opus-5-5");
    expect(queries[0]!.log).toContain('flags:{"switchModelsOnFlag":false}');
  });

  test("returning to the provider default clears the pin instead of forcing a value", async () => {
    const { session, queries, turn } = await start([], { model: "claude-opus-5-5" });
    await turn("hello");
    await session.setModel("claude-opus-5");
    await session.setModel(null);
    expect(controls(queries[0]!)).toEqual([
      "setModel:claude-opus-5",
      'flags:{"switchModelsOnFlag":null}',
      "setModel:undefined",
    ]);
  });

  test("a refused pin changes nothing, and a refused model puts the pin back", async () => {
    const { session, queries, turn } = await start([]);
    await turn("hello");
    const query = queries[0]!;
    query.refuse.flags = true;
    await expect(session.setModel("claude-opus-5-5")).rejects.toThrow("flags refused");
    expect(controls(query)).toEqual([]);
    expect((await session.getRuntimeInfo()).model).not.toBe("claude-opus-5-5");

    query.refuse.flags = false;
    query.refuse.model = true;
    await expect(session.setModel("claude-opus-5-5")).rejects.toThrow("model refused");
    expect(controls(query)).toEqual([
      'flags:{"switchModelsOnFlag":false}',
      'flags:{"switchModelsOnFlag":null}',
    ]);
  });

  test("a session switch by Claude Code is shown and the next message goes to the chosen model", async () => {
    const { session, queries, events, turn } = await start(
      [[init("claude-opus-5-5"), fallback("session"), reply("from 4.8"), done]],
      { model: "claude-opus-5-5" },
    );
    expect(await turn("first")).toBe("turn_completed");
    expect(notices(events)).toEqual([
      expect.objectContaining({
        level: "warning",
        message: expect.stringContaining(
          "claude-opus-5-5 declined this request (cyber), and Claude Code switched the session to claude-opus-4-8",
        ),
      }),
    ]);
    // What answered is shown as it is; the choice is not rewritten.
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "model_changed",
        runtimeInfo: expect.objectContaining({ model: "claude-opus-4-8" }),
      }),
    );
    expect((await session.getRuntimeInfo()).model).toBe("claude-opus-4-8");

    expect(await turn("second")).toBe("turn_completed");
    // The refused turn is not resent; the chosen model is set before the next prompt.
    expect(sends(queries[0]!)).toEqual(["prompt:0", "setModel:claude-opus-5-5", "prompt:1"]);
    expect(queries[0]!.prompts).toHaveLength(2);
    expect((await session.getRuntimeInfo()).model).toBe("claude-opus-5-5");
  });

  test("an older CLI without a scope is treated as a session switch", async () => {
    const { queries, turn } = await start(
      [[init("claude-opus-5-5"), fallback(), reply("from 4.8"), done]],
      { model: "claude-opus-5-5" },
    );
    await turn("first");
    await turn("second");
    expect(sends(queries[0]!)).toEqual(["prompt:0", "setModel:claude-opus-5-5", "prompt:1"]);
  });

  test("a local fallback is noted without moving the session", async () => {
    const { session, queries, events, turn } = await start(
      [[init("claude-opus-5-5"), fallback("local"), reply("ok"), done]],
      { model: "claude-opus-5-5" },
    );
    await turn("first");
    await turn("second");
    expect(notices(events)).toEqual([expect.objectContaining({ level: "info" })]);
    expect(sends(queries[0]!)).toEqual(["prompt:0", "prompt:1"]);
    expect((await session.getRuntimeInfo()).model).toBe("claude-opus-5-5");
  });

  test("a refusal without a retry is shown and not resent", async () => {
    const { session, queries, events, turn } = await start(
      [
        [
          init("claude-opus-5-5"),
          {
            type: "system",
            subtype: "model_refusal_no_fallback",
            original_model: "claude-opus-5-5",
            request_id: null,
            api_refusal_category: "cyber",
            content: "Declined",
            uuid: "refusal-uuid",
            session_id: "pinned-session",
          } as SDKMessage,
          done,
        ],
      ],
      { model: "claude-opus-5-5" },
    );
    expect(await turn("first")).toBe("turn_completed");
    expect(notices(events)).toEqual([
      expect.objectContaining({
        level: "warning",
        message: expect.stringContaining("was not retried on another model"),
      }),
    ]);
    expect(queries[0]!.prompts).toHaveLength(1);
    expect((await session.getRuntimeInfo()).model).toBe("claude-opus-5-5");
  });

  test("a resumed session Claude Code still runs on another model is corrected on the next send", async () => {
    const { queries, events, turn } = await start(
      [[init("claude-opus-4-8"), reply("from 4.8"), done]],
      { model: "claude-opus-5-5" },
    );
    await turn("first");
    expect(notices(events)).toEqual([
      expect.objectContaining({
        message: expect.stringContaining("not the chosen claude-opus-5-5"),
      }),
    ]);
    await turn("second");
    expect(sends(queries[0]!)).toEqual(["prompt:0", "setModel:claude-opus-5-5", "prompt:1"]);
  });

  test("an init on the chosen model in another spelling is not a drift", async () => {
    const { queries, events, turn } = await start(
      [[init("claude-opus-5-5[1m]"), reply("ok"), done]],
      { model: "claude-opus-5-5" },
    );
    await turn("first");
    await turn("second");
    expect(notices(events)).toEqual([]);
    expect(sends(queries[0]!)).toEqual(["prompt:0", "prompt:1"]);
  });
});
