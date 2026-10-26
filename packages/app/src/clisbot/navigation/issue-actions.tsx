import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { Archive, Eye, EyeOff, MoreHorizontal, RotateCw, X } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useToast } from "@/contexts/toast-context";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { useArchiveAgent } from "@/hooks/use-archive-agent";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useNavigationActivity } from "./activity";
import type { Issue } from "./issues";
import { HeaderMenuIcon, SECTION_MENU_WIDTH } from "./section-header";

/**
 * A failure or a request is never a dead end (brief 3.1c): the row opens it, and these are the
 * next steps. Reload is offered only when the session can be reattached; it is the workspace tab's
 * Reload agent, the closest thing to a retry the daemon has.
 */
export function IssueActions({
  agent,
  issue,
  onAction,
}: {
  agent: AggregatedAgent;
  issue: Issue;
  /** The reader acted; the feed applies the change instead of holding it. */
  onAction?: () => void;
}) {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const actions = useIssueActionHandlers(agent, onAction);
  const canReload = issue.kind === "failure" && actions.reloadable;
  const markLabel =
    issue.state === "unseen"
      ? t("navigation.actions.markSeen")
      : t("navigation.actions.markUnread");
  const toggleMark = issue.state === "unseen" ? actions.markSeen : actions.markUnread;
  const testID = `issue-actions-${agent.serverId}-${agent.id}`;
  return (
    <View style={styles.row} testID={testID}>
      {compact ? null : (
        <>
          {canReload ? (
            <Button
              size="xs"
              variant="ghost"
              leftIcon={RotateCw}
              onPress={actions.reload}
              disabled={actions.busy}
              testID={`${testID}-reload`}
            >
              {t("navigation.actions.reload")}
            </Button>
          ) : null}
          <Button
            size="xs"
            variant="ghost"
            leftIcon={X}
            onPress={actions.dismiss}
            testID={`${testID}-dismiss`}
          >
            {t("navigation.actions.dismiss")}
          </Button>
        </>
      )}
      <DropdownMenu>
        <ToolbarButton kind="menu" label={t("navigation.actions.open")} testID={`${testID}-menu`}>
          <HeaderMenuIcon Icon={MoreHorizontal} />
        </ToolbarButton>
        <DropdownMenuContent align="end" width={SECTION_MENU_WIDTH}>
          {compact && canReload ? (
            <DropdownMenuItem leading={reloadIcon} onSelect={actions.reload}>
              {t("navigation.actions.reload")}
            </DropdownMenuItem>
          ) : null}
          {compact ? (
            <DropdownMenuItem
              leading={dismissIcon}
              onSelect={actions.dismiss}
              testID={`${testID}-dismiss-item`}
            >
              {t("navigation.actions.dismiss")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            leading={issue.state === "unseen" ? seenIcon : unreadIcon}
            onSelect={toggleMark}
            testID={`${testID}-mark`}
          >
            {markLabel}
          </DropdownMenuItem>
          <DropdownMenuItem
            leading={archiveIcon}
            onSelect={actions.archive}
            testID={`${testID}-archive`}
          >
            {t("navigation.actions.archive")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

const reloadIcon = <HeaderMenuIcon Icon={RotateCw} />;
const dismissIcon = <HeaderMenuIcon Icon={X} />;
const seenIcon = <HeaderMenuIcon Icon={Eye} />;
const unreadIcon = <HeaderMenuIcon Icon={EyeOff} />;
const archiveIcon = <HeaderMenuIcon Icon={Archive} />;

function useIssueActionHandlers(agent: AggregatedAgent, onAction?: () => void) {
  const toast = useToast();
  const activity = useNavigationActivity();
  const { archiveAgent } = useArchiveAgent();
  const [busy, setBusy] = useState(false);
  const reloadable = useSessionStore((state) =>
    Boolean(state.sessions[agent.serverId]?.agents.get(agent.id)?.persistence),
  );
  const report = useCallback(
    (error: unknown) => toast.error(error instanceof Error ? error.message : String(error)),
    [toast],
  );
  const reload = useCallback(() => {
    const client = getHostRuntimeStore().getClient(agent.serverId);
    if (!client) return report(new Error("Host offline"));
    setBusy(true);
    void client
      .refreshAgent(agent.id)
      .catch(report)
      .finally(() => setBusy(false));
  }, [agent.id, agent.serverId, report]);
  const archive = useCallback(() => {
    void archiveAgent({ serverId: agent.serverId, agentId: agent.id }).then(onAction).catch(report);
  }, [agent.id, agent.serverId, archiveAgent, onAction, report]);
  const after = useCallback(
    (apply: (subject: AggregatedAgent) => void) => () => {
      apply(agent);
      onAction?.();
    },
    [agent, onAction],
  );
  const dismiss = useMemo(() => after(activity.dismiss), [activity.dismiss, after]);
  const markSeen = useMemo(() => after(activity.markSeen), [activity.markSeen, after]);
  const markUnread = useMemo(() => after(activity.markUnread), [activity.markUnread, after]);
  return { busy, reloadable, reload, archive, dismiss, markSeen, markUnread };
}

const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1], flexShrink: 0 },
}));
