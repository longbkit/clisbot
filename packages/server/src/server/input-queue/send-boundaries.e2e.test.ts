import { expect, test } from "vitest";
import { createTestClisbotDaemon } from "../test-utils/clisbot-daemon.js";
import { createTestAgentClients } from "../test-utils/fake-agent-client.js";
import { DaemonClient } from "../test-utils/daemon-client.js";

test("disabled Host queue rejects admission while ordinary session sends still work", async () => {
  const daemon = await createTestClisbotDaemon({
    agentSessionStorage: true,
    hostInputQueue: false,
  });
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
  try {
    await client.connect();
    const agent = await client.createAgent({ provider: "codex", cwd: daemon.staticDir });
    const response = await client.executeAgentQueueCommand({
      agentId: agent.id,
      command: { action: "enqueue", id: "disabled", text: "Keep draft" },
    });
    expect(response.error).toContain("disabled");
    await client.sendAgentMessage(agent.id, "Ordinary send", { messageId: "ordinary" });
    await expect
      .poll(() => daemon.daemon.agentManager.hasDurableSubmittedMessage(agent.id, "ordinary"))
      .toBe(true);
  } finally {
    await client.close();
    await daemon.close();
  }
});

test("unavailable exact-turn Steer never replaces the active turn", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const daemon = await createTestClisbotDaemon({
    agentSessionStorage: true,
    agentClients: createTestAgentClients({ beforeTurnComplete: () => gate }),
  });
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
  try {
    await client.connect();
    const agent = await client.createAgent({ provider: "codex", cwd: daemon.staticDir });
    await client.sendAgentMessage(agent.id, "Hold the turn", { messageId: "running" });
    const turnId = daemon.daemon.agentManager.getAgent(agent.id)!.activeForegroundTurnId!;
    await expect(
      client.sendAgentMessage(agent.id, "Exact steer", {
        messageId: "steer",
        activeTurnBehavior: "steer",
        expectedTurnId: turnId,
      }),
    ).rejects.toThrow("cannot steer");
    expect(daemon.daemon.agentManager.getAgent(agent.id)!.activeForegroundTurnId).toBe(turnId);
    expect(await daemon.daemon.agentManager.hasDurableSubmittedMessage(agent.id, "steer")).toBe(
      false,
    );
    const queued = await client.executeAgentQueueCommand({
      agentId: agent.id,
      command: { action: "enqueue", id: "queued-steer", text: "Keep this queued input" },
    });
    const refused = await client.executeAgentQueueCommand({
      agentId: agent.id,
      command: {
        action: "steer_now",
        id: "queued-steer",
        revision: queued.queue!.revision,
        target: { agentId: agent.id, turnId },
      },
    });
    expect(refused.error).toContain("cannot steer");
    expect(daemon.daemon.agentManager.getAgent(agent.id)!.activeForegroundTurnId).toBe(turnId);
    const retained = await client.executeAgentQueueCommand({
      agentId: agent.id,
      command: { action: "fetch" },
    });
    expect(retained.queue!.items).toMatchObject([
      { id: "queued-steer", state: "needs_review", text: "Keep this queued input" },
    ]);
    await expect(
      client.sendAgentMessage(agent.id, "Stale steer", {
        messageId: "stale",
        activeTurnBehavior: "steer",
        expectedTurnId: "stale-turn",
      }),
    ).rejects.toThrow("changed");
    expect(daemon.daemon.agentManager.getAgent(agent.id)!.activeForegroundTurnId).toBe(turnId);
  } finally {
    release();
    await client.close();
    await daemon.close();
  }
});

test("explicit Queue waits through a permission pause without answering or interrupting it", async () => {
  const daemon = await createTestClisbotDaemon({ agentSessionStorage: true });
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
  try {
    await client.connect();
    const agent = await client.createAgent({
      provider: "codex",
      cwd: daemon.staticDir,
      modeId: "always-ask",
    });
    await client.sendAgentMessage(agent.id, 'Run printf "ok" > permission.txt', {
      messageId: "permission-turn",
    });
    await expect
      .poll(() => daemon.daemon.agentManager.getPendingPermissions(agent.id).length)
      .toBe(1);
    const permission = daemon.daemon.agentManager.getPendingPermissions(agent.id)[0];
    const accepted = await client.executeAgentQueueCommand({
      agentId: agent.id,
      command: { action: "enqueue", id: "after-permission", text: "Explain the result" },
    });
    expect(accepted.error).toBeNull();
    expect(accepted.queue!.items[0].state).toBe("queued");
    expect(daemon.daemon.agentManager.getPendingPermissions(agent.id).map((p) => p.id)).toEqual([
      permission.id,
    ]);
    await client.respondToPermission(agent.id, permission.id, {
      behavior: "deny",
      message: "Fixture explicitly denies",
    });
    await expect
      .poll(
        async () =>
          (
            await client.executeAgentQueueCommand({
              agentId: agent.id,
              command: { action: "fetch" },
            })
          ).queue?.items.map((item) => [item.id, item.state, item.reason]),
        { timeout: 20000 },
      )
      .toEqual([]);
  } finally {
    await client.close();
    await daemon.close();
  }
});
