import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  isDevicePublicKey,
  verifyDeviceProof,
  type DeviceProof,
  type ProofContext,
} from "@clisbot/device-access/proof";
import {
  DeviceAccessError,
  normalizeDeviceLabel,
  type PairedDevice,
} from "@clisbot/device-access/authority";
import { ProductRequestError } from "../auth/organization-access.js";
import { EMAIL_REGISTRATION_PATHS } from "../auth/registration-contract.js";

const TTL = 300_000;
const PATHS = new Map([
  ["/api/auth/sign-in/email", "POST"],
  ["/api/auth/sign-up/email", "POST"],
  ...Object.values(EMAIL_REGISTRATION_PATHS).map((path): [string, string] => [path, "POST"]),
  ["/api/auth/clisbot/state", "GET"],
  ["/api/auth/clisbot/device/google/challenge", "POST"],
  ["/api/auth/clisbot/device/google/sign-in", "POST"],
]);

interface ChallengeLabel {
  hubId: string;
  publicKey: string;
  label: string;
  expiresAt: number;
}

/** Ephemeral proof of key possession is admission to login only, never an owner credential. */
export class HubLoginEntry {
  private readonly secret = randomBytes(32);
  private readonly labels = new Map<string, ChallengeLabel>();
  private readonly consumed = new Map<string, number>();
  private readonly active = new Set<string>();
  constructor(private readonly now = Date.now) {}

  create(hubId: string, publicKey: string, label = "New device") {
    this.prune();
    if (!isDevicePublicKey(publicKey)) throw new ProductRequestError(400, "invalid_device_key");
    const normalized = normalizeDeviceLabel(label);
    const existing = [...this.labels].find(
      ([, value]) => value.publicKey === publicKey && value.hubId === hubId,
    );
    if (existing) return { hubId, challengeId: existing[0], expiresAt: existing[1].expiresAt };
    const expiresAt = this.now() + TTL;
    const payload = Buffer.alloc(48);
    Buffer.from(publicKey, "base64").copy(payload);
    payload.writeBigUInt64BE(BigInt(expiresAt), 32);
    randomBytes(8).copy(payload, 40);
    const challengeId = Buffer.concat([payload, this.mac(hubId, payload)]).toString("base64url");
    // Only display metadata can be evicted. Anonymous challenge creation never reserves authority.
    if (this.labels.size >= 64) this.labels.delete(this.labels.keys().next().value!);
    this.labels.set(challengeId, { hubId, publicKey, label: normalized, expiresAt });
    return { hubId, challengeId, expiresAt };
  }

  authenticate(proof: DeviceProof, context: ProofContext, request: Request): PairedDevice {
    this.prune();
    const id = proof.credentialId.slice("login:".length);
    const challenge = this.verifyChallenge(id, proof.backendId);
    if (
      !challenge ||
      PATHS.get(new URL(request.url).pathname) !== request.method ||
      Math.abs(this.now() - proof.timestamp) > 60_000 ||
      !/^[A-Za-z0-9_-]{22,128}$/.test(proof.nonce) ||
      this.consumed.has(id) ||
      !verifyDeviceProof({ publicKey: challenge.publicKey, proof, context })
    )
      throw new DeviceAccessError("Invalid login challenge proof");
    return {
      id: proof.credentialId,
      publicKey: challenge.publicKey,
      label: this.labels.get(id)?.label ?? "New device",
      grant: "login",
      createdAt: challenge.expiresAt - TTL,
      lastSeenAt: this.now(),
      revokedAt: null,
    };
  }

  requiresMutationGuard(request: Request): boolean {
    const path = new URL(request.url).pathname;
    return !(
      (path === "/api/auth/clisbot/state" && request.method === "GET") ||
      (path === "/api/auth/clisbot/device/google/challenge" && request.method === "POST") ||
      (path === EMAIL_REGISTRATION_PATHS.inspect && request.method === "POST")
    );
  }

  /** Serialize account mutations per challenge without retaining failed anonymous attempts. */
  async runMutation<T>(credentialId: string, operation: () => Promise<T>): Promise<T> {
    this.prune();
    const id = credentialId.slice("login:".length);
    if (this.consumed.has(id)) throw new DeviceAccessError("Invalid login challenge proof");
    if (this.active.has(id)) throw new ProductRequestError(409, "login_in_progress");
    // Reserve capacity for every in-flight operation; successful completion can always consume.
    if (this.active.size >= 128 || this.consumed.size + this.active.size >= 2048)
      throw new ProductRequestError(429, "login_busy");
    this.active.add(id);
    try {
      return await operation();
    } finally {
      this.active.delete(id);
    }
  }

  /** Called only after Better Auth has issued a genuine admitted account session. */
  consume(credentialId: string): void {
    const id = credentialId.slice("login:".length);
    if (!this.active.has(id)) throw new DeviceAccessError("Verified login mutation required");
    const bytes = Buffer.from(id, "base64url");
    if (bytes.length !== 80) throw new DeviceAccessError("Invalid login challenge proof");
    const expiresAt = Number(bytes.readBigUInt64BE(32));
    this.consumed.set(id, expiresAt);
    this.labels.delete(id);
  }

  private verifyChallenge(
    id: string,
    hubId: string,
  ): { publicKey: string; expiresAt: number } | undefined {
    if (!/^[A-Za-z0-9_-]{107}$/.test(id)) return undefined;
    const bytes = Buffer.from(id, "base64url");
    if (bytes.length !== 80 || bytes.toString("base64url") !== id) return undefined;
    const payload = bytes.subarray(0, 48);
    if (!timingSafeEqual(bytes.subarray(48), this.mac(hubId, payload))) return undefined;
    const expiresAt = Number(payload.readBigUInt64BE(32));
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= this.now() || expiresAt > this.now() + TTL)
      return undefined;
    return { publicKey: payload.subarray(0, 32).toString("base64"), expiresAt };
  }

  private mac(hubId: string, payload: Buffer): Buffer {
    return createHmac("sha256", this.secret)
      .update(JSON.stringify(["clisbot-login-entry-v1", hubId]))
      .update(payload)
      .digest();
  }
  private prune(): void {
    for (const [id, value] of this.labels)
      if (value.expiresAt <= this.now()) this.labels.delete(id);
    for (const [id, expiresAt] of this.consumed)
      if (expiresAt <= this.now()) this.consumed.delete(id);
  }
}
