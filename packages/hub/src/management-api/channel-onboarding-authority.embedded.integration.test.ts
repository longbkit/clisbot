import { it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { hashPassword } from "better-auth/crypto";
import { embeddedDatabaseRuntime } from "../db/runtime/index.js";
import { createDatabase } from "../db/pg.js";
import { createTestCredentialCipher } from "../credentials/test-utils.js";
import { InstanceSetup } from "../instance-setup/index.js";
import { UNLIMITED_PROVISIONING } from "../organizations/provisioning.js";
import { composeEntitlements } from "../auth/entitlements.js";
import { createAuthServer } from "../auth/server.js";
import { cliCredentialParts } from "../auth/cli-credentials.js";
import { AccessStore } from "../access/store.js";
import { AccessTicketService } from "../managed-access/tickets.js";
import { ManagementApi } from "./index.js";
import { createFetchServer } from "../http/node-server.js";
import { enrollTestDaemon, TEST_DAEMON_ID } from "../test-utils/project-configuration.js";
import type { BotPayload } from "@clisbot/protocol/bots/types";

it("preserves identity verification authority for authenticated Admin browser/API/CLI and operator onboarding", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "onboarding-authority-"));
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
    }).claim({ email: "operator@example.test", password: "isolated-operator-password" });
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    const address = http.address();
    if (!address || typeof address === "string") throw Error("No fixture listener");
    const origin = `http://127.0.0.1:${address.port}`;
    auth = createAuthServer({
      database: bundle.runtime,
      locks: bundle.locks,
      entitlements: entitlements.service,
      baseURL: origin,
      secret: "fixture-auth-secret-that-is-long-enough",
    });
    await auth.initialize?.();
    const login = async (email: string, password: string) => {
      const response = await fetch(`${origin}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      expect(response.status).toBe(200);
      return response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
    };
    const operatorCookie = await login("operator@example.test", "isolated-operator-password");
    const state = await (
      await fetch(`${origin}/api/auth/clisbot/state`, { headers: { cookie: operatorCookie } })
    ).json();
    const org = state.organization.id as string,
      operator = state.account.id as string;
    const operatorMember = (
      await bundle.runtime.query<{ id: string }>(
        "select id from member where organization_id = $1 and user_id = $2",
        [org, operator],
      )
    ).rows[0]!.id;
    for (const [id, role] of [
      ["admin", "admin"],
      ["victim", "owner"],
    ]) {
      await bundle.runtime.query(
        `insert into "user" (id, name, email, email_verified) values ($1, $1, $2, true)`,
        [id, `${id}@example.test`],
      );
      await bundle.runtime.query(
        `insert into member (id, organization_id, user_id, role) values ($1, $2, $3, $4)`,
        [`member-${id}`, org, id, role],
      );
    }
    await bundle.runtime.query(
      `insert into account (id, account_id, provider_id, user_id, password) values ('admin-password', 'admin', 'credential', 'admin', $1)`,
      [await hashPassword("isolated-admin-password")],
    );
    const adminCookie = await login("admin@example.test", "isolated-admin-password");
    const adminState = await (
      await fetch(`${origin}/api/auth/clisbot/state`, { headers: { cookie: adminCookie } })
    ).json();
    expect(adminState.organization.id).toBe(org);
    expect(adminState.membership.role).toBe("admin");
    const owners = {
      bot_aaaaaaaaaaaaaaaa: { id: "admin", memberId: "member-admin" },
      bot_bbbbbbbbbbbbbbbb: { id: "victim", memberId: "member-victim" },
      bot_cccccccccccccccc: { id: operator, memberId: operatorMember },
    };
    const bot = (id: string): BotPayload | undefined => {
      const owner = owners[id as keyof typeof owners];
      if (!owner) return undefined;
      return {
        id,
        slug: id,
        name: "Authority fixture",
        kind: "personal",
        projectId: "prj_fixture",
        workspaceId: "ws_fixture",
        cwd: "/isolated/bot",
        launch: { provider: "codex" },
        template: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        archivedAt: null,
        owner: { kind: "user", ...owner, organizationId: org },
      };
    };
    const access = new AccessStore(bundle.runtime);
    management = new ManagementApi({
      database,
      runtime: bundle.runtime,
      auth,
      access,
      tickets: new AccessTicketService(bundle.runtime, access),
      channelSupervisor: null,
      ...(auth.publicCredentials ? { credentials: auth.publicCredentials } : {}),
      readOnboardingBot: async (_daemon, id) => bot(id),
    });
    await enrollTestDaemon(database, org);
    const key = await auth.apiKeys!.create(org, "admin", "admin configuration", [
      "configuration:install",
    ]);
    const cliSecret = "clisbot_cli_ABCDEFGHIJKL_isolated-test-secret";
    const parts = cliCredentialParts(cliSecret);
    await bundle.runtime.query(
      `insert into organization_cli_credentials (organization_id, prefix, verifier, created_by_user_id) values ($1, $2, $3, 'admin')`,
      [org, parts.prefix, parts.verifier],
    );
    const headers = [
      { origin, cookie: adminCookie },
      { authorization: `Bearer ${key.secret}` },
      { authorization: `Bearer ${cliSecret}` },
    ];
    const endpoint = `${origin}/api/management/v1/organizations/${org}/channel-onboarding`;
    let sequence = 0;
    const post = (header: Record<string, string>, setup: Record<string, unknown>, url = endpoint) =>
      fetch(url, {
        method: "POST",
        headers: { ...header, "content-type": "application/json" },
        body: JSON.stringify({
          channel: "telegram",
          account: `authority-${++sequence}`,
          botToken: "isolated-no-platform-token",
          setup: {
            name: "Authority fixture",
            botId: "bot_bbbbbbbbbbbbbbbb",
            daemonId: TEST_DAEMON_ID,
            projectId: "prj_fixture",
            cwd: "/isolated/bot",
            provider: "codex",
            ...setup,
          },
        }),
      });
    const count = async (table: string, member?: string) =>
      (
        await bundle.runtime.query<{ n: number }>(
          `select count(*)::integer as n from ${table}${member ? " where member_id = $1" : ""}`,
          member ? [member] : [],
        )
      ).rows[0]!.n;
    for (const header of headers) {
      expect(
        (await post(header, { ownerMemberId: "member-victim", ownerIdentity: "attacker-subject" }))
          .status,
      ).toBe(403);
      expect(
        (
          await post(header, {
            botId: "bot_aaaaaaaaaaaaaaaa",
            ownerMemberId: "member-admin",
            ownerIdentity: "self-unverified-subject",
          })
        ).status,
      ).toBe(403);
      const pending = await post(header, { ownerMemberId: "member-victim" });
      expect(pending.status).toBe(200);
      const body = await pending.json();
      expect(body.owner).toMatchObject({
        ready: false,
        guidance: expect.stringContaining("Bot Owner must sign in"),
      });
      expect(body.owner.command).toBeUndefined();
      expect(body.owner.expiresAt).toBeUndefined();
      expect(await count("channel_identity_challenges", "member-victim")).toBe(0);
      expect(await count("channel_identities")).toBe(0);
      const self = await post(header, { botId: "bot_aaaaaaaaaaaaaaaa" });
      expect(self.status).toBe(200);
      expect((await self.json()).owner.command).toMatch(/^\/link /);
    }
    expect(await count("channel_identity_challenges", "member-admin")).toBe(3);
    expect((await post(headers[0]!, { ownerMemberId: "member-admin" })).status).toBe(409);
    expect((await post(headers[0]!, { ownerOrganizationId: "another-org" })).status).toBe(409);
    expect((await post(headers[0]!, { botId: "bot_dddddddddddddddd" })).status).toBe(409);
    expect((await post(headers[0]!, {}, endpoint.replace(org, "other-org"))).status).toBe(404);
    expect((await post(headers[1]!, {}, endpoint.replace(org, "other-org"))).status).toBe(403);
    expect(
      (
        await post(
          { origin, cookie: operatorCookie, authorization: `Bearer ${key.secret}` },
          { ownerMemberId: "member-victim", ownerIdentity: "borrowed-operator-cookie" },
        )
      ).status,
    ).toBe(403);
    const operatorPending = await post(
      { origin, cookie: operatorCookie },
      { ownerMemberId: "member-victim" },
    );
    expect((await operatorPending.json()).owner.command).toBeUndefined();
    expect(await count("channel_identity_challenges", "member-victim")).toBe(0);
    const operatorKey = await auth.apiKeys!.create(org, operator, "operator configuration only", [
      "configuration:install",
    ]);
    expect(
      (
        await post(
          { authorization: `Bearer ${operatorKey.secret}` },
          { botId: "bot_cccccccccccccccc", ownerIdentity: "unverified-operator-self" },
        )
      ).status,
    ).toBe(403);
    const positive = await post(
      { origin, cookie: operatorCookie },
      { ownerMemberId: "member-victim", ownerIdentity: "verified-by-operator" },
    );
    expect(positive.status).toBe(200);
    expect((await positive.json()).owner.ready).toBe(true);
    expect((await access.listChannelIdentities(org))[0]).toMatchObject({
      memberId: "member-victim",
      externalSubjectId: "verified-by-operator",
      verificationMethod: "administrator",
      verifiedByUserId: operator,
    });
    await bundle.runtime.query(
      "update organization_api_keys set revoked_at = now() where id = $1",
      [key.summary.id],
    );
    await bundle.runtime.query(
      "update organization_cli_credentials set revoked_at = now() where prefix = $1",
      [parts.prefix],
    );
    expect((await post(headers[1]!, {})).status).toBe(401);
    expect((await post(headers[2]!, {})).status).toBe(401);
    expect(
      (
        await post(
          { origin, cookie: operatorCookie, authorization: `Bearer ${key.secret}` },
          { ownerIdentity: "revoked-credential-cookie-fallback" },
        )
      ).status,
    ).toBe(401);
    await database.revokeDaemon(TEST_DAEMON_ID);
    expect((await post(headers[0]!, {})).status).toBe(400);
    await bundle.runtime.query("update member set role = 'member' where id = 'member-admin'");
    expect((await post(headers[0]!, {})).status).toBe(403);
  } finally {
    http.closeAllConnections();
    await new Promise<void>((resolve) => http.close(() => resolve()));
    await entitlements.close();
    await bundle.runtime.close();
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);
