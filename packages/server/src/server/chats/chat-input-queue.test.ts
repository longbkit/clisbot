import { expect, test, vi } from "vitest";
import { publishChatQueueBoundary } from "./chat-input-queue.js";

for (const enabled of [false, true]) {
  test(`discussion boundary publishes authoritative idle with Host queue enabled=${enabled}`, async () => {
    const chat = { id: "group" };
    const payload = { id: "group", discussionActive: false };
    const wake = vi.fn();
    const publish = vi.fn();
    const input = {
      chatId: "group",
      enabled,
      queues: { wake },
      store: { require: async () => chat },
      engine: { payload: async () => payload },
      publish,
      logger: { warn: vi.fn() },
    } as unknown as Parameters<typeof publishChatQueueBoundary>[0];
    publishChatQueueBoundary(input);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(wake).toHaveBeenCalledTimes(enabled ? 1 : 0);
    expect(publish).toHaveBeenCalledExactlyOnceWith(payload);
  });
}
