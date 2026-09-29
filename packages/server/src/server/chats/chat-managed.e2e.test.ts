import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { createClisbotDaemon } from "../bootstrap.js";
import { createTestClisbotDaemon } from "../test-utils/clisbot-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import type { HubRelationshipRemote } from "../hub/relationship-remote.js";
import type { ManagedAccessAdmission } from "../managed-access/types.js";

test("shared Bot grants protect private Chat and ordinary agent timelines over WebSocket", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "chat-managed-"));
  let projectId = "";
  const admission = (id: string): ManagedAccessAdmission => ({
    principalId: `member:${id}`,
    actor: { kind: "user", id, organizationId: "org", hubOrigin: "https://hub.test" },
    permissions: ["workspace.read", "workspace.write"],
    resourceMode: "projects",
    projects: new Map(
      id === "outsider"
        ? []
        : [
            [
              projectId,
              {
                privileges: new Set([
                  "project.use",
                  "agent.interact",
                  "agent.create",
                  "workspace.create",
                ]),
                agentConfigurations: [
                  { providerId: "claude", modelIds: "*", thinkingOptionIds: "*" },
                ],
              },
            ],
          ],
    ),
    leaseId: `lease-${id}`,
    leaseExpiresAt: Date.now() + 60000,
  });
  const remote: HubRelationshipRemote = {
    enroll: async (input) => ({
      daemonId: input.daemonId,
      permissions: input.permissions,
      webSocketUrl: "wss://hub.test/ws",
    }),
    updatePermissions: async (input) => ({ permissions: input.permissions }),
    consumeAccessTicket: async (input) => admission(input.accessTicket),
    refreshAccessLease: async (input) => admission(input.leaseId.slice(6)),
    replaceProjects: async () => {},
    replaceConnectionOffer: async () => {},
    revoke: async () => {},
    openSocket: () => ({ close: () => {} }),
  };
  const daemon = await createTestClisbotDaemon({
    clisbotHomeRoot: root,
    agentSessionStorage: true,
    bots: { enabled: true, root: path.join(root, "homes") },
    createDaemon: (config, logger, deps) =>
      createClisbotDaemon({ ...config, managedAccessMode: "external" }, logger, {
        ...deps,
        hubRelationshipRemote: remote,
      }),
  });
  const clients: DaemonClient[] = [];
  const open = async (id?: string) => {
    const client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      clientId: id ?? "owner",
      ...(id ? { resolveAccessTicket: async () => id } : {}),
    });
    clients.push(client);
    await client.connect();
    return client;
  };
  try {
    const owner = await open();
    expect(owner.getLastServerInfoMessage()?.botCreationAllowed).toBe(true);
    const created = await owner.createBot({
      name: "Shared",
      kind: "team",
      launch: { provider: "claude" },
    });
    expect(created.error).toBeNull();
    projectId = created.bot!.projectId;
    expect(
      (await owner.connectHub("https://hub.test", "test-token", ["hub.execute"])).error,
    ).toBeFalsy();
    const alice = await open("alice");
    const bob = await open("bob");
    const outsider = await open("outsider");
    expect(alice.getLastServerInfoMessage()?.features?.channelFileRead).toBe(true);
    expect(alice.getLastServerInfoMessage()?.botCreationAllowed).toBe(false);
    expect((await bob.listBots()).bots[0]?.canConfigure).toBe(false);
    expect((await outsider.listBots()).bots).toEqual([]);
    expect((await bob.listBots()).bots.map((bot) => bot.id)).toContain(created.bot!.id);
    const chat = await alice.createChat({
      botIds: [created.bot!.id],
      firstMessage: { text: "alice-private" },
    });
    expect(chat.error).toBeNull();
    await expect
      .poll(async () => (await alice.fetchChatTranscript({ chatId: chat.chat!.id })).lines.length)
      .toBe(2);
    expect((await bob.listChats()).chats).toEqual([]);
    const denied = await bob.fetchChatTranscript({ chatId: chat.chat!.id });
    expect(denied.error).toBeTruthy();
    expect(denied.lines).toEqual([]);
    const agentId = (await alice.listChats()).chats[0]!.participants[0]!.agentId!;
    expect((await bob.fetchAgents()).entries.map((entry) => entry.agent.id)).not.toContain(agentId);
    await expect(bob.fetchAgentTimeline(agentId, { timeout: 1500 })).rejects.toThrow();
    expect(await alice.fetchAgentTimeline(agentId)).toBeTruthy();
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    await daemon.close();
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
