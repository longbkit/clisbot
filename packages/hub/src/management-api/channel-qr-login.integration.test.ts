// The QR login as an operator drives it: five management operations against a
// migrated embedded database, a configured Zalo Personal account, and a FAKE
// vertical whose `plugin.setup` is a real little state machine (pending →
// linked, cancel, relink, logout). The verb dispatch and the response
// projection are the production ones (`channels/supervisor/qr-login.ts`); what
// the fake stands in for is the zca-js socket a unit test cannot reach.
//
// The cases: authority + the mutation guard, start → status pending → linked,
// cancel, relink discarding the stored session, logout clearing it, and the
// projection dropping anything that is not the code, the state or the identity.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, it } from "vitest";
import { AccessStore } from "../access/store.js";
import type { BrowserOrganizationAccess } from "../auth/browser-organization-access.js";
import { buildAccountCarriers } from "../channels/supervisor/account-carriers.js";
import type { ChannelPlugin } from "../channels/loader/load-channel.js";
import { runQrLoginVerb } from "../channels/supervisor/qr-login.js";
import type { ChannelSupervisor } from "../channels/supervisor/types.js";
import { createTestCredentialCipher } from "../credentials/test-utils.js";
import { createDatabase } from "../db/pg.js";
import { embeddedDatabaseRuntime, type DatabaseRuntimeBundle } from "../db/runtime/index.js";
import * as schema from "../db/schema.js";
import { AccessTicketService } from "../managed-access/tickets.js";
import { ManagementApi } from "./index.js";

const ORGANIZATION_ID = "org";
const USER_ID = "owner";
const MEMBERSHIP_ID = "owner-membership";
const ACCOUNT_ID = "personal";
const PROFILE = "long-personal";

// One migrated database for the file: migrating an embedded PGlite instance is
// the expensive part, and both cases read the same organization.
let bundle: DatabaseRuntimeBundle;
let root: string;
let database: ReturnType<typeof createDatabase>;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "hub-channel-qr-"));
  bundle = await embeddedDatabaseRuntime(root);
  await bundle.runtime.migrate();
  database = createDatabase(bundle.runtime, bundle.locks, createTestCredentialCipher());
  await seedOrganization(database);
}, 120_000);

afterAll(async () => {
  await bundle.runtime.close();
  await rm(root, { recursive: true, force: true });
}, 30_000);

/**
 * A vertical's `plugin.setup` as the contract describes it: the login is
 * in-flight state, the session is what a scan leaves behind, and every verb
 * refuses to touch a session it should not.
 */
function fakeVertical() {
  const sessions = new Map<string, { imei: string }>();
  const bound: string[] = [];
  const profiles: string[] = [];
  let pending: string | undefined;
  let scans = 0;

  const plugin = {
    setup: {
      auth: "qr",
      bindAccountSession: async ({ accountId }: { accountId: string }) => {
        bound.push(accountId);
      },
      startQrLogin: async ({ profile }: { profile: string }) => {
        profiles.push(profile);
        if (sessions.has(profile)) return { status: "linked", message: "already linked" };
        pending = profile;
        return {
          status: "pending",
          qrDataUrl: "data:image/png;base64,QVFR",
          qrFilePath: "/tmp/qr.png",
          message: "scan the code",
          // Must never reach the response: the projection drops it.
          session: { imei: "imei-canary" },
        };
      },
      pollQrLogin: async ({ profile }: { profile: string }) => {
        profiles.push(profile);
        if (pending !== profile) return { status: "failed", message: "no login in flight" };
        scans += 1;
        if (scans < 2) return { status: "pending", message: "still waiting for the scan" };
        pending = undefined;
        sessions.set(profile, { imei: "imei-canary" });
        return {
          status: "linked",
          message: "linked",
          user: { userId: "u-1", displayName: "Long" },
        };
      },
      cancelQrLogin: async ({ profile }: { profile: string }) => {
        profiles.push(profile);
        if (sessions.has(profile)) {
          return { cancelled: false, message: "session is still linked; nothing to cancel" };
        }
        pending = undefined;
        return { cancelled: true, message: "cancelled" };
      },
      relinkQrLogin: async ({ profile }: { profile: string }) => {
        profiles.push(profile);
        sessions.delete(profile);
        scans = 0;
        pending = profile;
        return { status: "pending", qrDataUrl: "data:image/png;base64,Uk5E", message: "rescan" };
      },
      logout: async ({ profile }: { profile: string }) => {
        profiles.push(profile);
        const cleared = sessions.delete(profile);
        return { cleared, message: cleared ? "unlinked" : "nothing to clear" };
      },
    },
  } as unknown as ChannelPlugin;

  return { plugin, sessions, bound, profiles };
}

/** A supervisor whose `qrLogin` is the real dispatch over the fake vertical,
 * with the profile taken from the account carrier exactly as the real one does. */
function supervisorOver(vertical: ReturnType<typeof fakeVertical>): ChannelSupervisor {
  return {
    startAll: async () => undefined,
    stopAll: async () => undefined,
    startAccount: async (channel, account) => ({
      channel,
      account,
      installed: false,
      transport: "started",
    }),
    reconcile: async () => ({ accounts: [], stopped: [] }),
    status: () => [],
    channelReplyPost: async () => ({ ok: false }),
    channelReplyMediaPost: async () => ({ ok: false }),
    postTestMessage: async () => ({ ok: false }),
    qrLogin: async (input) => {
      const { account } = buildAccountCarriers(input.channel, {
        accountId: input.accountId,
        compiled: input.compiled,
        profile: PROFILE,
      });
      return runQrLoginVerb({
        plugin: vertical.plugin,
        accountId: input.accountId,
        profile: String(account["profile"]),
        verb: input.verb,
      });
    },
  };
}

async function seedOrganization(hub: ReturnType<typeof createDatabase>): Promise<void> {
  await bundle.runtime
    .drizzle()
    .insert(schema.organizations)
    .values({ id: ORGANIZATION_ID, name: "Org", slug: "org" });
  await bundle.runtime
    .drizzle()
    .insert(schema.users)
    .values({ id: USER_ID, name: "Owner", email: "owner@example.test", emailVerified: true });
  await bundle.runtime
    .drizzle()
    .insert(schema.members)
    .values({ id: MEMBERSHIP_ID, organizationId: ORGANIZATION_ID, userId: USER_ID, role: "owner" });
  const { connectionId } = await hub.configureChannelConnection({
    organizationId: ORGANIZATION_ID,
    channel: "zalouser",
    accountId: ACCOUNT_ID,
    credentials: { profile: PROFILE },
  });
  await hub.saveChannelConfiguration({
    organizationId: ORGANIZATION_ID,
    files: [
      {
        path: `.paseo/channels/zalouser/${ACCOUNT_ID}.yml`,
        content: `channel: zalouser\naccountId: ${ACCOUNT_ID}\nenabled: true\nconnectionId: ${connectionId}\ntransport:\n  mode: qr\nconfig:\n  profile: ${PROFILE}\n`,
      },
    ],
    contentHash: "qr-login",
    createdByUserId: USER_ID,
  });
}

it("drives the QR login through the management contract without leaking session bytes", async () => {
  const vertical = fakeVertical();
  const access = new AccessStore(bundle.runtime);
  const common = {
    database,
    runtime: bundle.runtime,
    access,
    tickets: new AccessTicketService(bundle.runtime, access),
    channelSupervisor: supervisorOver(vertical),
  };
  const owner = new ManagementApi({ ...common, auth: ownerAccess() });
  const member = new ManagementApi({ ...common, auth: memberAccess() });

  // Authority: the QR login is `channel.manage`, like every other account verb.
  assert.equal((await member.handle(qr("start"))).status, 403);
  // The mutation guard runs on every non-GET verb.
  const csrf = new ManagementApi({
    ...common,
    auth: {
      ...ownerAccess(),
      rejectCookieMutation: () => new Response(null, { status: 403 }),
    },
  });
  assert.equal((await csrf.handle(qr("start"))).status, 403);

  const started = await owner.handle(qr("start"));
  assert.equal(started.status, 200);
  assert.deepEqual(await started.json(), {
    status: "pending",
    message: "scan the code",
    qrDataUrl: "data:image/png;base64,QVFR",
    qrFilePath: "/tmp/qr.png",
  });

  // Polling advances the vertical's state machine, so it is a POST like the
  // rest; it reports pending until the scan lands.
  const pending = await owner.handle(qr("poll"));
  assert.equal(pending.status, 200);
  assert.deepEqual(await pending.json(), {
    status: "pending",
    message: "still waiting for the scan",
  });
  const linked = await owner.handle(qr("poll"));
  assert.deepEqual(await linked.json(), {
    status: "linked",
    message: "linked",
    user: { userId: "u-1", displayName: "Long" },
  });
  assert.equal(vertical.sessions.has(PROFILE), true);

  // Every verb bound the account's session store first, and every one of them
  // ran against the HUB's profile — never an account id or a caller value.
  assert.deepEqual(new Set(vertical.bound), new Set([ACCOUNT_ID]));
  assert.deepEqual(new Set(vertical.profiles), new Set([PROFILE]));

  // Cancel refuses to drop a session that is still good.
  const cancelled = await owner.handle(qr("cancel"));
  assert.deepEqual(await cancelled.json(), {
    cancelled: false,
    message: "session is still linked; nothing to cancel",
  });
  assert.equal(vertical.sessions.has(PROFILE), true);

  // Relink discards the stored session and hands back a fresh code.
  const relinked = await owner.handle(qr("relink"));
  assert.deepEqual(await relinked.json(), {
    status: "pending",
    message: "rescan",
    qrDataUrl: "data:image/png;base64,Uk5E",
  });
  assert.equal(vertical.sessions.has(PROFILE), false);

  // Logout clears the stored session.
  await owner.handle(qr("poll"));
  await owner.handle(qr("poll"));
  assert.equal(vertical.sessions.has(PROFILE), true);
  const loggedOut = await owner.handle(qr("logout"));
  assert.deepEqual(await loggedOut.json(), { cleared: true, message: "unlinked" });
  assert.equal(vertical.sessions.has(PROFILE), false);
});

// The vertical writes its session through the SYNC keyed store, whose
// encrypted backing is write-behind. Answering "linked" before that reached the
// database meant a Hub that stopped in the window came back unlinked and the
// operator had to scan again.
it("makes the scanned session durable before it answers linked", async () => {
  const vertical = fakeVertical();
  const order: string[] = [];
  const verb = async (name: "start" | "poll") =>
    await runQrLoginVerb({
      plugin: vertical.plugin,
      accountId: ACCOUNT_ID,
      profile: PROFILE,
      verb: name,
      flushState: async () => {
        // What the store holds AT the barrier: the verb has already written.
        order.push(`flush:${name}:${vertical.sessions.has(PROFILE) ? "linked" : "empty"}`);
      },
    });
  await verb("start");
  await verb("poll");
  const linked = await verb("poll");

  assert.deepEqual(linked, {
    status: "linked",
    message: "linked",
    user: { userId: "u-1", displayName: "Long" },
  });
  assert.equal(vertical.sessions.has(PROFILE), true);
  assert.deepEqual(order, ["flush:start:empty", "flush:poll:empty", "flush:poll:linked"]);
});

it("refuses the QR login for an unknown account, an offline runtime and a token channel", async () => {
  const access = new AccessStore(bundle.runtime);
  const common = {
    database,
    runtime: bundle.runtime,
    access,
    tickets: new AccessTicketService(bundle.runtime, access),
  };
  const offline = new ManagementApi({ ...common, auth: ownerAccess(), channelSupervisor: null });
  assert.equal((await offline.handle(qr("start"))).status, 503);

  const owner = new ManagementApi({
    ...common,
    auth: ownerAccess(),
    channelSupervisor: supervisorOver(fakeVertical()),
  });
  assert.equal(
    (await owner.handle(apiRequest("/channel-accounts/zalouser/missing/qr/start", "POST"))).status,
    404,
  );
  // A channel with no QR login has no account here either.
  assert.equal(
    (await owner.handle(apiRequest(`/channel-accounts/telegram/${ACCOUNT_ID}/qr/start`, "POST")))
      .status,
    404,
  );
  // Every verb is a POST, and only the five exist.
  assert.equal((await owner.handle(apiRequest(qrPath("start"), "GET"))).status, 404);
  assert.equal((await owner.handle(apiRequest(qrPath("status"), "POST"))).status, 404);
});

it("publishes the channel catalog behind the same management authority", async () => {
  const access = new AccessStore(bundle.runtime);
  const common = {
    database,
    runtime: bundle.runtime,
    access,
    tickets: new AccessTicketService(bundle.runtime, access),
    channelSupervisor: null,
  };
  const owner = new ManagementApi({ ...common, auth: ownerAccess() });
  const member = new ManagementApi({ ...common, auth: memberAccess() });
  assert.equal((await member.handle(apiRequest("/channel-catalog", "GET"))).status, 403);

  const response = await owner.handle(apiRequest("/channel-catalog", "GET"));
  assert.equal(response.status, 200);
  const { channels } = (await response.json()) as {
    channels: {
      id: string;
      auth: string;
      status: string;
      transports: { id: string; requiredConfig: string[] }[];
      credentials: { key: string; secret: boolean }[];
      capabilities: string[];
      extraTools: string[];
    }[];
  };
  assert.deepEqual(
    channels.map((entry) => entry.id),
    ["slack", "telegram", "discord", "googlechat", "feishu", "zalouser", "zalo"],
  );
  // `auth` is defaulted here, so a client never has to know the catalog's own
  // "absent means token" rule.
  assert.deepEqual(
    channels.filter((entry) => entry.auth === "qr").map((entry) => entry.id),
    ["zalouser"],
  );
  assert.equal(
    channels.every((entry) => entry.auth === "token" || entry.auth === "qr"),
    true,
  );
  const zalouser = channels.find((entry) => entry.id === "zalouser");
  assert.equal(zalouser?.status, "in-repo");
  assert.deepEqual(zalouser?.transports, [
    {
      id: "qr",
      label: "QR login session",
      requiredConfig: ["profile"],
      setup:
        "Scan the QR code with the personal Zalo client; the Hub stores the resulting session encrypted at rest.",
    },
  ]);
  assert.deepEqual(
    zalouser?.credentials.map((credential) => credential.key),
    ["profile"],
  );
  assert.deepEqual(zalouser?.extraTools, ["zalouser"]);
  // Developer facts about how a vertical is built stay Hub-side.
  assert.equal("sdkPackages" in (zalouser ?? {}), false);
  assert.equal("upstreamPackage" in (zalouser ?? {}), false);
});

function qrPath(verb: string): string {
  return `/channel-accounts/zalouser/${ACCOUNT_ID}/qr/${verb}`;
}

function qr(verb: string): Request {
  return apiRequest(qrPath(verb), "POST");
}

function apiRequest(path: string, method: string): Request {
  return new Request(
    `https://hub.example.test/api/management/v1/organizations/${ORGANIZATION_ID}${path}`,
    { method },
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
      manageChannels: true,
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

function memberAccess(): BrowserOrganizationAccess {
  const value = {
    session: { id: "member-session" },
    account: { id: "member-user", name: "Member", email: "member@example.test" },
    organization: { id: ORGANIZATION_ID, name: "Org", slug: "org" },
    membership: { id: "member-membership", role: "member" as const },
    capabilities: {
      view: true as const,
      manageMembers: false,
      manageOwners: false,
      manageResources: false,
      manageChannels: false,
    },
  };
  return {
    resolveOrganizationAccess: async () => value,
    resolveAccount: async () => ({
      session: { id: "member-session", activeOrganizationId: ORGANIZATION_ID },
      account: value.account,
      isInstanceOperator: false,
    }),
    rejectCookieMutation: () => undefined,
  };
}
