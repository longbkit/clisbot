import { beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { clisbotConfigSchema } from "../../src/config/core/schema.ts";
import { renderDefaultConfigTemplate } from "../../src/config/core/template.ts";
import type { LoadedConfig } from "../../src/config/core/load-config.ts";

const listenerHandlers = new Map<string, (...args: any[]) => void | Promise<void>>();
const listenerStartOptions: unknown[] = [];
const sentMessages: any[] = [];

mock.module("../../src/channels/zalo-personal/zca-js.ts", () => ({
  loginZaloPersonalFromSession: async () => ({
    api: {
      getOwnId: () => "bot-1",
      listener: {
        on: (event: string, handler: (...args: any[]) => void) => {
          listenerHandlers.set(event, handler);
        },
        start: (options: unknown) => {
          listenerStartOptions.push(options);
        },
        stop: () => undefined,
      },
      sendMessage: async (...args: any[]) => {
        sentMessages.push(args);
      },
    },
    ThreadType: { User: 0, Group: 1 },
  }),
}));

describe("zalo-personal listener service", () => {
  beforeEach(() => {
    listenerHandlers.clear();
    listenerStartOptions.length = 0;
    sentMessages.length = 0;
  });

  test("reports terminal closed events without treating transient disconnect as failed", async () => {
    const { ZaloPersonalListenerService } = await import("../../src/channels/zalo-personal/service.ts");
    const lifecycle: Array<{ connection: string; summary?: string; detail?: string }> = [];
    const service = new ZaloPersonalListenerService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      "default",
      { tokenFile: "/tmp/zalo-auth-session" } as any,
      async (event) => {
        lifecycle.push(event);
      },
    );

    await service.start();

    expect(listenerHandlers.has("closed")).toBe(true);
    expect(listenerHandlers.has("disconnected")).toBe(false);
    expect(listenerStartOptions).toEqual([{ retryOnClose: true }]);

    listenerHandlers.get("closed")?.(3000, "DuplicateConnection");
    expect(lifecycle.at(-1)).toMatchObject({
      connection: "failed",
      summary: "Zalo Personal listener closed for default.",
      detail: "3000: DuplicateConnection",
    });
  });

  test("does not reply to unknown DMs under the default allowlist", async () => {
    const { ZaloPersonalListenerService } = await import("../../src/channels/zalo-personal/service.ts");
    const service = new ZaloPersonalListenerService(
      createLoadedConfig(),
      createRejectingAgentService(),
      createProcessedEventsStore(),
      {} as any,
      "default",
      { tokenFile: "/tmp/zalo-auth-session" } as any,
      async () => undefined,
    );

    await service.start();
    listenerHandlers.get("message")?.(createTextMessage({ msgId: "msg-unknown", content: "/status" }));
    await service.stop();

    expect(sentMessages).toEqual([]);
  });

  test("keeps first-owner claim open before the default DM allowlist gate", async () => {
    const { resetOwnerClaimRuntimeForTests } = await import("../../src/auth/owner-claim.ts");
    const { ZaloPersonalListenerService } = await import("../../src/channels/zalo-personal/service.ts");
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-zalo-owner-claim-"));
    try {
      resetOwnerClaimRuntimeForTests();
      const loadedConfig = createLoadedConfig({ configPath: join(tempDir, "clisbot.json") });
      loadedConfig.raw.app.auth.roles.owner.users = [];
      writeFileSync(loadedConfig.configPath, JSON.stringify(loadedConfig.raw, null, 2));
      const service = new ZaloPersonalListenerService(
        loadedConfig,
        createIdleAgentService(tempDir),
        createProcessedEventsStore(),
        {} as any,
        "default",
        { tokenFile: "/tmp/zalo-auth-session" } as any,
        async () => undefined,
      );

      await service.start();
      listenerHandlers.get("message")?.(createTextMessage({ msgId: "msg-owner", content: "" }));
      await service.stop();

      const persisted = JSON.parse(readFileSync(loadedConfig.configPath, "utf8"));
      expect(persisted.app.auth.roles.owner.users).toContain("zalo-personal:user-1");
      expect(sentMessages[0]?.[0]?.msg).toContain("First owner claim complete.");
    } finally {
      resetOwnerClaimRuntimeForTests();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

function createLoadedConfig(params: { configPath?: string } = {}): LoadedConfig {
  const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
  config.bots.zaloPersonal.defaults.enabled = true;
  config.bots.zaloPersonal.default.enabled = true;
  config.app.auth.roles.owner.users = ["telegram:owner"];
  return {
    configPath: params.configPath ?? "/tmp/clisbot.json",
    processedEventsPath: "/tmp/processed.json",
    stateDir: "/tmp",
    raw: {
      ...config,
      session: {
        ...config.app.session,
        dmScope: config.bots.defaults.dmScope,
      },
      control: config.app.control,
      tmux: config.agents.defaults.runner.defaults.tmux,
    },
  };
}

function createRejectingAgentService() {
  return {
    getConversationFollowUpState: async () => {
      throw new Error("unknown DM should not reach the agent");
    },
  } as any;
}

function createIdleAgentService(workspacePath: string) {
  return {
    getConversationFollowUpState: async () => ({
      overrideMode: undefined,
      lastBotReplyAt: undefined,
    }),
    getWorkspacePath: () => workspacePath,
  } as any;
}

function createProcessedEventsStore() {
  return {
    getStatus: async () => undefined,
    markProcessing: async () => undefined,
    markCompleted: async () => undefined,
    clear: async () => undefined,
  } as any;
}

describe("ZaloPersonalMediaGroupDispatcher", () => {
  test("buffers Zalo image group events before dispatching one interaction", async () => {
    const { OrderedIngressDispatcher } = await import("../../src/channels/message/ordered-ingress-dispatcher.ts");
    const { ZaloPersonalMediaGroupDispatcher } = await import("../../src/channels/zalo-personal/media-group.ts");
    const handled: any[] = [];
    const dispatcher = new OrderedIngressDispatcher<any>(
      (message) => String(message.threadId),
      async (message) => {
        handled.push(message);
      },
    );
    const mediaGroups = new ZaloPersonalMediaGroupDispatcher(dispatcher, 10);

    const firstTasks = mediaGroups.dispatch([
      createPhotoMessage({ msgId: "msg-2", idInGroup: 1, title: "second" }),
    ]);
    const secondTasks = mediaGroups.dispatch([
      createPhotoMessage({ msgId: "msg-1", idInGroup: 0, title: "first" }),
    ]);

    await Promise.all([...firstTasks, ...secondTasks]);

    expect(handled).toHaveLength(1);
    expect(handled[0]?.mediaGroupMessages?.map((message: any) => message.data.msgId)).toEqual(["msg-1", "msg-2"]);
  });

  test("keeps later normal Zalo messages behind a pending image group on the same thread", async () => {
    const { OrderedIngressDispatcher } = await import("../../src/channels/message/ordered-ingress-dispatcher.ts");
    const { ZaloPersonalMediaGroupDispatcher } = await import("../../src/channels/zalo-personal/media-group.ts");
    const handled: string[] = [];
    const dispatcher = new OrderedIngressDispatcher<any>(
      (message) => String(message.threadId),
      async (message) => {
        handled.push(
          message.mediaGroupMessages
            ? `album:${message.mediaGroupMessages.map((entry: any) => entry.data.msgId).join(",")}`
            : `message:${message.data.msgId}`,
        );
      },
    );
    const mediaGroups = new ZaloPersonalMediaGroupDispatcher(dispatcher, 10);

    const firstTasks = mediaGroups.dispatch([
      createPhotoMessage({ msgId: "msg-1", idInGroup: 0, title: "first" }),
    ]);
    const secondTasks = mediaGroups.dispatch([
      createTextMessage({ msgId: "msg-2", content: "after album" }),
    ]);

    await Promise.all([...firstTasks, ...secondTasks]);

    expect(handled).toEqual(["message:msg-1", "message:msg-2"]);
  });
});

function createPhotoMessage(params: { msgId: string; idInGroup: number; title: string }) {
  return {
    type: 0,
    threadId: "user-1",
    isSelf: false,
    data: {
      msgId: params.msgId,
      cliMsgId: "",
      msgType: "chat.photo",
      uidFrom: "user-1",
      idTo: "bot-1",
      ts: "1",
      content: {
        title: params.title,
        href: `https://photo-stal-24.zdn.vn/no/jpg/${params.msgId}`,
        params: JSON.stringify({
          id_in_group: params.idInGroup,
          group_layout_id: 1779587704613,
          total_item_in_group: 2,
        }),
      },
    },
  };
}

function createTextMessage(params: { msgId: string; content: string }) {
  return {
    type: 0,
    threadId: "user-1",
    isSelf: false,
    data: {
      msgId: params.msgId,
      cliMsgId: "",
      msgType: "webchat",
      uidFrom: "user-1",
      idTo: "bot-1",
      ts: "2",
      content: params.content,
    },
  };
}
