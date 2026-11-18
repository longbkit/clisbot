import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { googleSignInNonce } from "@clisbot/device-access/proof";
import type { AuthServer } from "../auth/server.js";
import type { HubDeviceAccess } from "./index.js";
import { ProductRequestError } from "../auth/organization-access.js";
import { boundedBody } from "./request-body.js";

type GoogleAuth = Pick<AuthServer, "googleClientId" | "verifyGoogleIdToken" | "signInGoogleToken">;
type GoogleDevice = Pick<
  HubDeviceAccess,
  "deviceId" | "setupStatus" | "checkOwnerSetupApproval" | "hubIdentity"
>;
const TTL = 300_000;

/**
 * A transaction is scoped to one verified device, this Hub process and one single-use sign-in.
 *
 * The OIDC nonce is never handed out. It is derived from this Hub's pinned identity (backend ID and
 * E2EE public key) and the transaction, so the app computes it for the Hub it actually connected
 * to. A Google token obtained through another Hub carries that Hub's binding and fails here, even
 * if the other Hub relayed this Hub's transaction and client ID (CB-04).
 */
export class HubGoogleLogin {
  private readonly secret = randomBytes(32);
  private readonly consumed = new Map<string, number>();
  constructor(private readonly now = Date.now) {}

  async handle(
    path: string,
    request: Request,
    auth: GoogleAuth,
    devices: GoogleDevice,
  ): Promise<Response> {
    if (request.method !== "POST")
      return Response.json({ error: "method_not_allowed" }, { status: 405 });
    if (!auth.googleClientId || !auth.verifyGoogleIdToken || !auth.signInGoogleToken)
      return Response.json({ error: "google_not_configured" }, { status: 409 });
    const identity = await devices.hubIdentity();
    if (!identity) return Response.json({ error: "google_not_configured" }, { status: 409 });
    const deviceId = await devices.deviceId(request);
    if (!deviceId) throw new ProductRequestError(401, "device_proof_required");
    this.prune();
    if (path === "/google/challenge") {
      z.object({})
        .strict()
        .parse(JSON.parse(await boundedBody(request, 2048)));
      return this.challenge(deviceId, auth.googleClientId, identity.hubId);
    }
    const body = z
      .object({
        transactionId: z.string().min(20).max(128),
        idToken: z.string().min(1).max(16384),
        invitation: z.string().min(1).max(200).optional(),
        intent: z.literal("claimInstance").optional(),
      })
      .strict()
      .parse(JSON.parse(await boundedBody(request, 20_000)));
    this.validate(body.transactionId, deviceId, auth.googleClientId);
    const nonce = googleSignInNonce({
      hubId: identity.hubId,
      hubPublicKey: identity.publicKey,
      transactionId: body.transactionId,
    });
    const setup = await devices.setupStatus();
    if (setup !== "ready") {
      if (body.intent !== "claimInstance")
        throw new ProductRequestError(403, "owner_setup_required");
      await devices.checkOwnerSetupApproval(request);
    } else if (body.intent === "claimInstance") {
      throw new ProductRequestError(409, "owner_setup_unavailable");
    }
    // Invalid provider tokens must not allocate a five-minute replay record. Check the audience
    // and nonce binding first (Better Auth checks both again with the signature), then consume
    // synchronously before its ordinary admission side effects.
    if (
      !isBoundToken(body.idToken, auth.googleClientId, nonce) ||
      !(await auth.verifyGoogleIdToken(body.idToken, nonce))
    )
      throw new ProductRequestError(401, "google_id_token_invalid");
    this.consume(body.transactionId, deviceId, auth.googleClientId);
    return auth.signInGoogleToken(
      {
        idToken: body.idToken,
        nonce,
        ...(body.invitation ? { invitationId: body.invitation } : {}),
        claimInstance: body.intent === "claimInstance",
      },
      request.headers,
    );
  }

  private challenge(deviceId: string, clientId: string, hubId: string): Response {
    const expiresAt = this.now() + TTL;
    const payload = Buffer.alloc(32);
    payload.writeBigUInt64BE(BigInt(expiresAt));
    randomBytes(24).copy(payload, 8);
    const transactionId = Buffer.concat([payload, this.mac(deviceId, clientId, payload)]).toString(
      "base64url",
    );
    return Response.json(
      { transactionId, deviceId, hubId, expiresAt, clientId },
      { headers: { "cache-control": "no-store" } },
    );
  }

  private validate(id: string, deviceId: string, clientId: string) {
    if (!/^[A-Za-z0-9_-]{86}$/.test(id))
      throw new ProductRequestError(401, "google_transaction_invalid");
    const bytes = Buffer.from(id, "base64url");
    const payload = bytes.subarray(0, 32);
    if (
      bytes.length !== 64 ||
      bytes.toString("base64url") !== id ||
      !timingSafeEqual(bytes.subarray(32), this.mac(deviceId, clientId, payload))
    )
      throw new ProductRequestError(401, "google_transaction_invalid");
    const expiresAt = Number(payload.readBigUInt64BE());
    if (
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= this.now() ||
      expiresAt > this.now() + TTL ||
      this.consumed.has(id)
    )
      throw new ProductRequestError(401, "google_transaction_invalid");
    return { expiresAt };
  }

  private consume(id: string, deviceId: string, clientId: string): void {
    this.prune();
    const { expiresAt } = this.validate(id, deviceId, clientId);
    if (this.consumed.size >= 2048) throw new ProductRequestError(429, "google_sign_in_limit");
    this.consumed.set(id, expiresAt);
  }

  private mac(deviceId: string, clientId: string, payload: Buffer): Buffer {
    return createHmac("sha256", this.secret)
      .update(JSON.stringify(["clisbot-google-login-v1", deviceId, clientId]))
      .update(payload)
      .digest();
  }

  private prune(): void {
    for (const [id, expiresAt] of this.consumed)
      if (expiresAt <= this.now()) this.consumed.delete(id);
  }
}

const boundClaims = z.object({ aud: z.string(), nonce: z.string() });

/** Unverified pre-check: the token names exactly this Hub's client ID and this sign-in's nonce. */
function isBoundToken(idToken: string, clientId: string, nonce: string): boolean {
  const parts = idToken.split(".");
  if (parts.length !== 3) return false;
  try {
    const claims = boundClaims.safeParse(
      JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")),
    );
    return claims.success && claims.data.aud === clientId && claims.data.nonce === nonce;
  } catch {
    return false;
  }
}
