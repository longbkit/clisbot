import { describe, expect, it, vi } from "vitest";
import { createMemoryDatabase } from "../db/memory.js";
import { createWorkflowOwnerResolver } from "./workflow-owner.js";

async function fixture() {
  const database = createMemoryDatabase({ organizationIds: ["org"] });
  const save = (author: string | null, triggerId?: string) =>
    database.saveOrganizationTrigger({
      organizationId: "org",
      ...(triggerId ? { triggerId } : {}),
      name: "fixture",
      enabled: true,
      format: "single_run",
      yaml: "",
      normalizedConfiguration: {},
      contentHash: author ?? "import",
      sourceKind: "manual",
      sourceEvidence: { kind: "test" },
      createdByUserId: author,
      routes: [],
    });
  const resolveAuthor = vi.fn(async (organizationId: string, userId: string) => ({
    organizationId,
    userId,
    membershipId: `member-${userId}`,
  }));
  const resolve = createWorkflowOwnerResolver({
    database,
    resolveAuthor,
    hubOrigin: "https://hub.example/",
  });
  return { database, save, resolve, resolveAuthor };
}

describe("verified pinned workflow owner", () => {
  it("uses revision A's author after revision B becomes active", async () => {
    const f = await fixture();
    const a = await f.save("author-a");
    const aId = a.activeRevisionId;
    const b = await f.save("author-b", a.id);
    expect(b.activeRevisionId).not.toBe(aId);
    const input = { organizationId: "org", workflowId: a.id, configurationRevisionId: aId };
    expect(await f.resolve(input)).toEqual({
      kind: "user",
      id: "author-a",
      memberId: "member-author-a",
      organizationId: "org",
      hubOrigin: "https://hub.example",
    });
    expect((await f.resolve({ ...input, configurationRevisionId: b.activeRevisionId }))?.id).toBe(
      "author-b",
    );
    expect((await f.resolve(input))?.id).toBe("author-a");
  });
  it("keeps imported, missing, foreign and departed authors unknown", async () => {
    const f = await fixture();
    const imported = await f.save(null);
    const input = {
      organizationId: "org",
      workflowId: imported.id,
      configurationRevisionId: imported.activeRevisionId,
    };
    expect(await f.resolve(input)).toBeUndefined();
    expect(await f.resolve({ ...input, configurationRevisionId: "missing" })).toBeUndefined();
    expect(f.resolveAuthor).not.toHaveBeenCalled();
    const owned = await f.save("author", imported.id);
    const ownedInput = { ...input, configurationRevisionId: owned.activeRevisionId };
    expect(await f.resolve({ ...ownedInput, organizationId: "foreign" })).toBeUndefined();
    const departed = createWorkflowOwnerResolver({
      database: f.database,
      resolveAuthor: async () => undefined,
      hubOrigin: "https://hub.example",
    });
    expect(await departed(ownedInput)).toBeUndefined();
  });
  it("does not accept a mismatched Member principal", async () => {
    const f = await fixture();
    const owned = await f.save("author");
    const resolve = createWorkflowOwnerResolver({
      database: f.database,
      hubOrigin: "https://hub.example",
      resolveAuthor: async () => ({
        organizationId: "foreign",
        userId: "impostor",
        membershipId: "member",
      }),
    });
    expect(
      await resolve({
        organizationId: "org",
        workflowId: owned.id,
        configurationRevisionId: owned.activeRevisionId,
      }),
    ).toBeUndefined();
  });
});
