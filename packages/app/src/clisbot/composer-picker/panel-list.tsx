import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import type { PanelProps } from "./model-picker";
import { ModelList, ProfileList } from "./model-list";
import { ProviderHeader } from "./provider-header";

function useProviderActions(props: PanelProps) {
  const { scope } = props.state;
  const { rail } = props;
  const providerId = scope.kind === "provider" ? scope.providerId : null;
  const index = rail.providers.findIndex((provider) => provider.id === providerId);
  const move = useCallback(
    (delta: -1 | 1) => {
      if (providerId) rail.move(providerId, delta);
    },
    [providerId, rail],
  );
  const openSettings = useMemo(
    () => (rail.openSettings && providerId ? () => rail.openSettings?.(providerId) : undefined),
    [providerId, rail],
  );
  const retry = useMemo(
    () =>
      providerId && rail.refresh.available ? () => void rail.refresh.run(providerId) : undefined,
    [providerId, rail.refresh],
  );
  return { provider: index >= 0 ? rail.providers[index] : null, index, move, openSettings, retry };
}

/** The center column: the chosen provider's header and models, Favorites, matches, or Profiles. */
export function PanelList(props: PanelProps) {
  const { t } = useTranslation();
  const { state } = props;
  const actions = useProviderActions(props);
  const query = state.query.trim();
  if (state.scope.kind === "profiles" && props.profiles && !query) {
    return <ProfileList profiles={props.profiles} emptyText={t("composer.picker.noMatches")} />;
  }
  const emptyKey = state.scope.kind === "favorites" && !query ? "noFavorites" : "noMatches";
  return (
    <View>
      {actions.provider && !query ? (
        <ProviderHeader
          provider={actions.provider}
          serverId={props.serverId}
          refresh={props.rail.refresh}
          canMoveUp={actions.index > 0}
          canMoveDown={actions.index < props.rail.providers.length - 1}
          onMove={actions.move}
          onOpenSettings={actions.openSettings}
        />
      ) : null}
      <ModelList
        rows={state.rows}
        hiddenCount={state.hiddenCount}
        status={state.status}
        emptyText={t(`composer.picker.${emptyKey}`)}
        selectedKey={state.selectedKey}
        highlightIndex={state.highlight}
        favorites={state.favorites}
        serverId={props.serverId}
        onPick={props.onPick}
        onShowMore={state.showMore}
        onToggleFavorite={state.toggleFavorite}
        onCreateProfile={props.onCreateProfile}
        onRetry={actions.retry}
      />
    </View>
  );
}
