import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { z } from "zod";
import { createTestCredentialCipher } from "../credentials/test-utils.js";
import { createDatabase } from "../db/pg.js";
import { embeddedDatabaseRuntime } from "../db/runtime/index.js";
import { composeEntitlements } from "./entitlements.js";
import { accountStateSchema } from "./organization-contract.js";
import { createAuthServer } from "./server.js";

const ORIGIN = "http://embedded.test";

it("adds an invited Member to the selected Team atomically on PGlite", async () => {
  const root = await mkdtemp(join(tmpdir(), "hub-team-invitation-"));
  const { runtime, locks } = await embeddedDatabaseRuntime(join(root, "database"));
  await runtime.migrate();
  const database = createDatabase(runtime, locks, createTestCredentialCipher());
  const entitlements = composeEntitlements(database, runtime);
  const auth = createAuthServer({
    database: runtime,
    locks,
    entitlements: entitlements.service,
    secret: "embedded-team-invitation-secret".padEnd(32, "-"),
    baseURL: ORIGIN,
    policy: {
      registrationMode: "open",
      organizationCreation: "open",
      bootstrap: undefined,
    },
  });

  try {
    await auth.initialize?.();
    const ownerCookie = await claimOwner(auth);
    await post(auth, "/api/auth/paseo/complete-app-setup", ownerCookie, {});
    const ownerState = await state(auth, ownerCookie);
    assert.equal(ownerState.status, "active");
    if (ownerState.status !== "active") throw new Error("owner account is not active");

    const teamId = randomUUID();
    await runtime.query(
      `insert into team (id, organization_id, name, created_at, updated_at)
       values ($1, $2, $3, now(), now())`,
      [teamId, ownerState.organization.id, "Engineering"],
    );

    const missingTeam = await post(auth, "/api/auth/paseo/create-invitation", ownerCookie, {
      email: "missing@example.test",
      role: "member",
      teamId: randomUUID(),
    });
    assert.equal(missingTeam.status, 404);
    assert.equal(
      (
        await runtime.query(
          `select count(*)::int as count from invitation where email = $1 and status = 'pending'`,
          ["missing@example.test"],
        )
      ).rows[0]?.["count"],
      0,
    );

    const invitation = await post(auth, "/api/auth/paseo/create-invitation", ownerCookie, {
      email: "member@example.test",
      role: "member",
      teamId,
    });
    assert.equal(invitation.status, 201);
    const invitationBody = z
      .object({
        id: z.string(),
        team: z.object({ id: z.string(), name: z.string() }),
      })
      .parse(await invitation.json());
    assert.deepEqual(invitationBody.team, { id: teamId, name: "Engineering" });

    const memberCookie = await signUp(auth, {
      name: "Member",
      email: "member@example.test",
      password: "member-password-long-enough",
    });
    const accepted = await post(auth, "/api/auth/paseo/accept-invitation", memberCookie, {
      invitationId: invitationBody.id,
    });
    assert.equal(accepted.status, 200);

    const membership = await runtime.query<{ team_id: string; user_email: string }>(
      `select "teamMember".team_id, "user".email as user_email
       from "teamMember"
       join "user" on "user".id = "teamMember".user_id
       where "teamMember".team_id = $1`,
      [teamId],
    );
    assert.deepEqual(membership.rows, [{ team_id: teamId, user_email: "member@example.test" }]);
  } finally {
    await auth.close();
    await entitlements.close();
    await database.close();
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);

async function claimOwner(auth: ReturnType<typeof createAuthServer>): Promise<string> {
  const response = await auth.handle(
    new Request(`${ORIGIN}/api/auth/paseo/claim-instance`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({
        email: "owner@example.test",
        password: "owner-password-long-enough",
      }),
    }),
  );
  assert.equal(response.status, 200);
  return requireCookie(response);
}

async function signUp(
  auth: ReturnType<typeof createAuthServer>,
  input: { name: string; email: string; password: string },
): Promise<string> {
  const response = await auth.handle(
    new Request(`${ORIGIN}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
  assert.equal(response.status, 200);
  return requireCookie(response);
}

function post(
  auth: ReturnType<typeof createAuthServer>,
  path: string,
  cookie: string,
  body: unknown,
): Promise<Response> {
  return auth.handle(
    new Request(`${ORIGIN}${path}`, {
      method: "POST",
      headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function state(auth: ReturnType<typeof createAuthServer>, cookie: string) {
  const response = await auth.handle(
    new Request(`${ORIGIN}/api/auth/paseo/state`, { headers: { cookie } }),
  );
  assert.equal(response.status, 200);
  return accountStateSchema.parse(await response.json());
}

function requireCookie(response: Response): string {
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie !== undefined);
  return cookie;
}
