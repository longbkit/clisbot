import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import type { BrowserOrganizationAccess } from "../auth/browser-organization-access.js";
import { createMemoryDatabase } from "../db/memory.js";
import { cliCredentialParts } from "../auth/cli-credentials.js";
import { CliAuthorizations, normalizeUserCode } from "./index.js";

const startSchema = z.object({
  deviceCode: z.string(),
  userCode: z.string(),
  verificationUri: z.string(),
  verificationUriComplete: z.string(),
});
const pollSchema = z.object({
  status: z.string(),
  credential: z.string().optional(),
  organizationId: z.string().optional(),
});
const inspectionSchema = z.object({ organization: z.object({ name: z.string() }) });

describe("CLI authorizations", () => {
  it("keeps URL-safe underscores inside the public credential prefix", () => {
    const token = "paseo_cli_ab_cd1234567_secret";
    assert.equal(cliCredentialParts(token).prefix, "paseo_cli_ab_cd1234567");
  });

  it("approves one organization credential and discloses it exactly once", async () => {
    const database = createMemoryDatabase();
    const authorizations = new CliAuthorizations(database, browserAccess(), "https://hub.test");
    const started = startSchema.parse(
      await json(await authorizations.start(post("/api/v1/cli-authorizations", {}))),
    );

    assert.equal(started.verificationUri, "https://hub.test/cli-login");
    assert.match(started.verificationUriComplete, /\/cli-login\?code=/u);
    assert.equal(
      normalizeUserCode(started.userCode.toLowerCase()),
      started.userCode.replaceAll("-", ""),
    );

    const inspection = await authorizations.inspect(
      post("/inspect", { userCode: started.userCode }),
    );
    assert.equal(inspection.status, 200);
    assert.equal(inspectionSchema.parse(await inspection.json()).organization.name, "Acme");
    assert.equal(
      (
        await authorizations.decide(
          post("/decision", {
            userCode: started.userCode,
            decision: "approve",
            organizationId: "org-acme",
          }),
        )
      ).status,
      200,
    );

    const first = pollSchema.parse(
      await json(
        await authorizations.poll(
          post("/api/v1/cli-authorizations/poll", { deviceCode: started.deviceCode }),
        ),
      ),
    );
    assert.equal(first.status, "authorized");
    assert.equal(first.organizationId, "org-acme");
    assert.match(first.credential!, /^paseo_cli_/u);

    const replay = pollSchema.parse(
      await json(
        await authorizations.poll(
          post("/api/v1/cli-authorizations/poll", { deviceCode: started.deviceCode }),
        ),
      ),
    );
    assert.equal(replay.status, "disclosed");
    assert.equal(replay.credential, undefined);
  });

  it("rejects organization substitution and preserves denial as terminal", async () => {
    const database = createMemoryDatabase();
    const authorizations = new CliAuthorizations(database, browserAccess());
    const started = startSchema.parse(
      await json(await authorizations.start(post("/api/v1/cli-authorizations", {}))),
    );
    const substituted = await authorizations.decide(
      post("/decision", {
        userCode: started.userCode,
        decision: "approve",
        organizationId: "org-other",
      }),
    );
    assert.equal(substituted.status, 403);
    const denied = await authorizations.decide(
      post("/decision", {
        userCode: started.userCode,
        decision: "deny",
        organizationId: "org-acme",
      }),
    );
    assert.equal(denied.status, 200);
    const poll = pollSchema.parse(
      await json(await authorizations.poll(post("/poll", { deviceCode: started.deviceCode }))),
    );
    assert.equal(poll.status, "denied");
  });

  it("rejects a browser decision when the existing CSRF boundary rejects the request", async () => {
    const database = createMemoryDatabase();
    const access = browserAccess(() => Response.json({ error: "invalid_origin" }, { status: 403 }));
    const authorizations = new CliAuthorizations(database, access);
    const started = startSchema.parse(
      await json(await authorizations.start(post("/api/v1/cli-authorizations", {}))),
    );

    const decision = await authorizations.decide(
      post("/decision", {
        userCode: started.userCode,
        decision: "approve",
        organizationId: "org-acme",
      }),
    );

    assert.equal(decision.status, 403);
    assert.equal(
      pollSchema.parse(
        await json(await authorizations.poll(post("/poll", { deviceCode: started.deviceCode }))),
      ).status,
      "pending",
    );
  });
});

function browserAccess(
  rejectCookieMutation: () => Response | undefined = () => undefined,
): BrowserOrganizationAccess {
  return {
    resolveOrganizationAccess: () =>
      Promise.resolve({
        session: { id: "session-owner" },
        account: { id: "user-owner", name: "Owner", email: "owner@example.test" },
        organization: { id: "org-acme", name: "Acme", slug: "acme" },
        membership: { id: "member-owner", role: "owner" as const },
        capabilities: {
          view: true as const,
          manageResources: true,
          manageMembers: true,
          manageOwners: true,
        },
      }),
    resolveAccount: () => Promise.reject(new Error("unused")),
    rejectCookieMutation,
  };
}

function post(path: string, body: unknown): Request {
  return new Request(new URL(path, "https://hub.test"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const json = (response: Response): Promise<unknown> => response.json();
