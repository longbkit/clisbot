import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { createClisbotDaemon } from "../bootstrap.js";
import { createTestClisbotDaemon } from "../test-utils/clisbot-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import type { HubRelationshipRemote } from "../hub/relationship-remote.js";
import type { ManagedAccessAdmission } from "../managed-access/types.js";

test("managed quick starts sync personal pins, enforce sharing and authorize bot launch overrides", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "chat-managed-"));
  let projectId = "";
  const admission = (id: string): ManagedAccessAdmission => ({
    principalId: `member:${id}`,
    actor: {
      kind: "user",
      id,
      organizationId: "org",
      hubOrigin: "https://hub.test",
      hubIdentity: "stable-test-hub",
    },
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
    const quick = await owner.prepareQuickChat();
    expect(quick.error).toBeNull();
    expect(quick.cwd).toContain("quick-chats");
    expect((await owner.prepareQuickChat()).projectId).toBe(quick.projectId);
    // Every chat claims its own folder inside the one Quick chats project, which is never git.
    const chats = await Promise.all(
      [1, 2].map(() =>
        owner.createWorkspace({
          title: "Convert PNGs",
          source: { kind: "directory", path: quick.cwd!, projectId: quick.projectId },
        }),
      ),
    );
    const folders = chats.map((chat) => chat.workspace?.workspaceDirectory);
    expect(new Set(folders).size).toBe(2);
    for (const chat of chats) {
      expect(chat.workspace).toMatchObject({ projectId: quick.projectId, projectKind: "non_git" });
      expect(path.dirname(chat.workspace!.workspaceDirectory!)).toBe(quick.cwd);
      expect(path.basename(chat.workspace!.workspaceDirectory!)).toMatch(
        /^\d{4}-\d{2}-\d{2}-convert-pngs-[0-9a-f]{8}$/,
      );
    }

    expect(
      (await owner.connectHub("https://hub.test", "test-token", ["hub.execute"])).error,
    ).toBeFalsy();
    const alice = await open("alice");
    const bob = await open("bob");
    const outsider = await open("outsider");
    expect((await alice.prepareQuickChat()).error).toBeTruthy();
    const item = {
      name: "Triage",
      visibility: "host" as const,
      target: { kind: "bot" as const, botId: created.bot!.id },
      startingPrompt: "Triage today's bugs",
      agent: { kind: "default" as const },
    };
    const id = "qs_0000000000000001";
    expect((await alice.saveQuickStart({ id, expectedRevision: 0, input: item })).error).toBeNull();
    expect((await bob.listQuickStarts()).items?.[0]).toMatchObject({
      name: "Triage",
      canEdit: false,
    });
    expect((await outsider.listQuickStarts()).items).toEqual([]);
    expect(
      (await bob.setQuickStartPins({ pinnedIds: [id], expectedRevision: 0 })).error,
    ).toBeNull();
    expect((await alice.listQuickStarts()).preferences?.pinnedIds).toEqual([]);
    expect(
      (await bob.saveQuickStart({ id, expectedRevision: 1, input: { ...item, name: "Hijack" } }))
        .error,
    ).toBeTruthy();
    const otherDevice = await open("bob");
    expect((await otherDevice.listQuickStarts()).preferences?.pinnedIds).toEqual([id]);
    expect(
      (
        await alice.saveQuickStart({
          id,
          expectedRevision: 1,
          input: { ...item, visibility: "personal" },
        })
      ).error,
    ).toBeNull();
    expect((await bob.listQuickStarts()).items).toEqual([]);
    expect((await bob.listQuickStarts()).preferences?.pinnedIds).toEqual([]);
    // Selected launch configuration is authorized for the actual Chat, not the Bot default.
    const denied = await alice.createChat({
      botIds: [created.bot!.id],
      launch: { provider: "codex" },
      idempotencyKey: "denied",
      firstMessage: { text: "do not run", messageId: "denied-message" },
    });
    expect(denied.error).toBeTruthy();
    const request = {
      botIds: [created.bot!.id],
      launch: { provider: "claude", modeId: "default" },
      idempotencyKey: "triage",
      firstMessage: { text: "Triage once", messageId: "triage-first" },
    };
    const first = await alice.createChat(request);
    expect(first.error).toBeNull();
    const retry = await alice.createChat(request);
    expect(retry.error).toBeNull();
    expect(retry.chat?.id).toBe(first.chat?.id);
    expect(retry.sent?.duplicate).toBe(true);
    const fresh = await alice.createChat({
      ...request,
      idempotencyKey: "triage-second",
      firstMessage: { text: "Triage again", messageId: "triage-second-first" },
    });
    expect(fresh.error).toBeNull();
    expect(fresh.chat?.id).not.toBe(first.chat?.id);
    await expect
      .poll(
        async () =>
          (await alice.fetchAgentHistory({ activityFilter: { kind: "bot" } })).entries.length,
      )
      .toBe(2);
    const page = await alice.fetchAgentHistory({
      activityFilter: { kind: "bot" },
      page: { limit: 1 },
    });
    expect(page.entries).toHaveLength(1);
    expect(page.pageInfo.hasMore).toBe(true);
    const next = await alice.fetchAgentHistory({
      activityFilter: { kind: "bot" },
      page: { limit: 1, cursor: page.pageInfo.nextCursor! },
    });
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0].agent.id).not.toBe(page.entries[0].agent.id);
    expect(next.pageInfo.hasMore).toBe(false);
    expect(
      (await alice.fetchAgentHistory({ activityFilter: { kind: "project" }, page: { limit: 1 } }))
        .entries,
    ).toEqual([]);
    expect(
      (
        await alice.fetchAgentHistory({
          activityFilter: { updatedAfter: "2099-01-01T00:00:00.000Z" },
        })
      ).entries,
    ).toEqual([]);
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    await daemon.close();
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
