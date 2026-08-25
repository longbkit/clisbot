import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { describe, it } from "vitest";
import { createGitHubAuth } from "./github.js";

describe("GitHub App authentication", () => {
  it("caches internal installation tokens and refreshes them inside the refresh window", async () => {
    let now = Date.parse("2026-07-28T00:00:00.000Z");
    const { auth, tokenRequests } = createGitHubAuthHarness(() => now);

    const first = await auth.getInstallationToken(142);
    const cached = await auth.getInstallationToken(142);
    now += 59 * 60 * 1000 + 1;
    const refreshed = await auth.getInstallationToken(142);

    assert.deepEqual(
      [first, cached, refreshed],
      ["ghs_installation_1", "ghs_installation_1", "ghs_installation_2"],
    );
    assert.deepEqual(tokenRequests, [142, 142]);
  });

  it("mints scoped tokens without reading or replacing the internal token cache", async () => {
    const now = Date.parse("2026-07-28T00:00:00.000Z");
    const { auth, tokenRequests } = createGitHubAuthHarness(() => now);

    const internal = await auth.getInstallationToken(142);
    const firstExecution = await auth.mintInstallationAccessToken({
      installationId: 142,
      accountLogin: "acme",
      repositories: ["acme/app"],
      permissions: { contents: "write" },
    });
    const stillCached = await auth.getInstallationToken(142);
    const secondExecution = await auth.mintInstallationAccessToken({
      installationId: 142,
      accountLogin: "acme",
      repositories: ["acme/app"],
      permissions: { contents: "write" },
    });

    assert.deepEqual(
      [internal, firstExecution.token, stillCached, secondExecution.token],
      ["ghs_installation_1", "ghs_installation_2", "ghs_installation_1", "ghs_installation_3"],
    );
    assert.deepEqual(tokenRequests, [142, 142, 142]);
  });

  it("sends exact authored repositories and native permissions, then revokes the token", async () => {
    const requests: Array<{
      method: string;
      pathname: string;
      apiVersion: string | null;
      body: unknown;
    }> = [];
    const auth = createGitHubAuth({
      appId: "12345",
      privateKey: testPrivateKey(),
      now: () => Date.parse("2026-07-28T00:00:00.000Z"),
      fetch: async (input, init) => {
        const request =
          input instanceof Request && init === undefined ? input : new Request(input, init);
        requests.push({
          method: request.method,
          pathname: new URL(request.url).pathname,
          apiVersion: request.headers.get("x-github-api-version"),
          body: request.method === "POST" ? await request.json() : undefined,
        });
        if (request.method === "DELETE") return new Response(null, { status: 204 });
        return Response.json({
          token: "ghs_execution",
          expires_at: "2026-07-28T01:00:00.000Z",
        });
      },
    });

    const token = await auth.mintInstallationAccessToken({
      installationId: 142,
      accountLogin: "acme",
      repositories: ["acme/app", "acme/docs"],
      permissions: { contents: "write", pull_requests: "write", issues: "read" },
    });
    await auth.revokeInstallationToken(token.token);

    assert.deepEqual(requests, [
      {
        method: "POST",
        pathname: "/app/installations/142/access_tokens",
        apiVersion: "2026-03-10",
        body: {
          repositories: ["app", "docs"],
          permissions: { contents: "write", pull_requests: "write", issues: "read" },
        },
      },
      {
        method: "DELETE",
        pathname: "/installation/token",
        apiVersion: "2026-03-10",
        body: undefined,
      },
    ]);
  });

  it("resolves and caches the GitHub App bot identity by app slug", async () => {
    const requests: string[] = [];
    const auth = createGitHubAuth({
      appId: "12345",
      privateKey: testPrivateKey(),
      fetch: async (input, init) => {
        const request =
          input instanceof Request && init === undefined ? input : new Request(input, init);
        assert.equal(request.headers.get("authorization"), "token scoped-installation-token");
        requests.push(`${request.method} ${new URL(request.url).pathname}`);
        return Response.json({ id: 9876, login: "paseo[bot]" });
      },
    });

    const first = await auth.getAppBotIdentity("paseo", "scoped-installation-token");
    const cached = await auth.getAppBotIdentity("paseo", "another-installation-token");

    assert.deepEqual(first, { id: 9876, login: "paseo[bot]" });
    assert.deepEqual(cached, first);
    assert.deepEqual(requests, ["GET /users/paseo%5Bbot%5D"]);
  });
});

function createGitHubAuthHarness(now: () => number) {
  const tokenRequests: number[] = [];
  const auth = createGitHubAuth({
    appId: "12345",
    privateKey: testPrivateKey(),
    now,
    fetch: (input) => {
      const url = requestUrl(input);
      assert.equal(url.pathname, "/app/installations/142/access_tokens");
      tokenRequests.push(142);
      return Promise.resolve(
        Response.json({
          token: `ghs_installation_${tokenRequests.length}`,
          expires_at: new Date(now() + 60 * 60 * 1000).toISOString(),
        }),
      );
    },
  });
  return { auth, tokenRequests };
}

function testPrivateKey(): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return privateKey.export({ format: "pem", type: "pkcs8" }).toString();
}

function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof URL) return input;
  return new URL(input instanceof Request ? input.url : input);
}
