import { useCallback, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { View } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { CompactHeader } from "@/components/headers/compact-header";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { isNative } from "@/constants/platform";
import { usePanelStore } from "@/stores/panel-store";
import type { Theme } from "@/styles/theme";
import { nativePresentation, type PendingChatIntent } from "./chat-list-presentation";
import { useIsChatListDeparting } from "./use-chat-list-departure";
import { returnFromPendingChat, useNavigateHomeTab, isHomeTabPath } from "./mobile-navigation";
import { HOME_V2_ENABLED } from "./feature";

const Spinner = withUnistyles(LoadingSpinner);
const spinnerColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/** Projection of the navigation owner's admitted intent, not another route/data owner. */
export function PendingChatPresentation({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(
    nativePresentation.subscribe,
    nativePresentation.getPendingSnapshot,
    nativePresentation.getPendingSnapshot,
  );
  const panel = usePanelStore((state) => state.mobilePanel);
  const departing = useIsChatListDeparting();
  const path = usePathname();
  const committedPath = useRef(path);
  useLayoutEffect(() => {
    committedPath.current = path;
  }, [path]);
  const router = useRouter();
  const navigate = useNavigateHomeTab();
  const { t } = useTranslation();
  const held = useRef<PendingChatIntent | null>(null);
  const current = snapshot && snapshot.revision === panel.revision && panel.target === "agent-list";
  if (current)
    held.current = snapshot.returning || isHomeTabPath(snapshot.destination) ? null : snapshot;
  // Keep the shell to the same actual overlay visibility boundary as the source geometry.
  // A returned /chat, new panel generation, or another global screen cannot inherit it.
  if (!departing || (!snapshot && path === "/chat")) held.current = null;
  const intent = isNative && HOME_V2_ENABLED ? held.current : null;
  const back = useCallback(() => {
    if (!intent) return;
    const currentPath = committedPath.current;
    const parentPath = intent.destination.slice(0, intent.destination.lastIndexOf("/"));
    // A queued callback must not override a newer global navigation that did not
    // create another Chat admission. Use committed route, never render intent.
    if (currentPath !== "/chat" && currentPath !== intent.destination && currentPath !== parentPath)
      return;
    if (returnFromPendingChat(router, navigate, intent.id)) return;
    // onAppear may have completed the intent while the native overlay still hides.
    // That final visible shell must also have a usable Back, without allowing a
    // delayed press from A to cancel a newer B or a different overlay generation.
    const panels = usePanelStore.getState();
    if (
      currentPath !== intent.destination ||
      nativePresentation.getPendingSnapshot() ||
      !nativePresentation.isLatestIntent(intent.id)
    )
      return;
    if (
      (panels.mobilePanel.target === "agent-list" &&
        panels.mobilePanel.revision === intent.revision) ||
      (panels.mobilePanel.target === "agent" && panels.mobilePanel.revision === intent.revision + 1)
    ) {
      panels.showMobileAgentList();
      router.navigate("/chat");
    }
  }, [intent, navigate, router]);

  return (
    <View style={styles.root}>
      <View
        style={intent ? styles.covered : styles.root}
        pointerEvents={intent ? "none" : "auto"}
        accessibilityElementsHidden={!!intent}
        importantForAccessibility={intent ? "no-hide-descendants" : "auto"}
      >
        {children}
      </View>
      {intent ? (
        <View style={styles.pending} testID="pending-chat-presentation">
          <CompactHeader navigation="back" onBack={back} title={t("bots.chat.route.loading")} />
          <View
            style={styles.loading}
            accessibilityRole="progressbar"
            accessibilityLabel={t("bots.chat.route.loading")}
          >
            <Spinner size="large" uniProps={spinnerColor} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1 },
  covered: { flex: 1, opacity: 0 },
  pending: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.colors.surface0 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
}));
