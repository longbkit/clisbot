import { createServer, type Server } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { composeEntitlements } from "./entitlements.js";
import { createAuthServer, type AuthServer } from "./server.js";
import { createTestCredentialCipher } from "../credentials/test-utils.js";
import { createDatabase } from "../db/pg.js";
import { embeddedDatabaseRuntime, type DatabaseRuntime } from "../db/runtime/index.js";
import {
  MasterPasswordReset,
  MASTER_PASSWORD_RESET_PATH,
  recoveryMasterPassword,
  recoverySessionValid,
} from "./master-password-reset.js";

let origin: string;
let http: Server;
const master = "test-master-password-with-at-least-32-characters";
const email = "owner@example.test";
let root: string;
let runtime: DatabaseRuntime;
let auth: AuthServer;
let userId: string;
let originalCookie: string;
let originalSession: string;
let originalJwt: string;

function request(body: unknown, credential = master): Request {
  return new Request(`${origin}${MASTER_PASSWORD_RESET_PATH}`, {
    method: "POST",
    headers: { origin, "content-type": "application/json", authorization: `Bearer ${credential}` },
    body: JSON.stringify(body),
  });
}

async function signIn(password: string): Promise<Response> {
  return auth.handle(
    new Request(`${origin}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    }),
  );
}

beforeAll(async () => {
  http = createServer(async (incoming, outgoing) => {
    const result = await auth.handle(new Request(`${origin}${incoming.url}`));
    outgoing.writeHead(result.status, Object.fromEntries(result.headers));
    outgoing.end(await result.text());
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("Missing test listener");
  origin = `http://127.0.0.1:${address.port}`;
  root = await mkdtemp(join(tmpdir(), "hub-master-recovery-"));
  const bundle = await embeddedDatabaseRuntime(join(root, "database"));
  runtime = bundle.runtime;
  await runtime.migrate();
  const database = createDatabase(runtime, bundle.locks, createTestCredentialCipher());
  auth = createAuthServer({
    database: runtime,
    locks: bundle.locks,
    entitlements: composeEntitlements(database, runtime).service,
    secret: "test-auth-secret".padEnd(32, "-"),
    baseURL: origin,
    masterPassword: master,
  });
  await auth.initialize?.();
  const claimed = await auth.handle(
    new Request(`${origin}/api/auth/paseo/claim-instance`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ email, password: "original-owner-password" }),
    }),
  );
  expect(claimed.status).toBe(200);
  originalCookie = claimed.headers.get("set-cookie")!.split(";")[0]!;
  const session = await runtime.query<{ id: string; user_id: string }>(
    `select id, user_id from "session" limit 1`,
  );
  userId = session.rows[0]!.user_id;
  originalSession = session.rows[0]!.id;
  const completed = await auth.handle(
    new Request(`${origin}/api/auth/paseo/complete-app-setup`, {
      method: "POST",
      headers: { origin, cookie: originalCookie, "content-type": "application/json" },
      body: "{}",
    }),
  );
  expect(completed.status).toBe(200);
  originalJwt = await authorize(originalCookie);
}, 120_000);

afterAll(async () => {
  http?.closeAllConnections();
  if (http) await new Promise<void>((resolve) => http.close(() => resolve()));
  await auth?.close();
  await runtime?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

it("is disabled without configuration, rejects weak configuration and does not expose account existence to an incorrect master", async () => {
  expect(recoveryMasterPassword(" ")).toBeUndefined();
  expect(() => recoveryMasterPassword("x".repeat(32) + " ")).toThrow("ASCII");
  expect(() => recoveryMasterPassword("short")).toThrow("32");
  expect(
    (
      await new MasterPasswordReset(runtime).handle(
        request({ email, newPassword: "replacement-password" }),
      )
    ).status,
  ).toBe(404);
  for (const address of [email, "missing@example.test"])
    expect(
      (await auth.handle(request({ email: address, newPassword: "replacement-password" }, "wrong")))
        .status,
    ).toBe(401);
  expect((await signIn("original-owner-password")).ok).toBe(true);
});

it("bounds input and rate limits across different accounts without trusting spoofed client headers", async () => {
  const recovery = new MasterPasswordReset(runtime, master);
  expect((await recovery.handle(request({ email, newPassword: "x" }))).status).toBe(400);
  expect((await recovery.handle(request({ email, newPassword: master }))).status).toBe(400);
  expect((await recovery.handle(request({ email, newPassword: "x".repeat(5000) }))).status).toBe(
    413,
  );
  for (let i = 0; i < 2; i++)
    expect((await recovery.handle(request({ email: `${i}@example.test` }, "wrong"))).status).toBe(
      401,
    );
  const limited = await recovery.handle(request({ email, newPassword: "replacement-password" }));
  expect(limited.status).toBe(429);
  expect(limited.headers.get("retry-after")).toBe("60");
});

it("rejects cross-site requests and never creates an account", async () => {
  const recovery = new MasterPasswordReset(runtime, master);
  const hostile = request({ email, newPassword: "replacement-password" });
  hostile.headers.set("sec-fetch-site", "cross-site");
  expect((await auth.handle(hostile)).status).toBe(403);
  expect(
    (
      await recovery.handle(
        request({ email: "missing@example.test", newPassword: "replacement-password" }),
      )
    ).status,
  ).toBe(404);
  expect(
    (await runtime.query(`select id from "user" where email = 'missing@example.test'`)).rowCount,
  ).toBe(0);
});

it("resets via the HTTP boundary, revokes sessions and OAuth credentials, preserves membership and records no secrets", async () => {
  const members = (await runtime.query(`select * from member where user_id = $1`, [userId])).rows;
  expect(await recoverySessionValid(runtime, userId, originalSession)).toBe(true);
  await runtime.query(
    `insert into oauth_refresh_token
    (id, token, client_id, session_id, user_id, expires_at, created_at, scopes)
    values ('test-refresh', 'private-refresh', 'paseo-client', $1, $2, now() + interval '1 day', now(), '{}')`,
    [originalSession, userId],
  );
  await runtime.query(
    `insert into oauth_access_token
    (id, token, client_id, session_id, user_id, expires_at, created_at, scopes)
    values ('test-access', 'private-access', 'paseo-client', $1, $2, now() + interval '1 day', now(), '{}')`,
    [originalSession, userId],
  );
  expect((await auth.resolveAccount(bearer(originalJwt))).account.id).toBe(userId);
  const reset = await auth.handle(
    request({ email: email.toUpperCase(), newPassword: "replacement-owner-password" }),
  );
  expect(reset.status).toBe(200);
  expect(await reset.json()).toEqual({ code: "password_reset" });
  expect(reset.headers.get("set-cookie")).toBeNull();
  expect((await signIn("original-owner-password")).ok).toBe(false);
  for (const table of ["session", "oauth_refresh_token", "oauth_access_token"])
    expect(
      (await runtime.query(`select id from "${table}" where user_id = $1`, [userId])).rowCount,
    ).toBe(0);
  const oldSession = await auth.handle(
    new Request(`${origin}/api/auth/get-session`, { headers: { cookie: originalCookie } }),
  );
  expect(await oldSession.json()).toBeNull();
  expect(await recoverySessionValid(runtime, userId, originalSession)).toBe(false);
  await expect(auth.resolveAccount(bearer(originalJwt))).rejects.toThrow();
  const signedIn = await signIn("replacement-owner-password");
  expect(signedIn.ok).toBe(true);
  const freshJwt = await authorize(signedIn.headers.get("set-cookie")!.split(";")[0]!);
  expect((await auth.resolveAccount(bearer(freshJwt))).account.id).toBe(userId);
  const session = (
    await runtime.query<{ id: string }>(`select id from "session" where user_id = $1`, [userId])
  ).rows[0]!;
  expect(await recoverySessionValid(runtime, userId, session.id)).toBe(true);
  expect((await runtime.query(`select * from member where user_id = $1`, [userId])).rows).toEqual(
    members,
  );
  const audits = (
    await runtime.query(`select * from audit_events where action = 'account.password.reset'`)
  ).rows;
  expect(audits).toHaveLength(1);
  expect(JSON.stringify(audits)).not.toContain(master);
  expect(JSON.stringify(audits)).not.toContain("replacement-owner-password");
});

it("rolls back the password and session revocation together if the audit write fails", async () => {
  await runtime.query(`create function reject_recovery_audit() returns trigger language plpgsql as $$
    begin raise exception 'test audit failure'; end $$`);
  await runtime.query(`create trigger reject_recovery before insert on audit_events
    for each row execute function reject_recovery_audit()`);
  try {
    await expect(
      new MasterPasswordReset(runtime, master).handle(
        request({ email, newPassword: "must-not-be-installed" }),
      ),
    ).rejects.toThrow();
    expect((await signIn("replacement-owner-password")).ok).toBe(true);
    expect((await signIn("must-not-be-installed")).ok).toBe(false);
    expect(
      (await runtime.query(`select id from "session" where user_id = $1`, [userId])).rowCount,
    ).toBeGreaterThan(0);
  } finally {
    await runtime.query(`drop trigger reject_recovery on audit_events`);
    await runtime.query(`drop function reject_recovery_audit()`);
  }
});

function bearer(token: string): Request {
  return new Request(`${origin}/api/auth/paseo/account`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

async function authorize(cookie: string): Promise<string> {
  const organization = (
    await runtime.query<{ organization_id: string }>(
      `select organization_id from member where user_id = $1 limit 1`,
      [userId],
    )
  ).rows[0]!;
  const selected = await auth.handle(
    new Request(`${origin}/api/auth/paseo/select-organization`, {
      method: "POST",
      headers: { origin, cookie, "content-type": "application/json" },
      body: JSON.stringify({ organizationId: organization.organization_id }),
    }),
  );
  expect(selected.status).toBe(200);
  const verifier = randomBytes(48).toString("base64url");
  const redirectUri = "http://127.0.0.1:49152/hub-auth/callback";
  const url = new URL(`${origin}/api/auth/oauth2/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: "paseo-client",
    redirect_uri: redirectUri,
    scope: "hub:access offline_access",
    state: "recovery-test-state",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  const response = await auth.handle(new Request(url, { headers: { cookie } }));
  expect(response.status).toBe(302);
  const code = new URL(response.headers.get("location")!).searchParams.get("code");
  expect(code).toBeTruthy();
  const exchanged = await auth.handle(
    new Request(`${origin}/api/auth/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: "paseo-client",
        redirect_uri: redirectUri,
        code: code!,
        code_verifier: verifier,
        resource: origin,
      }),
    }),
  );
  expect(exchanged.status).toBe(200);
  const body = (await exchanged.json()) as { access_token: string };
  expect(body.access_token).toBeTruthy();
  return body.access_token;
}
