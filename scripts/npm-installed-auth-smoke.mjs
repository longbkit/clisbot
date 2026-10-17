import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function verifyInstalledHubAuth(hubManifest, fixture) {
  const load = (file) => import(pathToFileURL(path.join(path.dirname(hubManifest), "dist", file)));
  const { configureRuntimeRoot } = await load("runtime-files.js");
  const restoreRoot = configureRuntimeRoot(path.dirname(hubManifest));
  const { embeddedDatabaseRuntime } = await load("db/runtime/index.js");
  const { createDatabase } = await load("db/pg.js");
  const { createCredentialCipher } = await load("credentials/credential-cipher.js");
  const { composeEntitlements } = await load("auth/entitlements.js");
  const { createAuthServer } = await load("auth/server.js");
  const { runtime, locks } = await embeddedDatabaseRuntime(path.join(fixture, "auth-database"));
  let auth, entitlements, origin;
  const server = authHttpServer((request) => auth.handle(request));
  try {
    await runtime.migrate();
    const database = createDatabase(
      runtime,
      locks,
      createCredentialCipher({
        keyId: "install-smoke",
        masterKey: randomBytes(32),
      }),
    );
    entitlements = composeEntitlements(database, runtime);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    origin = `http://127.0.0.1:${server.address().port}`;
    auth = createAuthServer({
      database: runtime,
      locks,
      entitlements: entitlements.service,
      secret: randomBytes(32).toString("hex"),
      baseURL: origin,
    });
    await auth.initialize();
    await verifyAccountAuthentication(auth, origin);
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await auth?.close();
    await entitlements?.close();
    await runtime.close();
    restoreRoot();
  }
}

function authHttpServer(handle) {
  return createServer(async (incoming, outgoing) => {
    try {
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const response = await handle(
        new Request(`http://${incoming.headers.host}${incoming.url}`, {
          method: incoming.method,
          headers: incoming.headers,
          ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
        }),
      );
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(await response.text());
    } catch (error) {
      outgoing.writeHead(500);
      outgoing.end(String(error));
    }
  });
}

async function verifyAccountAuthentication(auth, origin) {
  const email = "installed-owner@example.test";
  const password = "installed-smoke-password";
  const headers = new Headers({ origin, "content-type": "application/json" });
  // These server actions run Better Auth's cookie after-hook, including its
  // dynamic Start server import. HTTP-only sign-in skips that integration.
  await auth.claimInstance({ email, password }, headers);
  await auth.signInEmail({ email, password }, headers);
  const signIn = (attemptedPassword) =>
    fetch(`${origin}/api/auth/sign-in/email`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email, password: attemptedPassword }),
    });
  assert.equal((await signIn("incorrect-password")).status, 401);
  const retry = await signIn(password);
  assert.equal(retry.status, 200, await retry.text());
  const cookie = retry.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  assert(cookie.includes("session_token="));
  const session = await fetch(`${origin}/api/auth/get-session`, { headers: { cookie } });
  assert.equal(session.status, 200);
  assert.equal((await session.json()).user.email, email);
  console.log(
    "PASS: packed Hub server actions, auth cookies, rejected password and successful retry.",
  );
}
