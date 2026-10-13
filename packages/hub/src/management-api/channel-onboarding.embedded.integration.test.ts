import { it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { embeddedDatabaseRuntime } from "../db/runtime/index.js";
import { createDatabase } from "../db/pg.js";
import { createTestCredentialCipher } from "../credentials/test-utils.js";
import { InstanceSetup } from "../instance-setup/index.js";
import { UNLIMITED_PROVISIONING } from "../organizations/provisioning.js";
import { composeEntitlements } from "../auth/entitlements.js";
import { createAuthServer } from "../auth/server.js";
import { AccessStore } from "../access/store.js";
import { AccessTicketService } from "../managed-access/tickets.js";
import { ManagementApi } from "./index.js";
import { createFetchServer } from "../http/node-server.js";
import { enrollTestDaemon, TEST_DAEMON_ID } from "../test-utils/project-configuration.js";

it("authenticates remote onboarding, scopes it to the signed-in organization and preserves exact owner defaults", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "remote-onboarding-"));
  const bundle = await embeddedDatabaseRuntime(root);
  const database = createDatabase(bundle.runtime, bundle.locks, createTestCredentialCipher());
  const entitlements = composeEntitlements(database, bundle.runtime);
  let auth: ReturnType<typeof createAuthServer>;
  let management: ManagementApi;
  const http = createFetchServer((request) =>
    new URL(request.url).pathname.startsWith("/api/management/")
      ? management.handle(request)
      : auth.handle(request),
  );
  try {
    await bundle.runtime.migrate();
    await new InstanceSetup({
      database: bundle.runtime,
      policy: {
        registrationMode: "invite_only",
        organizationCreation: "disabled",
        bootstrap: undefined,
      },
      provisioningEntitlements: async () => UNLIMITED_PROVISIONING,
    }).claim({ email: "owner@example.test", password: "isolated-owner-password" });
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    const address = http.address();
    if (!address || typeof address === "string") throw new Error("No test listener");
    const origin = `http://127.0.0.1:${address.port}`;
    auth = createAuthServer({
      database: bundle.runtime,
      locks: bundle.locks,
      entitlements: entitlements.service,
      baseURL: origin,
      secret: "fixture-secret-that-is-long-enough",
    });
    await auth.initialize?.();
    const access = new AccessStore(bundle.runtime);
    management = new ManagementApi({
      database,
      runtime: bundle.runtime,
      auth,
      access,
      tickets: new AccessTicketService(bundle.runtime, access),
      channelSupervisor: null,
      readOnboardingBot: async () => ({
        id: "bot_1234567890123456",
        slug: "remote-assistant",
        name: "Remote Assistant",
        kind: "personal",
        projectId: "prj_fixture",
        workspaceId: "ws_fixture",
        cwd: "/isolated/bot",
        launch: { provider: "codex" },
        template: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        archivedAt: null,
        owner: {
          kind: "user",
          id: state.account.id,
          memberId: ownerMemberId,
          organizationId,
        },
      }),
      ...(auth.publicCredentials ? { credentials: auth.publicCredentials } : {}),
    });
    const login = await fetch(`${origin}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ email: "owner@example.test", password: "isolated-owner-password" }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const state = await (
      await fetch(`${origin}/api/auth/clisbot/state`, { headers: { cookie } })
    ).json();
    const organizationId = state.organization.id;
    const ownerMemberId = (
      await bundle.runtime.query<{ id: string }>(
        "select id from member where organization_id = $1 and user_id = $2",
        [organizationId, state.account.id],
      )
    ).rows[0]!.id;
    const endpoint = `${origin}/api/management/v1/organizations/${organizationId}/channel-onboarding`;
    const prepare = (url = endpoint, authenticated = true) =>
      fetch(url, {
        method: "PUT",
        headers: {
          origin,
          "content-type": "application/json",
          ...(authenticated ? { cookie } : {}),
        },
        body: "{}",
      });
    expect((await prepare(endpoint, false)).status).toBe(401);
    expect((await prepare(endpoint.replace(organizationId, "other-org"))).status).toBe(404);
    const prepared = await prepare();
    expect(prepared.status).toBe(200);
    expect((await prepared.json()).organizationId).toBe(organizationId);
    const key = await auth.apiKeys!.create(organizationId, state.account.id, "fixture onboarding", [
      "configuration:install",
    ]);
    const bearerPrepare = () =>
      fetch(endpoint, {
        method: "PUT",
        headers: { authorization: `Bearer ${key.secret}`, "content-type": "application/json" },
        body: "{}",
      });
    expect((await bearerPrepare()).status).toBe(200);
    await enrollTestDaemon(database, organizationId);
    const created = await fetch(endpoint, {
      method: "POST",
      headers: { origin, cookie, "content-type": "application/json" },
      body: JSON.stringify({
        channel: "telegram",
        account: "remote-assistant",
        botToken: "isolated-token",
        setup: {
          name: "Remote Assistant",
          botId: "bot_1234567890123456",
          daemonId: TEST_DAEMON_ID,
          projectId: "prj_fixture",
          cwd: "/isolated/bot",
          provider: "codex",
        },
      }),
    });
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({ transport: "deferred", owner: { ready: false } });
    await bundle.runtime.query("update member set role = 'member' where organization_id = $1", [
      organizationId,
    ]);
    expect((await prepare()).status).toBe(403);
    expect((await bearerPrepare()).status).toBe(403);
  } finally {
    http.closeAllConnections();
    await new Promise<void>((resolve) => http.close(() => resolve()));
    await entitlements.close();
    await bundle.runtime.close();
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);
