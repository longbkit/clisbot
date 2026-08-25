import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { AuthServer } from "../auth/server.js";
import { createMemoryDatabase } from "../db/memory.js";
import { resolveRouteTenant, TenantRouteNotFoundError } from "./access.js";

describe("URL tenant resolution", () => {
  it("resolves organization and org-local project slugs independently of the landing hint", async () => {
    const database = createMemoryDatabase({
      memberships: [
        {
          userId: "user-1",
          organizationId: "org-a",
          organizationName: "Acme",
          organizationSlug: "acme",
          membershipId: "member-a",
          role: "owner",
        },
        {
          userId: "user-1",
          organizationId: "org-b",
          organizationName: "Orbit",
          organizationSlug: "orbit",
          membershipId: "member-b",
          role: "member",
        },
      ],
    });
    const acme = await database.createProject({
      organizationId: "org-a",
      name: "Default",
      slug: "default",
      createdByUserId: "user-1",
    });
    await database.createProject({
      organizationId: "org-b",
      name: "Default",
      slug: "default",
      createdByUserId: "user-1",
    });

    const resolved = await resolveRouteTenant(
      accountAuth("org-b"),
      database,
      new Request("https://hub.test/o/acme/projects/default"),
      { organizationSlug: "acme", projectSlug: "default" },
    );

    assert.equal(resolved.account.session.activeOrganizationId, "org-b");
    assert.equal(resolved.tenant.organization.id, "org-a");
    assert.equal(resolved.tenant.project?.id, acme.id);
  });

  it("conceals inaccessible and nonexistent URL scopes identically", async () => {
    const database = createMemoryDatabase({ memberships: [] });
    const attempts = [
      resolveRouteTenant(accountAuth(null), database, new Request("https://hub.test"), {
        organizationSlug: "private",
        projectSlug: "default",
      }),
      resolveRouteTenant(accountAuth(null), database, new Request("https://hub.test"), {
        organizationSlug: "does-not-exist",
        projectSlug: "does-not-exist",
      }),
    ];
    for (const attempt of attempts) {
      await assert.rejects(
        attempt,
        (error: unknown) =>
          error instanceof TenantRouteNotFoundError && error.message === "tenant route not found",
      );
    }
  });
});

function accountAuth(activeOrganizationId: string | null): AuthServer {
  return {
    handle: () => Promise.resolve(new Response()),
    resources: () => Promise.reject(new Error("unused")),
    resolveOrganizationAccess: () => Promise.reject(new Error("unused")),
    resolveAccount: () =>
      Promise.resolve({
        session: { id: "session-1", activeOrganizationId },
        account: { id: "user-1", name: "User", email: "user@example.test" },
        isInstanceOperator: false,
      }),
    rejectCookieMutation: () => undefined,
    close: () => Promise.resolve(),
  };
}
