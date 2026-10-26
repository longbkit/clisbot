import type { Page } from "@playwright/test";
import type { SessionActor } from "@clisbot/protocol/session-authorship";

/** A Hub that exists only at the network boundary; the reader is signed in as `HUB_READER`. */
export const E2E_HUB = "https://hub.e2e.test";
export const HUB_READER = { accountId: "account-me", memberId: "member-me" };

/** A teammate on the same Hub: what they author is "Others" for the reader. */
export const HUB_TEAMMATE: SessionActor = {
  kind: "user",
  id: "account-teammate",
  displayName: "Mỹ Duyên Đào",
  hubOrigin: E2E_HUB,
  organizationId: "org-e2e",
  memberId: "member-teammate",
};

/**
 * A signed-in Hub account, at the network boundary: the reader is `HUB_READER`, so a teammate's
 * workspaces and sessions resolve to Others by the production ownership rule.
 */
export async function signInToE2EHub(page: Page): Promise<void> {
  await page.addInitScript((origin) => {
    localStorage.setItem(
      "clisbot:device-hub-profiles:v1",
      JSON.stringify({
        profiles: [
          {
            authentication: "oauth",
            hubId: origin,
            origin,
            label: "E2E Hub",
            entry: "account",
            setupStatus: "ready",
          },
        ],
        activeId: origin,
      }),
    );
  }, E2E_HUB);
  const state = {
    status: "active",
    account: { id: HUB_READER.accountId, name: "Long", email: "long@e2e.test", image: null },
    memberships: [
      {
        id: "org-e2e",
        name: "E2E Org",
        slug: "e2e",
        membershipId: HUB_READER.memberId,
        role: "member",
      },
    ],
    organization: { id: "org-e2e", name: "E2E Org", slug: "e2e" },
    membership: { id: HUB_READER.memberId, role: "member" },
    capabilities: { view: true, manageMembers: false, manageOwners: false, manageResources: false },
    isInstanceOperator: false,
    team: { members: [] },
    canCreateOrganization: false,
  };
  await page.route(`${E2E_HUB}/**`, async (route) => {
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "content-type": "application/json",
    };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/auth/clisbot/state") {
      return route.fulfill({ status: 200, headers, body: JSON.stringify(state) });
    }
    if (pathname.endsWith("/daemons")) {
      return route.fulfill({ status: 200, headers, body: JSON.stringify({ daemons: [] }) });
    }
    return route.fulfill({ status: 404, headers, body: JSON.stringify({ error: "not_found" }) });
  });
}
