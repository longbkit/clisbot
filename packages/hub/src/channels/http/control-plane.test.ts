// COMPAT(clisbot-control-plane): tests for the control-plane HTTP ops (the
// seven thin operations in `./operations.ts`). The contract under test:
// flag-off byte-equivalence (the exact absent-404 problem body, before any
// database or auth state is consulted), the 401/loopback self-auth model, and
// the 200 shapes the CLI's zod `.strict()` schemas parse — including the
// mutation path (credential encrypted in a canonical Connection, no token in
// any revision YAML, revision inserted + activated).

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { createHubApplication, type HubApplication } from "../../app.js";
import { ChannelConfigurationConflictError } from "../../db/errors.js";
import { createMemoryDatabase } from "../../db/memory.js";
import type { Database } from "../../db/types.js";
import { createUnlimitedEntitlementsService } from "../../entitlements/test-utils.js";
import { enrollTestDaemon } from "../../test-utils/project-configuration.js";
import { OrganizationTriggerStore } from "../../triggers/store.js";
import { loadChannelControlPlane } from "../control-plane.js";
import { deployRevision } from "./operations.js";
import type {
  ChannelAccountStartResult,
  ChannelAccountStatusEntry,
  ChannelSupervisor,
} from "../supervisor/types.js";

const HUB_YAML = `
environments:
  work:
    kind: daemon
    daemon: daemon-10000000
    cwd: /workspace/app
agents:
  codex-safe:
    provider: codex
    model: gpt-5.5
`;

// The policy exercises the roles mapping: `operator` is a known role, assigned
// to alice by username, so her view carries it; unknown names would not.
const POLICY_YAML = `
enabled: true
channels:
  slack:
    enabled: true
roles:
  operator:
    grants:
      - bot.interact
users:
  alice:
    name: Alice
    identities: [slack:U1]
assignments:
  - identities:
      - user:alice
    roles:
      - operator
`;

const ACCOUNT_YAML = `
channel: slack
accountId: work
connectionId: slack-work
transport:
  mode: socket
fallback:
  deny: true
`;

const ORG_ID = "org-1";
const SECRET_TOKEN = "xoxb-ops-secret-token";

function memoryDatabase(): Database {
  return createMemoryDatabase({
    memberships: [
      {
        userId: "user-1",
        organizationId: ORG_ID,
        organizationName: "Operator",
        organizationSlug: "operator",
        membershipId: "member-1",
        role: "owner",
      },
    ],
  });
}

async function withActiveConfiguration(database: Database): Promise<void> {
  await enrollTestDaemon(database, ORG_ID);
  await new OrganizationTriggerStore(database, ORG_ID).save({
    yaml: `name: handoff\nenabled: true\non:\n  manual.run: {}\nrun:\n  target: { daemon: daemon-10000000, cwd: /workspace/app }\n  agent: { provider: codex, mode: default }\n  prompt: hand off\n  max_runtime: 1h\n  idle_timeout: 5m\n`,
    userId: null,
  });
  const files = [
    { path: ".paseo/hub.yml", content: HUB_YAML },
    { path: ".paseo/channels/policy.yml", content: POLICY_YAML },
    { path: ".paseo/channels/slack/work.yml", content: ACCOUNT_YAML },
  ];
  await database.saveChannelConfiguration({
    organizationId: ORG_ID,
    files,
    contentHash: "test-channel-configuration",
    createdByUserId: null,
  });
}

function stubSupervisor(
  entries: readonly ChannelAccountStatusEntry[],
  start: ChannelAccountStartResult,
): {
  supervisor: ChannelSupervisor;
  started: { channel: string; account: string }[];
} {
  const started: { channel: string; account: string }[] = [];
  const supervisor: ChannelSupervisor = {
    startAll: async () => {},
    stopAll: async () => {},
    startAccount: async (channel, account) => {
      started.push({ channel, account });
      return start;
    },
    reconcile: async () => ({ accounts: [], stopped: [] }),
    status: () => entries,
    channelReplyPost: async () => ({
      ok: false,
      error: "no transport started in the stub",
    }),
    channelReplyMediaPost: async () => ({
      ok: false,
      error: "no transport started in the stub",
    }),
    postTestMessage: async () => ({
      ok: false,
      error: "no transport started in the stub",
    }),
  };
  return { supervisor, started };
}

function buildApp(
  database: Database | null,
  extras: {
    dataDir?: string;
    supervisor?: ChannelSupervisor | null;
    channelReplyServer?: import("../channel-reply.js").ChannelReplyServer | null;
  } = {},
): HubApplication {
  return createHubApplication({
    database,
    entitlements: createUnlimitedEntitlementsService(),
    publicApi: { status: "unavailable" },
    completionTokenSecret: "hub-secret",
    ...(extras.dataDir === undefined ? {} : { hubDataDir: extras.dataDir }),
    ...(extras.supervisor === undefined ? {} : { channelSupervisor: extras.supervisor }),
    ...(extras.channelReplyServer === undefined
      ? {}
      : { channelReplyServer: extras.channelReplyServer }),
  });
}

function jsonRequest(
  path: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  } = {},
): Request {
  const headers: Record<string, string> = {
    "x-paseo-client-address": "127.0.0.1",
    ...init.headers,
  };
  const body = init.body === undefined ? undefined : JSON.stringify(init.body);
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(`http://hub.test${path}`, {
    method: init.method ?? "GET",
    headers,
    ...(body === undefined ? {} : { body }),
  });
}

const ORIGINAL_FLAG = process.env["PASEO_HUB_CHANNELS_ENABLED"];

afterEach(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env["PASEO_HUB_CHANNELS_ENABLED"];
  else process.env["PASEO_HUB_CHANNELS_ENABLED"] = ORIGINAL_FLAG;
});

describe("channel control-plane ops", () => {
  it("validates a revision against Agent and Environment names from its candidate hub.yml", async () => {
    const database = memoryDatabase();
    await withActiveConfiguration(database);
    const snapshot = await loadChannelControlPlane(database);
    const files = snapshot.files.map((file) => {
      if (file.path === ".paseo/hub.yml") {
        return {
          ...file,
          content: `environments:\n  candidate-env:\n    kind: daemon\n    daemon: daemon-10000000\n    cwd: /workspace/candidate\nagents:\n  candidate-agent:\n    provider: codex\n`,
        };
      }
      if (file.path === ".paseo/channels/slack/work.yml") {
        return {
          ...file,
          content: `${ACCOUNT_YAML}\nroutes:\n  - match: { kind: channel }\n    agent: candidate-agent\n    environment: candidate-env\n`,
        };
      }
      return file;
    });

    await deployRevision(database, snapshot, files);
    const deployed = await loadChannelControlPlane(database);
    assert.deepEqual(deployed.controlPlane.accounts[0]?.routes[0]?.target, {
      kind: "agent",
      agent: "candidate-agent",
      environment: "candidate-env",
      template: null,
    });
  });

  it("rejects a Channel configuration write based on a stale active revision", async () => {
    const database = memoryDatabase();
    await withActiveConfiguration(database);
    const snapshot = await loadChannelControlPlane(database);
    assert.ok(snapshot.revision);

    await deployRevision(database, snapshot, snapshot.files, {
      expectedRevisionId: snapshot.revision.id,
    });

    await assert.rejects(
      deployRevision(database, snapshot, snapshot.files, {
        expectedRevisionId: snapshot.revision.id,
      }),
      ChannelConfigurationConflictError,
    );
  });

  it("answers the exact absent-404 when the kill-switch is off, before db or auth", async () => {
    process.env["PASEO_HUB_CHANNELS_ENABLED"] = "0";
    // Even with a database the flag-off body is the public API's unknown-route
    // 404; with no database it must NOT be the 503 — the flag off means the
    // routes do not exist at all.
    for (const database of [memoryDatabase(), null]) {
      const application = buildApp(database);
      for (const call of [
        () => application.operations.handleChannelList(jsonRequest("/api/v1/channels")),
        () => application.operations.handleUserShow(jsonRequest("/api/v1/users/alice"), "alice"),
      ]) {
        const response = await call();
        assert.equal(response.status, 404);
        assert.equal(response.headers.get("content-type"), "application/problem+json");
        const body = await response.json();
        assert.equal(body.type, "https://paseo.sh/problems/not-found");
        assert.equal(body.title, "Not found");
        assert.equal(body.status, 404);
        assert.equal(body.detail, "No canonical API route matches this path.");
        assert.equal(body.code, "not_found");
        assert.ok(typeof body.requestId === "string" && body.requestId.length > 0);
      }
      // Byte-equivalence against the reference: a Hub without these routes
      // answers /api/v1/channels through the public API's unknown-route 404.
      // Same x-request-id on both sides, so the bodies must match byte for byte.
      const reference = await application.publicApi.handle(
        jsonRequest("/api/v1/channels", {
          headers: { "x-request-id": "flag-off-ref" },
        }),
      );
      const flagOff = await application.operations.handleChannelList(
        jsonRequest("/api/v1/channels", {
          headers: { "x-request-id": "flag-off-ref" },
        }),
      );
      assert.equal(reference.status, flagOff.status);
      assert.equal(reference.headers.get("content-type"), flagOff.headers.get("content-type"));
      assert.equal(reference.headers.get("x-request-id"), flagOff.headers.get("x-request-id"));
      assert.equal(await reference.text(), await flagOff.text());
    }
  });

  it("answers the shared 503 when the flag is on but the database is absent", async () => {
    const application = buildApp(null);
    const response = await application.operations.handleChannelList(
      jsonRequest("/api/v1/channels"),
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "database_unavailable" });
  });

  it("self-authenticates: 401 for non-loopback without a valid Bearer, 200 otherwise", async () => {
    const database = memoryDatabase();
    await withActiveConfiguration(database);
    const application = buildApp(database);
    const list = () => application.operations.handleChannelList(jsonRequest("/api/v1/channels"));

    // No Bearer + non-loopback address → 401 with the Bearer challenge.
    let response = await list();
    {
      const noLoopback = new Request("http://hub.test/api/v1/channels", {
        headers: { "x-paseo-client-address": "10.1.2.3" },
      });
      response = await application.operations.handleChannelList(noLoopback);
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("www-authenticate"), "Bearer");
      assert.equal(response.headers.get("content-type"), "application/problem+json");
      assert.deepEqual(await response.json().then((body) => body.code), "invalid_credentials");
    }
    // Wrong Bearer (any address) → 401.
    response = await application.operations.handleChannelList(
      jsonRequest("/api/v1/channels", {
        headers: { authorization: "Bearer wrong" },
      }),
    );
    assert.equal(response.status, 401);
    // Right Bearer from a non-loopback address → 200.
    response = await application.operations.handleChannelList(
      jsonRequest("/api/v1/channels", {
        headers: {
          authorization: "Bearer hub-secret",
          "x-paseo-client-address": "10.1.2.3",
        },
      }),
    );
    assert.equal(response.status, 200);
    // No Bearer from loopback → 200 (the default header in jsonRequest).
    response = await list();
    assert.equal(response.status, 200);
  });

  it("lists accounts with the compiled enablement and the supervisor's transport", async () => {
    const database = memoryDatabase();
    await withActiveConfiguration(database);
    const { supervisor } = stubSupervisor(
      [
        {
          channel: "slack",
          account: "work",
          pin: "paseo-channel-slack@1.0.0",
          integrity: "ok",
          loadTrace: "ok",
          transport: "started",
        },
      ],
      {
        channel: "slack",
        account: "work",
        installed: false,
        transport: "deferred",
      },
    );
    const application = buildApp(database, { supervisor });
    const response = await application.operations.handleChannelList(
      jsonRequest("/api/v1/channels"),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      accounts: [
        {
          channel: "slack",
          account: "work",
          enabled: true,
          transport: "started",
        },
      ],
    });
  });

  it("reports per-account status straight from the supervisor", async () => {
    const database = memoryDatabase();
    await withActiveConfiguration(database);
    const { supervisor } = stubSupervisor(
      [
        {
          channel: "slack",
          account: "work",
          pin: "paseo-channel-slack@1.0.0",
          integrity: "ok",
          loadTrace: "ok",
          transport: "started",
        },
      ],
      {
        channel: "slack",
        account: "work",
        installed: false,
        transport: "deferred",
      },
    );
    const application = buildApp(database, { supervisor });
    const response = await application.operations.handleChannelStatus(
      jsonRequest("/api/v1/channels/status"),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      accounts: [
        {
          channel: "slack",
          account: "work",
          pin: "paseo-channel-slack@1.0.0",
          integrity: "ok",
          loadTrace: "ok",
          transport: "started",
        },
      ],
    });
  });

  it("degrades status to an empty list without a supervisor", async () => {
    const database = memoryDatabase();
    await withActiveConfiguration(database);
    const application = buildApp(database);
    const response = await application.operations.handleChannelStatus(
      jsonRequest("/api/v1/channels/status"),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accounts: [] });
  });

  it("gates the channel-reply MCP endpoint: flag-off 404, no-server 503, non-loopback 401", async () => {
    // Flag off → the exact absent-404, before db or server state is consulted.
    process.env["PASEO_HUB_CHANNELS_ENABLED"] = "0";
    {
      const application = buildApp(null, {
        channelReplyServer: {
          handle: () => Promise.reject(new Error("must not be reached")),
        },
      });
      const response = await application.operations.handleChannelReplyMcp(
        jsonRequest("/mcp/channel/ref", { method: "POST" }),
        "ref",
      );
      assert.equal(response.status, 404);
      assert.equal(response.headers.get("content-type"), "application/problem+json");
      const body = await response.json();
      assert.equal(body.code, "not_found");
    }
    process.env["PASEO_HUB_CHANNELS_ENABLED"] = "1";
    // Flag on but the server is null (composition degraded) → the shared 503,
    // before auth is consulted.
    {
      const application = buildApp(memoryDatabase(), {
        channelReplyServer: null,
      });
      const noLoopback = new Request("http://hub.test/mcp/channel/ref", {
        method: "POST",
        headers: { "x-paseo-client-address": "10.1.2.3" },
      });
      const response = await application.operations.handleChannelReplyMcp(noLoopback, "ref");
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        error: "database_unavailable",
      });
    }
    // Flag on, server present, non-loopback without a Bearer → 401 problem.
    {
      const application = buildApp(memoryDatabase(), {
        channelReplyServer: {
          handle: () => Promise.reject(new Error("must not be reached")),
        },
      });
      const noLoopback = new Request("http://hub.test/mcp/channel/ref", {
        method: "POST",
        headers: { "x-paseo-client-address": "10.1.2.3" },
      });
      const response = await application.operations.handleChannelReplyMcp(noLoopback, "ref");
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("www-authenticate"), "Bearer");
      const body = await response.json();
      assert.equal(body.code, "invalid_credentials");
    }
    // A valid opaque reply capability is its own narrow bearer authority for
    // an Agent on a non-loopback daemon; it does not grant any other Hub API.
    {
      const application = buildApp(memoryDatabase(), {
        channelReplyServer: {
          accepts: (token) => token === "valid-capability",
          handle: () => Promise.resolve(new Response("mcp-ok", { status: 200 })),
        },
      });
      const response = await application.operations.handleChannelReplyMcp(
        new Request("http://hub.test/mcp/channel/valid-capability", {
          method: "POST",
          headers: { "x-paseo-client-address": "10.1.2.3" },
        }),
        "valid-capability",
      );
      assert.equal(response.status, 200);
    }
  });

  it("forwards the channel-reply MCP request to the server and maps thrown errors to the 500 problem", async () => {
    const saw: { request: Request; token: string }[] = [];
    const okServer: import("../channel-reply.js").ChannelReplyServer = {
      handle: (request, token) => {
        saw.push({ request, token });
        return Promise.resolve(new Response("mcp-ok", { status: 200 }));
      },
    };
    const authorizedLoopback = () =>
      jsonRequest("/mcp/channel/ref", {
        method: "POST",
        headers: {
          authorization: "Bearer hub-secret",
          "x-paseo-client-address": "10.1.2.3",
        },
      });

    const database = memoryDatabase();
    await withActiveConfiguration(database);

    // Authorized (Bearer) → the server's response passes through, token intact.
    {
      const application = buildApp(database, { channelReplyServer: okServer });
      const response = await application.operations.handleChannelReplyMcp(
        authorizedLoopback(),
        "ref-1",
      );
      assert.equal(response.status, 200);
      assert.equal(await response.text(), "mcp-ok");
      assert.equal(saw.length, 1);
      assert.equal(saw[0]?.token, "ref-1");
      assert.equal(saw[0]?.request.url, "http://hub.test/mcp/channel/ref");
    }
    // A server-side throw maps to the shared 500 problem body.
    {
      const failingServer: import("../channel-reply.js").ChannelReplyServer = {
        handle: () => Promise.reject(new Error("boom")),
      };
      const application = buildApp(database, {
        channelReplyServer: failingServer,
      });
      const response = await application.operations.handleChannelReplyMcp(
        authorizedLoopback(),
        "ref-2",
      );
      assert.equal(response.status, 500);
      assert.equal(response.headers.get("content-type"), "application/problem+json");
      const body = await response.json();
      assert.equal(body.code, "internal_error");
    }
  });

  it("lists users with their roles from the org assignments", async () => {
    const database = memoryDatabase();
    await withActiveConfiguration(database);
    const application = buildApp(database);
    const response = await application.operations.handleUsersList(jsonRequest("/api/v1/users"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      users: [
        {
          username: "alice",
          name: "Alice",
          identities: ["slack:U1"],
          roles: ["operator"],
        },
      ],
    });
  });

  it("shows one user, or the 404 problem body when absent", async () => {
    const database = memoryDatabase();
    await withActiveConfiguration(database);
    const application = buildApp(database);
    const found = await application.operations.handleUserShow(
      jsonRequest("/api/v1/users/alice"),
      "alice",
    );
    assert.equal(found.status, 200);
    assert.deepEqual(await found.json(), {
      username: "alice",
      name: "Alice",
      identities: ["slack:U1"],
      roles: ["operator"],
    });
    const absent = await application.operations.handleUserShow(
      jsonRequest("/api/v1/users/ghost"),
      "ghost",
    );
    assert.equal(absent.status, 404);
    assert.equal(absent.headers.get("content-type"), "application/problem+json");
    const body = await absent.json();
    assert.equal(body.code, "not_found");
    assert.match(String(body.detail), /user "ghost"/u);
  });

  it("adds a channel through an encrypted DB connection and stores no token in the revision", async () => {
    const database = memoryDatabase();
    await withActiveConfiguration(database);
    const dataDir = mkdtempSync(join(tmpdir(), "hub-channel-ops-"));
    try {
      const { supervisor, started } = stubSupervisor([], {
        channel: "telegram",
        account: "ops",
        installed: true,
        transport: "started",
      });
      const application = buildApp(database, { dataDir, supervisor });
      const before = (await loadChannelControlPlane(database)).revision!.id;

      const response = await application.operations.handleChannelAdd(
        jsonRequest("/api/v1/channels", {
          method: "POST",
          body: { channel: "telegram", account: "ops", botToken: SECRET_TOKEN },
        }),
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        channel: "telegram",
        account: "ops",
        installed: true,
        revision: true,
        transport: "started",
      });
      assert.deepEqual(started, [{ channel: "telegram", account: "ops" }]);

      // The revision is new, and the token appears in no yml — only the connection id.
      const snapshot = await loadChannelControlPlane(database);
      assert.notEqual(snapshot.revision!.id, before);
      const account = snapshot.controlPlane.accounts.find(
        (entry) => entry.channel === "telegram" && entry.accountId === "ops",
      );
      assert.equal(account?.enabled, true);
      assert.match(account?.connectionId ?? "", /^[0-9a-f-]{36}$/u);
      for (const file of snapshot.files) {
        assert.ok(!file.content.includes(SECRET_TOKEN), `token leaked into ${file.path}`);
      }

      // The new account lists with the degraded transport (the stub knows no
      // "ops" account yet — the supervisor entry wins for "work").
      const listed = await application.operations.handleChannelList(
        jsonRequest("/api/v1/channels"),
      );
      const accounts = (await listed.json()) as { accounts: unknown[] };
      assert.equal(accounts.accounts.length, 2);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects an unsupported channel and a duplicate user with typed 4xx bodies", async () => {
    const database = memoryDatabase();
    await withActiveConfiguration(database);
    const application = buildApp(database);

    const badChannel = await application.operations.handleChannelAdd(
      jsonRequest("/api/v1/channels", {
        method: "POST",
        body: { channel: "discord", account: "ops", secret: "{}" },
      }),
    );
    assert.equal(badChannel.status, 400);
    assert.deepEqual(await badChannel.json().then((body) => body.code), "invalid_request");

    const duplicateUser = await application.operations.handleUserAdd(
      jsonRequest("/api/v1/users", {
        method: "POST",
        body: { username: "bob", identities: ["slack:U1"] },
      }),
    );
    // The pre-compile guard catches the duplicate identity before any write.
    assert.equal(duplicateUser.status, 422);
    assert.deepEqual(await duplicateUser.json().then((body) => body.code), "invalid_configuration");

    const existingUser = await application.operations.handleUserAdd(
      jsonRequest("/api/v1/users", {
        method: "POST",
        body: { username: "alice", identities: ["slack:U9"] },
      }),
    );
    assert.equal(existingUser.status, 409);
  });

  it("adds and edits a user through the policy file", async () => {
    const database = memoryDatabase();
    await withActiveConfiguration(database);
    const application = buildApp(database);

    const added = await application.operations.handleUserAdd(
      jsonRequest("/api/v1/users", {
        method: "POST",
        body: { username: "bob", name: "Bob", identities: ["slack:U2"] },
      }),
    );
    assert.equal(added.status, 200);
    assert.deepEqual(await added.json(), { username: "bob", deployed: true });

    const edited = await application.operations.handleUserEdit(
      jsonRequest("/api/v1/users/bob", {
        method: "PUT",
        body: { name: "Bobby" },
      }),
      "bob",
    );
    assert.equal(edited.status, 200);
    assert.deepEqual(await edited.json(), { username: "bob", deployed: true });

    const shown = await application.operations.handleUserShow(
      jsonRequest("/api/v1/users/bob"),
      "bob",
    );
    assert.equal(shown.status, 200);
    assert.deepEqual(await shown.json(), {
      username: "bob",
      name: "Bobby",
      identities: ["slack:U2"],
      roles: [],
    });

    const emptyEdit = await application.operations.handleUserEdit(
      jsonRequest("/api/v1/users/bob", { method: "PUT", body: {} }),
      "bob",
    );
    assert.equal(emptyEdit.status, 400);

    const missingEdit = await application.operations.handleUserEdit(
      jsonRequest("/api/v1/users/ghost", {
        method: "PUT",
        body: { name: "G" },
      }),
      "ghost",
    );
    assert.equal(missingEdit.status, 404);
  });
});
