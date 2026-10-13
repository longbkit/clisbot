import * as Crypto from "expo-crypto";
import { oauthCredentialKey, parseOAuthCredential } from "./oauth-credentials";
import { readSecret, writeSecret, deleteSecret, lockSecret } from "@/device-access/secret-storage";
import { i18n } from "@/i18n/i18next";
import type { HubRequestInput, HubTransport } from "./contract";
import {
  authorizationCodeFromCallback,
  encodeBase64Url,
  oauthAuthorizeUrl,
  OAuthTokenResponseSchema,
  tokenRequestBody,
  CLISBOT_CLIENT_ID,
} from "./oauth";

const CALLBACK = "https://app.clisbot.com/hub-auth-callback";

/** Account Hub transport: each issuer owns its login page, credentials and token rotation. */
export class BrowserOAuthHubTransport implements HubTransport {
  readonly signInKind = "system-browser" as const;
  private readonly refreshKey: string;
  private access: { token: string; expiresAt: number; generation: string } | undefined;
  constructor(private readonly origin: string) {
    this.refreshKey = oauthCredentialKey(origin);
  }

  async request(path: string, input: HubRequestInput = {}): Promise<Response> {
    if (!path.startsWith("/api/")) throw new Error("Hub requests must use an API path.");
    const token = await this.currentToken();
    return fetch(new URL(path, this.origin), {
      ...input,
      credentials: "omit",
      redirect: "error",
      headers: { ...input.headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
  }

  async signIn(
    _input?: { email: string; password: string },
    context?: { invitationId?: string },
  ): Promise<void> {
    if (window.location.origin !== new URL(CALLBACK).origin)
      throw new Error(i18n.t("hub.account.signIn.officialWebRequired"));
    const popup = window.open("about:blank", "_blank", "popup,width=560,height=760");
    if (!popup) throw new Error(i18n.t("hub.account.signIn.allowPopups"));
    const verifier = encodeBase64Url(Crypto.getRandomBytes(48));
    const state = encodeBase64Url(Crypto.getRandomBytes(32));
    const waiting = waitForCallback(popup, state);
    // Install the receiver before navigating. The callback contains a one-use PKCE code only.
    try {
      const challenge = encodeBase64Url(
        await Crypto.digest(
          Crypto.CryptoDigestAlgorithm.SHA256,
          new TextEncoder().encode(verifier),
        ),
      );
      popup.location.href = oauthAuthorizeUrl({
        origin: this.origin,
        redirectUri: CALLBACK,
        state,
        challenge,
        ...context,
      });
      const code = authorizationCodeFromCallback({
        callbackUrl: await waiting.result,
        state,
        issuer: this.origin,
      });
      await lockSecret(this.refreshKey, async () => {
        await this.exchange(
          tokenRequestBody({ origin: this.origin, redirectUri: CALLBACK, code, verifier }),
          state,
        );
      });
      this.notifySessionChange();
    } finally {
      waiting.close();
      popup.close();
    }
  }

  async signOut(): Promise<void> {
    await lockSecret(this.refreshKey, async () => {
      const refresh = parseOAuthCredential(await readSecret(this.refreshKey), this.origin);
      this.access = undefined;
      await deleteSecret(this.refreshKey);
      this.notifySessionChange();
      if (refresh)
        await fetch(new URL("/api/auth/oauth2/revoke", this.origin), {
          method: "POST",
          credentials: "omit",
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: refresh.refreshToken, client_id: CLISBOT_CLIENT_ID }),
        }).catch(() => undefined); // Local sign-out still completes if the Hub is offline.
    });
  }

  subscribeSessionChange(listener: () => void): () => void {
    const channel = new BroadcastChannel(this.refreshKey);
    channel.addEventListener("message", () => {
      this.access = undefined;
      listener();
    });
    return () => channel.close();
  }

  private notifySessionChange(): void {
    const channel = new BroadcastChannel(this.refreshKey);
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel is restricted to the current origin.
    channel.postMessage("changed");
    channel.close();
  }

  private async currentToken(): Promise<string | null> {
    return lockSecret(this.refreshKey, async () => {
      const credential = parseOAuthCredential(await readSecret(this.refreshKey), this.origin);
      if (!credential) {
        this.access = undefined;
        return null;
      }
      if (
        this.access?.generation === credential.generation &&
        this.access.expiresAt - Date.now() > 30_000
      )
        return this.access.token;
      this.access = undefined;
      const token = await this.exchange(
        tokenRequestBody({ origin: this.origin, refreshToken: credential.refreshToken }),
        credential.generation,
      );
      return token?.access_token ?? null;
    });
  }

  private async exchange(body: URLSearchParams, generation: string) {
    const response = await fetch(new URL("/api/auth/oauth2/token", this.origin), {
      method: "POST",
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      if (
        body.get("grant_type") === "refresh_token" &&
        response.status === 400 &&
        error?.error === "invalid_grant"
      ) {
        this.access = undefined;
        await deleteSecret(this.refreshKey);
        this.notifySessionChange();
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
      token: token.access_token,
      expiresAt: Date.now() + token.expires_in * 1000,
    };
    return token;
  }
}

function waitForCallback(popup: Window, state: string): { result: Promise<string>; close(): void } {
  const channel = new BroadcastChannel(`clisbot-hub-login:${state}`);
  let close = () => {};
  const result = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(i18n.t("hub.account.signIn.canceled"))),
      5 * 60_000,
    );
    // Google may sever window.opener through COOP. In that case popup.closed can
    // become true even while login continues; the same-origin channel still returns it.
    const receive = (data: unknown) => {
      if (typeof data !== "object" || !data || !("url" in data) || typeof data.url !== "string")
        return;
      let callback: URL;
      try {
        callback = new URL(data.url);
      } catch {
        return;
      }
      if (
        callback.origin + callback.pathname !== CALLBACK ||
        callback.searchParams.get("state") !== state
      )
        return;
      resolve(callback.href);
    };
    channel.addEventListener("message", (event) => receive(event.data));
    const message = (event: MessageEvent) => {
      if (event.origin === new URL(CALLBACK).origin && event.source === popup) receive(event.data);
    };
    window.addEventListener("message", message);
    close = () => {
      clearTimeout(timeout);
      channel.close();
      window.removeEventListener("message", message);
    };
  });
  // Do not leak an unhandled rejection if PKCE preparation itself fails first.
  void result.catch(() => undefined);
  return { result, close: () => close() };
}
