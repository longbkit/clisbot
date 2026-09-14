import type { AgentTimelineRow } from "../../src/server/agent/agent-timeline-store-types.js";
import type { StoredAgentRecord } from "../../src/server/agent/agent-storage.js";

export const FIXTURE_TIME = "2026-09-11T00:00:00.000Z";
export function mixedRow(seq: number): AgentTimelineRow {
  const block = Math.floor((seq - 1) / 20);
  const slot = (seq - 1) % 20;
  const row = { seq, timestamp: FIXTURE_TIME, turnId: `turn-${block}` };
  if (slot === 0) {
    return {
      ...row,
      item: {
        type: "user_message",
        clientMessageId: `submission-${block}`,
        messageId: `provider-${block}`,
        sender: {
          kind: "user",
          id: `user-${block % 25}`,
          hubOrigin: "https://benchmark.invalid",
          organizationId: "org",
          connectionId: "channel",
        },
        text: `Inspect fixture ${block}. Attached file: uploads/fixture.txt\n${"request context ".repeat(8)}`,
      },
    };
  }
  if (slot === 1 || slot === 9) {
    return {
      ...row,
      item: {
        type: "tool_call",
        callId: `tool-${block}`,
        name: "read_file",
        status: slot === 1 ? "running" : "completed",
        detail: {
          type: "unknown",
          input: { path: "uploads/fixture.txt" },
          output: slot === 9 ? { text: "fixture bytes ".repeat(12) } : null,
        },
        error: null,
      },
    };
  }
  if (slot === 10)
    return { ...row, item: { type: "reasoning", text: `Reason about fixture ${block}.` } };
  return {
    ...row,
    item: {
      type: "assistant_message",
      messageId: `message-${block}-${slot < 10 ? "first" : "second"}`,
      text: `Chunk ${seq}: ${"answer text ".repeat(8)}`,
    },
  };
}

export function metadataRecord(index: number): StoredAgentRecord {
  const actor = {
    kind: "user" as const,
    id: `user-${index % 25}`,
    hubOrigin: "https://benchmark.invalid",
    organizationId: "org",
    connectionId: `connection-${index % 3}`,
  };
  return {
    id: `agent-${index}`,
    provider: "mock",
    cwd: `/fixture/project-${Math.floor(index / 100)}`,
    workspaceId: `workspace-${Math.floor(index / 20)}`,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
    labels: {},
    lastStatus: "closed",
    archivedAt: index % 4 === 0 ? FIXTURE_TIME : undefined,
    createdBy: actor,
    lastMessageBy: actor,
    lastInteractionBy: actor,
    lastInteractionAt: new Date(Date.parse(FIXTURE_TIME) + index).toISOString(),
    participantActors: [actor, { ...actor, id: `user-${(index + 1) % 25}` }],
    channels: [
      {
        hubOrigin: actor.hubOrigin,
        organizationId: actor.organizationId,
        connectionId: actor.connectionId,
        channelId: `channel-${index % 5}`,
        displayName: `Channel ${index % 5}`,
      },
    ],
  };
}
