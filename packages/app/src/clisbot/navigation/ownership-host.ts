import type { HostProfile } from "@/types/host-connection";
import type { OwnershipHostKind } from "./ownership";

/** Binding, not transport or managed-access mode, distinguishes Hub and legacy direct Hosts. */
export function ownershipHostKind(
  host: Pick<HostProfile, "management"> | undefined,
): OwnershipHostKind {
  if (!host) return "unknown";
  return host.management ? "hub" : "direct";
}
