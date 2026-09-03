import { Buffer } from "buffer";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import type { HubConfiguration } from "../config";
import type { HubRequestInput, HubTransport } from "./contract";
import {
  authorizationCodeFromCallback,
  oauthAuthorizeUrl,
  OAuthTokenResponseSchema,
  PASEO_CLIENT_ID,
  tokenRequestBody,
} from "./oauth";

interface AccessCredential {
  accessToken: string;
  expiresAt: number;
}

export function createHubTransport(configuration: HubConfiguration): HubTransport {
  return new NativeHubTransport(configuration.origin);
}

class NativeHubTransport implements HubTransport {
  readonly signInKind = "system-browser" as const;
  private access: AccessCredential | null = null;
  private readonly refreshKey: string;
  private refreshInFlight: Promise<string | null> | null = null;

  constructor(private readonly origin: string) {
    this.refreshKey = `clisbot.hub.${shortOriginHash(origin)}.refresh`;
  }

  async request(path: string, input: HubRequestInput = {}): Promise<Response> {
    const accessToken = await this.currentAccessToken();
    return fetch(new URL(assertHubPath(path), this.origin), {
      method: input.method ?? "GET",
      headers: {
        ...input.headers,
        ...(accessToken === null ? {} : { authorization: `Bearer ${accessToken}` }),
      },
      ...(input.body === undefined ? {} : { body: input.body }),
    });
  }

  async signIn(
    _input?: { email: string; password: string },
    context?: { invitationId?: string },
  ): Promise<void> {
    const verifier = Buffer.from(Crypto.getRandomBytes(48)).toString("base64url");
    const challengeBytes = await Crypto.digest(
      Crypto.CryptoDigestAlgorithm.SHA256,
      new TextEncoder().encode(verifier),
    );
    const challenge = Buffer.from(challengeBytes).toString("base64url");
    const state = Buffer.from(Crypto.getRandomBytes(32)).toString("base64url");
    const redirectUri = Linking.createURL("hub-auth/callback");
    const result = await WebBrowser.openAuthSessionAsync(
      oauthAuthorizeUrl({
        origin: this.origin,
        redirectUri,
        state,
        challenge,
        ...(context?.invitationId === undefined ? {} : { invitationId: context.invitationId }),
      }),
      redirectUri,
    );
    if (result.type !== "success") throw new Error("Hub sign-in was canceled.");
    const code = authorizationCodeFromCallback({
      callbackUrl: result.url,
      state,
      issuer: this.origin,
    });
    const token = await this.exchange(
      tokenRequestBody({
        origin: this.origin,
        redirectUri,
        code,
        verifier,
      }),
    );
    if (token.refresh_token === undefined) throw new Error("Hub did not issue a refresh token.");
    await SecureStore.setItemAsync(this.refreshKey, token.refresh_token, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }

  async signOut(): Promise<void> {
    const refreshToken = await SecureStore.getItemAsync(this.refreshKey);
    this.access = null;
    await SecureStore.deleteItemAsync(this.refreshKey);
    if (refreshToken === null) return;
    await fetch(new URL("/api/auth/oauth2/revoke", this.origin), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken, client_id: PASEO_CLIENT_ID }),
    }).catch(() => undefined);
  }

  private async currentAccessToken(): Promise<string | null> {
    if (this.access !== null && this.access.expiresAt - Date.now() > 30_000) {
      return this.access.accessToken;
    }
    if (this.refreshInFlight === null) {
      this.refreshInFlight = this.refresh().finally(() => {
        this.refreshInFlight = null;
      });
    }
    return this.refreshInFlight;
  }

  private async refresh(): Promise<string | null> {
    const refreshToken = await SecureStore.getItemAsync(this.refreshKey);
    if (refreshToken === null) return null;
    try {
      const token = await this.exchange(tokenRequestBody({ origin: this.origin, refreshToken }));
      const nextRefreshToken = token.refresh_token;
      if (nextRefreshToken === undefined) throw new Error("Hub did not rotate the refresh token.");
      await SecureStore.setItemAsync(this.refreshKey, nextRefreshToken, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      return token.access_token;
    } catch {
      this.access = null;
      await SecureStore.deleteItemAsync(this.refreshKey);
      return null;
    }
  }

  private async exchange(body: URLSearchParams) {
    const response = await fetch(new URL("/api/auth/oauth2/token", this.origin), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) throw new Error(`Hub credential exchange failed (${response.status}).`);
    const token = OAuthTokenResponseSchema.parse(await response.json());
    this.access = {
      accessToken: token.access_token,
      expiresAt: Date.now() + token.expires_in * 1_000,
    };
    return token;
  }
}

function shortOriginHash(origin: string): string {
  let hash = 2166136261;
  for (let index = 0; index < origin.length; index += 1) {
    hash ^= origin.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function assertHubPath(path: string): string {
  if (!path.startsWith("/api/")) throw new Error("Hub requests must use an API path.");
  return path;
}
