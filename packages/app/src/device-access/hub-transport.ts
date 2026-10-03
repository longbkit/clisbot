import * as Crypto from "expo-crypto";
import {
  HubDeviceTransport,
  HubDeviceTransportError,
} from "@clisbot/client/internal/hub-device-transport";
import { buildRelayWebSocketUrl } from "@clisbot/protocol/daemon-endpoints";
import { digest, httpBinding, signDeviceProof } from "@clisbot/device-access/proof";
import type { HubDeviceOffer } from "@clisbot/protocol/device-pairing-offer";
import type {
  HubRequestInput,
  HubTransport,
  GoogleSignInContext,
} from "@/clisbot/hub/transport/contract";
import {
  acquireGoogleIdToken,
  prepareGooglePopup,
  requiresOfficialGoogleWeb,
  openOfficialHubGoogle,
} from "./google-sign-in";
import { HubAccountRequestError, needsOwnerSetupRecovery } from "./hub-account-error";
import { suggestedDeviceLabel } from "./device-label";
import { createAppWebSocketFactory } from "@/runtime/websocket-factory";
import {
  prepareDevicePairing,
  prepareDeviceLogin,
  readDeviceCredential,
  saveDeviceCredential,
} from "./credentials";
import { readSecret, writeSecret, lockSecret } from "./secret-storage";
import {
  saveHubProfile,
  assertHubIdentity,
  validateHubRoutes,
  type HubProfile,
} from "./hub-profiles";

export class PairedHubTransport implements HubTransport {
  readonly signInKind = "password" as const;
  readonly googleSignInLabel = requiresOfficialGoogleWeb()
    ? "Continue with Google in Clisbot web"
    : "Continue with Google";
  private connection: Promise<HubDeviceTransport> | undefined;
  private closed = false;
  private loginChallenge?: { id: string; expiresAt: number };
  private accountLogin = false;
  constructor(private readonly profile: HubDeviceOffer) {
    validateHubRoutes(profile);
  }

  async request(path: string, input: HubRequestInput = {}): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const selection = this.connect();
      const connection = await selection;
      try {
        return await this.requestOn(connection, path, input);
      } catch (error) {
        if (!(error instanceof HubDeviceTransportError)) throw error;
        if (this.connection === selection) this.connection = undefined;
        connection.close();
        // A write may have reached Hub before the response was lost.
        if (this.closed || attempt === 1 || (input.method ?? "GET") !== "GET") throw error;
      }
    }
  }

  private async requestOn(
    connection: HubDeviceTransport,
    path: string,
    input: HubRequestInput,
    publicLogin = false,
  ): Promise<Response> {
    const credential = await prepareDeviceLogin(this.profile.hubId);
    const credentialId =
      !publicLogin && !this.accountLogin && credential.credentialId
        ? credential.credentialId
        : await this.loginCredential(connection, credential.key.publicKey);
    const method = input.method ?? "GET";
    const proof = signDeviceProof({
      key: credential.key,
      proof: {
        backendId: credential.backendId,
        credentialId,
        timestamp: Date.now(),
        nonce: nonce(),
      },
      context: {
        purpose: "http",
        binding: httpBinding({ method, path, body: input.body ?? "" }),
      },
    });
    const cookies = await readSecret(cookieKey(this.profile.hubId));
    const setupToken =
      path === "/api/auth/clisbot/claim-instance"
        ? await readSecret(setupKey(this.profile.hubId))
        : null;
    const response = await connection.request({
      method,
      path,
      headers: {
        ...input.headers,
        "x-clisbot-device-proof": JSON.stringify(proof),
        ...(setupToken ? { "x-clisbot-owner-setup": setupToken } : {}),
        ...(cookies
          ? {
              cookie: Object.entries(JSON.parse(cookies) as Record<string, string>)
                .map(([name, value]) => `${name}=${value}`)
                .join("; "),
            }
          : {}),
      },
      ...(input.body === undefined ? {} : { body: input.body }),
    });
    if (
      !publicLogin &&
      isUnauthorizedAccountState(method, path, response.status) &&
      (await this.allowsPublicLogin(connection))
    )
      return this.requestOn(connection, path, input, true);
    return this.receiveResponse(response, path);
  }

  private async allowsPublicLogin(connection: HubDeviceTransport): Promise<boolean> {
    const response = await connection.request({
      method: "GET",
      path: "/api/auth/clisbot/device/identity",
      headers: {},
    });
    if (!response.ok) return false;
    const identity = (await response.json()) as {
      hubId?: string;
      entry?: string;
    };
    return identity.hubId === this.profile.hubId && identity.entry === "account";
  }

  private async receiveResponse(response: Response, path: string): Promise<Response> {
    const upgrade = response.headers.get("x-clisbot-device-credential");
    if (response.ok && upgrade) {
      const value = JSON.parse(upgrade) as {
        backendId?: string;
        credentialId?: string;
      };
      if (value.backendId !== this.profile.hubId || typeof value.credentialId !== "string")
        throw new Error("Hub login credential identity mismatch");
      await saveDeviceCredential(this.profile.hubId, value.credentialId);
      this.loginChallenge = undefined;
      this.accountLogin = false;
    }
    if (response.ok && path === "/api/auth/clisbot/claim-instance")
      await writeSecret(setupKey(this.profile.hubId), "");
    return response;
  }

  private async loginCredential(
    connection: HubDeviceTransport,
    publicKey: string,
  ): Promise<string> {
    if (this.loginChallenge && this.loginChallenge.expiresAt > Date.now() + 5000)
      return `login:${this.loginChallenge.id}`;
    const response = await connection.request({
      method: "POST",
      path: "/api/auth/clisbot/device/login-challenge",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicKey, label: suggestedDeviceLabel() }),
    });
    if (!response.ok)
      throw new Error(
        response.status === 403
          ? "This Hub requires an approved pairing link before access or owner setup"
          : "Hub sign-in could not be started",
      );
    const value = (await response.json()) as {
      hubId?: string;
      challengeId?: string;
      expiresAt?: number;
    };
    if (
      value.hubId !== this.profile.hubId ||
      typeof value.challengeId !== "string" ||
      typeof value.expiresAt !== "number"
    )
      throw new Error("Hub sign-in challenge identity mismatch");
    this.loginChallenge = { id: value.challengeId, expiresAt: value.expiresAt };
    return `login:${value.challengeId}`;
  }

  async signIn(input?: { email: string; password: string }): Promise<void> {
    if (!input) throw new Error("Email and password are required");
    await this.prepareAccountLogin();
    try {
      const response = await this.request("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error("Hub sign-in failed; check your email and password");
      await this.request("/api/auth/clisbot/state");
    } finally {
      this.accountLogin = false;
    }
  }

  async identity(): Promise<Response> {
    return (await this.connect()).request({
      method: "GET",
      path: "/api/auth/clisbot/device/identity",
      headers: {},
    });
  }

  private async prepareAccountLogin(): Promise<void> {
    const response = await this.identity();
    if (!response.ok) throw new Error("Hub identity could not be verified");
    const identity = (await response.json()) as {
      hubId?: string;
      entry?: string;
    };
    if (identity.hubId !== this.profile.hubId) throw new Error("Hub login identity mismatch");
    // A prior successful request may have consumed its challenge even when its
    // response was lost. A new explicit attempt must obtain a fresh challenge.
    this.loginChallenge = undefined;
    // An account may sign in again after its old session/device was revoked.
    // Keep the old credential untouched until a fresh authenticated login succeeds.
    this.accountLogin = identity.entry === "account";
  }

  async signOut(): Promise<void> {
    try {
      const response = await this.request("/api/auth/sign-out", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!response.ok) throw new Error("Hub sign-out failed");
    } finally {
      await writeSecret(cookieKey(this.profile.hubId), "{}");
    }
  }

  async signInWithGoogle(context: GoogleSignInContext = {}): Promise<void> {
    if (requiresOfficialGoogleWeb()) {
      if (context.claimInstance)
        throw new Error(
          "Complete owner setup with the approved pairing link in Clisbot web, mobile or Desktop. Setup approvals are not sent to another website automatically.",
        );
      openOfficialHubGoogle(this.profile);
      return;
    }
    const popup = prepareGooglePopup();
    try {
      await this.prepareAccountLogin();
      const challenge = await this.request("/api/auth/clisbot/device/google/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!challenge.ok) throw new Error("Google sign-in is unavailable on this Hub");
      const transaction = (await challenge.json()) as {
        transactionId: string;
        nonce: string;
        clientId: string;
        expiresAt: number;
      };
      if (transaction.expiresAt <= Date.now()) throw new Error("Google sign-in challenge expired");
      const idToken = await acquireGoogleIdToken(transaction, popup);
      const setup = context.claimInstance ? await readSecret(setupKey(this.profile.hubId)) : null;
      const response = await this.request("/api/auth/clisbot/device/google/sign-in", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(setup ? { "x-clisbot-owner-setup": setup } : {}),
        },
        body: JSON.stringify({
          transactionId: transaction.transactionId,
          idToken,
          ...(context.invitationId ? { invitation: context.invitationId } : {}),
          ...(context.claimInstance ? { intent: "claimInstance" } : {}),
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const error = new HubAccountRequestError(
          typeof body?.error === "string" ? body.error : "request_failed",
          response.status,
        );
        if (needsOwnerSetupRecovery(error)) throw error;
        throw new Error(
          "Google account could not sign in to this Hub. Check its invitation and account policy.",
        );
      }
      if (context.claimInstance) await writeSecret(setupKey(this.profile.hubId), "");
    } finally {
      this.accountLogin = false;
      popup?.close();
    }
  }

  async redeem(label?: string): Promise<void> {
    const credential = await readDeviceCredential(this.profile.hubId);
    if (!credential?.invitationToken) {
      if (credential?.credentialId) return;
      throw new Error("Pairing invitation unavailable");
    }
    const connection = await this.connect();
    const proof = signDeviceProof({
      key: credential.key,
      proof: {
        backendId: credential.backendId,
        credentialId: "pair",
        timestamp: Date.now(),
        nonce: nonce(),
      },
      context: { purpose: "pair", binding: digest(credential.invitationToken) },
    });
    const response = await connection.request({
      method: "POST",
      path: "/api/auth/clisbot/device/redeem",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: credential.invitationToken,
        ...(label ? { label } : {}),
        publicKey: credential.key.publicKey,
        proof,
      }),
    });
    if (!response.ok)
      throw new Error(
        `Hub pairing failed (${response.status}); issue a fresh invitation on the host`,
      );
    const value = (await response.json()) as {
      hubId?: string;
      credentialId?: string;
    };
    if (value.hubId !== this.profile.hubId || typeof value.credentialId !== "string")
      throw new Error("Hub pairing identity mismatch");
    await saveDeviceCredential(this.profile.hubId, value.credentialId);
  }

  close(): void {
    this.closed = true;
    void this.connection?.then(
      (value) => value.close(),
      () => undefined,
    );
    this.connection = undefined;
  }

  private connect(): Promise<HubDeviceTransport> {
    if (this.closed) return Promise.reject(new HubDeviceTransportError("Hub connection closed"));
    if (this.connection) return this.connection;
    const selection = connectHub(this.profile, (values) =>
      saveCookies(this.profile.hubId, values),
    ).catch((error) => {
      if (this.connection === selection) this.connection = undefined;
      throw error;
    });
    this.connection = selection;
    return selection;
  }
}

function isUnauthorizedAccountState(method: string, path: string, status: number): boolean {
  return (
    method === "GET" && path === "/api/auth/clisbot/state" && (status === 401 || status === 403)
  );
}

async function connectHub(
  profile: HubDeviceOffer,
  cookies: (values: string[]) => Promise<void>,
): Promise<HubDeviceTransport> {
  const routes: { url: string; relay?: boolean }[] = [];
  if (profile.origin) {
    const url = new URL("/api/auth/clisbot/device/socket", profile.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    routes.push({ url: url.href });
  }
  if (profile.relay)
    routes.push({
      relay: true,
      url: buildRelayWebSocketUrl({
        ...profile.relay,
        useTls: profile.relay.useTls ?? true,
        serverId: `hub-${profile.hubId}`,
        role: "client",
      }),
    });
  let failure: unknown;
  for (const route of routes) {
    const connection = new HubDeviceTransport({
      ...route,
      publicKey: profile.publicKey,
      cookies,
      webSocketFactory: createAppWebSocketFactory(),
    });
    try {
      await connection.ready();
      return connection;
    } catch (error) {
      failure = error;
      connection.close();
    }
  }
  throw failure ?? new Error("Hub has no reachable endpoint");
}

export async function pairHub(
  offer: HubDeviceOffer,
  label = suggestedDeviceLabel(),
): Promise<void> {
  await assertHubIdentity(offer);
  const profile: HubProfile = { ...offer, label: "Hub" };
  validateHubRoutes(profile);
  if (offer.pairing) {
    if (offer.pairing.expiresAt <= Date.now())
      throw new Error("Hub invitation expired; create a fresh QR on the host");
    await prepareDevicePairing(offer.hubId, offer.pairing.token);
  }
  const transport = new PairedHubTransport(profile);
  try {
    if (!offer.pairing) {
      const response = await transport.identity();
      const identity = (await response.json()) as {
        hubId?: string;
        entry?: string;
      };
      if (!response.ok || identity.hubId !== offer.hubId)
        throw new Error("Hub identity could not be verified");
      if (identity.entry !== "account" && !(await readDeviceCredential(offer.hubId))?.credentialId)
        throw new Error(
          identity.entry === "owner-setup"
            ? "This Hub needs an approved owner-setup pairing link"
            : "This Hub needs an approved pairing link",
        );
      if (identity.entry === "account") {
        await saveHubProfile(offer);
        return;
      }
    }
    await transport.redeem(label);
    if (offer.ownerSetupToken) await writeSecret(setupKey(offer.hubId), offer.ownerSetupToken);
    const capabilities = await transport.request("/api/auth/clisbot/device/capabilities");
    const capability = await capabilities.json();
    if (!capabilities.ok || capability.hubId !== offer.hubId)
      throw new Error("Hub identity could not be verified");
    let entry: "owner-setup" | "account" | "pairing" = "pairing";
    if (offer.ownerSetupToken) entry = "owner-setup";
    else if (capability.loginRequired) entry = "account";
    const savedOffer = { ...offer, entry };
    await saveHubProfile(
      savedOffer,
      capability.accountAuthentication === "personal" ? "Personal Hub" : undefined,
    );
  } finally {
    transport.close();
  }
}

function nonce(): string {
  return Crypto.randomUUID().replace(/-/g, "");
}
function cookieKey(hubId: string): string {
  return `clisbot_hub_session.${digest(hubId).replace(/[^a-zA-Z0-9]/g, "_")}`;
}
function setupKey(hubId: string): string {
  return `clisbot_hub_setup.${digest(hubId).replace(/[^a-zA-Z0-9]/g, "_")}`;
}

async function saveCookies(hubId: string, values: string[]): Promise<void> {
  await lockSecret(cookieKey(hubId), async () => updateCookies(hubId, values));
}

async function updateCookies(hubId: string, values: string[]): Promise<void> {
  const current = JSON.parse((await readSecret(cookieKey(hubId))) ?? "{}") as Record<
    string,
    string
  >;
  for (const cookie of values) {
    const [pair] = cookie.split(";");
    const separator = pair?.indexOf("=") ?? -1;
    if (!pair || separator < 1) continue;
    const name = pair.slice(0, separator);
    if (!/^(?:__Secure-)?better-auth\.[a-zA-Z0-9_.-]{1,80}$/.test(name)) continue;
    if (/max-age=0(?:;|$)/i.test(cookie)) delete current[name];
    else current[name] = pair.slice(separator + 1);
  }
  await writeSecret(cookieKey(hubId), JSON.stringify(current));
}
