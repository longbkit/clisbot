import type { Server } from "node:http";
import { z } from "zod";
import { createFetchServer } from "../http/node-server.js";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createAuthServer, type AuthServer } from "./server.js";
import { composeEntitlements } from "./entitlements.js";
import { createDatabase } from "../db/pg.js";
import { createTestCredentialCipher } from "../credentials/test-utils.js";
import { embeddedDatabaseRuntime, type DatabaseRuntime } from "../db/runtime/index.js";
import {
  HUB_WEB_CLIENT_CALLBACK,
  HUB_WEB_CLIENT_ORIGIN,
  withHubWebClients,
} from "./web-clients.js";

let origin: string;
let http: Server;
let root: string;
let runtime: DatabaseRuntime;
let auth: AuthServer;
let cookie = "";
let fetchHub: ReturnType<typeof withHubWebClients>;
const realFetch = globalThis.fetch;
const googleToken = () => {
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode({ sub: "existing-google-user", email: "owner@company.test", email_verified: true, name: "Existing owner" })}.test`;
};

beforeAll(async () => {
  http = createFetchServer((request) => auth.handle(request));
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("Missing listener");
  origin = `http://127.0.0.1:${address.port}`;
  root = await mkdtemp(join(tmpdir(), "hub-web-oauth-"));
  const bundle = await embeddedDatabaseRuntime(root);
  runtime = bundle.runtime;
  await runtime.migrate();
  const database = createDatabase(runtime, bundle.locks, createTestCredentialCipher());
  auth = createAuthServer({
    database: runtime,
    locks: bundle.locks,
    entitlements: composeEntitlements(database, runtime).service,
    baseURL: origin,
    secret: "web-client-test-secret-at-least-32-characters",
    google: { clientId: "this-hubs-google-client", clientSecret: "this-hubs-google-secret" },
  });
  await auth.initialize?.();
  fetchHub = withHubWebClients((request) => auth.handle(request));
  // Only Google's remote token response is simulated; all Hub auth, database,
  // admission, OAuth authorization, PKCE exchange and JWT verification are real.
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    if (
      String(input instanceof Request ? input.url : input).startsWith(
        "https://oauth2.googleapis.com/token",
      )
    )
      return Promise.resolve(
        Response.json({
          access_token: "google-token",
          token_type: "Bearer",
          expires_in: 3600,
          id_token: googleToken(),
        }),
      );
    return realFetch(input, init);
  });
}, 120_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  http?.closeAllConnections();
  if (http) await new Promise<void>((resolve) => http.close(() => resolve()));
  await auth?.close();
  await runtime?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

function remember(response: Response) {
  const jar = new Map(
    cookie
      .split("; ")
      .filter(Boolean)
      .map((part): [string, string] => {
        const delimiter = part.indexOf("=");
        return [part.slice(0, delimiter), part.slice(delimiter + 1)];
      }),
  );
  for (const header of response.headers.getSetCookie()) {
    const [key, value] = header.split(";")[0]!.split(/=(.*)/s);
    jar.set(key!, value!);
  }
  cookie = [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
}

async function post(path: string, body: unknown) {
  const response = await fetchHub(
    new Request(`${origin}${path}`, {
      method: "POST",
      headers: { origin, cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  remember(response);
  return response;
}

async function googleLogin(claim: boolean) {
  const start = await post("/api/auth/sign-in/social", {
    provider: "google",
    callbackURL: "/",
    ...(claim ? { intent: "claimInstance" } : {}),
  });
  expect(start.status).toBe(200);
  const google = new URL(z.object({ url: z.string() }).parse(await start.json()).url);
  expect(google.searchParams.get("client_id")).toBe("this-hubs-google-client");
  expect(google.searchParams.get("redirect_uri")).toBe(`${origin}/api/auth/callback/google`);
  const response = await fetchHub(
    new Request(
      `${origin}/api/auth/callback/google?code=test&state=${google.searchParams.get("state")}`,
      { headers: { cookie } },
    ),
  );
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).not.toContain("error=");
  remember(response);
}

async function authorize(redirectUri = HUB_WEB_CLIENT_CALLBACK, withCookie = true) {
  const verifier = randomBytes(48).toString("base64url");
  const url = new URL(`${origin}/api/auth/oauth2/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: "clisbot-client",
    redirect_uri: redirectUri,
    scope: "hub:access offline_access",
    state: "test-client-state",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  const response = await fetchHub(new Request(url, { headers: withCookie ? { cookie } : {} }));
  return { response, verifier };
}

function token(body: Record<string, string>) {
  return fetchHub(
    new Request(`${origin}/api/auth/oauth2/token`, {
      method: "POST",
      headers: {
        origin: HUB_WEB_CLIENT_ORIGIN,
        "sec-fetch-site": "cross-site",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ client_id: "clisbot-client", resource: origin, ...body }),
    }),
  );
}

it("keeps an existing Google account, organization and browser session when the web app connects", async () => {
  const discovery = await fetchHub(
    new Request(`${origin}/api/auth/clisbot/connection`, {
      headers: { origin: HUB_WEB_CLIENT_ORIGIN },
    }),
  );
  expect(await discovery.json()).toEqual({ authentication: "oauth", issuer: origin });
  await googleLogin(true);
  expect((await post("/api/auth/clisbot/complete-app-setup", {})).status).toBe(200);
  const users = (await runtime.query<{ id: string }>(`select id from "user"`)).rows;
  const members = (
    await runtime.query<{ id: string; organization_id: string }>(`select * from member`)
  ).rows;
  const orgs = (await runtime.query(`select * from organization`)).rows;
  expect(users).toHaveLength(1);
  expect(members).toHaveLength(1);
  expect(
    (
      await post("/api/auth/clisbot/select-organization", {
        organizationId: members[0]!.organization_id,
      })
    ).status,
  ).toBe(200);
  const originalCookie = cookie;

  const { response, verifier } = await authorize();
  expect(response.status).toBe(302);
  const callback = new URL(response.headers.get("location")!);
  expect(callback.origin + callback.pathname).toBe(HUB_WEB_CLIENT_CALLBACK);
  expect(callback.searchParams.get("iss")).toBe(origin);
  expect(callback.searchParams.get("state")).toBe("test-client-state");
  const exchanged = await token({
    grant_type: "authorization_code",
    code: callback.searchParams.get("code")!,
    code_verifier: verifier,
    redirect_uri: HUB_WEB_CLIENT_CALLBACK,
  });
  expect(exchanged.status).toBe(200);
  expect(exchanged.headers.get("access-control-allow-origin")).toBe(HUB_WEB_CLIENT_ORIGIN);
  expect(exchanged.headers.has("set-cookie")).toBe(false);
  const credentials = z
    .object({ access_token: z.string(), refresh_token: z.string() })
    .parse(await exchanged.json());
  expect(credentials.refresh_token).toBeTruthy();
  const bearer = await fetchHub(
    new Request(`${origin}/api/auth/clisbot/state`, {
      headers: {
        origin: HUB_WEB_CLIENT_ORIGIN,
        authorization: `Bearer ${credentials.access_token}`,
      },
    }),
  );
  expect(await bearer.json()).toMatchObject({
    status: "active",
    account: { id: users[0]!.id },
    organization: { id: members[0]!.organization_id },
    membership: { id: members[0]!.id },
    capabilities: { manageResources: true },
  });

  const refresh = await token({
    grant_type: "refresh_token",
    refresh_token: credentials.refresh_token,
  });
  expect(refresh.status).toBe(200);
  const browser = await auth.handle(
    new Request(`${origin}/api/auth/clisbot/state`, { headers: { cookie: originalCookie } }),
  );
  expect(await browser.json()).toMatchObject({ account: { id: users[0]!.id } });

  // Worst case: an expired browser session signs in again through the same Google project.
  cookie = "";
  await googleLogin(false);
  expect((await runtime.query(`select id from "user"`)).rows).toEqual(users);
  expect((await runtime.query(`select * from member`)).rows).toEqual(members);
  expect((await runtime.query(`select * from organization`)).rows).toEqual(orgs);
  expect(
    (
      await post("/api/auth/clisbot/select-organization", {
        organizationId: members[0]!.organization_id,
      })
    ).status,
  ).toBe(200);
});

it("sends signed-out users to this Hub and refuses an unregistered callback", async () => {
  const signedOut = await authorize(HUB_WEB_CLIENT_CALLBACK, false);
  expect(signedOut.response.status).toBe(302);
  expect(new URL(signedOut.response.headers.get("location")!, origin).origin).toBe(origin);
  const malicious = await authorize("https://hostile.test/hub-auth-callback");
  expect(malicious.response.headers.get("location") ?? "").not.toContain("https://hostile.test");
  const error = new URL(malicious.response.headers.get("location")!, origin);
  expect(error.origin).toBe(origin);
  expect(error.searchParams.get("error")).toBeTruthy();
  expect(error.searchParams.has("code")).toBe(false);
});

async function appCredentials() {
  const { response, verifier } = await authorize();
  const callback = new URL(response.headers.get("location")!);
  const exchanged = await token({
    grant_type: "authorization_code",
    code: callback.searchParams.get("code")!,
    code_verifier: verifier,
    redirect_uri: HUB_WEB_CLIENT_CALLBACK,
  });
  expect(exchanged.status).toBe(200);
  return z
    .object({ access_token: z.string(), refresh_token: z.string() })
    .parse(await exchanged.json());
}
function appRequest(accessToken: string, path: string, body?: unknown) {
  return fetchHub(
    new Request(`${origin}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        origin: HUB_WEB_CLIENT_ORIGIN,
        "sec-fetch-site": "cross-site",
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

it("OAuth profile, organization and Team actions retain validation, roles and grant scope", async () => {
  const { access_token } = await appCredentials();
  const member = (
    await runtime.query<{ user_id: string; organization_id: string }>(
      `select user_id, organization_id from member`,
    )
  ).rows[0]!;
  const originalCookie = cookie;
  const profile = await appRequest(access_token, "/api/auth/update-user", {
    name: "Renamed through app",
  });
  expect(profile.status, await profile.clone().text()).toBe(200);
  expect(profile.headers.has("set-cookie")).toBe(false);
  expect(
    (
      await appRequest(access_token, "/api/auth/update-user", {
        image: "https://hostile.test/tracker",
      })
    ).status,
  ).toBe(400);
  expect((await appRequest("invalid", "/api/auth/update-user", { name: "Wrong" })).status).toBe(
    401,
  );
  expect(
    (
      await appRequest(access_token, "/api/auth/organization/update", {
        data: { name: "App organization" },
      })
    ).status,
  ).toBe(200);
  const team = await appRequest(access_token, "/api/auth/organization/create-team", {
    name: "App team",
  });
  expect(team.status, await team.clone().text()).toBe(200);
  const created = z.object({ id: z.string(), organizationId: z.string() }).parse(await team.json());
  expect(created.organizationId).toBe(member.organization_id);
  const updated = await appRequest(access_token, "/api/auth/organization/update-team", {
    teamId: created.id,
    data: { name: "Renamed team" },
  });
  expect(updated.status, await updated.clone().text()).toBe(200);
  expect((await appRequest(access_token, "/api/auth/organization/list-teams")).status).toBe(200);
  // The same user also belongs to another org; the app grant must not gain its authority.
  const otherOrg = "oauth-other-org";
  await runtime.query(`insert into organization (id, name, slug) values ($1, 'Other', $1)`, [
    otherOrg,
  ]);
  await runtime.query(
    `insert into member (id, user_id, organization_id, role) values ('other-membership', $1, $2, 'owner')`,
    [member.user_id, otherOrg],
  );
  await runtime.query(
    `insert into team (id, name, organization_id) values ('other-team', 'Other', $1)`,
    [otherOrg],
  );
  await runtime.query(`update session set active_organization_id = $1 where user_id = $2`, [
    otherOrg,
    member.user_id,
  ]);
  expect(
    (
      await appRequest(access_token, "/api/auth/organization/update", {
        organizationId: otherOrg,
        data: { name: "Wrong" },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await appRequest(access_token, "/api/auth/organization/update-team", {
        teamId: "other-team",
        data: { name: "Wrong" },
      })
    ).status,
  ).toBe(403);
  expect(
    (await appRequest(access_token, "/api/auth/organization/list-teams?organizationId=" + otherOrg))
      .status,
  ).toBe(403);
  expect(
    (
      await appRequest(access_token, "/api/auth/organization/update", {
        organizationId: otherOrg,
        teamId: 123,
        data: { name: "Wrong" },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await appRequest(access_token, `/api/auth/organization/update-team?teamId=${created.id}`, {
        teamId: "other-team",
        data: { name: "Wrong" },
      })
    ).status,
  ).toBe(403);
  const scoped = await appRequest(access_token, "/api/auth/organization/create-team", {
    name: "Still original org",
  });
  expect(scoped.status).toBe(200);
  expect(z.object({ organizationId: z.string() }).parse(await scoped.json()).organizationId).toBe(
    member.organization_id,
  );
  await runtime.query(
    `update member set role = 'member' where user_id = $1 and organization_id = $2`,
    [member.user_id, member.organization_id],
  );
  expect(
    (
      await appRequest(access_token, "/api/auth/organization/update", {
        data: { name: "Forbidden" },
      })
    ).status,
  ).toBe(403);
  expect(
    (await appRequest(access_token, "/api/auth/organization/create-team", { name: "Forbidden" }))
      .status,
  ).toBe(403);
  await runtime.query(
    `update member set role = 'owner' where user_id = $1 and organization_id = $2`,
    [member.user_id, member.organization_id],
  );
  await runtime.query(`update session set active_organization_id = $1 where user_id = $2`, [
    member.organization_id,
    member.user_id,
  ]);
  const browser = await auth.handle(
    new Request(`${origin}/api/auth/clisbot/state`, { headers: { cookie: originalCookie } }),
  );
  expect(await browser.json()).toMatchObject({
    status: "active",
    account: { id: member.user_id, name: "Renamed through app" },
  });
});

it("OAuth password change checks the old password and never exports a browser session", async () => {
  const { hashPassword } = await import("better-auth/crypto");
  const user = (await runtime.query<{ id: string }>(`select id from "user"`)).rows[0]!;
  await runtime.query(
    `insert into account (id, account_id, provider_id, user_id, password) values ('oauth-password', $1, 'credential', $1, $2)`,
    [user.id, await hashPassword("original-password-123")],
  );
  const { access_token } = await appCredentials();
  const bad = await appRequest(access_token, "/api/auth/change-password", {
    currentPassword: "wrong-password",
    newPassword: "changed-password-123",
  });
  expect(bad.status, await bad.clone().text()).toBe(400);
  const changed = await appRequest(access_token, "/api/auth/change-password", {
    currentPassword: "original-password-123",
    newPassword: "changed-password-123",
  });
  expect(changed.status, await changed.clone().text()).toBe(200);
  expect(changed.headers.has("set-cookie")).toBe(false);
  expect(await changed.json()).toMatchObject({ token: null });
});
