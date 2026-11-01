import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Check, Plus, Star } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import type { AgentProfileSeed } from "@/agent-profiles";
import { ModelProviderGlyph } from "@/components/model-browser";
import { ComboboxItem } from "@/components/ui/combobox";
import { Shortcut } from "@/components/ui/shortcut";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import type { ProviderSelectionModelRow } from "@/provider-selection/provider-selection";
import { ICON_SIZE } from "@/styles/theme";
import { useTouchRows } from "./use-touch-rows";

export interface ModelRowProps {
  row: ProviderSelectionModelRow;
  serverId: string | null;
  selected: boolean;
  highlighted: boolean;
  favorite: boolean;
  /** ⌘1…⌘9 for the first nine rows; null past them. */
  shortcut: string | null;
  /** Names the provider beside the model, for a list that mixes providers. */
  showProvider: boolean;
  onPick: (row: ProviderSelectionModelRow) => void;
  onToggleFavorite: (key: string) => void;
  onCreateProfile?: (seed: AgentProfileSeed) => void;
}

function RowAction(props: {
  label: string;
  visible: boolean;
  /** A thumb gets a larger press area than the drawn button. */
  touch: boolean;
  onPress: () => void;
  testID: string;
  children: ReactNode;
}) {
  return (
    <View
      style={props.visible ? undefined : styles.hidden}
      pointerEvents={props.visible ? "auto" : "none"}
    >
      <ToolbarButton
        label={props.label}
        compact
        round
        tooltipSide="top"
        hitSlop={props.touch ? TOUCH_HIT_SLOP : undefined}
        onPress={props.onPress}
        testID={props.testID}
      >
        {props.children}
      </ToolbarButton>
    </View>
  );
}

function RowActions(props: ModelRowProps & { hovered: boolean }) {
  const { t } = useTranslation();
  const touch = useTouchRows();
  const { row, favorite, onToggleFavorite, onCreateProfile } = props;
  const toggle = useCallback(() => onToggleFavorite(row.favoriteKey), [onToggleFavorite, row]);
  const create = useCallback(
    () => onCreateProfile?.({ provider: row.provider, modelId: row.modelId, name: row.modelLabel }),
    [onCreateProfile, row],
  );
  const starColor = favorite ? styles.starOn.color : styles.icon.color;
  return (
    <View style={styles.actions} pointerEvents="box-none">
      {onCreateProfile && row.modelId ? (
        <RowAction
          label={t("composer.picker.createProfile")}
          visible={props.hovered || touch}
          touch={touch}
          onPress={create}
          testID={`composer-picker-profile-${row.favoriteKey}`}
        >
          <Plus size={ICON_SIZE.xs} color={styles.icon.color} />
        </RowAction>
      ) : null}
      <RowAction
        label={t(favorite ? "composer.picker.removeFavorite" : "composer.picker.addFavorite")}
        visible={favorite || props.hovered || props.highlighted || touch}
        touch={touch}
        onPress={toggle}
        testID={`composer-picker-favorite-${row.favoriteKey}`}
      >
        <Star size={ICON_SIZE.sm} color={starColor} fill={favorite ? starColor : "transparent"} />
      </RowAction>
    </View>
  );
}

/**
 * One model: provider icon, name, its ⌘ shortcut, and a check when selected. Hover reveals the
 * star and Create profile (docs/hover.md); they sit over a reserved slot beside the row's
 * pressable rather than inside it, as the model browser's profile action does.
 */
export function ModelRow(props: ModelRowProps) {
  const [hovered, setHovered] = useState(false);
  const touch = useTouchRows();
  const { row, onPick } = props;
  const pick = useCallback(() => onPick(row), [onPick, row]);
  const enter = useCallback(() => setHovered(true), []);
  const leave = useCallback(() => setHovered(false), []);
  const { shortcut, selected, serverId } = props;
  const trailing = useMemo(
    () => (
      <View style={styles.trailing}>
        {shortcut ? <Shortcut keys={["mod", shortcut]} /> : null}
        <View style={styles.actionSlot} />
        <View style={styles.check}>
          {selected ? <Check size={16} color={styles.icon.color} /> : null}
        </View>
      </View>
    ),
    [selected, shortcut],
  );
  const leading = useMemo(
    () => <ModelProviderGlyph provider={row.provider} serverId={serverId} size={16} />,
    [row.provider, serverId],
  );
  return (
    <View style={styles.boundary} onPointerEnter={enter} onPointerLeave={leave}>
      <ComboboxItem
        label={row.modelLabel}
        description={props.showProvider ? row.providerLabel : undefined}
        active={props.highlighted}
        touch={touch}
        onPress={pick}
        leadingSlot={leading}
        trailingSlot={trailing}
        accessibilityLabel={row.modelLabel}
        testID={`composer-picker-model-${row.favoriteKey}`}
      />
      <RowActions {...props} hovered={hovered} />
    </View>
  );
}

const ACTION_SIZE = 24;
const TOUCH_HIT_SLOP = 10;
// The check column and the row's own right padding, in that order, sit right of the actions.
const ACTIONS_RIGHT_INSET = 16 + 4 + 12;

const styles = StyleSheet.create((theme) => ({
  boundary: {
    position: "relative",
  },
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  actionSlot: {
    width: ACTION_SIZE * 2,
  },
  check: {
    width: 16,
    alignItems: "center",
  },
  actions: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: ACTIONS_RIGHT_INSET,
    width: ACTION_SIZE * 2,
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
  },
  hidden: {
    opacity: 0,
  },
  icon: {
    color: theme.colors.foregroundMuted,
  },
  starOn: {
    color: theme.colors.palette.amber[500],
  },
}));
