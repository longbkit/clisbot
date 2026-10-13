import { it, expect } from "vitest";
import type { DaemonSessionAccess } from "../../daemons/protocol.js";
import { onboardingBotReader } from "./onboarding-bot.js";
it("reads authoritative Bot ownership over only the named enrolled Host and releases its session subscription", async () => {
  const subscribers = new Set<(frame: Record<string, unknown>) => void>();
  const requests: Record<string, unknown>[] = [];
  const bot = {
    id: "bot_aaaaaaaaaaaaaaaa",
    slug: "fixture",
    name: "Fixture",
    kind: "personal",
    projectId: "prj_1",
    workspaceId: "ws_1",
    cwd: "/isolated",
    launch: { provider: "codex" },
    template: null,
    owner: { kind: "user", id: "victim", memberId: "member-victim", organizationId: "org" },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    archivedAt: null,
  };
  const sessions: DaemonSessionAccess = {
    channel: (id) =>
      id === "host"
        ? {
            serverInfo: {},
            permissions: ["hub.execute"],
            write: async (raw) => {
              const request = JSON.parse(raw).message;
              requests.push(request);
              for (const subscriber of subscribers)
                subscriber({
                  type: "bot.list.response",
                  payload: { requestId: request.requestId, bots: [bot], error: null },
                });
            },
          }
        : undefined,
    subscribe: (_id, handler) => {
      subscribers.add(handler);
      return () => {
        subscribers.delete(handler);
      };
    },
    onConnected: () => () => {},
    onDisconnected: () => () => {},
  };
  expect(await onboardingBotReader(() => sessions)("host", bot.id)).toMatchObject({
    owner: bot.owner,
  });
  expect(requests[0]).toMatchObject({ type: "bot.list.request" });
  expect(subscribers.size).toBe(0);
  await expect(onboardingBotReader(() => sessions)("unrelated-host", bot.id)).rejects.toThrow(
    /offline/,
  );
  expect(requests).toHaveLength(1);
});
