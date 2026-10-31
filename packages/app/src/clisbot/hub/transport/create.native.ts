import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import { readSecret, writeSecret, deleteSecret, lockSecret } from "@/device-access/secret-storage";
import {
  type OAuthCredential,
  oauthCredentialKey,
  parseOAuthCredential,
} from "./oauth-credentials";
import * as WebBrowser from "expo-web-browser";
import { AppState, Platform } from "react-native";
import type { HubConfiguration } from "../config";
import {
  AuthSessions,
  HubSignInReplacedError,
  HubSignInStartError,
  type AuthSessionResult,
} from "./auth-session";
import type { HubRequestInput, HubTransport } from "./contract";
import {
  authorizationCodeFromCallback,
  encodeBase64Url,
  oauthAuthorizeUrl,
  OAuthTokenResponseSchema,
  CLISBOT_CLIENT_ID,
  tokenRequestBody,
} from "./oauth";
import { i18n } from "@/i18n/i18next";
import { fetchWithDeadline } from "./request-deadline";
import { getColdStartConnectTimeline } from "@/runtime/cold-start-connect";

const CREDENTIAL_REREAD_DELAY_MS = 500;
/** An access token this close to expiry is refreshed before use. */
const ACCESS_TOKEN_MARGIN_MS = 30_000;

interface AccessCredential {
  accessToken: string;
  expiresAt: number;
  generation: string;
}

function storedAccess(credential: OAuthCredential): AccessCredential | null {
  return credential.accessToken === undefined || credential.accessExpiresAt === undefined
    ? null
    : {
        accessToken: credential.accessToken,
        expiresAt: credential.accessExpiresAt,
        generation: credential.generation,
      };
}

export function createHubTransport(configuration: HubConfiguration): HubTransport {
  return new NativeHubTransport(configuration.origin);
}

class NativeHubTransport implements HubTransport {
  readonly signInKind = "system-browser" as const;
  private access: AccessCredential | null = null;
  private accessTokenRead: Promise<string | null> | null = null;
  private readonly refreshKey: string;

  constructor(private readonly origin: string) {
    this.refreshKey = oauthCredentialKey(origin);
  }

  async request(path: string, input: HubRequestInput = {}): Promise<Response> {
    const accessToken = await this.currentAccessToken();
    const response = await this.send(path, input, accessToken);
    // The Hub refused a token the app still believed valid, or a request that went out with none.
    // Take a new one once and ask again; a second 401 is returned so the caller shows "sign in"
    // instead of treating it as a revocation.
    if (response.status !== 401) return response;
    const refreshed =
      accessToken === null
        ? await this.recoverAccessToken()
        : await this.refreshRejectedAccessToken(accessToken);
    return refreshed === null ? response : this.send(path, input, refreshed);
  }

  async recoverSignIn(): Promise<boolean> {
    return (await this.recoverAccessToken()) !== null;
  }

  /**
   * Android's keystore can answer empty once on a cold start (after a force-stop or `install -r`)
   * although the credential is intact. Read it again after a moment, then refresh.
   */
  private async recoverAccessToken(): Promise<string | null> {
    await new Promise((resolve) => setTimeout(resolve, CREDENTIAL_REREAD_DELAY_MS));
    return this.currentAccessToken();
  }

  private send(path: string, input: HubRequestInput, accessToken: string | null) {
    return fetchWithDeadline(new URL(assertHubPath(path), this.origin), {
      method: input.method ?? "GET",
      credentials: "omit",
      redirect: "error",
      headers: {
        ...input.headers,
        ...(accessToken === null ? {} : { authorization: `Bearer ${accessToken}` }),
      },
      ...(input.body === undefined ? {} : { body: input.body }),
    });
  }

  /** One refresh per rejected token: concurrent 401s share the token the first one obtained. */
  private async refreshRejectedAccessToken(rejected: string): Promise<string | null> {
    return lockSecret(this.refreshKey, async () => {
      const credential = parseOAuthCredential(await readSecret(this.refreshKey), this.origin);
      if (!credential) return null;
      if (this.access !== null && this.access.accessToken !== rejected) {
        return this.access.accessToken;
      }
      this.access = null;
      const token = await this.exchange(
        tokenRequestBody({ origin: this.origin, refreshToken: credential.refreshToken }),
        credential.generation,
      );
      return token?.access_token ?? null;
    });
  }

  async signIn(
    _input?: { email: string; password: string },
    context?: { invitationId?: string },
  ): Promise<void> {
    const verifier = encodeBase64Url(Crypto.getRandomBytes(48));
    const challengeBytes = await Crypto.digest(
      Crypto.CryptoDigestAlgorithm.SHA256,
      new TextEncoder().encode(verifier),
    );
    const challenge = encodeBase64Url(challengeBytes);
    const state = encodeBase64Url(Crypto.getRandomBytes(32));
    const redirectUri = Linking.createURL("hub-auth/callback");
    const result = await openAuthSession(
      oauthAuthorizeUrl({
        origin: this.origin,
        redirectUri,
        state,
        challenge,
        ...(context?.invitationId === undefined ? {} : { invitationId: context.invitationId }),
      }),
      redirectUri,
    );
    if (result.type !== "success") throw new Error(i18n.t("hub.account.signIn.canceled"));
    const code = authorizationCodeFromCallback({
      callbackUrl: result.url,
      state,
      issuer: this.origin,
    });
    await lockSecret(this.refreshKey, () =>
      this.exchange(tokenRequestBody({ origin: this.origin, redirectUri, code, verifier }), state),
    );
  }

  async signOut(): Promise<void> {
    await lockSecret(this.refreshKey, async () => {
      const credential = parseOAuthCredential(await readSecret(this.refreshKey), this.origin);
      this.access = null;
      await deleteSecret(this.refreshKey);
      if (!credential) return;
      await withRequestTimeout(10_000, (signal) =>
        fetch(new URL("/api/auth/oauth2/revoke", this.origin), {
          method: "POST",
          credentials: "omit",
          redirect: "error",
          signal,
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            token: credential.refreshToken,
            client_id: CLISBOT_CLIENT_ID,
          }).toString(),
        }),
      ).catch(() => undefined);
    });
  }

  /**
   * Requests asking at the same time share one keystore read and at most one refresh: a cold start
   * sends the account read, the daemon list and a ticket per Host together, and reading the
   * keystore once per request in turn put whole seconds before the last of them
   * (connection-resilience.md#cold-start-connect-path).
   */
  private currentAccessToken(): Promise<string | null> {
    this.accessTokenRead ??= this.readAccessToken().finally(() => {
      this.accessTokenRead = null;
    });
    return this.accessTokenRead;
  }

  /** Settles as soon as the token is known; the lock is held until the rotated one is stored. */
  private readAccessToken(): Promise<string | null> {
    return new Promise((resolve, reject) => {
      lockSecret(this.refreshKey, async () => {
        const credential = parseOAuthCredential(await readSecret(this.refreshKey), this.origin);
        if (!credential) {
          this.access = null;
          return resolve(null);
        }
        // In memory, or stored by the last refresh before this process started.
        const held = [this.access, storedAccess(credential)].find(
          (access) =>
            access?.generation === credential.generation &&
            access.expiresAt - Date.now() > ACCESS_TOKEN_MARGIN_MS,
        );
        if (held) {
          this.access = held;
          return resolve(held.accessToken);
        }
        this.access = null;
        const token = await this.exchange(
          tokenRequestBody({ origin: this.origin, refreshToken: credential.refreshToken }),
          credential.generation,
          (accessToken) => {
            getColdStartConnectTimeline().mark("hubToken");
            resolve(accessToken);
          },
        );
        resolve(token?.access_token ?? null);
      }).catch(reject);
    });
  }

  private async exchange(
    body: URLSearchParams,
    generation: string,
    /** Called with the new access token before the rotated refresh token is written. */
    onIssued?: (accessToken: string) => void,
  ) {
    return withRequestTimeout(20_000, async (signal) => {
      const response = await fetch(new URL("/api/auth/oauth2/token", this.origin), {
        method: "POST",
        credentials: "omit",
        redirect: "error",
        signal,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        if (
          body.get("grant_type") === "refresh_token" &&
          response.status === 400 &&
          error?.error === "invalid_grant"
        ) {
          this.access = null;
          await deleteSecret(this.refreshKey);
          return null;
        }
        throw new Error(
          i18n.t("hub.account.signIn.credentialExchangeFailed", { status: response.status }),
        );
      }
      const token = OAuthTokenResponseSchema.parse(await response.json());
      if (!token.refresh_token) throw new Error(i18n.t("hub.account.signIn.noRefreshToken"));
      onIssued?.(token.access_token);
      const expiresAt = Date.now() + token.expires_in * 1_000;
      const stored: OAuthCredential = {
        issuer: this.origin,
        refreshToken: token.refresh_token,
        generation,
        accessToken: token.access_token,
        accessExpiresAt: expiresAt,
      };
      await writeSecret(this.refreshKey, JSON.stringify(stored));
      this.access = { generation, accessToken: token.access_token, expiresAt };
      return token;
    });
  }
}

/** Custom tabs cannot be closed from the app, and report neither closing nor the redirect. */
const androidSessions = new AuthSessions({
  open: async (url) => {
    await WebBrowser.openBrowserAsync(url);
  },
  dismiss: () => undefined,
  subscribeRedirect: (listener) => {
    const subscription = Linking.addEventListener("url", (event) => listener(event.url));
    return () => subscription.remove();
  },
  subscribeAppState: (listener) => {
    const subscription = AppState.addEventListener("change", listener);
    return () => subscription.remove();
  },
});

let iosSessionGeneration = 0;
let iosSessionOpen = false;

/** ASWebAuthenticationSession always settles; a session still registered is dismissed first. */
async function openIosAuthSession(url: string, redirectUri: string): Promise<AuthSessionResult> {
  if (iosSessionOpen) WebBrowser.dismissAuthSession();
  const generation = ++iosSessionGeneration;
  iosSessionOpen = true;
  try {
    const result = await WebBrowser.openAuthSessionAsync(url, redirectUri);
    if (generation !== iosSessionGeneration) throw new HubSignInReplacedError();
    return result.type === "success" ? { type: "success", url: result.url } : { type: "cancel" };
  } catch (cause) {
    if (cause instanceof HubSignInReplacedError) throw cause;
    throw new HubSignInStartError(cause);
  } finally {
    if (generation === iosSessionGeneration) iosSessionOpen = false;
  }
}

function openAuthSession(url: string, redirectUri: string): Promise<AuthSessionResult> {
  return Platform.OS === "android"
    ? androidSessions.open(url, redirectUri)
    : openIosAuthSession(url, redirectUri);
}

function assertHubPath(path: string): string {
  if (!path.startsWith("/api/")) throw new Error("Hub requests must use an API path.");
  return path;
}

/** Hermes does not implement AbortSignal.timeout; keep the deadline through body reads. */
async function withRequestTimeout<T>(
  milliseconds: number,
  request: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), milliseconds);
  try {
    return await request(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}
