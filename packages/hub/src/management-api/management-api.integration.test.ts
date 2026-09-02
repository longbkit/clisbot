import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, it } from "vitest";
import { AccessStore } from "../access/store.js";
import type { BrowserOrganizationAccess } from "../auth/browser-organization-access.js";
import { createTestCredentialCipher } from "../credentials/test-utils.js";
import { createDatabase } from "../db/pg.js";
import { embeddedDatabaseRuntime, type DatabaseRuntimeBundle } from "../db/runtime/index.js";
import * as schema from "../db/schema.js";
import { AccessTicketService } from "../managed-access/tickets.js";
import { enrollTestDaemon } from "../test-utils/project-configuration.js";
import { ManagementApi } from "./index.js";

const ORGANIZATION_ID = "org";
const USER_ID = "owner";
const MEMBERSHIP_ID = "owner-membership";

let bundle: DatabaseRuntimeBundle;
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hub-management-api-"));
  bundle = await embeddedDatabaseRuntime(root);
  await bundle.runtime.migrate();
}, 30_000);

afterEach(async () => {
  await bundle.runtime.close();
  await rm(root, { recursive: true, force: true });
}, 30_000);

it("updates one Channel revision for Agent and Automation routes and rejects a stale writer", async () => {
  const database = createDatabase(bundle.runtime, bundle.locks, createTestCredentialCipher());
  await bundle.runtime.drizzle().insert(schema.organizations).values({
    id: ORGANIZATION_ID,
    name: "Org",
    slug: "org",
  });
  await bundle.runtime.drizzle().insert(schema.users).values({
    id: USER_ID,
    name: "Owner",
    email: "owner@example.test",
    emailVerified: true,
  });
  await bundle.runtime.drizzle().insert(schema.members).values({
    id: MEMBERSHIP_ID,
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
    role: "owner",
  });
  await enrollTestDaemon(database, ORGANIZATION_ID);
  const initial = await database.saveChannelConfiguration({
    organizationId: ORGANIZATION_ID,
    files: [
      {
        path: ".paseo/hub.yml",
        content: `environments:\n  work:\n    kind: daemon\n    daemon: daemon-10000000\n    cwd: /workspace/app\nagents:\n  coding:\n    provider: codex\n    model: gpt-5.5\n`,
      },
    ],
    contentHash: "initial",
    createdByUserId: USER_ID,
  });
  const access = new AccessStore(bundle.runtime);
  const api = new ManagementApi({
    database,
    runtime: bundle.runtime,
    auth: ownerAccess(),
    access,
    tickets: new AccessTicketService(bundle.runtime, access),
    channelSupervisor: null,
  });

  const automationResponse = await api.handle(
    request("/automations", "POST", {
      expectedRevisionId: null,
      yaml: `name: handoff\nenabled: true\non:\n  manual.run: {}\nrun:\n  target: { daemon: daemon-10000000, cwd: /workspace/app }\n  agent: { provider: codex, mode: default }\n  prompt: hand off\n  max_runtime: 1h\n  idle_timeout: 5m\n`,
    }),
  );
  assert.equal(automationResponse.status, 201);

  const candidate = {
    expectedRevisionId: initial.id,
    policy: { enabled: true },
    accounts: [
      {
        channel: "slack",
        accountId: "support",
        enabled: true,
        connectionId: "slack-support",
        transport: { mode: "socket" },
        routes: [
          { match: { kind: "dm" }, agent: "coding", environment: "work" },
          { match: { kind: "channel", ids: ["C-CUSTOMER"] }, workflow: "handoff" },
        ],
        fallback: { deny: true },
      },
    ],
  };
  const update = await api.handle(request("/channel-configuration", "PUT", candidate));
  assert.equal(update.status, 200);
  const body = await update.json();
  assert.equal(body.accounts[0].routes[0].agent, "coding");
  assert.equal(body.accounts[0].routes[1].workflow, "handoff");
  assert.equal(body.effective.accounts[0].routes[0].target.kind, "agent");
  assert.equal(body.effective.accounts[0].routes[1].target.kind, "workflow");

  const stale = await api.handle(request("/channel-configuration", "PUT", candidate));
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error, "revision_conflict");
});

function request(path: string, method: string, body?: unknown): Request {
  return new Request(
    `https://hub.example.test/api/management/v1/organizations/${ORGANIZATION_ID}${path}`,
    {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
    },
  );
}

function ownerAccess(): BrowserOrganizationAccess {
  const value = {
    session: { id: "session" },
    account: { id: USER_ID, name: "Owner", email: "owner@example.test" },
    organization: { id: ORGANIZATION_ID, name: "Org", slug: "org" },
    membership: { id: MEMBERSHIP_ID, role: "owner" as const },
    capabilities: {
      view: true as const,
      manageMembers: true,
      manageOwners: true,
      manageResources: true,
    },
  };
  return {
    resolveOrganizationAccess: async () => value,
    resolveAccount: async () => ({
      session: { id: "session", activeOrganizationId: ORGANIZATION_ID },
      account: value.account,
      isInstanceOperator: true,
    }),
    rejectCookieMutation: () => undefined,
  };
}
