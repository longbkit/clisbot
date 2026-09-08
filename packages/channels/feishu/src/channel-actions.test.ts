import { describe, expect, it } from "vitest";
import { createFeishuClient } from "./client.js";
import { feishuChannelActions, FEISHU_MESSAGE_ACTIONS } from "./channel-actions.js";
import { buildFeishuTestConfig } from "./fusion/test-config.js";
import type { ChannelMessageActionContext } from "@getpaseo/channels-core/plugin-sdk/channel-contract";

/** Replaces namespaces on the cached SDK client the ported send path resolves. */
function fakeSdk(namespaces: Record<string, unknown>): void {
  const client = createFeishuClient({
    accountId: "default",
    appId: "cli_test_app",
    appSecret: "test-secret",
    domain: "feishu",
  }) as unknown as Record<string, unknown>;
  for (const [name, value] of Object.entries(namespaces)) client[name] = value;
}

function ctx(action: string, params: Record<string, unknown>): ChannelMessageActionContext {
  return {
    channel: "feishu",
    action,
    cfg: buildFeishuTestConfig(),
    params,
  } as unknown as ChannelMessageActionContext;
}

async function payload(result: Awaited<ReturnType<typeof handle>>): Promise<Record<string, unknown>> {
  const first = result.content[0];
  if (first === undefined || first.type !== "text") throw new Error("no text content");
  const start = first.text.indexOf("{");
  return JSON.parse(first.text.slice(start, first.text.lastIndexOf("}") + 1));
}

function handle(action: string, params: Record<string, unknown>) {
  const run = feishuChannelActions.handleAction;
  if (run === undefined) throw new Error("handleAction missing");
  return run(ctx(action, params));
}

describe("feishuChannelActions discovery", () => {
  it("advertises the executable action set plus the gated reaction verbs", () => {
    const discovery = feishuChannelActions.describeMessageTool?.({
      cfg: buildFeishuTestConfig(),
    } as never);
    expect(discovery?.actions).toEqual(expect.arrayContaining([...FEISHU_MESSAGE_ACTIONS]));
    // `actions.reactions` defaults on upstream.
    expect(discovery?.actions).toContain("react");
    expect(discovery?.capabilities).toContain("presentation");
  });

  it("advertises nothing for an unconfigured channel", () => {
    const discovery = feishuChannelActions.describeMessageTool?.({
      cfg: { channels: {} },
    } as never);
    expect(discovery?.actions).toEqual([]);
  });

  it("drops the reaction verbs when the account disables them", () => {
    const discovery = feishuChannelActions.describeMessageTool?.({
      cfg: buildFeishuTestConfig({ actions: { reactions: false } }),
    } as never);
    expect(discovery?.actions).not.toContain("react");
    expect(discovery?.actions).not.toContain("reactions");
  });

  it("refuses an action the vertical cannot execute", () => {
    expect(feishuChannelActions.supportsAction?.({ action: "send" as never })).toBe(true);
    expect(feishuChannelActions.supportsAction?.({ action: "upload-file" as never })).toBe(false);
    expect(feishuChannelActions.supportsAction?.({ action: "poll" as never })).toBe(false);
  });
});

describe("feishuChannelActions handleAction", () => {
  it("sends text through the ported send path", async () => {
    const calls: Record<string, unknown>[] = [];
    fakeSdk({
      im: {
        message: {
          create: async (request: Record<string, unknown>) => {
            calls.push(request);
            return { code: 0, data: { message_id: "om_sent", chat_id: "oc_1" } };
          },
        },
      },
    });
    const result = await payload(await handle("send", { to: "oc_1", text: "hello" }));
    expect(result).toMatchObject({ ok: true, channel: "feishu", action: "send" });
    expect(calls[0]).toMatchObject({ params: { receive_id_type: "chat_id" } });
  });

  it("requires a target", async () => {
    await expect(handle("send", { text: "hi" })).rejects.toThrow(/requires a target/);
  });

  it("requires messageId on thread-reply", async () => {
    await expect(handle("thread-reply", { to: "oc_1", text: "hi" })).rejects.toThrow(
      /thread-reply requires messageId/,
    );
  });

  it("adds a reaction", async () => {
    fakeSdk({
      im: {
        messageReaction: {
          create: async () => ({ code: 0, data: { reaction_id: "re_1" } }),
        },
      },
    });
    const result = await payload(
      await handle("react", { messageId: "om_1", emoji: "THUMBSUP" }),
    );
    expect(result).toMatchObject({ ok: true, action: "react", reactionId: "re_1" });
  });

  it("refuses reactions when the account gate is off", async () => {
    const run = feishuChannelActions.handleAction;
    if (run === undefined) throw new Error("handleAction missing");
    await expect(
      run({
        channel: "feishu",
        action: "react",
        cfg: buildFeishuTestConfig({ actions: { reactions: false } }),
        params: { messageId: "om_1", emoji: "THUMBSUP" },
      } as never),
    ).rejects.toThrow(/reactions are disabled/);
  });

  it("refuses an unsupported action by name", async () => {
    await expect(handle("sticker", { to: "oc_1" })).rejects.toThrow(
      /not supported for provider feishu/,
    );
  });
});
