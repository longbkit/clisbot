import assert from "node:assert/strict";
import { describe, it, vi, beforeEach } from "vitest";
import type { AuthServer } from "./auth/server.js";
import type { OrganizationAccessValue } from "./auth/organization-access.js";
import { createMemoryDatabase } from "./db/memory.js";
import type { Database } from "./db/types.js";
import type { DatabaseRuntime } from "./db/runtime/index.js";
import { EntitlementsService } from "./entitlements/service.js";
import type { ChannelSupervisor } from "./channels/supervisor/types.js";
import { createApplicationRuntime } from "./application-runtime.js";

const supervisorModule = vi.hoisted(() => ({
  stopAllCalls: [] as string[],
}));

// Composition loads the channel supervisor through a literal dynamic import of
// this module (application-runtime.ts `createChannelSupervisorAtComposition`).
// Mocking it lets a test observe whether `stopAll` is wired into the disposal
// chain without booting a real channel vertical.
vi.mock("./channels/supervisor/index.js", () => ({
  createChannelSupervisor: (options: { dataDir: string }) => {
    const fake: ChannelSupervisor = {
      startAll: async () => undefined,
      stopAll: async () => {
        supervisorModule.stopAllCalls.push(options.dataDir);
      },
      startAccount: async () => ({
        channel: "slack",
        account: "work",
        installed: false,
        transport: "started" as const,
      }),
      reconcile: async () => ({ accounts: [], stopped: [] }),
      status: () => [],
      channelReplyPost: async () => ({
        ok: false,
        error: "no transport in the stub",
      }),
      channelReplyMediaPost: async () => ({
        ok: false,
        error: "no transport in the stub",
      }),
      postTestMessage: async () => ({
        ok: false,
        error: "no transport in the stub",
      }),
    };
    return fake;
  },
}));

describe("channel plane disposal chain", () => {
  beforeEach(() => {
    supervisorModule.stopAllCalls.length = 0;
  });

  it("stops the channel plane when the application runtime stops", async () => {
    process.env["PASEO_HUB_CHANNELS_ENABLED"] = "1";
    try {
      const database = runtimeDatabase();
      const runtime = await createApplicationRuntime({
        database,
        // Threading a runtime + data dir is what makes composition build a
        // channel supervisor (mocked above) and register `stopAll` on the
        // disposal chain.
        databaseRuntime: fakeDatabaseRuntime(),
        hubDataDir: "channel-plane-disposal-test",
        auth: new RuntimeAuth(),
        entitlements: new EntitlementsService(database, {
          seats: () => Promise.resolve(0),
        }),
        billing: null,
        registrations: [],
        close: () => Promise.resolve(),
      });

      await runtime.stop();
      assert.deepEqual(supervisorModule.stopAllCalls, ["channel-plane-disposal-test"]);
    } finally {
      delete process.env["PASEO_HUB_CHANNELS_ENABLED"];
    }
  });

  it("registers nothing channel-specific when the kill-switch is off", async () => {
    process.env["PASEO_HUB_CHANNELS_ENABLED"] = "0";
    try {
      const database = runtimeDatabase();
      const runtime = await createApplicationRuntime({
        database,
        databaseRuntime: fakeDatabaseRuntime(),
        hubDataDir: "channel-plane-off-test",
        auth: new RuntimeAuth(),
        entitlements: new EntitlementsService(database, {
          seats: () => Promise.resolve(0),
        }),
        billing: null,
        registrations: [],
        close: () => Promise.resolve(),
      });

      await runtime.stop();
      assert.deepEqual(supervisorModule.stopAllCalls, []);
    } finally {
      delete process.env["PASEO_HUB_CHANNELS_ENABLED"];
    }
  });
});

function fakeDatabaseRuntime(): DatabaseRuntime {
  return { drizzle: () => ({}) } as unknown as DatabaseRuntime;
}

function runtimeDatabase(): Database {
  const database = createMemoryDatabase({
    memberships: [
      {
        userId: "user",
        organizationId: "org",
        organizationName: "Org",
        organizationSlug: "org",
        membershipId: "membership",
        role: "owner",
      },
    ],
  });
  return database;
}

class RuntimeAuth implements AuthServer {
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
      membership: { id: "membership", role: "owner" },
      capabilities: {
        view: true,
        manageMembers: true,
        manageOwners: true,
        manageResources: true,
        manageChannels: true,
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
