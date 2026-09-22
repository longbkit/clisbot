import { Redirect, Stack, useLocalSearchParams, usePathname } from "expo-router";
import { useEffect } from "react";
import { useHostRuntimeBootstrapState } from "@/app/_layout";
import { withHostReturnTo } from "@/navigation/host-return-to";
import { HostRouteProvider } from "@/navigation/host-route-context";
import { resolveStartupRoute } from "@/navigation/host-runtime-bootstrap";
import { ThemedStack } from "@/navigation/themed-stack";
import { recordHostDiagnostic } from "@/runtime/host-diagnostics";
import { useHostRegistryStatus, useHosts } from "@/runtime/host-runtime";

const HOST_STACK_SCREEN_OPTIONS = {
  headerShown: false,
  animation: "none" as const,
};

const AGENT_SCREEN_OPTIONS = { gestureEnabled: false };

export default function HostRouteLayout() {
  return <KnownHostRoute />;
}

function KnownHostRoute() {
  const params = useLocalSearchParams<{ serverId?: string | string[] }>();
  const hosts = useHosts();
  const hostRegistryStatus = useHostRegistryStatus();
  const bootstrapState = useHostRuntimeBootstrapState();
  const routeServerId = typeof params.serverId === "string" ? params.serverId : null;
  const startupRoute = resolveStartupRoute({
    route: { kind: "host", serverId: routeServerId },
    startupBlocker: bootstrapState.startupBlocker,
    hostRegistryStatus,
    hosts,
  });

  const pathname = usePathname();
  const redirectHref =
    startupRoute.kind === "redirect" ? withHostReturnTo(String(startupRoute.href), pathname) : null;
  useEffect(() => {
    if (redirectHref === null) return;
    recordHostDiagnostic("host-route-redirect", {
      reason: "host not in registry",
      serverId: routeServerId,
      to: redirectHref,
      registeredHosts: hosts.map((host) => host.serverId),
    });
    // Record once per redirect, not on every registry change while it is pending.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redirectHref]);

  if (redirectHref !== null) {
    return <Redirect href={redirectHref as never} />;
  }

  const stack = (
    <ThemedStack screenOptions={HOST_STACK_SCREEN_OPTIONS}>
      <Stack.Screen name="index" />
      <Stack.Screen name="workspace/[workspaceId]/index" />
      <Stack.Screen name="agent/[agentId]" options={AGENT_SCREEN_OPTIONS} />
      <Stack.Screen name="sessions" />
      <Stack.Screen name="open-project" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="plugin/[pluginId]/[surfaceId]" />
      <Stack.Screen name="plugin/[pluginId]/[contributionKind]/[contributionId]" />
    </ThemedStack>
  );

  if (!routeServerId) {
    return stack;
  }

  return <HostRouteProvider serverId={routeServerId}>{stack}</HostRouteProvider>;
}
