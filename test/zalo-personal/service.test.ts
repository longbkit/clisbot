import { beforeEach, describe, expect, mock, test } from "bun:test";

const listenerHandlers = new Map<string, (...args: any[]) => void>();
const listenerStartOptions: unknown[] = [];

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
      sendMessage: async () => undefined,
    },
    ThreadType: { User: 0, Group: 1 },
  }),
}));

describe("zalo-personal listener service", () => {
  beforeEach(() => {
    listenerHandlers.clear();
    listenerStartOptions.length = 0;
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
});
