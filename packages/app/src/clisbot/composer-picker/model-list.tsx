import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { Pencil } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  AgentProfileGlyph,
  type AgentProfilePicker,
  type AgentProfilePickerRow,
  type AgentProfileSeed,
} from "@/agent-profiles";
import { Button } from "@/components/ui/button";
import { ComboboxItem } from "@/components/ui/combobox";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import type { ProviderSelectionModelRow } from "@/provider-selection/provider-selection";
import { ICON_SIZE } from "@/styles/theme";
import { ModelRow } from "./model-row";
import { shortcutDigit } from "./picker-rows";
import { useTouchRows } from "./use-touch-rows";

export type ModelListStatus = "ready" | "loading" | { error: string };

export interface ModelListProps {
  rows: readonly ProviderSelectionModelRow[];
  hiddenCount: number;
  status: ModelListStatus;
  emptyText: string;
  /** Search matches and Favorites mix providers, so each row names its own. */
  showProvider: boolean;
  selectedKey: string;
  highlightIndex: number;
  favorites: readonly string[];
  serverId: string | null;
  onPick: (row: ProviderSelectionModelRow) => void;
  onShowMore: () => void;
  onToggleFavorite: (key: string) => void;
  onCreateProfile?: (seed: AgentProfileSeed) => void;
  /** Reloads a provider whose models failed to load. */
  onRetry?: () => void;
}

function ListMessage(props: { status: ModelListStatus; emptyText: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  const { status, emptyText } = props;
  if (status === "loading") {
    return (
      <View style={styles.message}>
        <LoadingSpinner size={ICON_SIZE.sm} color={styles.muted.color} />
      </View>
    );
  }
  const failed = typeof status === "object";
  return (
    <View style={styles.message}>
      <Text style={styles.muted}>{failed ? status.error : emptyText}</Text>
      {failed && props.onRetry ? (
        <Button size="xs" variant="outline" onPress={props.onRetry}>
          {t("modelSelector.retry")}
        </Button>
      ) : null}
    </View>
  );
}

/** The center column: the chosen provider's models, Favorites, or every match for a query. */
export function ModelList(props: ModelListProps) {
  const { t } = useTranslation();
  const touch = useTouchRows();
  if (props.rows.length === 0) {
    return (
      <ListMessage status={props.status} emptyText={props.emptyText} onRetry={props.onRetry} />
    );
  }
  return (
    <View testID="composer-picker-models">
      {props.rows.map((row, index) => (
        <ModelRow
          key={row.favoriteKey}
          row={row}
          serverId={props.serverId}
          selected={row.favoriteKey === props.selectedKey}
          highlighted={index === props.highlightIndex}
          favorite={props.favorites.includes(row.favoriteKey)}
          shortcut={shortcutDigit(index)}
          showProvider={props.showProvider}
          onPick={props.onPick}
          onToggleFavorite={props.onToggleFavorite}
          onCreateProfile={props.onCreateProfile}
        />
      ))}
      {props.hiddenCount > 0 ? (
        <ComboboxItem
          label={t("composer.picker.showMore", { count: props.hiddenCount })}
          onPress={props.onShowMore}
          touch={touch}
          testID="composer-picker-show-more"
        />
      ) : null}
    </View>
  );
}

function ProfileRow(props: { row: AgentProfilePickerRow; onApply: (id: string) => void }) {
  const { row, onApply } = props;
  const touch = useTouchRows();
  const apply = useCallback(() => onApply(row.id), [onApply, row.id]);
  const glyph = useMemo(
    () => <AgentProfileGlyph icon={row.icon} color={row.color} size={16} />,
    [row.color, row.icon],
  );
  return (
    <ComboboxItem
      label={row.name}
      description={row.summary}
      onPress={apply}
      leadingSlot={glyph}
      touch={touch}
      testID={`composer-picker-profile-row-${row.id}`}
    />
  );
}

/** The Profiles rail entry's header: its name and the way to the Host's Agent profiles. */
function ProfilesHeader(props: { onEditProfiles?: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.profilesHeader}>
      <Text style={styles.profilesHeading} numberOfLines={1}>
        {t("composer.picker.profiles")}
      </Text>
      {props.onEditProfiles ? (
        <ToolbarButton
          label={t("modelSelector.editProfilesLabel")}
          compact
          onPress={props.onEditProfiles}
          testID="composer-picker-profiles-edit"
        >
          <Pencil size={ICON_SIZE.sm} color={styles.muted.color} />
        </ToolbarButton>
      ) : null}
    </View>
  );
}

/**
 * The Profiles rail entry: the Host's Agent profiles, applied with one press. With none yet it
 * offers Create profile, which opens the Host's Agent profiles settings.
 */
export function ProfileList(props: {
  profiles: AgentProfilePicker;
  emptyText: string;
  onEditProfiles?: () => void;
}) {
  const { t } = useTranslation();
  const { onEditProfiles } = props;
  if (props.profiles.rows.length === 0) {
    return (
      <View style={styles.message}>
        <Text style={styles.muted}>{props.emptyText}</Text>
        {onEditProfiles ? (
          <Button
            size="xs"
            variant="outline"
            onPress={onEditProfiles}
            testID="composer-picker-profiles-create"
          >
            {t("modelSelector.createProfile")}
          </Button>
        ) : null}
      </View>
    );
  }
  return (
    <View>
      <ProfilesHeader onEditProfiles={onEditProfiles} />
      {props.profiles.rows.map((row) => (
        <ProfileRow key={row.id} row={row} onApply={props.profiles.applyProfile} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  message: {
    minHeight: 120,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[2],
  },
  muted: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  profilesHeader: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[3],
    paddingRight: theme.spacing[1],
  },
  profilesHeading: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
}));
