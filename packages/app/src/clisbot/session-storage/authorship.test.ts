import { describe, expect, it } from "vitest";
import { createUserMessage, upsertUserMessage } from "@/types/stream";
import {
  normalizeWorkspaceTabTarget,
  buildDeterministicWorkspaceTabId,
  workspaceTabTargetsEqual,
} from "@/workspace-tabs/identity";
import type { SessionActor } from "@getpaseo/protocol/session-authorship";
const actor: SessionActor = {
  kind: "user",
  id: "slack:U1",
  hubOrigin: "https://hub",
  organizationId: "org",
  connectionId: "slack",
};
describe("authorship snapshots", () => {
  it("reconciles a pending local message with its authoritative sender even while retaining local presentation", () => {
    const pending = createUserMessage({
      id: "local",
      clientMessageId: "retry",
      text: "hello",
      timestamp: new Date(0),
    });
    const echo = createUserMessage({
      id: "remote",
      messageId: "remote",
      clientMessageId: "retry",
      text: "hello",
      timestamp: new Date(1),
      sender: actor,
    });
    const result = upsertUserMessage([pending], echo);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ sender: actor });
    expect(upsertUserMessage(result, echo)).toHaveLength(1);
    expect(pending).not.toHaveProperty("sender");
  });
  it("restores profile snapshots and reuses only the full scoped identity", () => {
    const target = { kind: "user_profile" as const, actor };
    expect(normalizeWorkspaceTabTarget(JSON.parse(JSON.stringify(target)))).toEqual(target);
    expect(
      workspaceTabTargetsEqual(target, { ...target, actor: { ...actor, displayName: "Renamed" } }),
    ).toBe(true);
    for (const change of [
      { hubOrigin: "https://other" },
      { organizationId: "other" },
      { connectionId: "other" },
    ]) {
      const other = { ...target, actor: { ...actor, ...change } };
      expect(workspaceTabTargetsEqual(target, other)).toBe(false);
      expect(buildDeterministicWorkspaceTabId(target)).not.toBe(
        buildDeterministicWorkspaceTabId(other),
      );
    }
  });
});
