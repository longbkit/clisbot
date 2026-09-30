import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
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
    const token = "clisbot_cli_ab_cd1234567_secret";
    assert.equal(cliCredentialParts(token).prefix, "clisbot_cli_ab_cd1234567");
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
    assert.match(first.credential!, /^clisbot_cli_/u);

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
          manageChannels: true,
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

describe("Host approval authority boundary", () => {
  const enrollment = {
    serverId: "host",
    daemonPublicKey: "key",
    hostname: "laptop",
    permissions: ["daemon.read"],
  };
  it("rejects new Host requests when onboarding is disabled, while explicit CLI login remains available", async () => {
    vi.stubEnv("CLISBOT_ONBOARDING_ENABLED", "0");
    try {
      const auth = new CliAuthorizations(createMemoryDatabase(), browserAccess());
      assert.equal((await auth.start(post("/start", { enrollment }))).status, 403);
      assert.equal((await auth.start(post("/start", {}))).status, 201);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("memory storage enforces the same Host binding and single-use contract", async () => {
    const database = createMemoryDatabase();
    const auth = new CliAuthorizations(database, browserAccess());
    const started = startSchema.parse(
      await (await auth.start(post("/start", { enrollment }))).json(),
    );
    assert.equal(
      (
        await auth.decide(
          post("/decide", {
            userCode: started.userCode,
            organizationId: "org-acme",
            decision: "approve",
          }),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await auth.decide(
          post("/decide", {
            userCode: started.userCode,
            organizationId: "org-acme",
            decision: "approve",
            purpose: "host_enrollment",
          }),
        )
      ).status,
      200,
    );
    const result = z
      .object({
        status: z.literal("enrollment_authorized"),
        token: z.string(),
        credential: z.undefined().optional(),
      })
      .parse(
        await (
          await auth.poll(
            post("/poll", { deviceCode: started.deviceCode, purpose: "host_enrollment" }),
          )
        ).json(),
      );
    const input = {
      daemonId: randomUUID(),
      idempotencyKey: randomUUID(),
      tokenVerifier: createHash("sha256").update(result.token).digest("base64url"),
      serverId: "host",
      daemonPublicKey: "key",
      permissions: ["daemon.read"],
      credentialVerifier: "daemon-secret",
      now: new Date(),
    };
    assert.equal(await database.enrollDaemon({ ...input, serverId: "other-host" }), undefined);
    assert.equal(
      await database.enrollDaemon({ ...input, permissions: ["daemon.manage"] }),
      undefined,
    );
    const enrolled = await database.enrollDaemon(input);
    assert.ok(enrolled);
    assert.deepEqual(await database.enrollDaemon(input), enrolled);
    assert.equal(await database.enrollDaemon({ ...input, credentialVerifier: "other" }), undefined);
    assert.equal(
      await database.enrollDaemon({
        ...input,
        daemonId: randomUUID(),
        idempotencyKey: randomUUID(),
      }),
      undefined,
    );
  });
});
