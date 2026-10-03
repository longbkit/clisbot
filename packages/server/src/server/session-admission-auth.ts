import { compare } from "bcryptjs";
import type { WSHelloMessage } from "@clisbot/protocol/messages";
import { OWNER_PERMISSIONS } from "./authorization/index.js";
import { matchesLocalCredential } from "./local-credential.js";
import type { SessionAdmission } from "./websocket-server.js";
import type { DeviceAuthority } from "@clisbot/device-access/authority";
import { helloBinding } from "@clisbot/device-access/proof";

export type AdmissionFailure = "password_required" | "incorrect_password";

type AdmissionResolution = { admission: SessionAdmission } | { rejection: AdmissionFailure };

export async function resolveSessionAdmission(input: {
  credential: WSHelloMessage["auth"];
  passwordHash: string | undefined;
  localCredential: string | null;
  transport: "direct" | "relay";
  deviceAuthority?: DeviceAuthority;
  hello?: WSHelloMessage;
  allowManagedTicket?: boolean;
  encrypted?: boolean;
}): Promise<AdmissionResolution> {
  const { credential, passwordHash, localCredential, transport } = input;
  if (input.deviceAuthority) return resolveDeviceAdmission(input);
  if (!passwordHash) {
    return { admission: { principalId: "owner", permissions: OWNER_PERMISSIONS } };
  }
  if (!credential) {
    // COMPAT(relayPasswordOptional): added in v0.9.1, remove once release N mobile builds are live on App Store and Play.
    if (transport === "relay") {
      return { admission: { principalId: "owner", permissions: OWNER_PERMISSIONS } };
    }
    return { rejection: "password_required" };
  }
  if (credential.kind === "localCredential") {
    if (localCredential && matchesLocalCredential(localCredential, credential.token)) {
      return { admission: { principalId: "owner", permissions: OWNER_PERMISSIONS } };
    }
    return { rejection: "incorrect_password" };
  }
  return credential.kind === "password" && (await compare(credential.password, passwordHash))
    ? { admission: { principalId: "owner", permissions: OWNER_PERMISSIONS } }
    : { rejection: "incorrect_password" };
}

async function resolveDeviceAdmission(input: {
  credential: WSHelloMessage["auth"];
  localCredential: string | null;
  deviceAuthority?: DeviceAuthority;
  hello?: WSHelloMessage;
  allowManagedTicket?: boolean;
  encrypted?: boolean;
}): Promise<AdmissionResolution> {
  const { credential, localCredential, deviceAuthority, hello } = input;
  if (
    credential?.kind === "localCredential" &&
    localCredential &&
    matchesLocalCredential(localCredential, credential.token)
  ) {
    return {
      admission: { principalId: "owner", permissions: OWNER_PERMISSIONS, localOperator: true },
    };
  }
  if (
    input.encrypted &&
    input.allowManagedTicket &&
    hello?.accessTicket &&
    credential?.kind !== "pairing"
  ) {
    // No authority is granted here: the ticket resolver must admit this hello next.
    return { admission: { principalId: "pending-ticket", permissions: [] } };
  }
  if (!deviceAuthority || !hello || !credential) return { rejection: "password_required" };
  if (!input.encrypted) return { rejection: "incorrect_password" };
  try {
    let device: import("@clisbot/device-access/authority").PairedDevice | null = null;
    if (credential.kind === "pairing") device = await deviceAuthority.redeem(credential);
    if (credential.kind === "device")
      device = await deviceAuthority.authenticate(credential.proof, {
        purpose: "hello",
        binding: helloBinding(hello),
      });
    if (!device || device.grant !== "owner") return { rejection: "incorrect_password" };
    const { backendId } = await deviceAuthority.info();
    return {
      admission: {
        principalId: `device:${device.id}`,
        permissions: OWNER_PERMISSIONS,
        deviceCredential: { backendId, credentialId: device.id },
      },
    };
  } catch {
    return { rejection: "incorrect_password" };
  }
}
