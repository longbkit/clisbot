import * as Crypto from "expo-crypto";
import { z } from "zod";
import { createDeviceKey, digest } from "@clisbot/device-access/proof";
import type { DaemonClientConfig } from "@clisbot/client/internal/daemon-client";
import { readSecret, writeSecret, lockSecret } from "./secret-storage";
import { i18n } from "@/i18n/i18next";

const CredentialSchema = z.object({
  backendId: z.string(),
  key: z.object({ publicKey: z.string(), privateKey: z.string() }),
  credentialId: z.string().optional(),
  invitationToken: z.string().optional(),
  invitationLabel: z.string().optional(),
});
export type StoredDeviceCredential = z.infer<typeof CredentialSchema>;
const pending = new Map<string, Promise<unknown>>();

function storageKey(backendId: string): string {
  return `clisbot_device.${digest(backendId).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

export async function readDeviceCredential(
  backendId: string,
): Promise<StoredDeviceCredential | null> {
  const value = await readSecret(storageKey(backendId));
  if (!value) return null;
  const credential = CredentialSchema.parse(JSON.parse(value));
  if (credential.backendId !== backendId)
    throw new Error(i18n.t("hub.connection.errors.credentialMismatch"));
  return credential;
}

export async function prepareDevicePairing(
  backendId: string,
  token: string,
  label?: string,
): Promise<void> {
  await updateCredential(backendId, async () => {
    const current = await readDeviceCredential(backendId);
    const key = current?.key ?? createDeviceKey(await Crypto.getRandomBytesAsync(32));
    return { ...current, backendId, key, invitationToken: token, invitationLabel: label };
  });
}

export async function prepareDeviceLogin(backendId: string): Promise<StoredDeviceCredential> {
  const existing = await readDeviceCredential(backendId);
  if (existing) return existing;
  await updateCredential(backendId, async () => {
    const current = await readDeviceCredential(backendId);
    return current ?? { backendId, key: createDeviceKey(await Crypto.getRandomBytesAsync(32)) };
  });
  const credential = await readDeviceCredential(backendId);
  if (!credential) throw new Error(i18n.t("hub.connection.errors.keyNotSaved"));
  return credential;
}

export async function saveDeviceCredential(backendId: string, credentialId: string): Promise<void> {
  await updateCredential(backendId, async () => {
    const current = await readDeviceCredential(backendId);
    if (!current) throw new Error(i18n.t("hub.connection.errors.keyUnavailable"));
    return { backendId, key: current.key, credentialId };
  });
}

async function updateCredential(
  backendId: string,
  next: () => Promise<StoredDeviceCredential>,
): Promise<void> {
  const previous = pending.get(backendId);
  const operation = (async () => {
    await previous?.catch(() => undefined);
    await lockSecret(storageKey(backendId), async () =>
      writeSecret(storageKey(backendId), JSON.stringify(await next())),
    );
  })();
  pending.set(backendId, operation);
  try {
    await operation;
  } finally {
    if (pending.get(backendId) === operation) pending.delete(backendId);
  }
}

export async function daemonDeviceAccess(
  backendId: string,
  pairing = false,
): Promise<NonNullable<DaemonClientConfig["deviceAccess"]>> {
  const credential = await readDeviceCredential(backendId);
  if (!credential) throw new Error(i18n.t("hub.connection.errors.credentialUnavailable"));
  return {
    ...credential,
    ...(pairing && credential.invitationLabel ? { label: credential.invitationLabel } : {}),
    ...(pairing ? { credentialId: undefined } : { invitationToken: undefined }),
    nonce: () => Crypto.randomUUID().replace(/-/g, ""),
    onPaired: (value) => saveDeviceCredential(value.backendId, value.credentialId),
  };
}
