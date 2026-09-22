import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { useHostRuntimeBootstrapState } from "@/app/_layout";
import { HostRouteProvider } from "@/navigation/host-route-context";
import { resolveStartupRoute } from "@/navigation/host-runtime-bootstrap";
import { ThemedStack } from "@/navigation/themed-stack";
import { useHostRegistryStatus, useHosts } from "@/runtime/host-runtime";
import { HostUnavailableScreen } from "@/screens/host-unavailable-screen";

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

  if (startupRoute.kind === "redirect") {
    // A Host route never navigates away on its own: a missing Host is shown where the reader is,
    // with the choices, and the route renders it again once it is registered.
    if (routeServerId !== null) return <HostUnavailableScreen serverId={routeServerId} />;
    return <Redirect href={startupRoute.href} />;
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
