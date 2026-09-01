import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { AuthServer } from "../../auth/server.js";
import type { OrganizationAccessValue } from "../../auth/organization-access.js";
import { createMemoryDatabase } from "../../db/memory.js";
import type { StartConnectionAttemptInput } from "../../db/types.js";
import { MemoryDiscordBotClient } from "../../triggers/discord/memory-bot.js";
import type { DiscordConnectionClient } from "./client.js";
import { createDiscordRegistration } from "./index.js";

describe("Discord registration", () => {
  it("constructs the complete Discord slice and delegates connection start", async () => {
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
    let attempt: StartConnectionAttemptInput | undefined;
    database.startConnectionAttempt = (input) => {
      attempt = input;
      return Promise.resolve();
    };
    const registration = createDiscordRegistration({
      database,
      auth: new RegistrationAuth(),
      applicationBaseUrl: "https://hub.test",
      publicBaseUrl: "https://hub.test",
      configuration: {
        botToken: "token",
        clientId: "900",
        clientSecret: "secret",
      },
      bot: new MemoryDiscordBotClient({ selfUserId: "900" }),
      connectionClient: new DiscordClientFake(),
    });

    assert.equal(registration.connection.name, "discord");
    assert.equal(registration.sources.length, 1);
    assert.equal(registration.triggerProviders.length, 1);
    assert.deepEqual(
      registration.outputs.map((output) => output.type),
      ["discord.reply"],
    );
    assert.deepEqual(registration.requests, []);

    const response = await registration.connection.actions["start"]!(
      new Request("https://hub.test/start?organizationSlug=org", { method: "POST" }),
    );
    assert.equal(response.status, 200);
    assert.equal(attempt?.provider, "discord");
    const body: unknown = await response.json();
    assert(body !== null && typeof body === "object" && "url" in body);
    assert(typeof body.url === "string");
    assert.match(body.url, /^https:\/\/discord\.test\/authorize/u);
  });

  it("reports readiness without constructing partial provider behavior", () => {
    const registration = createDiscordRegistration({
      database: createMemoryDatabase(),
      auth: new RegistrationAuth(),
      applicationBaseUrl: "https://hub.test",
      publicBaseUrl: "https://hub.test",
      configuration: null,
    });

    assert.deepEqual(
      registration.connection.status({ github: [], discord: [], slack: [], linear: [] }),
      {
        status: "notConfigured",
      },
    );
    assert.deepEqual(registration.sources, []);
    assert.deepEqual(registration.outputs, []);
  });

  it("keeps provider runtime active without browser authentication", () => {
    const registration = createDiscordRegistration({
      database: createMemoryDatabase(),
      auth: null,
      applicationBaseUrl: "https://hub.test",
      publicBaseUrl: "https://hub.test",
      configuration: {
        botToken: "token",
        clientId: "900",
        clientSecret: "secret",
      },
      bot: new MemoryDiscordBotClient({ selfUserId: "900" }),
      connectionClient: new DiscordClientFake(),
    });

    assert.equal(registration.sources.length, 1);
    assert.equal(registration.triggerProviders.length, 1);
    assert.equal(registration.outputs.length, 1);
    assert.deepEqual(registration.connection.actions, {});
  });
});

class DiscordClientFake implements DiscordConnectionClient {
  authorizationUrl(state: string): string {
    return `https://discord.test/authorize?state=${state}`;
  }
  verifyGuild() {
    return Promise.resolve(undefined);
  }
  leaveGuild(): Promise<void> {
    return Promise.resolve();
  }
  guildMembership() {
    return Promise.resolve("present" as const);
  }
}

class RegistrationAuth implements AuthServer {
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
      capabilities: { view: true, manageMembers: true, manageOwners: true, manageResources: true },
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
