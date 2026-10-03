import { randomBytes, randomUUID } from "node:crypto";
import {
  digest,
  isDevicePublicKey,
  verifyDeviceProof,
  type DeviceProof,
  type ProofContext,
} from "./proof.js";
import type { DeviceAuthorityState, DeviceAuthorityStore, PairedDevice } from "./state.js";

export type { DeviceAuthorityState, DeviceAuthorityStore, PairedDevice } from "./state.js";
export { createAuthorityState, assertAuthorityState } from "./state.js";

export class DeviceAccessError extends Error {}

const PROOF_WINDOW_MS = 60_000;
const MAX_REPLAYS = 10_000;

export class DeviceAuthority {
  constructor(
    private readonly store: DeviceAuthorityStore,
    private readonly now = Date.now,
  ) {}

  info(): Promise<{ backendId: string; loginRequired: boolean }> {
    return this.store.transaction((s) => ({
      backendId: s.backendId,
      loginRequired: s.loginRequired,
    }));
  }

  createInvitation(
    options: { label?: string; ttlMs?: number; grant?: "owner" | "login" } = {},
  ): Promise<{
    backendId: string;
    token: string;
    expiresAt: number;
  }> {
    const ttlMs = options.ttlMs ?? 300_000;
    if (!Number.isInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 900_000)
      throw new DeviceAccessError("TTL must be between 1 and 900 seconds");
    const label = normalizeDeviceLabel(options.label ?? "New device");
    return this.store.transaction((state) => {
      prune(state, this.now());
      if (state.invitations.length >= 64)
        throw new DeviceAccessError("Too many outstanding invitations");
      const token = randomBytes(32).toString("base64url");
      const expiresAt = this.now() + ttlMs;
      state.invitations.push({
        verifier: digest(token),
        expiresAt,
        label,
        deviceId: null,
        grant: options.grant ?? "owner",
      });
      return { backendId: state.backendId, token, expiresAt };
    });
  }

  redeem(input: {
    token: string;
    publicKey: string;
    proof: DeviceProof;
    label?: string;
  }): Promise<PairedDevice> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(input.token) || !isDevicePublicKey(input.publicKey))
      throw new DeviceAccessError("Invalid invitation");
    return this.store.transaction((state) => this.redeemInTransaction(state, input));
  }

  private redeemInTransaction(
    state: DeviceAuthorityState,
    input: {
      token: string;
      publicKey: string;
      proof: DeviceProof;
      label?: string;
    },
  ): PairedDevice {
    const now = this.now();
    prune(state, now);
    const invitation = state.invitations.find((i) => i.verifier === digest(input.token));
    if (!invitation) throw new DeviceAccessError("Invitation expired or unavailable");
    validateProof({
      state,
      proof: input.proof,
      publicKey: input.publicKey,
      now,
      context: { purpose: "pair", binding: digest(input.token) },
      credentialId: "pair",
    });
    if (invitation.deviceId) {
      const device = state.devices.find((d) => d.id === invitation.deviceId);
      if (!device || device.revokedAt !== null || device.publicKey !== input.publicKey)
        throw new DeviceAccessError("Invitation already used");
      consumeProof(state, input.publicKey, input.proof);
      return { ...device };
    }
    if (input.label !== undefined) invitation.label = normalizeDeviceLabel(input.label);
    consumeProof(state, input.publicKey, input.proof);
    const existing = state.devices.find(
      (device) => device.publicKey === input.publicKey && device.revokedAt === null,
    );
    if (existing) {
      if (invitation.grant === "owner") existing.grant = "owner";
      existing.label = invitation.label;
      invitation.deviceId = existing.id;
      return { ...existing };
    }
    return registerDevice(state, invitation, input.publicKey, now);
  }

  authenticate(proof: DeviceProof, context: ProofContext): Promise<PairedDevice> {
    return this.store.transaction((state) => {
      const now = this.now();
      prune(state, now);
      const device = state.devices.find((d) => d.id === proof.credentialId && d.revokedAt === null);
      if (!device) throw new DeviceAccessError("Device is not authorized");
      validateProof({
        state,
        proof,
        context,
        publicKey: device.publicKey,
        now,
        credentialId: device.id,
      });
      consumeProof(state, device.publicKey, proof);
      device.lastSeenAt = now;
      return { ...device };
    });
  }

  list(): Promise<PairedDevice[]> {
    return this.store.transaction((s) => s.devices.map((d) => ({ ...d })));
  }

  /** Called only by a backend after successful account authentication. */
  registerLoginDevice(input: { publicKey: string; label?: string }): Promise<PairedDevice> {
    if (!isDevicePublicKey(input.publicKey)) throw new DeviceAccessError("Invalid device key");
    const label = normalizeDeviceLabel(input.label ?? "Signed-in device");
    return this.store.transaction((state) => {
      const existing = state.devices.find(
        (device) => device.publicKey === input.publicKey && device.revokedAt === null,
      );
      // Account login neither upgrades a login credential to owner nor downgrades
      // an independently approved owner credential. Identity is the key, not label.
      if (existing) return { ...existing };
      return registerDevice(
        state,
        { verifier: "", expiresAt: this.now(), deviceId: null, label, grant: "login" },
        input.publicKey,
        this.now(),
      );
    });
  }

  rename(id: string, label: string): Promise<void> {
    const next = normalizeDeviceLabel(label);
    return this.store.transaction((state) => {
      const device = state.devices.find((d) => d.id === id && d.revokedAt === null);
      if (!device) throw new DeviceAccessError("Unknown device");
      device.label = next;
    });
  }

  revoke(id: string): Promise<void> {
    return this.store.transaction((state) => {
      const device = state.devices.find((d) => d.id === id);
      if (!device) throw new DeviceAccessError("Unknown device");
      device.revokedAt ??= this.now();
    });
  }

  setLoginRequired(required: boolean): Promise<void> {
    return this.store.transaction((state) => {
      state.loginRequired = required;
    });
  }
}

export function normalizeDeviceLabel(value: string): string {
  if (typeof value !== "string") throw new DeviceAccessError("Invalid device label");
  const label = value.trim();
  if (
    !label ||
    label.length > 80 ||
    // eslint-disable-next-line no-control-regex -- Reject terminal controls and bidirectional label spoofing.
    /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/u.test(label)
  )
    throw new DeviceAccessError("Device label must contain 1–80 printable characters");
  return label;
}

function consumeProof(state: DeviceAuthorityState, publicKey: string, proof: DeviceProof): void {
  const key = digest(JSON.stringify([publicKey, proof.nonce]));
  if (state.replays.some((r) => r.key === key)) throw new DeviceAccessError("Proof already used");
  if (state.replays.length >= MAX_REPLAYS) throw new DeviceAccessError("Proof capacity reached");
  state.replays.push({ key, expiresAt: proof.timestamp + PROOF_WINDOW_MS + 1 });
}

function prune(state: DeviceAuthorityState, now: number): void {
  state.invitations = state.invitations.filter((i) => i.expiresAt > now);
  state.replays = state.replays.filter((r) => r.expiresAt > now);
}

function validateProof(input: {
  state: DeviceAuthorityState;
  proof: DeviceProof;
  context: ProofContext;
  publicKey: string;
  now: number;
  credentialId: string;
}): void {
  const { state, proof, context, publicKey, now, credentialId } = input;
  if (
    proof.backendId !== state.backendId ||
    proof.credentialId !== credentialId ||
    !Number.isSafeInteger(proof.timestamp) ||
    Math.abs(now - proof.timestamp) > PROOF_WINDOW_MS ||
    !/^[A-Za-z0-9_-]{22,128}$/.test(proof.nonce) ||
    !verifyDeviceProof({ publicKey, proof, context })
  )
    throw new DeviceAccessError("Invalid device proof");
}

function registerDevice(
  state: DeviceAuthorityState,
  invitation: DeviceAuthorityState["invitations"][number],
  publicKey: string,
  now: number,
): PairedDevice {
  if (state.devices.length >= 256) throw new DeviceAccessError("Device limit reached");
  const device: PairedDevice = {
    id: randomUUID(),
    publicKey: publicKey,
    grant: invitation.grant,
    label: invitation.label,
    createdAt: now,
    lastSeenAt: null,
    revokedAt: null,
  };
  state.devices.push(device);
  invitation.deviceId = device.id;
  return { ...device };
}
