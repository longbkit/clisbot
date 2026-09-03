import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { app, ipcMain, safeStorage, shell, type IpcMainInvokeEvent } from "electron";
import { z } from "zod";

const PASEO_CLIENT_ID = "paseo-client";
const HUB_ACCESS_SCOPE = "hub:access";
const CALLBACK_PATH = "/hub-auth/callback";
const AUTHORIZATION_TIMEOUT_MS = 5 * 60_000;
const CREDENTIALS_FILENAME = "hub-client-credentials.json";
const ALLOWED_ACCOUNT_PATHS = new Set([
  "/api/auth/paseo/state",
  "/api/auth/paseo/select-organization",
  "/api/auth/paseo/create-organization",
  "/api/auth/paseo/complete-app-setup",
  "/api/auth/paseo/api-keys",
  "/api/auth/paseo/revoke-api-key",
  "/api/auth/paseo/revoke-cli-credential",
  "/api/auth/paseo/create-invitation",
  "/api/auth/paseo/cancel-invitation",
  "/api/auth/paseo/accept-invitation",
  "/api/auth/paseo/change-member-role",
  "/api/auth/paseo/remove-member",
]);
const ALLOWED_REQUEST_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

const HubOriginSchema = z.string().transform((value, context) => {
  try {
    const url = new URL(value);
    const localHttp =
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "localhost");
    if (
      (url.protocol !== "https:" && !localHttp) ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      context.addIssue({ code: "custom", message: "Hub origin must be HTTPS or loopback HTTP." });
      return z.NEVER;
    }
    return url.origin;
  } catch {
    context.addIssue({ code: "custom", message: "Hub origin is invalid." });
    return z.NEVER;
  }
});

const HubRequestSchema = z
  .object({
    origin: HubOriginSchema,
    path: z.string(),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().optional(),
  })
  .strict();

const HubOriginInputSchema = z.object({ origin: HubOriginSchema }).strict();
const HubSignInInputSchema = z
  .object({
    origin: HubOriginSchema,
    invitationId: z.string().min(1).max(256).optional(),
  })
  .strict();

const OAuthTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().positive(),
  token_type: z.string(),
});

const PersistedCredentialDocumentSchema = z
  .object({
    version: z.literal(1),
    credentials: z.record(z.string(), z.string()),
  })
  .strict();

interface AccessCredential {
  accessToken: string;
  expiresAt: number;
}

interface HubResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

interface HubClientDependencies {
  userDataPath: string;
  openExternal(url: string): Promise<void>;
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
  encryptionAvailable(): boolean;
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
}

/**
 * Owns desktop authorization to a Hub and authenticated Hub API requests. Refresh credentials
 * never cross the main-process boundary; the renderer receives only response data from an
 * allowlisted API surface.
 */
export class DesktopHubClient {
  private readonly access = new Map<string, AccessCredential>();
  private readonly refreshInFlight = new Map<string, Promise<string | null>>();
  private credentials: Record<string, string> | null = null;
  private persistQueue: Promise<void> = Promise.resolve();

  constructor(private readonly dependencies: HubClientDependencies) {}

  async signIn(rawOrigin: unknown, rawInvitationId?: unknown): Promise<void> {
    const origin = HubOriginSchema.parse(rawOrigin);
    const invitationId =
      rawInvitationId === undefined ? undefined : z.string().min(1).max(256).parse(rawInvitationId);
    if (!this.dependencies.encryptionAvailable()) {
      throw new Error("The operating system credential store is unavailable.");
    }
    const callback = await openLoopbackCallback();
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const state = randomBytes(32).toString("base64url");
    const authorization = new URL(
      invitationId === undefined ? "/api/auth/oauth2/authorize" : "/",
      origin,
    );
    authorization.searchParams.set("response_type", "code");
    authorization.searchParams.set("client_id", PASEO_CLIENT_ID);
    authorization.searchParams.set("redirect_uri", callback.redirectUri);
    authorization.searchParams.set("scope", `${HUB_ACCESS_SCOPE} offline_access`);
    authorization.searchParams.set("state", state);
    authorization.searchParams.set("code_challenge", challenge);
    authorization.searchParams.set("code_challenge_method", "S256");
    if (invitationId !== undefined) authorization.searchParams.set("invitation", invitationId);

    try {
      await this.dependencies.openExternal(authorization.toString());
      const result = await callback.result;
      if (result.searchParams.get("state") !== state) {
        throw new Error("Hub sign-in state mismatch.");
      }
      const issuer = result.searchParams.get("iss");
      if (issuer !== null && issuer !== origin) throw new Error("Unexpected Hub issuer.");
      const authorizationError = result.searchParams.get("error");
      if (authorizationError !== null) {
        throw new Error(`Hub sign-in failed: ${authorizationError}`);
      }
      const code = result.searchParams.get("code");
      if (code === null) throw new Error("Hub did not return an authorization code.");
      const token = await this.exchange(
        origin,
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: PASEO_CLIENT_ID,
          resource: origin,
          redirect_uri: callback.redirectUri,
          code,
          code_verifier: verifier,
        }),
      );
      if (token.refresh_token === undefined) throw new Error("Hub did not issue a refresh token.");
      await this.saveRefreshCredential(origin, token.refresh_token);
    } finally {
      callback.close();
    }
  }

  async signOut(rawOrigin: unknown): Promise<void> {
    const origin = HubOriginSchema.parse(rawOrigin);
    const refreshToken = await this.readRefreshCredential(origin);
    this.access.delete(origin);
    await this.deleteRefreshCredential(origin);
    if (refreshToken === null) return;
    await this.dependencies
      .fetch(new URL("/api/auth/oauth2/revoke", origin), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: refreshToken, client_id: PASEO_CLIENT_ID }),
      })
      .catch(() => undefined);
  }

  async request(rawInput: unknown): Promise<HubResponse> {
    const input = HubRequestSchema.parse(rawInput);
    const requestPath = allowedHubPath(input.path);
    const method = input.method ?? "GET";
    if (!ALLOWED_REQUEST_METHODS.has(method)) throw new Error("Hub request method is unavailable.");
    const headers = allowedRequestHeaders(input.headers);
    let accessToken = await this.currentAccessToken(input.origin);
    let response = await this.authenticatedFetch(
      input.origin,
      requestPath,
      method,
      headers,
      input.body,
      accessToken,
    );
    if (response.status === 401 && accessToken !== null) {
      this.access.delete(input.origin);
      accessToken = await this.refreshAccessToken(input.origin);
      response = await this.authenticatedFetch(
        input.origin,
        requestPath,
        method,
        headers,
        input.body,
        accessToken,
      );
    }
    return {
      status: response.status,
      headers: responseHeaders(response.headers),
      body: await response.text(),
    };
  }

  private authenticatedFetch(
    origin: string,
    requestPath: string,
    method: string,
    headers: Record<string, string>,
    body: string | undefined,
    accessToken: string | null,
  ): Promise<Response> {
    return this.dependencies.fetch(new URL(requestPath, origin), {
      method,
      headers: {
        ...headers,
        ...(accessToken === null ? {} : { authorization: `Bearer ${accessToken}` }),
      },
      ...(body === undefined ? {} : { body }),
    });
  }

  private async currentAccessToken(origin: string): Promise<string | null> {
    const current = this.access.get(origin);
    if (current !== undefined && current.expiresAt - Date.now() > 30_000) {
      return current.accessToken;
    }
    return this.refreshAccessToken(origin);
  }

  private refreshAccessToken(origin: string): Promise<string | null> {
    const active = this.refreshInFlight.get(origin);
    if (active !== undefined) return active;
    const refresh = this.performRefresh(origin).finally(() => {
      this.refreshInFlight.delete(origin);
    });
    this.refreshInFlight.set(origin, refresh);
    return refresh;
  }

  private async performRefresh(origin: string): Promise<string | null> {
    const refreshToken = await this.readRefreshCredential(origin);
    if (refreshToken === null) return null;
    try {
      const token = await this.exchange(
        origin,
        new URLSearchParams({
          grant_type: "refresh_token",
          client_id: PASEO_CLIENT_ID,
          resource: origin,
          refresh_token: refreshToken,
        }),
      );
      if (token.refresh_token === undefined)
        throw new Error("Hub did not rotate the refresh token.");
      await this.saveRefreshCredential(origin, token.refresh_token);
      return token.access_token;
    } catch {
      this.access.delete(origin);
      await this.deleteRefreshCredential(origin);
      return null;
    }
  }

  private async exchange(origin: string, body: URLSearchParams) {
    const response = await this.dependencies.fetch(new URL("/api/auth/oauth2/token", origin), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) throw new Error(`Hub credential exchange failed (${response.status}).`);
    const token = OAuthTokenResponseSchema.parse(await response.json());
    this.access.set(origin, {
      accessToken: token.access_token,
      expiresAt: Date.now() + token.expires_in * 1_000,
    });
    return token;
  }

  private async readRefreshCredential(origin: string): Promise<string | null> {
    const credentials = await this.loadCredentials();
    const encrypted = credentials[origin];
    if (encrypted === undefined) return null;
    try {
      return this.dependencies.decrypt(Buffer.from(encrypted, "base64"));
    } catch {
      delete credentials[origin];
      await this.persistCredentials(credentials);
      return null;
    }
  }

  private async saveRefreshCredential(origin: string, refreshToken: string): Promise<void> {
    const credentials = await this.loadCredentials();
    credentials[origin] = this.dependencies.encrypt(refreshToken).toString("base64");
    await this.persistCredentials(credentials);
  }

  private async deleteRefreshCredential(origin: string): Promise<void> {
    const credentials = await this.loadCredentials();
    if (!(origin in credentials)) return;
    delete credentials[origin];
    await this.persistCredentials(credentials);
  }

  private async loadCredentials(): Promise<Record<string, string>> {
    if (this.credentials !== null) return this.credentials;
    try {
      const raw = await readFile(this.credentialsPath(), "utf8");
      this.credentials = PersistedCredentialDocumentSchema.parse(JSON.parse(raw)).credentials;
    } catch (error) {
      if (!isMissingFile(error)) {
        // A corrupt document cannot be trusted. Start empty; a later successful sign-in replaces it.
      }
      this.credentials = {};
    }
    return this.credentials;
  }

  private async persistCredentials(credentials: Record<string, string>): Promise<void> {
    const next = { ...credentials };
    const write = async () => {
      await mkdir(this.dependencies.userDataPath, { recursive: true });
      const target = this.credentialsPath();
      const temporary = `${target}.tmp.${process.pid}.${randomUUID()}`;
      await writeFile(
        temporary,
        `${JSON.stringify({ version: 1, credentials: next }, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      await rename(temporary, target);
      this.credentials = next;
    };
    const queued = this.persistQueue.then(write, write);
    this.persistQueue = queued.catch(() => undefined);
    await queued;
  }

  private credentialsPath(): string {
    return path.join(this.dependencies.userDataPath, CREDENTIALS_FILENAME);
  }
}

export function registerHubClientHandlers(): void {
  const client = new DesktopHubClient({
    userDataPath: app.getPath("userData"),
    openExternal: (url) => shell.openExternal(url),
    encrypt: (value) => safeStorage.encryptString(value),
    decrypt: (value) => safeStorage.decryptString(value),
    encryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    fetch: (input, init) => fetch(input, init),
  });
  ipcMain.handle("paseo:hub:sign-in", (event, input: unknown) => {
    requireTrustedRenderer(event);
    const parsed = HubSignInInputSchema.parse(input);
    return client.signIn(parsed.origin, parsed.invitationId);
  });
  ipcMain.handle("paseo:hub:sign-out", (event, input: unknown) => {
    requireTrustedRenderer(event);
    return client.signOut(HubOriginInputSchema.parse(input).origin);
  });
  ipcMain.handle("paseo:hub:request", (event, input: unknown) => {
    requireTrustedRenderer(event);
    return client.request(input);
  });
}

function requireTrustedRenderer(event: IpcMainInvokeEvent): void {
  const frameUrl = event.senderFrame?.url ?? event.sender.getURL();
  const url = new URL(frameUrl);
  const trusted =
    (url.protocol === "paseo:" && url.host === "app") ||
    (!app.isPackaged && url.origin === (process.env.EXPO_DEV_URL ?? "http://localhost:8081"));
  if (!trusted) throw new Error("Hub client IPC is available only to the Paseo renderer.");
}

function allowedHubPath(value: string): string {
  const url = new URL(value, "https://hub.invalid");
  if (
    url.origin !== "https://hub.invalid" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Hub request path is invalid.");
  }
  const pathname = url.pathname;
  if (!ALLOWED_ACCOUNT_PATHS.has(pathname) && !pathname.startsWith("/api/management/v1/")) {
    throw new Error("Hub request path is unavailable.");
  }
  if (url.search !== "") {
    const invitation = url.searchParams.getAll("invitation");
    const onlyInvitation = [...url.searchParams.keys()].every((key) => key === "invitation");
    if (
      pathname !== "/api/auth/paseo/state" ||
      !onlyInvitation ||
      invitation.length !== 1 ||
      invitation[0]?.trim().length === 0
    ) {
      throw new Error("Hub request query is unavailable.");
    }
  }
  return `${pathname}${url.search}`;
}

function allowedRequestHeaders(input: Record<string, string> | undefined): Record<string, string> {
  if (input === undefined) return {};
  const output: Record<string, string> = {};
  for (const [name, value] of Object.entries(input)) {
    const normalized = name.toLowerCase();
    if (normalized !== "content-type" && normalized !== "x-request-id") {
      throw new Error(`Hub request header is unavailable: ${name}`);
    }
    output[normalized] = value;
  }
  return output;
}

function responseHeaders(headers: Headers): Record<string, string> {
  const output: Record<string, string> = {};
  for (const name of ["content-type", "retry-after", "x-request-id"]) {
    const value = headers.get(name);
    if (value !== null) output[name] = value;
  }
  return output;
}

async function openLoopbackCallback(): Promise<{
  redirectUri: string;
  result: Promise<URL>;
  close(): void;
}> {
  let resolveResult!: (url: URL) => void;
  let rejectResult!: (error: Error) => void;
  let settled = false;
  const result = new Promise<URL>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method !== "GET" || requestUrl.pathname !== CALLBACK_PATH || settled) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    settled = true;
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(
      '<!doctype html><meta charset="utf-8"><title>Paseo sign-in complete</title><p>Sign-in complete. You can return to Paseo.</p><script>window.close()</script>',
    );
    resolveResult(requestUrl);
  });
  server.on("error", (error) => {
    if (settled) return;
    settled = true;
    rejectResult(error);
  });
  await listenLoopback(server);
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Could not open the Hub sign-in callback.");
  }
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    rejectResult(new Error("Hub sign-in timed out."));
    server.close();
  }, AUTHORIZATION_TIMEOUT_MS);
  timer.unref();
  return {
    redirectUri: `http://127.0.0.1:${String(address.port)}${CALLBACK_PATH}`,
    result,
    close() {
      clearTimeout(timer);
      server.close();
    },
  };
}

function listenLoopback(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
