import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { ArrowDown, ArrowUp, MoreHorizontal, RefreshCw, Settings2 } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { ModelProviderGlyph } from "@/components/model-browser";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { ICON_SIZE } from "@/styles/theme";
import type { ProviderRefreshControl } from "./use-provider-refresh";

export interface ProviderHeaderProps {
  provider: { id: string; label: string };
  serverId: string | null;
  refresh: ProviderRefreshControl;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (delta: -1 | 1) => void;
  onOpenSettings?: () => void;
}

function OptionsMenu(props: ProviderHeaderProps & { onRefresh: () => void }) {
  const { t } = useTranslation();
  const { onMove } = props;
  const up = useCallback(() => onMove(-1), [onMove]);
  const down = useCallback(() => onMove(1), [onMove]);
  const icon = styles.icon.color;
  const leading = useMemo(
    () => ({
      settings: <Settings2 size={ICON_SIZE.sm} color={icon} />,
      refresh: <RefreshCw size={ICON_SIZE.sm} color={icon} />,
      up: <ArrowUp size={ICON_SIZE.sm} color={icon} />,
      down: <ArrowDown size={ICON_SIZE.sm} color={icon} />,
    }),
    [icon],
  );
  return (
    <DropdownMenu compactMode="sheet">
      <ToolbarButton
        kind="menu"
        label={t("composer.picker.providerOptions", { provider: props.provider.label })}
        compact
        testID="composer-picker-provider-menu"
      >
        <MoreHorizontal size={ICON_SIZE.sm} color={icon} />
      </ToolbarButton>
      <DropdownMenuContent align="end" width={220} sheetTitle={props.provider.label}>
        {props.onOpenSettings ? (
          <DropdownMenuItem
            leading={leading.settings}
            onSelect={props.onOpenSettings}
            testID="composer-picker-provider-settings"
          >
            {t("composer.picker.providerSettings")}
          </DropdownMenuItem>
        ) : null}
        {props.refresh.available ? (
          <DropdownMenuItem
            leading={leading.refresh}
            onSelect={props.onRefresh}
            testID="composer-picker-provider-refresh-item"
          >
            {t("composer.picker.refreshModels")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          leading={leading.up}
          disabled={!props.canMoveUp}
          onSelect={up}
          testID="composer-picker-provider-move-up"
        >
          {t("composer.picker.moveUp")}
        </DropdownMenuItem>
        <DropdownMenuItem
          leading={leading.down}
          disabled={!props.canMoveDown}
          onSelect={down}
          testID="composer-picker-provider-move-down"
        >
          {t("composer.picker.moveDown")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Above the chosen provider's models: its name, an in-place refresh of its model list, and its
 * options (Provider settings, Refresh, Move up, Move down). On every layout, so a phone and the
 * icon-only rail reach the same actions.
 */
export function ProviderHeader(props: ProviderHeaderProps) {
  const { t } = useTranslation();
  const { refresh, provider } = props;
  const pending = refresh.isPending(provider.id);
  const error = refresh.errorFor(provider.id);
  const onRefresh = useCallback(() => void refresh.run(provider.id), [provider.id, refresh]);
  return (
    <View testID="composer-picker-provider-header">
      <View style={styles.row}>
        <ModelProviderGlyph provider={provider.id} serverId={props.serverId} size={ICON_SIZE.sm} />
        <Text style={styles.name} numberOfLines={1}>
          {provider.label}
        </Text>
        {refresh.available ? (
          <ToolbarButton
            label={t("composer.picker.refreshModels")}
            compact
            disabled={pending}
            onPress={onRefresh}
            testID="composer-picker-provider-refresh"
          >
            {pending ? (
              <LoadingSpinner size={ICON_SIZE.sm} color={styles.icon.color} />
            ) : (
              <RefreshCw size={ICON_SIZE.sm} color={styles.icon.color} />
            )}
          </ToolbarButton>
        ) : null}
        <OptionsMenu {...props} onRefresh={onRefresh} />
      </View>
      {error ? (
        <View style={styles.error} testID="composer-picker-provider-refresh-error">
          <Text style={styles.errorText}>{`${t("composer.picker.refreshFailed")}: ${error}`}</Text>
          <Button size="xs" variant="outline" onPress={onRefresh}>
            {t("modelSelector.retry")}
          </Button>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[3],
    paddingRight: theme.spacing[1],
  },
  name: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  error: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[1],
  },
  errorText: {
    flex: 1,
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
  },
  icon: {
    color: theme.colors.foregroundMuted,
  },
}));
