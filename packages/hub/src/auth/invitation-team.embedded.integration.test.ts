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
const managerInvitationBody = z.object({
  id: z.string(),
  role: z.string(),
  expiresAt: z.string(),
  teams: z.array(z.object({ id: z.string(), name: z.string() })),
  team: z.object({ id: z.string(), name: z.string() }).optional(),
});

it("preserves setup-pending Account context and adds an invited Member to its Teams atomically", async () => {
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
    const ownerState = await state(auth, ownerCookie);
    assert.equal(ownerState.status, "appSetupRequired");
    if (ownerState.status !== "appSetupRequired") throw new Error("owner setup state is missing");
    assert.equal(ownerState.team?.members.length, 1);
    assert.equal(ownerState.team?.members[0]?.role, "owner");
    assert.equal(ownerState.canCreateOrganization, true);

    const organizationId = ownerState.organization.id;
    const teamId = await insertTeam(runtime, organizationId, "Engineering");
    const designTeamId = await insertTeam(runtime, organizationId, "design");
    const supportTeamId = await insertTeam(runtime, organizationId, "Support");

    const missingTeam = await post(auth, "/api/auth/paseo/create-invitation", ownerCookie, {
      email: "missing@example.test",
      role: "member",
      teamIds: [teamId, randomUUID()],
    });
    assert.equal(missingTeam.status, 404);
    assert.deepEqual(await missingTeam.json(), { error: "team_unavailable" });
    assert.equal(await pendingInvitationCount(runtime, "missing@example.test"), 0);
    assert.equal(
      (await runtime.query(`select count(*)::int as count from invitation_teams`)).rows[0]?.[
        "count"
      ],
      0,
    );

    const invitation = await post(auth, "/api/auth/paseo/create-invitation", ownerCookie, {
      email: "member@example.test",
      role: "member",
      teamIds: [teamId, designTeamId, teamId],
    });
    assert.equal(invitation.status, 201);
    const invitationBody = managerInvitationBody.parse(await invitation.json());
    const design = { id: designTeamId, name: "design" };
    const engineering = { id: teamId, name: "Engineering" };
    const support = { id: supportTeamId, name: "Support" };
    assert.deepEqual(invitationBody.teams, [design, engineering]);
    assert.deepEqual(invitationBody.team, design);

    // Re-inviting a pending invitee replaces the role and the Team set and renews the expiry.
    await runtime.query(
      `update invitation set expires_at = now() + interval '1 hour' where id = $1`,
      [invitationBody.id],
    );
    const reinvite = await post(auth, "/api/auth/paseo/create-invitation", ownerCookie, {
      email: "member@example.test",
      role: "admin",
      teamIds: [designTeamId],
    });
    assert.equal(reinvite.status, 201);
    const reinviteBody = managerInvitationBody.parse(await reinvite.json());
    assert.equal(reinviteBody.id, invitationBody.id);
    assert.equal(reinviteBody.role, "admin");
    assert.deepEqual(reinviteBody.teams, [design]);
    assert.ok(Date.parse(reinviteBody.expiresAt) > Date.now() + 47 * 60 * 60 * 1000);

    // COMPAT(invitationTeamId): the single-Team body merges into the Team set.
    const legacy = await post(auth, "/api/auth/paseo/create-invitation", ownerCookie, {
      email: "member@example.test",
      role: "member",
      teamId,
      teamIds: [supportTeamId, teamId],
    });
    assert.equal(legacy.status, 201);
    assert.deepEqual(managerInvitationBody.parse(await legacy.json()).teams, [
      engineering,
      support,
    ]);

    // Deleting a Team only removes it from the pending invitation.
    await runtime.query(`delete from team where id = $1`, [supportTeamId]);
    const pendingState = await state(auth, ownerCookie);
    assert.equal(pendingState.status, "appSetupRequired");
    if (pendingState.status !== "appSetupRequired")
      throw new Error("setup was unexpectedly completed");
    const pendingInvitation = pendingState.team?.invitations?.[0];
    assert.equal(pendingInvitation?.id, invitationBody.id);
    assert.deepEqual(pendingInvitation?.teams, [engineering]);
    assert.deepEqual(pendingInvitation?.team, engineering);

    await runtime.query(`insert into invitation_teams (invitation_id, team_id) values ($1, $2)`, [
      invitationBody.id,
      designTeamId,
    ]);
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
       where "user".email = $1
       order by "teamMember".team_id`,
      ["member@example.test"],
    );
    assert.deepEqual(
      membership.rows,
      [teamId, designTeamId]
        .sort()
        .map((id) => ({ team_id: id, user_email: "member@example.test" })),
    );

    // An incomplete optional setup must not hide an invitation to another organization.
    const otherOrganization = await post(
      auth,
      "/api/auth/paseo/create-organization",
      memberCookie,
      {
        name: "Another organization",
      },
    );
    assert.equal(otherOrganization.status, 201);
    const incomingInvitation = await post(auth, "/api/auth/paseo/create-invitation", memberCookie, {
      email: "owner@example.test",
      role: "member",
    });
    assert.equal(incomingInvitation.status, 201);
    const incoming = z.object({ id: z.string() }).parse(await incomingInvitation.json());
    const invitedOwner = await state(auth, ownerCookie, incoming.id);
    assert.equal(invitedOwner.status, "appSetupRequired");
    if (invitedOwner.status !== "appSetupRequired")
      throw new Error("setup was unexpectedly completed");
    assert.equal(invitedOwner.invitation?.id, incoming.id);
    assert.equal(invitedOwner.invitation?.organization.name, "Another organization");
    assert.equal(invitedOwner.membership.role, "owner");
    const unavailable = await state(auth, ownerCookie, "missing-invitation");
    assert.equal("invitationUnavailable" in unavailable && unavailable.invitationUnavailable, true);
    assert.equal(
      (await runtime.query(`select app_onboarding_completed_at from instance_bootstrap`)).rows[0]?.[
        "app_onboarding_completed_at"
      ],
      null,
    );
  } finally {
    await auth.close();
    await entitlements.close();
    await database.close();
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);

async function insertTeam(
  runtime: Awaited<ReturnType<typeof embeddedDatabaseRuntime>>["runtime"],
  organizationId: string,
  name: string,
): Promise<string> {
  const id = randomUUID();
  await runtime.query(
    `insert into team (id, organization_id, name, created_at, updated_at)
     values ($1, $2, $3, now(), now())`,
    [id, organizationId, name],
  );
  return id;
}

async function pendingInvitationCount(
  runtime: Awaited<ReturnType<typeof embeddedDatabaseRuntime>>["runtime"],
  email: string,
): Promise<unknown> {
  const result = await runtime.query(
    `select count(*)::int as count from invitation where email = $1 and status = 'pending'`,
    [email],
  );
  return result.rows[0]?.["count"];
}

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

async function state(
  auth: ReturnType<typeof createAuthServer>,
  cookie: string,
  invitationId?: string,
) {
  const url = new URL("/api/auth/paseo/state", ORIGIN);
  if (invitationId !== undefined) url.searchParams.set("invitation", invitationId);
  const response = await auth.handle(new Request(url, { headers: { cookie } }));
  assert.equal(response.status, 200);
  return accountStateSchema.parse(await response.json());
}

function requireCookie(response: Response): string {
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie !== undefined);
  return cookie;
}
