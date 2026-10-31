import { useLayoutEffect, useMemo } from "react";
import { View } from "react-native";
import { traceInstant } from "@/performance/native-trace";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { HomeHeaderNavigation } from "@/clisbot/home/header-navigation";
import { CompactHeader } from "@/components/headers/compact-header";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useWorkspace } from "@/stores/session-store-hooks";
import type { Theme } from "@/styles/theme";
import { resolveWorkspaceRouteId } from "@/utils/workspace-identity";
import { resolveWorkspaceHeaderRenderState } from "./workspace-header-source";
import { WorkspaceHeaderProjectRow } from "./workspace-header-project-row";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const PENDING_CHECKOUT = { kind: "pending" } as const;
const NAVIGATION = <HomeHeaderNavigation />;

/**
 * What a phone shows in the frame after a session row is pressed, while the workspace screen
 * renders in the next task: the screen's own compact header (Back, workspace title, project row)
 * over the spinner the screen shows until its body commits. One store read; no subscriptions to
 * the timeline, terminals, checkout or layout.
 */
export function WorkspaceOpenShell({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}) {
  const workspace = useWorkspace(
    serverId,
    resolveWorkspaceRouteId({ routeWorkspaceId: workspaceId }) ?? "",
  );
  const header = resolveWorkspaceHeaderRenderState({ workspace, checkoutState: PENDING_CHECKOUT });
  const ready = header.kind === "ready";
  const subtitle = ready ? header.subtitle : null;
  const isSubtitleDistinct = ready && header.isSubtitleDistinct;
  const projectRow = useMemo(
    () =>
      subtitle === null ? undefined : (
        <WorkspaceHeaderProjectRow
          subtitle={subtitle}
          isSubtitleDistinct={isSubtitleDistinct}
          serverId={serverId}
        />
      ),
    [subtitle, isSubtitleDistinct, serverId],
  );
  useLayoutEffect(() => {
    traceInstant("clisbot.workspace.shell", { serverId, workspaceId });
  }, [serverId, workspaceId]);
  return (
    <View style={styles.root} testID="workspace-open-shell">
      <CompactHeader
        navigation="menu"
        navigationContent={NAVIGATION}
        title={ready ? header.title : undefined}
        subtitle={projectRow}
        loading={!ready}
      />
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
