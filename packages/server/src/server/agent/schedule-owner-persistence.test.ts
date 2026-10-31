import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { AgentManager } from "./agent-manager.js";
import { AgentStorage } from "./agent-storage.js";
import { FileAgentTimelineStore } from "./session-storage/file-agent-timeline-store.js";
import { SessionEventLog } from "./session-storage/session-event-log.js";
import { withSessionOperationIdentity } from "./session-operation-context.js";
import { createTestAgentClients } from "../test-utils/fake-agent-client.js";
import { createTestLogger } from "../../test-utils/test-logger.js";

it("persists an automation's owner through admission and refuses a conflicting replay", async () => {
  const root = await mkdtemp(join(tmpdir(), "schedule-owner-persistence-"));
  const logger = createTestLogger();
  const registry = new AgentStorage(join(root, "agents"), logger, { sessionLayout: true });
  await registry.initialize();
  const store = new FileAgentTimelineStore((id) => registry.getSessionDirectory(id));
  const manager = new AgentManager({
    logger,
    registry,
    clients: createTestAgentClients(),
    durableTimelineStore: store,
  });
  const identity = {
    actor: { kind: "automation" as const, id: "schedule" },
    ownerActor: {
      kind: "user" as const,
      id: "owner",
      hubOrigin: "https://hub.example",
      memberId: "member-owner",
    },
  };
  let agentId: string | undefined;
  try {
    const agent = await withSessionOperationIdentity(identity, () =>
      manager.createAgent({ provider: "claude", cwd: root }, undefined, {}),
    );
    agentId = agent.id;
    await withSessionOperationIdentity(identity, () =>
      manager.admitMessageSubmission(agent.id, "Fixture prompt", { clientMessageId: "fixture" }),
    );
    await manager.closeAgent(agent.id);
    await store.flush();
    await registry.flush();
    SessionEventLog.forgetAll();
    const reopened = new FileAgentTimelineStore((id) => registry.getSessionDirectory(id));
    const submitted = await reopened.readMessageSubmission(agent.id, "fixture");
    expect(submitted?.identity).toEqual(identity);
    expect(submitted?.operation?.ownerActor).toEqual(identity.ownerActor);
    const freshRegistry = new AgentStorage(join(root, "agents"), logger, { sessionLayout: true });
    expect((await freshRegistry.get(agent.id))?.ownerActor).toEqual(identity.ownerActor);
    await expect(
      reopened.writeMessageSubmission(agent.id, {
        ...submitted!,
        identity: { ...identity, ownerActor: { ...identity.ownerActor, id: "different-owner" } },
      }),
    ).rejects.toThrow("Logical message ID conflicts with its immutable content or sender");
    expect((await reopened.readMessageSubmission(agent.id, "fixture"))?.identity).toEqual(identity);
    await reopened.flush();
  } finally {
    if (agentId) await manager.closeAgent(agentId);
    await store.flush();
    await registry.flush();
    SessionEventLog.forgetAll();
    await rm(root, { recursive: true, force: true });
  }
});
