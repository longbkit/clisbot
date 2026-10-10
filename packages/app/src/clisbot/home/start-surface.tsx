import { View, Text, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useCallback, type ReactNode, type ReactElement } from "react";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useProviderIcon } from "@/components/provider-icons";
import { Button } from "@/components/ui/button";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useHostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import { buildSettingsHostSectionRoute } from "@/utils/host-routes";
import { HomeActivity } from "./activity-preview";
import { HostsStrip } from "./hosts-strip";
import { ComposerDock } from "@/composer/dock";
import { ChevronRight, Import } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import {
  isToolbarLabelTriggerHighlighted,
  toolbarLabelTriggerStyle,
  toolbarLabelTriggerTextStyle,
  ToolbarLabelTriggerIcon,
} from "@/components/ui/toolbar-label-trigger";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { startStatusLabel } from "./start-status";
import { ADDABLE_PROVIDER_COUNT } from "./host-readiness";
/**
 * One trigger for the Host's readiness: the ready agents' icons and a short label, opening
 * Status & Setup. The name lives in the tooltip and accessibility label, not on screen.
 */
export function StartStatus({
  serverId,
  onImportSession,
}: {
  serverId: string;
  onImportSession?: () => void;
}) {
  const router = useRouter();
  const status = useHostRuntimeConnectionStatus(serverId);
  const snapshot = useProvidersSnapshot(serverId);
  const ready =
    snapshot.entries?.filter((entry) => entry.enabled !== false && entry.status === "ready") ?? [];
  const setup = useCallback(
    () => router.push(buildSettingsHostSectionRoute(serverId, "providers")),
    [router, serverId],
  );
  const { label, warning } = startStatusLabel(status, ready.length, ADDABLE_PROVIDER_COUNT);
  const icons = status === "online" ? ready.slice(0, 3) : [];
  return (
    <View style={styles.status}>
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild triggerRefProp="ref">
          <Pressable
            onPress={setup}
            style={toolbarLabelTriggerStyle}
            accessibilityRole="button"
            accessibilityLabel={`Status & Setup: ${label}`}
            testID="home-status-setup"
          >
            {(state) => {
              const highlighted = isToolbarLabelTriggerHighlighted(state);
              return (
                <>
                  {icons.map((entry) => (
                    <ToolbarLabelTriggerIcon key={entry.provider}>
                      <ReadyIcon provider={entry.provider} serverId={serverId} />
                    </ToolbarLabelTriggerIcon>
                  ))}
                  <Text
                    style={[toolbarLabelTriggerTextStyle(highlighted), warning && styles.warning]}
                    numberOfLines={1}
                  >
                    {label}
                  </Text>
                  <ToolbarLabelTriggerIcon>
                    <StatusChevron size={12} />
                  </ToolbarLabelTriggerIcon>
                </>
              );
            }}
          </Pressable>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start">
          <Text>Status & Setup</Text>
        </TooltipContent>
      </Tooltip>
      {onImportSession ? <ImportSessionLink onPress={onImportSession} /> : null}
    </View>
  );
}

/** A rare action, so a quiet label at the end of the status line rather than a header pill. */
function ImportSessionLink({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      style={toolbarLabelTriggerStyle}
      accessibilityRole="button"
      testID="new-workspace-import-session"
    >
      {(state) => (
        <>
          <ToolbarLabelTriggerIcon>
            <MutedImport size={12} />
          </ToolbarLabelTriggerIcon>
          <Text style={toolbarLabelTriggerTextStyle(isToolbarLabelTriggerHighlighted(state))}>
            {t("importSession.title")}
          </Text>
        </>
      )}
    </Pressable>
  );
}
const MutedImport = withUnistyles(Import, (theme) => ({ color: theme.colors.foregroundMuted }));
const StatusChevron = withUnistyles(ChevronRight, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
function ReadyIconGlyph({
  provider,
  serverId,
  color,
}: {
  provider: string;
  serverId: string;
  color: string;
}) {
  const Icon = useProviderIcon(provider, serverId);
  return <Icon size={14} color={color} />;
}
const ReadyIcon = withUnistyles(ReadyIconGlyph, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
export function HomeStartLayout({
  compact,
  title,
  choices,
  form,
  composer,
  quickStarts,
  serverId,
  showActivity = true,
  onImportSession,
}: {
  compact: boolean;
  title: string;
  choices: ReactNode;
  form: ReactNode;
  composer: ReactElement;
  quickStarts: ReactNode;
  serverId: string;
  showActivity?: boolean;
  onImportSession?: () => void;
}) {
  const heading = <Text style={styles.heading}>{title}</Text>;
  // Where to chat sits on the composer's own row of context, not as a separate step above it.
  const context = (
    <View style={compact ? styles.compactContext : styles.desktopContext}>
      <View style={compact ? styles.compactChoices : styles.desktopChoices}>{choices}</View>
      <View style={compact ? null : styles.flex}>{form}</View>
    </View>
  );
  if (compact)
    return (
      <ComposerDock>
        <View style={styles.flex}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
            {showActivity ? <HostsStrip /> : null}
            {heading}
            <StartStatus serverId={serverId} onImportSession={onImportSession} />
            {quickStarts}
            {showActivity ? <HomeActivity /> : null}
          </ScrollView>
          {context}
        </View>
        {composer}
      </ComposerDock>
    );
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.desktopScroll}>
      <View style={styles.column}>
        {showActivity ? <HostsStrip /> : null}
        {heading}
        {context}
        {composer}
        <StartStatus serverId={serverId} onImportSession={onImportSession} />
        {quickStarts}
        {showActivity ? <HomeActivity /> : null}
      </View>
    </ScrollView>
  );
}
const styles = StyleSheet.create((t) => ({
  flex: { flex: 1 },
  feedback: { paddingHorizontal: t.spacing[4], gap: 6 },
  error: { color: t.colors.destructive },
  scroll: { paddingTop: 12 },
  desktopScroll: { alignItems: "center", paddingVertical: t.spacing[6] },
  column: { width: "100%", maxWidth: t.contentMaxWidth },
  heading: {
    color: t.colors.foreground,
    fontSize: t.fontSize["2xl"],
    fontWeight: t.fontWeight.normal,
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[4],
  },
  desktopContext: { flexDirection: "row", alignItems: "center" },
  // The form row below carries its own bottom margin and left inset; the switcher matches it.
  desktopChoices: { paddingLeft: t.spacing[4], marginBottom: t.spacing[4] },
  compactContext: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    paddingTop: t.spacing[2],
  },
  compactChoices: { paddingLeft: t.spacing[4] },
  // The trigger's own padding is one step; the row pulls it back so its glyphs sit on the rail.
  status: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[1],
  },
  warning: { color: t.colors.statusWarning },
}));

export function StartFeedback({
  error,
  configurationProblem,
  onAccept,
}: {
  error: string | null;
  configurationProblem: string | null;
  onAccept: () => void;
}) {
  return (
    <View style={styles.feedback}>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {configurationProblem ? (
        <>
          <Text accessibilityRole="alert" style={styles.error}>
            {configurationProblem} Review the agent controls before continuing.
          </Text>
          <Button variant="outline" onPress={onAccept}>
            Use current settings
          </Button>
        </>
      ) : null}
    </View>
  );
}
