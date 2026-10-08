import { useCallback, useMemo, type ReactElement } from "react";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { BOT_ID_LABEL, CHAT_ID_LABEL } from "@clisbot/protocol/bots/labels";
import type { FieldControlSize } from "@/components/ui/control-geometry";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { useAggregatedAgents } from "@/hooks/use-aggregated-agents";
import { useProjects } from "@/hooks/use-projects";
import { useSessionStore } from "@/stores/session-store";
import type { ScheduleFormTargetKind } from "@/schedules/schedule-form-model";
import { shortenPath } from "@/utils/shorten-path";

/**
 * Where a schedule runs, for the schedule form (docs/audits/2026-10-06-conversation-schedules.md):
 * a new session each run, or an existing session (a heartbeat). The form itself is upstream; these
 * fields are the Clisbot additions it renders.
 */

const RUN_IN_OPTIONS: SelectFieldOption<ScheduleFormTargetKind>[] = [
  {
    id: "new-agent",
    value: "new-agent",
    label: "New session each run",
    description: "Each run starts fresh, in a workspace you choose below.",
    testID: "schedule-run-in-new",
  },
  {
    id: "agent",
    value: "agent",
    label: "Existing session",
    description: "Each run is a message to one session and keeps its context (a heartbeat).",
    testID: "schedule-run-in-existing",
  },
];

export function RunInField({
  value,
  onChange,
  size,
}: {
  value: ScheduleFormTargetKind;
  onChange: (value: ScheduleFormTargetKind) => void;
  size: FieldControlSize;
}): ReactElement {
  const selected = RUN_IN_OPTIONS.find((option) => option.value === value) ?? null;
  return (
    <SelectField
      label="Run in"
      value={value}
      selectedDisplay={selected}
      options={RUN_IN_OPTIONS}
      onChange={onChange}
      placeholder="Choose where it runs"
      emptyText="No options"
      searchable={false}
      title="Run in"
      size={size}
      triggerTestID="schedule-run-in-trigger"
    />
  );
}

/**
 * The Chat a heartbeat on this session goes through: a Bot's session in a Chat, on a host that
 * posts runs into Chats. `null` runs it as a plain heartbeat.
 */
export function useScheduleChatId(serverId: string | null, agentId: string | null): string | null {
  const { agents } = useAggregatedAgents({ includeArchived: true });
  const supported = useSessionStore((state) =>
    serverId
      ? state.sessions[serverId]?.serverInfo?.features?.scheduleChatDelivery === true
      : false,
  );
  if (!supported || !agentId) return null;
  const agent = agents.find((entry) => entry.serverId === serverId && entry.id === agentId);
  return agent?.labels?.[CHAT_ID_LABEL] ?? null;
}

/** Sessions of one host a heartbeat can run in: live, not archived, not a schedule's own run. */
export function ScheduleSessionField({
  serverId,
  agentId,
  locked,
  onChange,
  size,
}: {
  serverId: string | null;
  agentId: string | null;
  locked: boolean;
  onChange: (agentId: string) => void;
  size: FieldControlSize;
}): ReactElement {
  const { agents, isInitialLoad } = useAggregatedAgents({ includeArchived: true });
  const chatId = useScheduleChatId(serverId, agentId);
  const options = useMemo<SelectFieldOption<string>[]>(
    () =>
      agents
        .filter(
          (agent) =>
            agent.serverId === serverId &&
            !agent.archivedAt &&
            agent.labels?.["clisbot.schedule-id"] === undefined,
        )
        .sort((a, b) => timeOf(b.lastActivityAt) - timeOf(a.lastActivityAt))
        .map((agent) => ({
          id: agent.id,
          value: agent.id,
          label: agent.title?.trim() || "Untitled session",
          // The id is on the row and matches the search, so a pasted id finds its session.
          description: `${sessionPlace(agent)} · ${agent.id.slice(0, 8)}`,
          testID: `schedule-session-option-${agent.id}`,
        })),
    [agents, serverId],
  );
  const selected = useMemo(() => {
    const option = options.find((entry) => entry.value === agentId);
    // The selected session's line replaces the field hint, so the Chat note goes there.
    if (option) return chatId ? { ...option, description: CHAT_SESSION_NOTE } : option;
    return agentId ? { label: isInitialLoad ? "Loading…" : "Session unavailable" } : null;
  }, [agentId, chatId, isInitialLoad, options]);
  const handleChange = useCallback((value: string) => onChange(value), [onChange]);
  return (
    <SelectField
      label="Session"
      value={agentId}
      selectedDisplay={selected}
      options={options}
      onChange={handleChange}
      placeholder="Choose a session"
      emptyText="No sessions on this host"
      disabled={locked || !serverId}
      hint={serverId ? undefined : "Choose a host first."}
      searchable
      searchPlaceholder="Search by name or ID"
      title="Session"
      size={size}
      loading={isInitialLoad}
      triggerTestID="schedule-session-trigger"
    />
  );
}

const CHAT_SESSION_NOTE = "A Bot in a Chat: each run is posted in the Chat.";

/** The workspaces of the chosen project on the chosen host that a run may reuse. */
export function ScheduleWorkspaceField({
  serverId,
  projectViewKey,
  workspaceId,
  onChange,
  size,
}: {
  serverId: string | null;
  projectViewKey: string | null;
  workspaceId: string | null;
  onChange: (workspaceId: string) => void;
  size: FieldControlSize;
}): ReactElement {
  const { projects } = useProjects();
  const { agents } = useAggregatedAgents({ includeArchived: false });
  const options = useMemo<SelectFieldOption<string>[]>(() => {
    const project = projects.find((entry) => entry.viewKey === projectViewKey);
    const host = project?.hosts.find((entry) => entry.serverId === serverId);
    return (host?.workspaces ?? [])
      .filter((workspace) => !workspace.archivingAt)
      .map((workspace) => ({
        id: workspace.id,
        value: workspace.id,
        label: workspace.title?.trim() || workspace.name,
        description: [
          workspaceDescription(
            workspace.currentBranch,
            agents.filter(
              (agent) => agent.serverId === serverId && agent.workspaceId === workspace.id,
            ),
          ),
          workspace.id,
        ]
          .filter(Boolean)
          .join(" · "),
        testID: `schedule-workspace-option-${workspace.id}`,
      }));
  }, [agents, projectViewKey, projects, serverId]);
  const selected = useMemo(() => {
    const option = options.find((entry) => entry.value === workspaceId);
    if (option) return option;
    return workspaceId ? { label: "Workspace unavailable" } : null;
  }, [options, workspaceId]);
  return (
    <SelectField
      label="Workspace"
      value={workspaceId || null}
      selectedDisplay={selected}
      options={options}
      onChange={onChange}
      placeholder="Choose a workspace"
      emptyText="No workspaces in this project"
      searchable
      searchPlaceholder="Search by name or ID"
      title="Workspace"
      size={size}
      triggerTestID="schedule-workspace-trigger"
    />
  );
}

/**
 * Workspaces of one project often share a name and a branch (`main`), so each option also says
 * what is in it: its newest session and how many there are.
 */
function workspaceDescription(
  branch: string | null | undefined,
  sessions: readonly { title?: string | null; lastActivityAt?: Date | string | null }[],
): string | undefined {
  const newest = [...sessions].sort(
    (a, b) => timeOf(b.lastActivityAt) - timeOf(a.lastActivityAt),
  )[0];
  const parts = [
    branch,
    newest?.title?.trim(),
    sessions.length > 1 ? `${sessions.length} sessions` : undefined,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function timeOf(value: Date | string | null | undefined): number {
  return value ? new Date(value).getTime() || 0 : 0;
}

/** The last two folders of a path, so a session's description stays on one line. */
function folderTail(cwd: string): string {
  const parts = shortenPath(cwd).split("/").filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : shortenPath(cwd);
}

/** Where a session lives: its Chat for a Bot's session, else its folder. */
function sessionPlace(agent: { cwd: string; labels?: Record<string, string> }): string {
  const chatId = agent.labels?.[CHAT_ID_LABEL];
  if (chatId) return `Bot chat ${chatId}`;
  return agent.labels?.[BOT_ID_LABEL] !== undefined ? "Bot" : folderTail(agent.cwd);
}

/**
 * Said under the project when its host cannot run sessions in an existing workspace, so the
 * missing choice reads as "update the host", not as a choice that was never there.
 */
export function ExistingWorkspaceHint({ visible }: { visible: boolean }): ReactElement | null {
  if (!visible) return null;
  return (
    <Text style={hintStyles.text}>
      Running each session in an existing workspace needs a newer Clisbot on this host.
    </Text>
  );
}

const hintStyles = StyleSheet.create((theme) => ({
  text: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
