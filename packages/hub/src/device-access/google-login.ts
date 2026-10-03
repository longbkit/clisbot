import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { AuthServer } from "../auth/server.js";
import type { HubDeviceAccess } from "./index.js";
import { ProductRequestError } from "../auth/organization-access.js";
import { boundedBody } from "./request-body.js";

type GoogleAuth = Pick<AuthServer, "googleClientId" | "verifyGoogleIdToken" | "signInGoogleToken">;
type GoogleDevice = Pick<HubDeviceAccess, "deviceId" | "setupStatus" | "checkOwnerSetupApproval">;
const TTL = 300_000;

/** A nonce is scoped to one verified device, this Hub process and one single-use sign-in. */
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
    const deviceId = await devices.deviceId(request);
    if (!deviceId) throw new ProductRequestError(401, "device_proof_required");
    this.prune();
    if (path === "/google/challenge") {
      z.object({})
        .strict()
        .parse(JSON.parse(await boundedBody(request, 2048)));
      return this.challenge(deviceId, auth.googleClientId);
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
    const nonce = this.validate(body.transactionId, deviceId, auth.googleClientId).nonce;
    const setup = await devices.setupStatus();
    if (setup !== "ready") {
      if (body.intent !== "claimInstance")
        throw new ProductRequestError(403, "owner_setup_required");
      await devices.checkOwnerSetupApproval(request);
    } else if (body.intent === "claimInstance") {
      throw new ProductRequestError(409, "owner_setup_unavailable");
    }
    // Invalid provider tokens must not allocate a five-minute replay record. Use the configured
    // Better Auth verifier, then consume synchronously before its ordinary admission side effects.
    if (!(await auth.verifyGoogleIdToken(body.idToken, nonce)))
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

  private challenge(deviceId: string, clientId: string): Response {
    const expiresAt = this.now() + TTL;
    const payload = Buffer.alloc(32);
    payload.writeBigUInt64BE(BigInt(expiresAt));
    randomBytes(24).copy(payload, 8);
    const transactionId = Buffer.concat([payload, this.mac(deviceId, clientId, payload)]).toString(
      "base64url",
    );
    return Response.json(
      { transactionId, deviceId, nonce: this.nonce(transactionId), expiresAt, clientId },
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
    return { nonce: this.nonce(id), expiresAt };
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

  private nonce(id: string): string {
    return createHmac("sha256", this.secret)
      .update("clisbot-google-nonce-v1")
      .update(id)
      .digest("base64url");
  }

  private prune(): void {
    for (const [id, expiresAt] of this.consumed)
      if (expiresAt <= this.now()) this.consumed.delete(id);
  }
}
