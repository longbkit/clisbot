import { useMemo } from "react";
import { useHosts } from "@/runtime/host-runtime";
import { ownershipHostKind } from "./ownership-host";
import type { OwnershipHostKind } from "./ownership";

export function useOwnershipHosts(): ReadonlyMap<string, OwnershipHostKind> {
  const hosts = useHosts();
  const key = JSON.stringify(hosts.map((host) => [host.serverId, ownershipHostKind(host)]));
  return useMemo(() => new Map(JSON.parse(key)), [key]);
}
