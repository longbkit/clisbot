import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { GitHubAuth } from "../../auth/github.js";
import type { GitHubInstallation } from "../../auth/github-events.js";
import { createGitHubConnectionClient } from "./client.js";

describe("GitHub connection client", () => {
  it("finds an accessible installation after the first full page", async () => {
    const github = new GitHubProviderPort({ installation: githubInstallation(142) });
    const provider = createGitHubConnectionClient(github.options());

    const identity = await provider.verifyUserInstallation({
      code: "code",
      verifier: "verifier",
      installationId: 142,
    });

    assert.deepEqual(identity, {
      installationId: 142,
      accountId: "501",
      accountLogin: "acme",
      accountType: "Organization",
      status: "active",
    });
    assert.deepEqual(github.userInstallationPages, [1, 2]);
  });

  it("returns exact App absence without converting transient failure to absence", async () => {
    const absent = new GitHubProviderPort({ installation: undefined });
    const unavailable = new GitHubProviderPort({ appFailure: new Error("provider unavailable") });

    assert.equal(
      await createGitHubConnectionClient(absent.options()).verifyUserInstallation({
        code: "code",
        verifier: "verifier",
        installationId: 142,
      }),
      undefined,
    );
    await assert.rejects(
      createGitHubConnectionClient(unavailable.options()).verifyUserInstallation({
        code: "code",
        verifier: "verifier",
        installationId: 142,
      }),
      /provider unavailable/u,
    );
  });
});

class GitHubProviderPort implements GitHubAuth {
  readonly userInstallationPages: number[] = [];
  private readonly installation: GitHubInstallation | undefined;
  private readonly appFailure: Error | undefined;

  constructor(options: {
    installation?: GitHubInstallation | undefined;
    appFailure?: Error | undefined;
  }) {
    this.installation = options.installation;
    this.appFailure = options.appFailure;
  }

  options() {
    return {
      publicBaseUrl: "https://hub.example.test",
      appSlug: "paseo",
      clientId: "client",
      clientSecret: "secret",
      appAuth: this,
      fetch: this.request,
    };
  }

  getInstallation(): Promise<GitHubInstallation | undefined> {
    if (this.appFailure !== undefined) return Promise.reject(this.appFailure);
    return Promise.resolve(this.installation);
  }

  getInstallationToken(): Promise<string> {
    return Promise.reject(new Error("unused"));
  }

  mintInstallationToken(): Promise<string> {
    return Promise.reject(new Error("unused"));
  }

  mintInstallationAccessToken(): Promise<never> {
    return Promise.reject(new Error("unused"));
  }

  getAppBotIdentity(): Promise<never> {
    return Promise.reject(new Error("unused"));
  }

  revokeInstallationToken(): Promise<void> {
    return Promise.resolve();
  }

  createInstallationOctokit(): Promise<never> {
    return Promise.reject(new Error("unused"));
  }

  private readonly request: typeof fetch = (input) => {
    const url = requestUrl(input);
    if (url.pathname === "/login/oauth/access_token") {
      return Promise.resolve(Response.json({ access_token: "user-token" }));
    }
    const page = Number(url.searchParams.get("page"));
    this.userInstallationPages.push(page);
    const installations =
      page === 1 ? Array.from({ length: 100 }, (_, index) => ({ id: index + 1 })) : [{ id: 142 }];
    return Promise.resolve(Response.json({ installations }));
  };
}

function githubInstallation(id: number): GitHubInstallation {
  return {
    id,
    account: { id: 501, login: "acme", type: "Organization" },
    suspended_at: null,
  };
}

function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof URL) return input;
  return new URL(input instanceof Request ? input.url : input);
}
