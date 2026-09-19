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
type Runtime = Awaited<ReturnType<typeof embeddedDatabaseRuntime>>["runtime"];
type Auth = ReturnType<typeof createAuthServer>;

it("lets a Team Admin invite Members into their own Teams only", async () => {
  const root = await mkdtemp(join(tmpdir(), "hub-team-admin-invitation-"));
  const { runtime, locks } = await embeddedDatabaseRuntime(join(root, "database"));
  await runtime.migrate();
  const database = createDatabase(runtime, locks, createTestCredentialCipher());
  const entitlements = composeEntitlements(database, runtime);
  const auth = createAuthServer({
    database: runtime,
    locks,
    entitlements: entitlements.service,
    secret: "embedded-team-admin-invitation".padEnd(32, "-"),
    baseURL: ORIGIN,
    policy: { registrationMode: "open", organizationCreation: "open", bootstrap: undefined },
  });
  try {
    await auth.initialize?.();
    const ownerCookie = await claimOwner(auth);
    const ownerState = await state(auth, ownerCookie);
    if (ownerState.status !== "appSetupRequired") throw new Error("owner setup state is missing");
    const organizationId = ownerState.organization.id;
    const qcTeam = await insertTeam(runtime, organizationId, "QC");
    const designTeam = await insertTeam(runtime, organizationId, "Design");

    const leadCookie = await joinAsMember(auth, ownerCookie, "lead@example.test");
    const invite = (body: unknown) =>
      post(auth, "/api/auth/paseo/create-invitation", leadCookie, body);
    // An ordinary Member invites nobody.
    assert.equal(
      (await invite({ email: "a@example.test", role: "member", teamIds: [qcTeam] })).status,
      403,
    );

    await appointTeamAdmin(runtime, organizationId, "lead@example.test", qcTeam);
    const accepted = await invite({ email: "a@example.test", role: "member", teamIds: [qcTeam] });
    assert.equal(accepted.status, 201);
    assert.deepEqual(
      z.object({ teams: z.array(z.object({ id: z.string() })) }).parse(await accepted.json()).teams,
      [{ id: qcTeam }],
    );
    // Not into a Team they do not administer, not without a Team, and never as admin.
    assert.equal(
      (await invite({ email: "b@example.test", role: "member", teamIds: [qcTeam, designTeam] }))
        .status,
      403,
    );
    assert.equal((await invite({ email: "c@example.test", role: "member" })).status, 403);
    assert.equal(
      (await invite({ email: "d@example.test", role: "admin", teamIds: [qcTeam] })).status,
      403,
    );
    assert.equal(await pendingInvitationCount(runtime), 1);
  } finally {
    await auth.close();
    await entitlements.close();
    await database.close();
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);

/** The owner invites, the invitee signs up and accepts; returns the new Member's cookie. */
async function joinAsMember(auth: Auth, ownerCookie: string, email: string): Promise<string> {
  const invited = await post(auth, "/api/auth/paseo/create-invitation", ownerCookie, {
    email,
    role: "member",
  });
  assert.equal(invited.status, 201);
  const { id } = z.object({ id: z.string() }).parse(await invited.json());
  const cookie = await signUp(auth, {
    name: email,
    email,
    password: "member-password-long-enough",
  });
  const accepted = await post(auth, "/api/auth/paseo/accept-invitation", cookie, {
    invitationId: id,
  });
  assert.equal(accepted.status, 200);
  return cookie;
}

async function appointTeamAdmin(
  runtime: Runtime,
  organizationId: string,
  email: string,
  teamId: string,
): Promise<void> {
  const member = await runtime.query<{ id: string }>(
    `select member.id from member join "user" on "user".id = member.user_id
     where member.organization_id = $1 and "user".email = $2`,
    [organizationId, email],
  );
  await runtime.query(
    `insert into access_assignments
       (organization_id, subject_kind, subject_id, resource_kind, resource_id, privileges, constraints)
     values ($1, 'member', $2, 'team', $3, '["hub.access.manage"]'::jsonb, '{}'::jsonb)`,
    [organizationId, member.rows[0]!.id, teamId],
  );
}

async function insertTeam(runtime: Runtime, organizationId: string, name: string): Promise<string> {
  const id = randomUUID();
  await runtime.query(
    `insert into team (id, organization_id, name, created_at, updated_at)
     values ($1, $2, $3, now(), now())`,
    [id, organizationId, name],
  );
  return id;
}

async function pendingInvitationCount(runtime: Runtime): Promise<unknown> {
  const result = await runtime.query(
    `select count(*)::int as count from invitation where status = 'pending'`,
  );
  return result.rows[0]?.["count"];
}

async function claimOwner(auth: Auth): Promise<string> {
  const response = await auth.handle(
    new Request(`${ORIGIN}/api/auth/paseo/claim-instance`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ email: "owner@example.test", password: "owner-password-long-enough" }),
    }),
  );
  assert.equal(response.status, 200);
  return requireCookie(response);
}

async function signUp(
  auth: Auth,
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

function post(auth: Auth, path: string, cookie: string, body: unknown): Promise<Response> {
  return auth.handle(
    new Request(`${ORIGIN}${path}`, {
      method: "POST",
      headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function state(auth: Auth, cookie: string) {
  const response = await auth.handle(
    new Request(new URL("/api/auth/paseo/state", ORIGIN), { headers: { cookie } }),
  );
  assert.equal(response.status, 200);
  return accountStateSchema.parse(await response.json());
}

function requireCookie(response: Response): string {
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie !== undefined);
  return cookie;
}
