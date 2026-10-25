import { useCallback } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { EyeOff, X } from "lucide-react-native";
import {
  dismissOutsideFilterReveal,
  useOutsideFilterReveal,
  type OutsideFilterReveal,
} from "@/clisbot/search-scope/work-navigation";
import { Button } from "@/components/ui/button";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { useSearchScopeTranslation } from "@/i18n/search-scope";
import { ICON_SIZE, ICON_STROKE_WIDTH } from "@/styles/theme";
import { listOfReveal, revealStillHidden, switchLabelOf } from "./outside-filter";
import { showAllFor, switchTo, useListFilter } from "./outside-filter-actions";
import type { ListSection } from "./store";

const muted = (theme: { colors: { foregroundMuted: string } }) => ({
  color: theme.colors.foregroundMuted,
});
const ThemedEyeOff = withUnistyles(EyeOff, muted);
const ThemedX = withUnistyles(X, muted);

/**
 * The open item is one this list's filter hides (R3): say so in one slim row above the list, and
 * offer to widen the filter. The filter itself never changes until the reader picks an action.
 * Shown while the filter still hides the item; opening another item ends it.
 */
export function OutsideFilterNotice({ list }: { list: ListSection }) {
  const reveal = useOutsideFilterReveal();
  const filter = useListFilter(list);
  if (!reveal || listOfReveal(reveal) !== list || !revealStillHidden(reveal, filter)) return null;
  return <NoticeRow reveal={reveal} list={list} />;
}

function NoticeRow({ reveal, list }: { reveal: OutsideFilterReveal; list: ListSection }) {
  const { t } = useSearchScopeTranslation();
  const showAll = useCallback(() => {
    showAllFor(reveal, list);
    dismissOutsideFilterReveal();
  }, [list, reveal]);
  const switchFilter = useCallback(() => {
    switchTo(reveal, list);
    dismissOutsideFilterReveal();
  }, [list, reveal]);
  const switchLabel = switchLabelOf(reveal);
  const message =
    reveal.reason === "others" ? t("notice.fromOthers") : t(`notice.${reveal.itemKind}`);
  return (
    <View style={styles.notice} accessibilityRole="alert" testID={`${list}-outside-filter-notice`}>
      <ThemedEyeOff size={ICON_SIZE.sm} strokeWidth={ICON_STROKE_WIDTH} />
      <Text style={styles.message} numberOfLines={2}>
        {message}
      </Text>
      <View style={styles.actions}>
        <Button size="xs" variant="ghost" onPress={showAll} testID={`${list}-notice-show-all`}>
          {t("notice.showAll")}
        </Button>
        {switchLabel ? (
          <Button size="xs" variant="ghost" onPress={switchFilter} testID={`${list}-notice-switch`}>
            {t("notice.switchTo", { name: switchLabel })}
          </Button>
        ) : null}
        <ToolbarButton
          label={t("notice.dismiss")}
          onPress={dismissOutsideFilterReveal}
          testID={`${list}-notice-dismiss`}
        >
          <ThemedX size={ICON_SIZE.sm} strokeWidth={ICON_STROKE_WIDTH} />
        </ToolbarButton>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  notice: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: theme.spacing[2],
    marginHorizontal: theme.spacing[2],
    marginBottom: theme.spacing[1],
    paddingLeft: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
  },
  message: {
    flex: 1,
    minWidth: 140,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  actions: { flexDirection: "row", alignItems: "center", marginLeft: "auto" },
}));
