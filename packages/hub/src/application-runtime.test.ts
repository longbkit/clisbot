import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { AuthServer } from "./auth/server.js";
import type { OrganizationAccessValue } from "./auth/organization-access.js";
import { createMemoryDatabase } from "./db/memory.js";
import type { Database } from "./db/types.js";
import { EntitlementsService } from "./entitlements/service.js";
import type { ProviderRegistration, TriggerProviderResources } from "./providers/registration.js";
import { createApplicationRuntime } from "./application-runtime.js";
import { replyOutputTool } from "./execution-capabilities/outputs.js";

describe("application runtime provider composition", () => {
  it("collects a fake registration without a concrete-provider case", async () => {
    const events: string[] = [];
    const registration: ProviderRegistration = {
      connection: {
        name: "fake",
        status: () => ({ status: "connected" }),
        actions: {
          start: () => Promise.resolve(Response.json({ provider: "fake" })),
        },
      },
      triggerProviders: [
        () => {
          events.push("provider");
          return { name: "fake", eventNames: ["fake.event"], match: () => Promise.resolve([]) };
        },
      ],
      sources: [
        {
          start: async () => {
            events.push("source:start");
          },
          stop: async () => {
            events.push("source:stop");
          },
        },
      ],
      outputs: [
        {
          type: "fake.output",
          tool: replyOutputTool,
          execute: () => Promise.resolve(),
        },
      ],
      requests: [
        {
          name: "webhook",
          handle: () => Promise.resolve(new Response("fake webhook")),
        },
      ],
    };
    let closed = false;
    const database = await runtimeDatabase("owner");
    const runtime = await createApplicationRuntime({
      database,
      auth: new RuntimeAuth(),
      entitlements: entitlementsForTest(database),
      billing: null,
      registrations: [registration],
      close: () => {
        closed = true;
        return Promise.resolve();
      },
    });

    assert.deepEqual(events, ["provider", "source:start"]);
    assert.equal(
      await (await runtime.webhook(new Request("https://hub.test/webhook"))).text(),
      "fake webhook",
    );
    assert.equal(
      await (
        await runtime.providerRequest("webhook", new Request("https://hub.test/webhook"))
      ).text(),
      "fake webhook",
    );
    assert.deepEqual(
      await (
        await runtime.connectionAction(new Request("https://hub.test/start"), "fake", "start")
      ).json(),
      { provider: "fake" },
    );
    assert.deepEqual(
      await (await runtime.connectionStatus(new Request(scopedStatusUrl()))).json(),
      { canManage: true, fake: { status: "connected" } },
    );
    assert.deepEqual(
      await (
        await runtime.connectionStatus(new Request("https://hub.test/status?organizationSlug=org"))
      ).json(),
      { canManage: true, fake: { status: "connected" } },
    );

    await runtime.stop();
    assert.deepEqual(events, ["provider", "source:start", "source:stop"]);
    assert.equal(closed, true);
  });

  it("rejects duplicate provider request registrations", async () => {
    const events: string[] = [];
    const first = fakeRegistration();
    first.connection = { ...first.connection, name: "first" };
    first.sources = [trackedSource("first", events)];
    first.requests = [{ name: "events", handle: () => Promise.resolve(new Response()) }];
    const second = fakeRegistration();
    second.connection = { ...second.connection, name: "second" };
    second.sources = [trackedSource("second", events)];
    second.requests = [{ name: "events", handle: () => Promise.resolve(new Response()) }];

    const database = createMemoryDatabase();
    await assert.rejects(
      () =>
        createApplicationRuntime({
          database,
          auth: new RuntimeAuth(),
          entitlements: entitlementsForTest(database),
          billing: null,
          registrations: [first, second],
          close: async () => {
            events.push("upstream:close");
          },
        }),
      /provider request registrations must have unique names: events/u,
    );
    assert.deepEqual(events, [
      "first:start",
      "second:start",
      "first:stop",
      "second:stop",
      "upstream:close",
    ]);
  });

  it("reports member connection status as read-only", async () => {
    const database = await runtimeDatabase("member");
    const runtime = await createApplicationRuntime({
      database,
      auth: new RuntimeAuth("member"),
      entitlements: entitlementsForTest(database),
      billing: null,
      registrations: [fakeRegistration()],
      close: () => Promise.resolve(),
    });

    assert.deepEqual(
      await (await runtime.connectionStatus(new Request(scopedStatusUrl()))).json(),
      { canManage: false, fake: { status: "connected" } },
    );
    await runtime.stop();
  });

  it("shares provider integrations with every trigger provider for the same organization", async () => {
    const calls: Array<{ projectId: string; slug: string; value: string }> = [];
    let providerResources: TriggerProviderResources | undefined;
    const database = createMemoryDatabase();
    database.findProjectById = async () => ({
      id: "project-1",
      organizationId: "org-1",
      name: "Project",
      slug: "project",
      status: "active",
      createdByUserId: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      archivedAt: null,
      activeConfigurationRevisionId: null,
    });
    database.organizationConnectionUsage = async () => ({
      github: [
        {
          id: "connection-1",
          organizationId: "org-1",
          slug: "getpaseo-github",
          installationId: 42,
          accountId: "account-1",
          accountLogin: "getpaseo",
          accountType: "Organization",
          status: "active",
          providerApplicationId: "42",
        },
        {
          id: "connection-2",
          organizationId: "org-1",
          slug: "secondary-getpaseo-github",
          installationId: 84,
          accountId: "account-2",
          accountLogin: "paseo",
          accountType: "Organization",
          status: "active",
          providerApplicationId: "42",
        },
      ],
      discord: [],
      slack: [],
      linear: [],
    });
    const registration: ProviderRegistration = {
      ...fakeRegistration("github"),
      integration: {
        resolve: (projectId, slug, value) => {
          calls.push({ projectId, slug, value });
          return Promise.resolve("organization-secret");
        },
      },
      triggerProviders: [
        (resources) => {
          providerResources = resources;
          return undefined;
        },
      ],
    };
    const runtime = await createApplicationRuntime({
      database,
      auth: new RuntimeAuth(),
      entitlements: entitlementsForTest(database),
      billing: null,
      registrations: [registration],
      close: () => Promise.resolve(),
    });

    assert.ok(providerResources);
    const resolveConnection = providerResources.connectionsForProject("project-1");
    assert.equal(
      await resolveConnection("secondary-getpaseo-github", "token"),
      "organization-secret",
    );
    assert.deepEqual(calls, [
      { projectId: "project-1", slug: "secondary-getpaseo-github", value: "token" },
    ]);
    await assert.rejects(
      async () => resolveConnection("missing-github", "token"),
      /connection slug is unavailable/u,
    );
    await assert.rejects(
      async () => resolveConnection("org-2-github", "token"),
      /connection slug is unavailable/u,
    );
    await runtime.stop();
  });
});

class RuntimeAuth implements AuthServer {
  constructor(private readonly role: "owner" | "member" = "owner") {}
  handle(): Promise<Response> {
    return Promise.resolve(new Response());
  }
  resources(): Promise<never> {
    return Promise.reject(new Error("unused"));
  }
  resolveOrganizationAccess(): Promise<OrganizationAccessValue> {
    return Promise.resolve({
      session: { id: "session" },
      account: { id: "user", name: "User", email: "user@example.test" },
      organization: { id: "org", name: "Org" },
      membership: { id: "membership", role: this.role },
      capabilities: {
        view: true,
        manageMembers: this.role === "owner",
        manageOwners: this.role === "owner",
        manageResources: this.role === "owner",
      },
    });
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

function entitlementsForTest(database: Database): EntitlementsService {
  return new EntitlementsService(database, { seats: () => Promise.resolve(0) });
}

function fakeRegistration(name = "fake"): ProviderRegistration {
  return {
    connection: {
      name,
      status: () => ({ status: "connected" }),
      actions: {},
    },
    triggerProviders: [],
    sources: [],
    outputs: [],
    requests: [],
  };
}

function trackedSource(name: string, events: string[]) {
  return {
    start: async () => {
      events.push(`${name}:start`);
    },
    stop: async () => {
      events.push(`${name}:stop`);
    },
  };
}

async function runtimeDatabase(role: "owner" | "member") {
  const database = createMemoryDatabase({
    memberships: [
      {
        userId: "user",
        organizationId: "org",
        organizationName: "Org",
        organizationSlug: "org",
        membershipId: "membership",
        role,
      },
    ],
  });
  await database.createProject({
    organizationId: "org",
    name: "Default",
    slug: "default",
    createdByUserId: "user",
  });
  return database;
}

function scopedStatusUrl(): string {
  return "https://hub.test/status?organizationSlug=org&projectSlug=default";
}
