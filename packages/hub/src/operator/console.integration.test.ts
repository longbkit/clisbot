import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createPostgresQueryRuntime } from "../db/test-utils/runtime.js";
import { z } from "zod";
import { composeEntitlements, type ComposedEntitlements } from "../auth/entitlements.js";
import { createAuthServer, type AuthServer } from "../auth/server.js";
import {
  createDatabase,
  testDatabaseLocks,
  testDatabaseRuntime,
} from "../db/test-utils/runtime.js";
import type { Database } from "../db/types.js";
import { OperatorConsole, OperatorForbiddenError } from "./console.js";

// The operator guard is the real authorization: hiding the nav is presentation, this refuses
// server-side. These tests build a real Better Auth server over real Postgres so the
// instance-operator flag flows exactly as it does in production — from the `user` row, through the
// session, into `resolveAccount`. A fake resolver would not prove that path. The guard is a real
// repro: deleting the flag check in `requireOperator` turns the "non-operator is refused" cases
// green (they stop rejecting), which fails these assertions.

describe("OperatorConsole authorization", () => {
  let postgres: StartedPostgreSqlContainer;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer("postgres:17-alpine").start();
  }, 120_000);

  afterAll(async () => {
    await postgres.stop();
  }, 120_000);

  afterEach(async () => {
    await stopHarnesses();
  });

  it("refuses every operator read and write for an org owner without the flag", async () => {
    const hub = await startHarness(postgres);
    const owner = await hub.signUp("Bea", "bea-operator@example.com");
    const orgSlug = await owner.createOrganization("Bea Co");

    // Bea owns this organization, yet without the operator flag she cannot read or write its
    // entitlements through the operator surface — the guard is the operator flag, not membership.
    await assert.rejects(
      hub.console.snapshot(owner.request(), { organizationSlug: orgSlug }),
      OperatorForbiddenError,
    );
    await assert.rejects(
      hub.console.override(
        owner.request(),
        { organizationSlug: orgSlug },
        { patch: { seats: { max: 2 } }, reason: "should be refused" },
      ),
      OperatorForbiddenError,
    );
    await assert.rejects(
      hub.console.clearOverride(
        owner.request(),
        { organizationSlug: orgSlug },
        { key: "seats", reason: "should be refused" },
      ),
      OperatorForbiddenError,
    );
    await assert.rejects(hub.console.listOrganizations(owner.request()), OperatorForbiddenError);
  });

  it("lets an operator read and override an organization it is not a member of", async () => {
    const hub = await startHarness(postgres);
    const operator = await hub.signUp("Ada", "ada-operator@example.com");
    await operator.createOrganization("Ada Co");
    const customer = await hub.signUp("Cyril", "cyril-operator@example.com");
    const customerSlug = await customer.createOrganization("Cyril Co");
    await hub.grantOperator(operator.email);

    // Ada is not a member of Cyril's organization — the operator path is not a membership read.
    assert.equal(await hub.membershipCount(operator.email, customerSlug), 0);

    const organizations = await hub.console.listOrganizations(operator.request());
    assert.deepEqual(organizations.map((organization) => organization.name).sort(), [
      "Ada Co",
      "Cyril Co",
    ]);

    const before = await hub.console.snapshot(operator.request(), {
      organizationSlug: customerSlug,
    });
    assert.equal(before.entitlements.effective.seats.max, null);

    const after = await hub.console.override(
      operator.request(),
      { organizationSlug: customerSlug },
      { patch: { seats: { max: 2 } }, reason: "Pilot seat cap" },
    );
    assert.equal(after.entitlements.effective.seats.max, 2);
    assert.equal(after.entitlements.overrides.seats?.max, 2);

    // The override persisted against Cyril's organization, and the audit names the operator actor.
    const reread = await hub.console.snapshot(operator.request(), {
      organizationSlug: customerSlug,
    });
    assert.equal(reread.entitlements.effective.seats.max, 2);
    assert.equal(reread.history[0]?.source, "override");
    assert.equal(reread.history[0]?.actorName, "Ada");
    assert.equal(reread.history[0]?.reason, "Pilot seat cap");
  });
});

const activeHarnesses: OperatorHarness[] = [];

async function startHarness(postgres: StartedPostgreSqlContainer): Promise<OperatorHarness> {
  const harness = await OperatorHarness.start(postgres);
  activeHarnesses.push(harness);
  return harness;
}

async function stopHarnesses(): Promise<void> {
  await Promise.all(activeHarnesses.splice(0).map((harness) => harness.stop()));
}

class OperatorHarness {
  readonly console: OperatorConsole;

  private constructor(
    private readonly url: string,
    private readonly database: Database,
    private readonly entitlements: ComposedEntitlements,
    private readonly auth: AuthServer,
  ) {
    this.console = new OperatorConsole(database, auth, entitlements.service);
  }

  static async start(postgres: StartedPostgreSqlContainer): Promise<OperatorHarness> {
    const url = isolatedDatabaseUrl(postgres);
    const database = await createDatabase(url);
    const entitlements = composeEntitlements(database, testDatabaseRuntime(database));
    const auth = createAuthServer({
      database: testDatabaseRuntime(database),
      locks: testDatabaseLocks(database),
      entitlements: entitlements.service,
      secret: "operator-auth-secret-at-least-32-characters",
      baseURL: "http://localhost:3000",
      policy: { registrationMode: "open", organizationCreation: "open", bootstrap: undefined },
    });
    return new OperatorHarness(url, database, entitlements, auth);
  }

  async signUp(name: string, email: string): Promise<OperatorAccount> {
    const account = new OperatorAccount(this.auth, email.toLowerCase());
    await account.signUp(name);
    return account;
  }

  async grantOperator(email: string): Promise<void> {
    await this.query(`update "user" set is_instance_operator = true where lower(email) = $1`, [
      email.toLowerCase(),
    ]);
  }

  async membershipCount(email: string, organizationSlug: string): Promise<number> {
    const rows = await this.query<{ count: number }>(
      `select count(*)::integer as count from member
       join "user" on "user".id = member.user_id
       join organization on organization.id = member.organization_id
       where lower("user".email) = $1 and organization.slug = $2`,
      [email.toLowerCase(), organizationSlug],
    );
    return rows[0]!.count;
  }

  async stop(): Promise<void> {
    await this.auth.close();
    await this.entitlements.close();
    await this.database.close();
  }

  private async query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: unknown[] = [],
  ): Promise<TRow[]> {
    const client = await createPostgresQueryRuntime(this.url);

    try {
      return (await client.query<TRow>(text, values)).rows;
    } finally {
      await client.close();
    }
  }
}

class OperatorAccount {
  private cookie = "";

  constructor(
    private readonly auth: AuthServer,
    readonly email: string,
  ) {}

  async signUp(name: string): Promise<void> {
    const response = await this.post("/api/auth/sign-up/email", {
      name,
      email: this.email,
      password: "operator-account-password",
    });
    assert.equal(response.status, 200);
    this.cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";", 1)[0])
      .join("; ");
  }

  async createOrganization(name: string): Promise<string> {
    const response = await this.post("/api/auth/paseo/create-organization", { name });
    assert.equal(response.status, 201);
    const body = z.object({ organizationId: z.string() }).parse(await response.json());
    const selected = await this.post("/api/auth/paseo/select-organization", {
      organizationId: body.organizationId,
    });
    assert.equal(selected.status, 200);
    const state = await this.get("/api/auth/paseo/state");
    const parsed = z
      .object({ organization: z.object({ slug: z.string() }) })
      .parse(await state.json());
    return parsed.organization.slug;
  }

  /** A bare request carrying this account's session cookie — all the operator console reads. */
  request(): Request {
    return new Request("http://localhost:3000/operator", {
      headers: this.cookie.length === 0 ? {} : { cookie: this.cookie },
    });
  }

  private get(path: string): Promise<Response> {
    const request = new Request(`http://localhost:3000${path}`, {
      headers: this.cookie.length === 0 ? {} : { cookie: this.cookie },
    });
    assert.ok(this.auth.browserAccount !== undefined);
    return this.auth.browserAccount(request);
  }

  private post(path: string, body: unknown): Promise<Response> {
    const request = new Request(`http://localhost:3000${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "sec-fetch-site": "same-origin",
        ...(this.cookie.length === 0 ? {} : { cookie: this.cookie }),
      },
      body: JSON.stringify(body),
    });
    if (path.startsWith("/api/auth/paseo/")) {
      assert.ok(this.auth.browserAccount !== undefined);
      return this.auth.browserAccount(request);
    }
    return this.auth.handle(request);
  }
}

function isolatedDatabaseUrl(postgres: StartedPostgreSqlContainer): string {
  const url = new URL(postgres.getConnectionUri());
  url.pathname = `/operator_${randomUUID().replaceAll("-", "")}`;
  return url.toString();
}
