import { useMemo } from "react";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { useHostRuntimeBootstrapState } from "@/app/_layout";
import { HostRouteProvider } from "@/navigation/host-route-context";
import { resolveStartupRoute } from "@/navigation/host-runtime-bootstrap";
import { ThemedStack } from "@/navigation/themed-stack";
import { useHostRegistryStatus } from "@/runtime/host-runtime";
import { useAvailableHosts } from "@/clisbot/hub/host-inventory";
import { HostUnavailableScreen } from "@/screens/host-unavailable-screen";

const HOST_STACK_SCREEN_OPTIONS = {
  headerShown: false,
  animation: "none" as const,
};

const SCREEN_OWNED_APPEARANCE = ["workspace/[workspaceId]/index"] as const;

const AGENT_SCREEN_OPTIONS = { gestureEnabled: false };

export default function HostRouteLayout() {
  return <KnownHostRoute />;
}

function KnownHostRoute() {
  const params = useLocalSearchParams<{ serverId?: string | string[] }>();
  const hosts = useAvailableHosts();
  const hostRegistryStatus = useHostRegistryStatus();
  const bootstrapState = useHostRuntimeBootstrapState();
  const routeServerId = typeof params.serverId === "string" ? params.serverId : null;
  const startupRoute = resolveStartupRoute({
    route: { kind: "host", serverId: routeServerId },
    startupBlocker: bootstrapState.startupBlocker,
    hostRegistryStatus,
    hosts,
  });

  // The Host navigator owns the existing leaf path even after its inventory entry
  // disappears. Replace its leaf contents, not the navigator: unmounting the stack
  // loses the workspace segment and lets web history serialize it as a query param.
  const unavailableContent = useMemo(
    () =>
      startupRoute.kind === "redirect" && routeServerId !== null ? (
        <HostUnavailableScreen serverId={routeServerId} />
      ) : undefined,
    [startupRoute.kind, routeServerId],
  );

  if (startupRoute.kind === "redirect" && routeServerId === null) {
    return <Redirect href={startupRoute.href} />;
  }

  const stack = (
    <ThemedStack
      screenOptions={HOST_STACK_SCREEN_OPTIONS}
      screenOwnedAppearance={SCREEN_OWNED_APPEARANCE}
      screenContentFallback={unavailableContent}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="workspace/[workspaceId]/index" />
      <Stack.Screen name="agent/[agentId]" options={AGENT_SCREEN_OPTIONS} />
      <Stack.Screen name="bot/[botId]" />
      <Stack.Screen name="chat/[chatId]" />
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
