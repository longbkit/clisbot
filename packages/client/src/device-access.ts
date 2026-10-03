import {
  digest,
  helloBinding,
  signDeviceProof,
  type DeviceKey,
} from "@clisbot/device-access/proof";
import type { WSHelloMessage } from "@clisbot/protocol/messages";

export interface DaemonDeviceAccess {
  backendId: string;
  key: DeviceKey;
  credentialId?: string;
  invitationToken?: string;
  label?: string;
  nonce?(): string;
  onPaired?(credential: { backendId: string; credentialId: string }): void | Promise<void>;
}

export function deviceHelloAuth(
  access: DaemonDeviceAccess,
  hello: Pick<WSHelloMessage, "clientId" | "clientType" | "protocolVersion" | "accessTicket">,
): NonNullable<WSHelloMessage["auth"]> {
  const token = access.credentialId ? undefined : access.invitationToken;
  if (!access.credentialId && !token) throw new Error("Pair this device before connecting");
  const proof = signDeviceProof({
    key: access.key,
    proof: {
      backendId: access.backendId,
      credentialId: access.credentialId ?? "pair",
      timestamp: Date.now(),
      nonce: access.nonce?.() ?? secureNonce(),
    },
    context: token
      ? { purpose: "pair", binding: digest(token) }
      : { purpose: "hello", binding: helloBinding(hello) },
  });
  return token
    ? { kind: "pairing", token, publicKey: access.key.publicKey, proof, label: access.label }
    : { kind: "device", proof };
}

function secureNonce(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function acceptDeviceCredential(
  access: DaemonDeviceAccess,
  credential: {
    backendId: string;
    credentialId: string;
  },
): Promise<void> {
  if (credential.backendId !== access.backendId) throw new Error("Unexpected backend identity");
  await access.onPaired?.(credential);
  access.credentialId = credential.credentialId;
  delete access.invitationToken;
}
