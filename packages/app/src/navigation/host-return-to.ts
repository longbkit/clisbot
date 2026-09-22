import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo } from "react";
import { useHosts } from "@/runtime/host-runtime";

/**
 * A Host route someone was sent away from because its Host left the registry. Welcome and Open
 * Project carry it, and send the reader back as soon as that Host is registered again.
 */
export const RETURN_TO_PARAM = "returnTo";

export interface HostReturnTo {
  path: string;
  serverId: string;
}

/** Accepts only in-app Host routes (`/h/<serverId>/…`), never another origin. */
export function parseHostReturnTo(value: unknown): HostReturnTo | null {
  if (typeof value !== "string") return null;
  const match = /^\/h\/([^/?#]+)(?:[/?#]|$)/.exec(value);
  if (match === null || value.startsWith("//") || value.includes("\\")) return null;
  return { path: value, serverId: decodeURIComponent(match[1]!) };
}

export function withHostReturnTo(href: string, returnTo: string | null | undefined): string {
  if (!returnTo || parseHostReturnTo(returnTo) === null) return href;
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}${RETURN_TO_PARAM}=${encodeURIComponent(returnTo)}`;
}

/** The pending return target, and whether its Host is back in the registry. */
export function useHostReturnTo(): (HostReturnTo & { available: boolean }) | null {
  const params = useLocalSearchParams<{ [RETURN_TO_PARAM]?: string | string[] }>();
  const hosts = useHosts();
  const raw = params[RETURN_TO_PARAM];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return useMemo(() => {
    const returnTo = parseHostReturnTo(value);
    if (returnTo === null) return null;
    return { ...returnTo, available: hosts.some((host) => host.serverId === returnTo.serverId) };
  }, [hosts, value]);
}

/** Sends the reader back to the Host route they were on once its Host is registered again. */
export function useResumeHostReturnTo(
  options: { enabled?: boolean } = {},
): (HostReturnTo & { available: boolean }) | null {
  const router = useRouter();
  const returnTo = useHostReturnTo();
  const enabled = options.enabled ?? true;
  const resumePath = enabled && returnTo?.available ? returnTo.path : null;
  useEffect(() => {
    if (resumePath === null) return;
    router.replace(resumePath as never);
  }, [resumePath, router]);
  return returnTo;
}
