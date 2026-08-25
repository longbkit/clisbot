import { z } from "zod";
import type { GitHubAuth } from "../../auth/github.js";

export interface GitHubInstallationIdentity {
  installationId: number;
  accountId: string;
  accountLogin: string;
  accountType: string;
  status: "active" | "suspended";
}

export type GitHubInstallationEvidence =
  | { status: "present"; identity: GitHubInstallationIdentity }
  | { status: "absent" };

export interface GitHubConnectionClient {
  setupUrl(state: string): string;
  authorizationUrl(input: { state: string; challenge: string }): string;
  verifyUserInstallation(input: {
    code: string;
    verifier: string;
    installationId: number;
  }): Promise<GitHubInstallationIdentity | undefined>;
  getInstallation(installationId: number): Promise<GitHubInstallationEvidence>;
}

const tokenSchema = z.object({ access_token: z.string().min(1) }).passthrough();
const userInstallationsSchema = z
  .object({ installations: z.array(z.object({ id: z.number().int().positive() }).passthrough()) })
  .passthrough();
const installationSchema = z
  .object({
    id: z.number().int().positive(),
    suspended_at: z.string().nullable().optional(),
    account: z
      .object({ id: z.union([z.number(), z.string()]), login: z.string(), type: z.string() })
      .passthrough(),
  })
  .passthrough();

export function createGitHubConnectionClient(input: {
  publicBaseUrl: string;
  appSlug: string;
  clientId: string;
  clientSecret: string;
  appAuth: GitHubAuth;
  fetch?: typeof fetch;
}): GitHubConnectionClient {
  const request = input.fetch ?? fetch;
  const webBaseUrl = "https://github.com";
  const apiBaseUrl = "https://api.github.com";
  const callback = new URL("/api/integrations/github/callback", input.publicBaseUrl).toString();
  return {
    setupUrl(state) {
      const url = new URL(`/apps/${input.appSlug}/installations/new`, webBaseUrl);
      url.searchParams.set("state", state);
      return url.toString();
    },
    authorizationUrl({ state, challenge }) {
      const url = new URL("/login/oauth/authorize", webBaseUrl);
      url.searchParams.set("client_id", input.clientId);
      url.searchParams.set("redirect_uri", callback);
      url.searchParams.set("state", state);
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");
      return url.toString();
    },
    async verifyUserInstallation({ code, verifier, installationId }) {
      const exchanged = await request(new URL("/login/oauth/access_token", webBaseUrl), {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({
          client_id: input.clientId,
          client_secret: input.clientSecret,
          code,
          redirect_uri: callback,
          code_verifier: verifier,
        }),
      });
      if (!exchanged.ok) throw new Error(`github oauth exchange failed: ${exchanged.status}`);
      const token = tokenSchema.parse(await exchanged.json()).access_token;
      if (!(await userCanAccessInstallation(request, apiBaseUrl, token, installationId))) {
        return undefined;
      }
      return readInstallation(input.appAuth, installationId);
    },
    async getInstallation(installationId) {
      const identity = await readInstallation(input.appAuth, installationId);
      return identity === undefined ? { status: "absent" } : { status: "present", identity };
    },
  };
}

async function readInstallation(
  appAuth: GitHubAuth,
  installationId: number,
): Promise<GitHubInstallationIdentity | undefined> {
  const installation = await appAuth.getInstallation(installationId);
  if (installation === undefined) return undefined;
  const exact = installationSchema.parse(installation);
  return {
    installationId: exact.id,
    accountId: String(exact.account.id),
    accountLogin: exact.account.login,
    accountType: exact.account.type,
    status: exact.suspended_at == null ? "active" : "suspended",
  };
}

async function userCanAccessInstallation(
  request: typeof fetch,
  apiBaseUrl: string,
  token: string,
  installationId: number,
): Promise<boolean> {
  for (let page = 1; ; page += 1) {
    const url = new URL("/user/installations", apiBaseUrl);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    const response = await request(url, {
      headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`github user installations failed: ${response.status}`);
    const listed = userInstallationsSchema.parse(await response.json());
    if (listed.installations.some((installation) => installation.id === installationId))
      return true;
    if (listed.installations.length < 100) return false;
  }
}
