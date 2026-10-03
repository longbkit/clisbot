import { isDevicePublicKey } from "./proof.js";

export interface PairedDevice {
  grant: "owner" | "login";
  id: string;
  publicKey: string;
  label: string;
  createdAt: number;
  lastSeenAt: number | null;
  revokedAt: number | null;
}

export interface PairingInvitation {
  grant: "owner" | "login";
  verifier: string;
  expiresAt: number;
  label: string;
  deviceId: string | null;
}

export interface DeviceAuthorityState {
  version: 1;
  backendId: string;
  loginRequired: boolean;
  devices: PairedDevice[];
  invitations: PairingInvitation[];
  replays: { key: string; expiresAt: number }[];
}

export interface DeviceAuthorityStore {
  transaction<T>(action: (state: DeviceAuthorityState) => T): Promise<T>;
}

export function createAuthorityState(backendId: string): DeviceAuthorityState {
  return { version: 1, backendId, loginRequired: false, devices: [], invitations: [], replays: [] };
}

export function assertAuthorityState(input: unknown): asserts input is DeviceAuthorityState {
  const state = input as DeviceAuthorityState | null;
  if (
    !state ||
    state.version !== 1 ||
    !text(state.backendId, 128) ||
    typeof state.loginRequired !== "boolean" ||
    !Array.isArray(state.devices) ||
    state.devices.length > 256 ||
    !Array.isArray(state.invitations) ||
    state.invitations.length > 64 ||
    !Array.isArray(state.replays) ||
    state.replays.length > 10_000 ||
    !state.devices.every(validDevice) ||
    !state.invitations.every(validInvitation) ||
    !state.replays.every((value) => value && text(value.key, 512) && timestamp(value.expiresAt))
  )
    throw new Error("Invalid device authority state");
  if (new Set(state.devices.map((device) => device.id)).size !== state.devices.length)
    throw new Error("Duplicate device identity");
}

function text(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}
function timestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function grant(value: unknown): boolean {
  return value === "owner" || value === "login";
}
function validDevice(device: PairedDevice): boolean {
  return Boolean(
    device &&
    text(device.id, 128) &&
    grant(device.grant) &&
    typeof device.publicKey === "string" &&
    isDevicePublicKey(device.publicKey) &&
    text(device.label, 80) &&
    timestamp(device.createdAt) &&
    (device.lastSeenAt === null || timestamp(device.lastSeenAt)) &&
    (device.revokedAt === null || timestamp(device.revokedAt)),
  );
}
function validInvitation(invitation: PairingInvitation): boolean {
  return Boolean(
    invitation &&
    grant(invitation.grant) &&
    text(invitation.verifier, 128) &&
    timestamp(invitation.expiresAt) &&
    text(invitation.label, 80) &&
    (invitation.deviceId === null || text(invitation.deviceId, 128)),
  );
}
