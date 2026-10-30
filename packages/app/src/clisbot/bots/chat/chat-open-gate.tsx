import { useLayoutEffect, useMemo, type ReactNode } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { CompactHeader } from "@/components/headers/compact-header";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { OpenGate, type ScheduleAfterPaint } from "@/navigation/open-gate";
import { traceInstant } from "@/performance/native-trace";
import type { Theme } from "@/styles/theme";
import { readChatOpenPreview } from "./open-preview";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * Shows the chat's shell in the press's frame and the chat route's content in the next task
 * (docs/features/offline/offline-cache.md#the-open-shell). The push renders the chat screen in
 * the press's own commit; on a phone that held the press's frame for the whole screen.
 */
export function ChatOpenGate({
  serverId,
  chatId,
  enabled,
  navigation,
  schedule,
  children,
}: {
  serverId: string;
  chatId: string;
  enabled: boolean;
  /** The header's leading control, the chat screen's own (Back on a phone). */
  navigation: ReactNode;
  schedule?: ScheduleAfterPaint;
  children: ReactNode;
}) {
  const shell = useMemo(
    () => <ChatOpenShell serverId={serverId} chatId={chatId} navigation={navigation} />,
    [serverId, chatId, navigation],
  );
  return (
    <OpenGate enabled={enabled} shell={shell} schedule={schedule}>
      {children}
    </OpenGate>
  );
}

/**
 * The chat screen's compact header (Back, the title the pressed row showed) over a spinner. One
 * read of the row's preview; no subscriptions to the record, transcript or live heads.
 */
function ChatOpenShell({
  serverId,
  chatId,
  navigation,
}: {
  serverId: string;
  chatId: string;
  navigation: ReactNode;
}) {
  const { t } = useTranslation();
  const title = readChatOpenPreview(serverId, chatId)?.title ?? t("bots.chat.route.loading");
  useLayoutEffect(() => {
    traceInstant("clisbot.chat.shell", { serverId, chatId });
  }, [serverId, chatId]);
  return (
    <View style={styles.root} testID="chat-open-shell">
      <CompactHeader navigation="menu" navigationContent={navigation} title={title} />
      <View style={styles.body}>
        <ThemedLoadingSpinner uniProps={mutedColorMapping} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.surface0 },
  body: { flex: 1, alignItems: "center", justifyContent: "center" },
}));
