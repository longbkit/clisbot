import { useCallback, useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { useCurrentOverlayLayer } from "@/lib/overlay-root";
import type { ProviderSelectorProvider } from "@/provider-selection/provider-selection";
import { useProviderSettingsStore } from "@/stores/provider-settings-store";
import type { RailLayout } from "./provider-rail";
import { orderProviderIds, resolveRailExpanded, useProviderRailStore } from "./rail-store";
import { useProviderRefresh, type ProviderRefresh } from "./use-provider-refresh";

/** The rail's per-device order and width, and the per-provider actions the panel offers. */
export function useProviderRail(input: {
  providers: readonly ProviderSelectorProvider[];
  isCompact: boolean;
  serverId: string | null;
  refresh: ProviderRefresh | undefined;
}) {
  const { width } = useWindowDimensions();
  const storedExpanded = useProviderRailStore((state) => state.expanded);
  const order = useProviderRailStore((state) => state.order);
  const { providers, serverId } = input;
  const ordered = useMemo(() => {
    const ids = orderProviderIds(
      providers.map((provider) => provider.id),
      order,
    );
    return ids.flatMap((id) => providers.filter((provider) => provider.id === id));
  }, [order, providers]);
  const expanded = resolveRailExpanded(storedExpanded, width);
  const desktopLayout: RailLayout = expanded ? "expanded" : "collapsed";
  const layout: RailLayout = input.isCompact ? "horizontal" : desktopLayout;
  const toggle = useCallback(
    () => useProviderRailStore.getState().setExpanded(!expanded),
    [expanded],
  );
  const move = useCallback(
    (id: string, delta: -1 | 1) =>
      useProviderRailStore.getState().move(
        ordered.map((provider) => provider.id),
        id,
        delta,
      ),
    [ordered],
  );
  // The settings sheet stacks over the panel, and closing it returns to the panel.
  const overlayParentLayer = useCurrentOverlayLayer();
  const openSettings = useMemo(() => {
    if (!serverId) return undefined;
    return (provider: string) =>
      useProviderSettingsStore.getState().open({ serverId, provider, overlayParentLayer });
  }, [overlayParentLayer, serverId]);
  const refresh = useProviderRefresh(input.refresh);
  return { providers: ordered, layout, toggle, move, openSettings, refresh };
}

export type ProviderRailControl = ReturnType<typeof useProviderRail>;
