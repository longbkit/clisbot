import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterEach, beforeEach, describe, it } from "vitest";
import type { DatabaseRuntime, QueryHandle } from "../db/runtime/index.js";
import { createPostgresQueryRuntime } from "../db/test-utils/runtime.js";
import { createDatabase, createPostgresPool } from "../db/test-utils/runtime.js";
import type { Database } from "../db/types.js";
import type { AuthServer } from "../auth/server.js";
import type { OrganizationAccessValue } from "../auth/organization-access.js";
import { ProductRequestError } from "../auth/organization-access.js";
import type { DiscordConnectionClient, DiscordGuildIdentity } from "../providers/discord/client.js";
import type {
  GitHubConnectionClient,
  GitHubInstallationIdentity,
} from "../providers/github/client.js";
import { createGitHubRegistration } from "../providers/github/index.js";
import { createDiscordRegistration } from "../providers/discord/index.js";
import type { ProviderRegistration } from "../providers/registration.js";
import { MemoryDiscordBotClient } from "../triggers/discord/memory-bot.js";

const TEST_WEBHOOK_SECRET = "provider-registration-test-secret";
interface ProviderFixture {
  database: Database;
  registrations: readonly ProviderRegistration[];
  organizationSlug: string;
  discordBot?: MemoryDiscordBotClient;
}

describe("provider connection facades PostgreSQL authority", () => {
  let postgres: StartedPostgreSqlContainer;
  let pool: DatabaseRuntime;
  let database: Database;
  let auth: ConnectionAuth;
  let github: TestGitHub;
  let discord: TestDiscord;
  let connections: ProviderFixture;

  beforeEach(async () => {
    postgres = await new PostgreSqlContainer("postgres:17-alpine").start();
    database = await createDatabase(postgres.getConnectionUri());
    pool = await createPostgresPool(postgres.getConnectionUri());
    await seedAccount(pool, "acme", "owner");
    await pool.query(
      `insert into runtime_provider_activation
         (provider, provider_application_id, configuration_version)
       values ('github', '42', 0), ('discord', '900', 0)`,
    );
    auth = new ConnectionAuth(accessFor("acme", "owner"));
    github = new TestGitHub();
    discord = new TestDiscord();
    connections = createConnections({
      database,
      auth,
      github,
      discord,
    });
  }, 120_000);

  afterEach(async () => {
    await pool?.close();
    await database?.close();
    await postgres?.stop();
  }, 120_000);

  it("binds verified providers once and disconnects only the active organization", async () => {
    const githubStart = await start(connections, "github");
    assert.equal(githubStart.state.includes("acme"), false);
    const userState = await completeSetup(connections, githubStart.state, 42);
    const [connected, replay] = await Promise.all([
      githubCallback(connections, userState, "github-code"),
      githubCallback(connections, userState, "github-code"),
    ]);
    const callbackResults = [result(connected), result(replay)];
    assert(callbackResults.every((value): value is string => value !== null));
    assert.deepEqual(
      callbackResults.sort((left, right) => left.localeCompare(right)),
      ["connection_invalid", "github_connected"],
    );

    const discordStart = await start(connections, "discord");
    assert.equal(
      result(await discordCallback(connections, discordStart.state, "discord-code")),
      "discord_connected",
    );
    assert.deepEqual(await resolutions(connections), {
      github: { status: "active", organizationId: "acme" },
      discord: { status: "active", organizationId: "acme" },
    });

    const project = await database.createProject({
      organizationId: "acme",
      name: "Sync attempt project",
      slug: "sync-attempt-project",
      createdByUserId: "user-acme",
    });
    const githubConnection = await database.findGitHubConnection(42);
    assert(githubConnection !== undefined);
    await database.recordConfigurationSyncAttempt({
      projectId: project.id,
      githubConnectionId: githubConnection.id,
      githubRepositoryId: 9001,
      webhookDeliveryId: "delivery-sync-attempt",
      commitSha: "sha-sync-attempt",
      outcome: "fetch_failed",
      evidence: { kind: "test" },
    });
    assert.equal((await disconnect(connections, "github", "42")).status, 200);
    assert.deepEqual(
      (
        await pool.query<{ organization_id: string; github_connection_id: string | null }>(
          `select organization_id, github_connection_id
           from configuration_sync_attempts
           where webhook_delivery_id = 'delivery-sync-attempt'`,
        )
      ).rows,
      [{ organization_id: "acme", github_connection_id: null }],
    );
    assert.equal((await disconnect(connections, "discord", "9001")).status, 200);
    assert.deepEqual(await resolutions(connections), {
      github: { status: "unbound" },
      discord: { status: "unbound" },
    });
    assert.deepEqual(discord.leftGuilds, ["9001"]);
  });

  it("returns provider-specific cancellation results from the attempt's trusted origin", async () => {
    const githubStart = await start(connections, "github");
    const githubState = await completeSetup(connections, githubStart.state, 42);
    const githubCancelled = await connectionAction(
      connections,
      request(`/api/integrations/github/callback?state=${githubState}&error=access_denied`),
      "github",
      "callback",
    );
    assert.equal(result(githubCancelled), "github_cancelled");

    const discordStart = await start(connections, "discord");
    const discordCancelled = await connectionAction(
      connections,
      request(`/api/integrations/discord/callback?state=${discordStart.state}&error=access_denied`),
      "discord",
      "callback",
    );
    assert.equal(result(discordCancelled), "discord_cancelled");
    assert.deepEqual(await resolutions(connections), {
      github: { status: "unbound" },
      discord: { status: "unbound" },
    });
  });

  it("fails closed for role changes, expiry, active-organization changes, and cross-tenant conflicts", async () => {
    const expired = await start(connections, "github");
    await pool.query(
      `update organization_connection_attempts set expires_at = now() - interval '1 second'`,
    );
    assert.equal(result(await setupCallback(connections, expired.state, 42)), "connection_invalid");

    const downgraded = await start(connections, "github");
    await pool.query(`update member set role = 'member' where organization_id = 'acme'`);
    assert.equal(
      result(await setupCallback(connections, downgraded.state, 42)),
      "connection_invalid",
    );
    assert.equal(
      (await connectionAction(connections, request("/start", "POST"), "discord", "start")).status,
      403,
    );

    await pool.query(`update member set role = 'owner' where organization_id = 'acme'`);
    const acme = await start(connections, "github");
    const acmeUserState = await completeSetup(connections, acme.state, 42);
    assert.equal(
      result(await githubCallback(connections, acmeUserState, "code")),
      "github_connected",
    );

    await seedAccount(pool, "orbit", "owner");
    auth.access = accessFor("orbit", "owner");
    connections.organizationSlug = "orbit";
    github.identity = { ...github.identity!, installationId: 42 };
    const orbit = await start(connections, "github");
    const orbitUserState = await completeSetup(connections, orbit.state, 42);
    assert.equal(
      result(await githubCallback(connections, orbitUserState, "code")),
      "connection_conflict",
    );
    assert.deepEqual(await resolution(connections, "github", "42"), {
      status: "active",
      organizationId: "acme",
    });
  });

  it("revalidates session, membership, and role after provider verification", async () => {
    assert.equal(
      await rejectGitHubCallbackAfter(database, pool, "signed-out", async () => {
        await pool.query(`delete from session where id = 'session-signed-out'`);
      }),
      "connection_invalid",
    );
    assert.equal(
      await rejectGitHubCallbackAfter(database, pool, "expired-session", async () => {
        await pool.query(
          `update session set expires_at = now() - interval '1 second' where id = 'session-expired-session'`,
        );
      }),
      "connection_invalid",
    );
    assert.equal(
      await rejectGitHubCallbackAfter(database, pool, "role-downgrade", async () => {
        await pool.query(`update member set role = 'member' where id = 'member-role-downgrade'`);
      }),
      "connection_invalid",
    );
    assert.equal(
      await rejectGitHubCallbackAfter(database, pool, "membership-delete", async () => {
        await pool.query(`delete from member where id = 'member-membership-delete'`);
      }),
      "connection_invalid",
    );

    const connectionsCount = await pool.query<{ count: number }>(
      `select count(*)::integer as count from github_connections`,
    );
    assert.equal(connectionsCount.rows[0]?.count, 0);
  });

  it("rejects setup callbacks whose fixed attempt or session expiry passes while the row is locked", async () => {
    const attemptSetup = await start(connections, "github");
    const attemptId = await attemptIdForState(pool, attemptSetup.state);

    assert.equal(
      await rejectCallbackAfterExpiryWhileLocked(
        postgres.getConnectionUri(),
        {
          text: `update organization_connection_attempts
                 set expires_at = clock_timestamp() + interval '1 second'
                 where id = $1
                 returning expires_at`,
          values: [attemptId],
        },
        {
          text: `select id from organization_connection_attempts where id = $1 for update`,
          values: [attemptId],
        },
        () => setupCallback(connections, attemptSetup.state, 42),
      ),
      "connection_invalid",
    );
    assert.deepEqual(await attemptAuthority(pool, attemptId), {
      phase: "github_setup",
      consumed: false,
      connections: 0,
    });

    const sessionSetup = await start(connections, "github");
    const sessionAttemptId = await attemptIdForState(pool, sessionSetup.state);
    assert.equal(
      await rejectCallbackAfterExpiryWhileLocked(
        postgres.getConnectionUri(),
        {
          text: `update session
                 set expires_at = clock_timestamp() + interval '1 second'
                 where id = $1
                 returning expires_at`,
          values: ["session-acme"],
        },
        {
          text: `select id from session where id = $1 for update`,
          values: ["session-acme"],
        },
        () => setupCallback(connections, sessionSetup.state, 42),
      ),
      "connection_invalid",
    );
    assert.deepEqual(await attemptAuthority(pool, sessionAttemptId), {
      phase: "github_setup",
      consumed: false,
      connections: 0,
    });
  });

  it("stores only hashed state and clears the PKCE secret on terminal consumption", async () => {
    const setup = await start(connections, "github");
    const setupRow = await pool.query<{
      state_verifier: string;
      organization_id: string;
      pkce_verifier: string | null;
    }>(
      `select state_verifier, organization_id, pkce_verifier from organization_connection_attempts`,
    );
    assert.equal(setupRow.rows[0]?.state_verifier, setup.stateHash);
    assert.equal(setupRow.rows[0]?.organization_id, "acme");
    assert.equal(setupRow.rows[0]?.pkce_verifier, null);

    const userState = await completeSetup(connections, setup.state, 42);
    await githubCallback(connections, userState, "one-time-code");
    const terminal = await pool.query<{ consumed_at: Date | null; pkce_verifier: string | null }>(
      `select consumed_at, pkce_verifier from organization_connection_attempts`,
    );
    assert.notEqual(terminal.rows[0]?.consumed_at, null);
    assert.equal(terminal.rows[0]?.pkce_verifier, null);
    const serialized = JSON.stringify(terminal.rows);
    assert.equal(serialized.includes("one-time-code"), false);
    assert.equal(serialized.includes(setup.state), false);
  });

  it("applies only current GitHub lifecycle evidence to the matching binding", async () => {
    const setup = await start(connections, "github");
    const userState = await completeSetup(connections, setup.state, 42);
    await githubCallback(connections, userState, "code");

    github.identity = { ...github.identity!, status: "suspended" };
    await applyGitHubLifecycle(connections, "suspend", 42);
    assert.deepEqual(await resolution(connections, "github", "42"), { status: "suspended" });

    github.identity = { ...github.identity, status: "active" };
    const reconnect = await start(connections, "github");
    const reconnectState = await completeSetup(connections, reconnect.state, 42);
    assert.equal(
      result(await githubCallback(connections, reconnectState, "reconnect-code")),
      "github_connected",
    );
    assert.deepEqual(await resolution(connections, "github", "42"), {
      status: "active",
      organizationId: "acme",
    });

    github.identity = { ...github.identity, status: "suspended" };
    await applyGitHubLifecycle(connections, "suspend-again", 42);
    github.identity = { ...github.identity, status: "active" };
    await applyGitHubLifecycle(connections, "restore", 42);
    assert.deepEqual(await resolution(connections, "github", "42"), {
      status: "active",
      organizationId: "acme",
    });

    github.identity = undefined;
    await applyGitHubLifecycle(connections, "removed", 42);
    assert.deepEqual(await resolution(connections, "github", "42"), { status: "unbound" });
  });

  it("retries failed GitHub lifecycle application and durably ignores applied duplicates", async () => {
    await connectGitHub(connections, 42);
    github.identity = { ...github.identity!, status: "suspended" };
    github.failInstallationReads = 1;

    await assert.rejects(applyGitHubLifecycle(connections, "lifecycle-retry", 42));
    await applyGitHubLifecycle(connections, "lifecycle-retry", 42);
    await applyGitHubLifecycle(connections, "lifecycle-retry", 42);

    assert.equal(github.installationReads, 2);
    assert.deepEqual(await resolution(connections, "github", "42"), { status: "suspended" });
    const ledger = await pool.query<{ count: number }>(
      `select count(*)::integer as count from provider_event_receipts where delivery_id = 'lifecycle-retry'`,
    );
    assert.equal(ledger.rows[0]?.count, 1);
  });

  it("ignores transient Discord unavailability and deletes only after membership is absent", async () => {
    const startResult = await start(connections, "discord");
    await discordCallback(connections, startResult.state, "code");
    await applyDiscordRemoval(connections, "9001", true);
    assert.deepEqual(await resolution(connections, "discord", "9001"), {
      status: "active",
      organizationId: "acme",
    });
    discord.membership = "unknown";
    await applyDiscordRemoval(connections, "9001", false);
    assert.deepEqual(await resolution(connections, "discord", "9001"), {
      status: "active",
      organizationId: "acme",
    });
    discord.membership = "absent";
    await applyDiscordRemoval(connections, "9001", false);
    assert.deepEqual(await resolution(connections, "discord", "9001"), { status: "unbound" });
  });

  it("serializes cross-tenant binding races after exact lookup", async () => {
    await seedAccount(pool, "orbit", "owner");
    const orbitGitHub = new TestGitHub();
    orbitGitHub.identity = { ...orbitGitHub.identity!, installationId: 42 };
    const orbitConnections = createConnections({
      database,
      auth: new ConnectionAuth(accessFor("orbit", "owner")),
      organizationSlug: "orbit",
      github: orbitGitHub,
      discord: new TestDiscord(),
    });
    const acmeSetup = await start(connections, "github");
    const orbitSetup = await start(orbitConnections, "github");
    const acmeAuthorization = await completeSetup(connections, acmeSetup.state, 42);
    const orbitAuthorization = await completeSetup(orbitConnections, orbitSetup.state, 42);
    const outcomes = await Promise.all([
      githubCallback(connections, acmeAuthorization, "acme-code"),
      githubCallback(orbitConnections, orbitAuthorization, "orbit-code"),
    ]);
    assert.deepEqual(
      outcomes.map(result).sort((left, right) => String(left).localeCompare(String(right))),
      ["connection_conflict", "github_connected"],
    );
    assert.equal(
      (
        await pool.query<{ count: number }>(
          `select count(*)::integer as count from github_connections where installation_id = 42`,
        )
      ).rows[0]?.count,
      1,
    );

    await pool.query(`delete from github_connections`);
    github.identity = { ...github.identity!, installationId: 42 };
    orbitGitHub.identity = { ...orbitGitHub.identity, installationId: 84 };
    await connectGitHub(connections, 42);
    await connectGitHub(orbitConnections, 84);
    discord.identity = { guildId: "9001", guildName: "Acme builders" };
    const orbitDiscord = new TestDiscord();
    orbitDiscord.identity = { guildId: "9002", guildName: "Orbit builders" };
    const orbitDiscordConnections = createConnections({
      database,
      auth: new ConnectionAuth(accessFor("orbit", "owner")),
      organizationSlug: "orbit",
      github: orbitGitHub,
      discord: orbitDiscord,
    });
    await connectDiscord(connections);
    await connectDiscord(orbitDiscordConnections);

    assert.deepEqual(await resolution(orbitConnections, "github", "84"), {
      status: "active",
      organizationId: "orbit",
    });
    assert.deepEqual(await resolution(orbitDiscordConnections, "discord", "9002"), {
      status: "active",
      organizationId: "orbit",
    });
  });

  it("distinguishes identity denial from retryable action authority failure", async () => {
    const admin = connectionsWithAuth(database, new ConnectionAuth(accessFor("acme", "admin")));
    const member = connectionsWithAuth(database, new ConnectionAuth(accessFor("acme", "member")));
    const denied = connectionsWithAuth(
      database,
      new FailingConnectionAuth(new ProductRequestError(403, "organization_required")),
    );
    const unavailable = connectionsWithAuth(
      database,
      new FailingConnectionAuth(new Error("storage unavailable")),
    );

    await pool.query(`update member set role = 'admin' where organization_id = 'acme'`);
    const adminStart = await connectionAction(admin, request("/start", "POST"), "github", "start");
    await pool.query(`update member set role = 'member' where organization_id = 'acme'`);
    const memberStart = await connectionAction(
      member,
      request("/start", "POST"),
      "github",
      "start",
    );
    assert.deepEqual(
      {
        adminStart: adminStart.status,
        memberStart: memberStart.status,
        start: (await connectionAction(denied, request("/start", "POST"), "github", "start"))
          .status,
      },
      {
        adminStart: 200,
        memberStart: 403,
        start: 403,
      },
    );
    assert.deepEqual(
      {
        start: (await connectionAction(unavailable, request("/start", "POST"), "github", "start"))
          .status,
      },
      { start: 503 },
    );
  });
});

class ConnectionAuth implements AuthServer {
  constructor(public access: OrganizationAccessValue) {}
  handle(): Promise<Response> {
    return Promise.resolve(new Response("Not Found", { status: 404 }));
  }
  resources(): Promise<never> {
    return Promise.reject(new Error("unused"));
  }
  resolveOrganizationAccess(): Promise<OrganizationAccessValue> {
    return Promise.resolve(this.access);
  }
  async resolveAccount() {
    const access = await this.resolveOrganizationAccess();
    return {
      session: { id: access.session.id, activeOrganizationId: null },
      account: access.account,
      isInstanceOperator: false,
    };
  }
  rejectCookieMutation(): Response | undefined {
    return undefined;
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

class FailingConnectionAuth implements AuthServer {
  constructor(private readonly failure: Error) {}
  handle(): Promise<Response> {
    return Promise.resolve(new Response("Not Found", { status: 404 }));
  }
  resources(): Promise<never> {
    return Promise.reject(new Error("unused"));
  }
  resolveOrganizationAccess(): Promise<never> {
    return Promise.reject(this.failure);
  }
  resolveAccount(): Promise<never> {
    return Promise.reject(this.failure);
  }
  rejectCookieMutation(): Response | undefined {
    return undefined;
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

class TestGitHub implements GitHubConnectionClient {
  installationReads = 0;
  failInstallationReads = 0;
  private verificationBarrier: ProviderBarrier | undefined;
  identity: GitHubInstallationIdentity | undefined = {
    installationId: 42,
    accountId: "101",
    accountLogin: "acme-inc",
    accountType: "Organization",
    status: "active",
  };
  setupUrl(state: string): string {
    return `https://github.test/install?state=${state}`;
  }
  authorizationUrl(input: { state: string; challenge: string }): string {
    return `https://github.test/authorize?state=${input.state}&code_challenge=${input.challenge}`;
  }
  async verifyUserInstallation(input: {
    installationId: number;
  }): Promise<GitHubInstallationIdentity | undefined> {
    await this.verificationBarrier?.wait();
    return input.installationId === this.identity?.installationId ? this.identity : undefined;
  }
  holdVerification(): void {
    this.verificationBarrier = new ProviderBarrier();
  }
  verificationBegins(): Promise<void> {
    if (this.verificationBarrier === undefined) throw new Error("verification is not held");
    return this.verificationBarrier.entered;
  }
  releaseVerification(): void {
    if (this.verificationBarrier === undefined) throw new Error("verification is not held");
    this.verificationBarrier.release();
    this.verificationBarrier = undefined;
  }
  getInstallation(installationId: number) {
    this.installationReads += 1;
    if (this.failInstallationReads > 0) {
      this.failInstallationReads -= 1;
      return Promise.reject(new Error("provider unavailable"));
    }
    const identity = installationId === this.identity?.installationId ? this.identity : undefined;
    return Promise.resolve(
      identity === undefined
        ? { status: "absent" as const }
        : { status: "present" as const, identity },
    );
  }
}

class ProviderBarrier {
  private markEntered: () => void = () => undefined;
  private unblock: () => void = () => undefined;
  readonly entered = new Promise<void>((resolve) => {
    this.markEntered = resolve;
  });
  private readonly released = new Promise<void>((resolve) => {
    this.unblock = resolve;
  });

  async wait(): Promise<void> {
    this.markEntered();
    await this.released;
  }

  release(): void {
    this.unblock();
  }
}

class TestDiscord implements DiscordConnectionClient {
  readonly leftGuilds: string[] = [];
  identity: DiscordGuildIdentity = { guildId: "9001", guildName: "Acme builders" };
  membership: "present" | "absent" | "unknown" = "present";
  authorizationUrl(state: string): string {
    return `https://discord.test/authorize?state=${state}`;
  }
  verifyGuild(): Promise<DiscordGuildIdentity | undefined> {
    return Promise.resolve(this.identity);
  }
  async leaveGuild(guildId: string): Promise<void> {
    this.leftGuilds.push(guildId);
  }
  guildMembership() {
    return Promise.resolve(this.membership);
  }
}

function accessFor(
  organizationId: string,
  role: "owner" | "admin" | "member",
): OrganizationAccessValue {
  return {
    session: { id: `session-${organizationId}` },
    account: {
      id: `user-${organizationId}`,
      name: organizationId,
      email: `${organizationId}@example.test`,
    },
    organization: { id: organizationId, name: organizationId },
    membership: { id: `member-${organizationId}`, role },
    capabilities: {
      view: true,
      manageMembers: role !== "member",
      manageOwners: role === "owner",
      manageResources: role !== "member",
    },
  };
}

function connectionsWithAuth(database: Database, auth: AuthServer): ProviderFixture {
  return createConnections({
    database,
    auth,
    github: new TestGitHub(),
  });
}

async function seedAccount(pool: QueryHandle, organizationId: string, role: string): Promise<void> {
  const userId = `user-${organizationId}`;
  await pool.query(`insert into organization (id, name, slug) values ($1,$1,$1)`, [organizationId]);
  await pool.query(`insert into "user" (id, name, email) values ($1,$2,$3)`, [
    userId,
    organizationId,
    `${organizationId}@example.test`,
  ]);
  await pool.query(
    `insert into session (id, token, user_id, active_organization_id, expires_at)
     values ($1,$2,$3,$4,now() + interval '1 hour')`,
    [`session-${organizationId}`, randomUUID(), userId, organizationId],
  );
  await pool.query(`insert into member (id, organization_id, user_id, role) values ($1,$2,$3,$4)`, [
    `member-${organizationId}`,
    organizationId,
    userId,
    role,
  ]);
}

function request(path: string, method = "GET"): Request {
  return new Request(`https://hub.example.test${path}`, { method });
}

async function start(connections: ProviderFixture, provider: "github" | "discord") {
  const response = await connectionAction(
    connections,
    request(`/start/${provider}`, "POST"),
    provider,
    "start",
  );
  assert.equal(response.status, 200);
  const body: unknown = await response.json();
  assert(isUrlBody(body));
  const state = new URL(body.url).searchParams.get("state");
  assert.notEqual(state, null);
  return { state: state!, stateHash: createHashForTest(state!) };
}

function isUrlBody(value: unknown): value is { url: string } {
  return (
    typeof value === "object" && value !== null && typeof Reflect.get(value, "url") === "string"
  );
}

async function completeSetup(connections: ProviderFixture, state: string, installationId: number) {
  const response = await setupCallback(connections, state, installationId);
  assert.equal(response.status, 303);
  const next = new URL(response.headers.get("location")!).searchParams.get("state");
  assert.notEqual(next, null);
  return next!;
}

function setupCallback(connections: ProviderFixture, state: string, installationId: number) {
  return connectionAction(
    connections,
    request(
      `/api/integrations/github/setup?state=${state}&setup_action=install&installation_id=${installationId}`,
    ),
    "github",
    "setup",
  );
}

function githubCallback(connections: ProviderFixture, state: string, code: string) {
  return connectionAction(
    connections,
    request(`/api/integrations/github/callback?state=${state}&code=${code}`),
    "github",
    "callback",
  );
}

function discordCallback(connections: ProviderFixture, state: string, code: string) {
  return connectionAction(
    connections,
    request(`/api/integrations/discord/callback?state=${state}&code=${code}`),
    "discord",
    "callback",
  );
}

async function connectGitHub(connections: ProviderFixture, installationId: number): Promise<void> {
  const setup = await start(connections, "github");
  const authorization = await completeSetup(connections, setup.state, installationId);
  assert.equal(
    result(await githubCallback(connections, authorization, "code")),
    "github_connected",
  );
}

async function connectDiscord(connections: ProviderFixture): Promise<void> {
  const authorization = await start(connections, "discord");
  assert.equal(
    result(await discordCallback(connections, authorization.state, "code")),
    "discord_connected",
  );
}

async function rejectGitHubCallbackAfter(
  database: Database,
  pool: QueryHandle,
  organizationId: string,
  mutateAuthority: () => Promise<void>,
): Promise<string | null> {
  await seedAccount(pool, organizationId, "owner");
  const github = new TestGitHub();
  const connections = createConnections({
    database,
    auth: new ConnectionAuth(accessFor(organizationId, "owner")),
    organizationSlug: organizationId,
    github,
  });
  const setup = await start(connections, "github");
  const authorization = await completeSetup(connections, setup.state, 42);
  github.holdVerification();
  const callback = githubCallback(connections, authorization, "code");
  await github.verificationBegins();
  await mutateAuthority();
  github.releaseVerification();
  return result(await callback);
}

async function rejectCallbackAfterExpiryWhileLocked(
  connectionString: string,
  scheduleExpiry: { text: string; values: unknown[] },
  lockedRow: { text: string; values: unknown[] },
  callback: () => Promise<Response>,
): Promise<string | null> {
  const holder = await createPostgresQueryRuntime(connectionString);

  try {
    let response!: Promise<Response>;
    await holder.transaction(async (transaction) => {
      const scheduled = await transaction.query<{ expires_at: Date }>(
        scheduleExpiry.text,
        scheduleExpiry.values,
      );
      const expiresAt = scheduled.rows[0]?.expires_at;
      assert.notEqual(expiresAt, undefined);
      await transaction.query(lockedRow.text, lockedRow.values);
      response = callback();
      await expectBlockedOnLockedAuthority(holder);
      await transaction.query(
        `select pg_sleep(
         greatest(extract(epoch from ($1::timestamptz - clock_timestamp())), 0) + 0.01
       )`,
        [expiresAt],
      );
      const expired = await transaction.query<{ expired: boolean }>(
        `select $1::timestamptz <= clock_timestamp() as expired`,
        [expiresAt],
      );
      assert.equal(expired.rows[0]?.expired, true);
    });
    return result(await response);
  } finally {
    await holder.close();
  }
}

async function attemptAuthority(pool: QueryHandle, attemptId: string) {
  const authority = await pool.query<{
    phase: string;
    consumed: boolean;
    connections: number;
  }>(
    `select phase, consumed_at is not null as consumed,
       (select count(*)::integer from github_connections) as connections
     from organization_connection_attempts
     where id = $1`,
    [attemptId],
  );
  return authority.rows[0];
}

async function expectBlockedOnLockedAuthority(client: DatabaseRuntime): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const waiting = await client.query<{ count: number }>(
      `select count(*)::integer as count
       from pg_stat_activity
       where datname = current_database()
         and pid <> pg_backend_pid()
         and wait_event_type = 'Lock'`,
    );
    if (waiting.rows[0]?.count === 1) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("connection callback did not block on the locked authority row");
}

async function attemptIdForState(pool: QueryHandle, state: string): Promise<string> {
  const attempt = await pool.query<{ id: string }>(
    `select id from organization_connection_attempts where state_verifier = $1`,
    [createHashForTest(state)],
  );
  const id = attempt.rows[0]?.id;
  assert.notEqual(id, undefined);
  return id!;
}

async function applyGitHubLifecycle(
  connections: ProviderFixture,
  deliveryId: string,
  installationId: number,
): Promise<void> {
  const body = JSON.stringify({
    action: "suspend",
    test_delivery: deliveryId,
    installation: {
      id: installationId,
      account: { id: 101, login: "acme-inc", type: "Organization" },
    },
  });
  const signature = `sha256=${createHmac("sha256", TEST_WEBHOOK_SECRET).update(body).digest("hex")}`;
  const registration = connections.registrations.find(
    (candidate) => candidate.connection.name === "github",
  );
  const webhook = registration?.requests.find((candidate) => candidate.name === "webhook");
  assert(webhook !== undefined);
  const response = await webhook.handle(
    new Request("https://hub.example.test/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-delivery": deliveryId,
        "x-github-event": "installation",
        "x-hub-signature-256": signature,
      },
      body,
    }),
  );
  assert.equal(response.status, 200);
}

function result(response: Response): string | null {
  return new URL(response.headers.get("location")!).searchParams.get("result");
}

async function resolutions(connections: ProviderFixture) {
  return {
    github: await resolution(connections, "github", "42"),
    discord: await resolution(connections, "discord", "9001"),
  };
}

async function disconnect(
  connections: ProviderFixture,
  provider: "github" | "discord",
  externalId: string,
): Promise<Response> {
  const connection =
    provider === "github"
      ? await connections.database.findGitHubConnection(Number(externalId))
      : await connections.database.findDiscordConnection(externalId);
  assert(connection !== undefined);
  return connectionAction(
    connections,
    request(`/disconnect?connectionId=${connection.id}`, "POST"),
    provider,
    "disconnect",
  );
}

async function resolution(
  connections: ProviderFixture,
  provider: "github" | "discord",
  externalId: string,
) {
  const fixture = connections;
  const github =
    provider === "github"
      ? await fixture.database.findGitHubConnection(Number(externalId))
      : undefined;
  const discord =
    provider === "discord" ? await fixture.database.findDiscordConnection(externalId) : undefined;
  const connection = fixture.registrations.find(
    (registration) => registration.connection.name === provider,
  )?.connection;
  assert(connection !== undefined);
  const status = connection.status({
    github: github === undefined ? [] : [github],
    discord: discord === undefined ? [] : [discord],
    slack: [],
    linear: [],
  });
  assert(status !== null && typeof status === "object" && "status" in status);
  if (status.status === "suspended") return { status: "suspended" as const };
  const binding = provider === "github" ? github : discord;
  return binding === undefined
    ? { status: "unbound" as const }
    : { status: "active" as const, organizationId: binding.organizationId };
}

async function applyDiscordRemoval(
  connections: ProviderFixture,
  guildId: string,
  unavailable: boolean,
): Promise<void> {
  const fixture = connections;
  const registration = fixture.registrations.find(
    (candidate) => candidate.connection.name === "discord",
  );
  assert(registration !== undefined && fixture.discordBot !== undefined);
  await registration.sources[0]!.start(async () => undefined);
  await fixture.discordBot.emitGuildDelete({ id: guildId, unavailable });
  await registration.sources[0]!.stop();
}

interface CreateConnectionsOptions {
  database: Database;
  auth: AuthServer;
  organizationSlug?: string;
  github?: GitHubConnectionClient;
  discord?: DiscordConnectionClient;
}

function createConnections(options: CreateConnectionsOptions): ProviderFixture {
  const registrations: ProviderRegistration[] = [];
  let discordBot: MemoryDiscordBotClient | undefined;
  if (options.github !== undefined) {
    registrations.push(
      createGitHubRegistration({
        database: options.database,
        auth: options.auth,
        applicationBaseUrl: "https://hub.example.test",
        publicBaseUrl: "https://hub.example.test",
        configuration: {
          appId: "42",
          appSlug: "paseo",
          clientId: "client",
          clientSecret: "secret",
          webhookSecret: TEST_WEBHOOK_SECRET,
          privateKey: "test-private-key",
        },
        connectionClient: options.github,
      }),
    );
  }
  if (options.discord !== undefined) {
    discordBot = new MemoryDiscordBotClient({ selfUserId: "900" });
    registrations.push(
      createDiscordRegistration({
        database: options.database,
        auth: options.auth,
        applicationBaseUrl: "https://hub.example.test",
        publicBaseUrl: "https://hub.example.test",
        configuration: {
          botToken: "token",
          clientId: "900",
          clientSecret: "secret",
        },
        bot: discordBot,
        connectionClient: options.discord,
      }),
    );
  }
  return {
    database: options.database,
    registrations,
    organizationSlug: options.organizationSlug ?? "acme",
    ...(discordBot === undefined ? {} : { discordBot }),
  };
}

function connectionAction(
  fixture: ProviderFixture,
  incoming: Request,
  provider: string,
  action: string,
): Promise<Response> {
  if (action === "start" || action === "disconnect") {
    const url = new URL(incoming.url);
    url.searchParams.set("organizationSlug", fixture.organizationSlug);
    incoming = new Request(url, incoming);
  }
  const registration = fixture.registrations.find(
    (candidate) => candidate.connection.name === provider,
  );
  return (
    registration?.connection.actions[action]?.(incoming) ??
    Promise.resolve(Response.json({ error: "provider_not_configured" }, { status: 409 }))
  );
}

function createHashForTest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
