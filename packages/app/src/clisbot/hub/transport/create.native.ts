import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import { readSecret, writeSecret, deleteSecret, lockSecret } from "@/device-access/secret-storage";
import { oauthCredentialKey, parseOAuthCredential } from "./oauth-credentials";
import * as WebBrowser from "expo-web-browser";
import type { HubConfiguration } from "../config";
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

interface AccessCredential {
  accessToken: string;
  expiresAt: number;
  generation: string;
}

export function createHubTransport(configuration: HubConfiguration): HubTransport {
  return new NativeHubTransport(configuration.origin);
}

class NativeHubTransport implements HubTransport {
  readonly signInKind = "system-browser" as const;
  private access: AccessCredential | null = null;
  private readonly refreshKey: string;

  constructor(private readonly origin: string) {
    this.refreshKey = oauthCredentialKey(origin);
  }

  async request(path: string, input: HubRequestInput = {}): Promise<Response> {
    const accessToken = await this.currentAccessToken();
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

  private async currentAccessToken(): Promise<string | null> {
    return lockSecret(this.refreshKey, async () => {
      const credential = parseOAuthCredential(await readSecret(this.refreshKey), this.origin);
      if (!credential) {
        this.access = null;
        return null;
      }
      if (
        this.access?.generation === credential.generation &&
        this.access.expiresAt - Date.now() > 30_000
      )
        return this.access.accessToken;
      this.access = null;
      const token = await this.exchange(
        tokenRequestBody({ origin: this.origin, refreshToken: credential.refreshToken }),
        credential.generation,
      );
      return token?.access_token ?? null;
    });
  }

  private async exchange(body: URLSearchParams, generation: string) {
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
      await writeSecret(
        this.refreshKey,
        JSON.stringify({ issuer: this.origin, refreshToken: token.refresh_token, generation }),
      );
      this.access = {
        generation,
        accessToken: token.access_token,
        expiresAt: Date.now() + token.expires_in * 1_000,
      };
      return token;
    });
  }
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
