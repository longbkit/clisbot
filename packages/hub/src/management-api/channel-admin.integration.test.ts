// Channel Route Admin through the management contract: a Member holding
// `channel.manage` on one account may save that account's file (Connection,
// transport and config frozen), read its activity and ingress, its status and
// drive its QR relink — and nothing else: no policy file, no other account, no
// organization-wide read. The organization capability keeps the full surface.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "js-yaml";
import { afterAll, beforeAll, it } from "vitest";
import { formatChannelAccountResourceId } from "../access/contract.js";
import { AccessStore } from "../access/store.js";
import { createChannelUseGrantSource } from "../channels/access-grants.js";
import type { BrowserOrganizationAccess } from "../auth/browser-organization-access.js";
import type { ChannelSupervisor } from "../channels/supervisor/types.js";
import { createTestCredentialCipher } from "../credentials/test-utils.js";
import { createDatabase } from "../db/pg.js";
import { embeddedDatabaseRuntime, type DatabaseRuntimeBundle } from "../db/runtime/index.js";
import * as schema from "../db/schema.js";
import { AccessTicketService } from "../managed-access/tickets.js";
import { enrollTestDaemon, TEST_DAEMON_SLUG } from "../test-utils/project-configuration.js";
import { ManagementApi } from "./index.js";

const ORGANIZATION_ID = "org";
const OWNER_USER = "owner";
const OWNER_MEMBERSHIP = "owner-membership";
const ADMIN_USER = "route-admin";
const ADMIN_MEMBERSHIP = "route-admin-membership";
const ACCOUNT_ID = "personal";
const OTHER_ACCOUNT_ID = "other";
const PROFILE = "long-personal";

let bundle: DatabaseRuntimeBundle;
let root: string;
let database: ReturnType<typeof createDatabase>;
let connectionId: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "hub-channel-admin-"));
  bundle = await embeddedDatabaseRuntime(root);
  await bundle.runtime.migrate();
  database = createDatabase(bundle.runtime, bundle.locks, createTestCredentialCipher());
  await seedOrganization(database);
}, 120_000);

afterAll(async () => {
  await bundle.runtime.close();
  await rm(root, { recursive: true, force: true });
}, 30_000);

function accountFile(accountId: string, connection: string, extra = ""): string {
  return `channel: zalouser\naccountId: ${accountId}\nenabled: true\nconnectionId: ${connection}\ntransport:\n  mode: qr\nconfig:\n  profile: ${PROFILE}\nfallback:\n  deny: true\n${extra}`;
}

async function seedOrganization(hub: ReturnType<typeof createDatabase>): Promise<void> {
  const db = bundle.runtime.drizzle();
  await db.insert(schema.organizations).values({ id: ORGANIZATION_ID, name: "Org", slug: "org" });
  await db.insert(schema.users).values([
    { id: OWNER_USER, name: "Owner", email: "owner@example.test", emailVerified: true },
    { id: ADMIN_USER, name: "Route Admin", email: "admin@example.test", emailVerified: true },
  ]);
  await db.insert(schema.members).values([
    { id: OWNER_MEMBERSHIP, organizationId: ORGANIZATION_ID, userId: OWNER_USER, role: "owner" },
    { id: ADMIN_MEMBERSHIP, organizationId: ORGANIZATION_ID, userId: ADMIN_USER, role: "member" },
  ]);
  await db.insert(schema.accessAssignments).values({
    organizationId: ORGANIZATION_ID,
    subjectKind: "member",
    subjectId: ADMIN_MEMBERSHIP,
    resourceKind: "channel_account",
    resourceId: formatChannelAccountResourceId("zalouser", ACCOUNT_ID),
    privileges: ["channel.manage"],
    constraints: { conversation: { kind: "all" } },
  });
  const configured = await hub.configureChannelConnection({
    organizationId: ORGANIZATION_ID,
    channel: "zalouser",
    accountId: ACCOUNT_ID,
    credentials: { profile: PROFILE },
  });
  connectionId = configured.connectionId;
  const other = await hub.configureChannelConnection({
    organizationId: ORGANIZATION_ID,
    channel: "zalouser",
    accountId: OTHER_ACCOUNT_ID,
    credentials: { profile: "other-profile" },
  });
  await enrollTestDaemon(hub, ORGANIZATION_ID);
  await hub.saveChannelConfiguration({
    organizationId: ORGANIZATION_ID,
    files: [
      {
        path: ".paseo/hub.yml",
        content: `environments:\n  work:\n    kind: daemon\n    daemon: ${TEST_DAEMON_SLUG}\n    cwd: /workspace/app\nagents:\n  coding:\n    provider: codex\n    model: gpt-5.5\n`,
      },
      {
        path: `.paseo/channels/zalouser/${ACCOUNT_ID}.yml`,
        content: accountFile(ACCOUNT_ID, connectionId),
      },
      {
        path: `.paseo/channels/zalouser/${OTHER_ACCOUNT_ID}.yml`,
        content: accountFile(OTHER_ACCOUNT_ID, other.connectionId),
      },
    ],
    contentHash: "channel-admin",
    createdByUserId: OWNER_USER,
  });
}

function supervisor(): ChannelSupervisor & { reconciliations: number } {
  const fake = {
    reconciliations: 0,
    startAll: async () => undefined,
    stopAll: async () => undefined,
    startAccount: async (channel: string, account: string) => ({
      channel,
      account,
      installed: false,
      transport: "started" as const,
    }),
    reconcile: async () => {
      fake.reconciliations += 1;
      return { accounts: [], stopped: [] };
    },
    status: () => [
      {
        channel: "zalouser",
        account: ACCOUNT_ID,
        integrity: "ok" as const,
        loadTrace: "ok" as const,
        transport: "started" as const,
      },
      {
        channel: "zalouser",
        account: OTHER_ACCOUNT_ID,
        integrity: "ok" as const,
        loadTrace: "ok" as const,
        transport: "started" as const,
      },
    ],
    channelReplyPost: async () => ({ ok: false as const }),
    channelReplyMediaPost: async () => ({ ok: false as const }),
    postTestMessage: async () => ({ ok: false as const }),
    qrLogin: async (input: { verb: string; accountId: string }) => ({
      status: "pending",
      message: `${input.verb} ${input.accountId}`,
    }),
  };
  return fake as unknown as ChannelSupervisor & { reconciliations: number };
}

function apiRequest(path: string, method: string, body?: unknown): Request {
  return new Request(
    `https://hub.example.test/api/management/v1/organizations/${ORGANIZATION_ID}${path}`,
    {
      method,
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    },
  );
}

function accessFor(input: {
  userId: string;
  membershipId: string;
  role: "owner" | "member";
  manageChannels: boolean;
}): BrowserOrganizationAccess {
  const value = {
    session: { id: `${input.userId}-session` },
    account: { id: input.userId, name: input.userId, email: `${input.userId}@example.test` },
    organization: { id: ORGANIZATION_ID, name: "Org", slug: "org" },
    membership: { id: input.membershipId, role: input.role },
    capabilities: {
      view: true as const,
      manageMembers: input.manageChannels,
      manageOwners: input.manageChannels,
      manageResources: input.manageChannels,
      manageChannels: input.manageChannels,
    },
  };
  return {
    resolveOrganizationAccess: async () => value,
    resolveAccount: async () => ({
      session: { id: value.session.id, activeOrganizationId: ORGANIZATION_ID },
      account: value.account,
      isInstanceOperator: false,
    }),
    rejectCookieMutation: () => undefined,
  };
}

const accountPath = `/channel-configuration/accounts/zalouser/${ACCOUNT_ID}`;

it("lets a Channel Route Admin manage exactly one account", async () => {
  const access = new AccessStore(bundle.runtime);
  const channelSupervisor = supervisor();
  const common = {
    database,
    runtime: bundle.runtime,
    access,
    tickets: new AccessTicketService(bundle.runtime, access),
    channelSupervisor,
  };
  const admin = new ManagementApi({
    ...common,
    auth: accessFor({
      userId: ADMIN_USER,
      membershipId: ADMIN_MEMBERSHIP,
      role: "member",
      manageChannels: false,
    }),
  });
  const owner = new ManagementApi({
    ...common,
    auth: accessFor({
      userId: OWNER_USER,
      membershipId: OWNER_MEMBERSHIP,
      role: "owner",
      manageChannels: true,
    }),
  });

  // Org-wide reads and the other account stay closed to the Route Admin.
  assert.equal((await admin.handle(apiRequest("/channel-configuration", "GET"))).status, 403);
  assert.equal(
    (
      await admin.handle(
        apiRequest(`/channel-configuration/accounts/zalouser/${OTHER_ACCOUNT_ID}`, "GET"),
      )
    ).status,
    403,
  );
  assert.equal((await admin.handle(apiRequest("/channel-accounts/status", "GET"))).status, 403);

  // The one account: its stored file, the compiled account, its warnings.
  const view = await admin.handle(apiRequest(accountPath, "GET"));
  assert.equal(view.status, 200);
  const shown = (await view.json()) as {
    revision: { id: string; version: number };
    account: { accountId: string; connectionId: string; fallback: unknown };
    effective: { accountId: string };
    warnings: unknown[];
  };
  assert.equal(shown.account.accountId, ACCOUNT_ID);
  assert.equal(shown.effective.accountId, ACCOUNT_ID);
  assert.deepEqual(shown.warnings, []);

  // Saving keeps the Connection: a different connectionId is refused.
  const swapped = await admin.handle(
    apiRequest(accountPath, "PUT", {
      account: { ...shown.account, connectionId: "another-connection" },
      expectedRevisionId: shown.revision.id,
    }),
  );
  assert.equal(swapped.status, 403);
  assert.equal(
    ((await swapped.json()) as { error: string }).error,
    "channel_connection_change_forbidden",
  );

  // Saving the Routes and limits of that account writes one new revision.
  const saved = await admin.handle(
    apiRequest(accountPath, "PUT", {
      account: { ...shown.account, limits: { maxInputCharacters: 2_000 } },
      expectedRevisionId: shown.revision.id,
    }),
  );
  assert.equal(saved.status, 200, await saved.clone().text());
  const after = (await saved.json()) as {
    revision: { id: string; version: number };
    account: { limits?: { maxInputCharacters?: number } };
    reconciliation: unknown;
  };
  assert.equal(after.revision.version, shown.revision.version + 1);
  assert.equal(after.account.limits?.maxInputCharacters, 2_000);
  assert.equal(channelSupervisor.reconciliations, 1);
  const active = await database.findActiveChannelConfiguration(ORGANIZATION_ID);
  const otherFile = active?.files.find(({ path }) => path.endsWith(`/${OTHER_ACCOUNT_ID}.yml`));
  assert.equal(
    (load(otherFile?.content ?? "") as { limits?: unknown }).limits,
    undefined,
    "the other account is untouched",
  );

  // Activity and ingress, scoped to the account by the path, not by the query.
  const activity = await admin.handle(
    apiRequest(`/channel-activity/accounts/zalouser/${ACCOUNT_ID}?limit=5`, "GET"),
  );
  assert.equal(activity.status, 200);
  const ingress = await admin.handle(
    apiRequest(`/channel-ingress/accounts/zalouser/${ACCOUNT_ID}`, "GET"),
  );
  assert.equal(ingress.status, 200);
  assert.deepEqual(await ingress.json(), { events: [], nextOffset: null });

  // Status and QR relink for that account only.
  const status = await admin.handle(
    apiRequest(`/channel-accounts/zalouser/${ACCOUNT_ID}/status`, "GET"),
  );
  assert.equal(status.status, 200);
  const entries = (await status.json()) as { accounts: { account: string }[] };
  assert.deepEqual(
    entries.accounts.map(({ account }) => account),
    [ACCOUNT_ID],
  );
  const relink = await admin.handle(
    apiRequest(`/channel-accounts/zalouser/${ACCOUNT_ID}/qr/relink`, "POST"),
  );
  assert.equal(relink.status, 200);
  assert.deepEqual(await relink.json(), { status: "pending", message: `relink ${ACCOUNT_ID}` });
  assert.equal(
    (
      await admin.handle(
        apiRequest(`/channel-accounts/zalouser/${OTHER_ACCOUNT_ID}/qr/relink`, "POST"),
      )
    ).status,
    403,
  );

  // The organization capability keeps the full surface, the scoped one included.
  assert.equal((await owner.handle(apiRequest("/channel-configuration", "GET"))).status, 200);
  assert.equal((await owner.handle(apiRequest(accountPath, "GET"))).status, 200);
});

it("retiring channel.use deletes Use-only grants and keeps Channel Route Admin grants", async () => {
  const db = bundle.runtime.drizzle();
  const resourceId = formatChannelAccountResourceId("zalouser", OTHER_ACCOUNT_ID);
  const [useOnly, admin] = await db
    .insert(schema.accessAssignments)
    .values([
      {
        organizationId: ORGANIZATION_ID,
        subjectKind: "member",
        subjectId: OWNER_MEMBERSHIP,
        resourceKind: "channel_account",
        resourceId,
        privileges: ["channel.use"],
        constraints: { conversation: { kind: "direct_messages" } },
      },
      {
        organizationId: ORGANIZATION_ID,
        subjectKind: "member",
        subjectId: ADMIN_MEMBERSHIP,
        resourceKind: "channel_account",
        resourceId,
        privileges: ["channel.use", "channel.manage"],
        constraints: { conversation: { kind: "all" } },
      },
    ])
    .returning();
  await createChannelUseGrantSource(bundle.runtime).retireChannelUse([useOnly!.id, admin!.id]);
  const rows = await db.select().from(schema.accessAssignments);
  assert.equal(
    rows.some((row) => row.id === useOnly!.id),
    false,
  );
  assert.deepEqual(rows.find((row) => row.id === admin!.id)?.privileges, ["channel.manage"]);
});
