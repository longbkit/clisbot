/* eslint-disable react/jsx-max-depth -- keep the scroll control inside its selection and animation providers */
import { ChatFind, ChatFindExpansion } from "@/agent-stream/chat-find";
import { DeferredTimelineItem } from "./deferred-timeline-item";
import type { TimelinePosition } from "@/types/stream";
import { useProviderSubagentStore } from "@/subagents/provider-store";
import { useReadingAnchor } from "./use-reading-anchor";
import {
  PermissionActivityProvider,
  ToolPermissionActivity,
} from "@/clisbot/session-storage/permission-activity";
import { permissionResponseAttempts } from "@/clisbot/session-storage/permission-attempts";
import {
  useSessionStorageEnabled,
  useSessionStorageReadable,
} from "@/clisbot/session-storage/capability";
import { AgentFace } from "@/clisbot/session-storage/actor";
import { HeartbeatCard } from "@/clisbot/heartbeats/heartbeat-created-card";
import { heartbeatIdFromToolCall } from "@/clisbot/heartbeats/heartbeat-tool-call";
import {
  useHeartbeatTurnFooterMetadata,
  HeartbeatCompletedTurnFooterRow,
} from "@/clisbot/heartbeats/heartbeat-run-footer";
import { isHeartbeatRunNotification } from "@clisbot/protocol/schedule/heartbeat-notice";
import { ActorGutterInset, ActorResponseRow } from "@/clisbot/session-storage/actor-row";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import React, {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import {
  View,
  Text,
  Pressable,
  Platform,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useMutation } from "@tanstack/react-query";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { Check, ChevronDown, X } from "lucide-react-native";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { openExplorerSidebarView } from "@/workspace-tabs/explorer-sidebar";
import {
  AssistantMessage,
  SpeakMessage,
  UserMessage,
  Notification,
  ToolCall,
  TodoListCard,
  CompactionMarker,
  MessageOuterSpacingProvider,
  type InlinePathTarget,
} from "@/components/message";
import { PlanCard } from "@/components/plan-card";
import { getStreamItemMessageId, type StreamItem } from "@/types/stream";
import type { PendingMessageSubmission } from "@/composer/submission/model";
import type { TurnPresentation } from "@/timeline/turn-liveness";
import type { PendingPermission } from "@/types/shared";
import type {
  AgentCapabilityFlags,
  AgentPermissionAction,
  AgentPermissionResponse,
} from "@clisbot/protocol/agent-types";
import type { AgentScreenAgent } from "@/hooks/use-agent-screen-state-machine";
import { useSessionStore } from "@/stores/session-store";
import { useRevealedText } from "@/hooks/use-revealed-text";
import { useFileExplorerActions } from "@/hooks/use-file-explorer-actions";
import { useLoadOlderAgentHistory } from "@/hooks/use-load-older-agent-history";
import { resolveContentMaxWidth, useSettings } from "@/hooks/use-settings";
import type { ToastApi } from "@/components/toast-host";
import { returnToTimelineTail } from "./timeline-tail-navigation";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { ToolCallDetailsContent } from "@/components/tool-call-details";
import { QuestionFormCard } from "@/components/question-form-card";
import {
  ToolCallExpansionContext,
  useAgentToolCallExpansion,
  useExpandedToolCallGroups,
} from "@/tool-calls/expansion-context";
import {
  UserMessageExpansionContext,
  useAgentUserMessageExpansion,
} from "@/components/user-message/expansion-context";
import { ToolCallSheetProvider } from "@/components/tool-call-sheet";
import { createStreamPresentation } from "./presentation";
import { ToolCallGroupView } from "@/tool-calls/detail-level/group-view";
import { IndentRail } from "@/components/indent-rail";
import { TurnSummaryLine } from "./turn-collapse/summary-line";
import { type AgentStreamRenderModel, buildAgentStreamRenderModel } from "./model";
import { resolveStreamRenderStrategy } from "./strategy-resolver";
import { type StreamSegmentRenderers, type StreamViewportHandle } from "./strategy";
import { renderStreamRow, type RenderStreamItem } from "./stream-row";
import { type NearBottom, useIsNearBottom, useNearBottom } from "./near-bottom";
import { ChatOutlineRail } from "@/agent-stream/chat-outline/rail";
import { useChatOutline } from "@/agent-stream/chat-outline/use-chat-outline";
import { CHAT_COLUMN_RAIL_DATASET, useChatOutlineRail } from "@/chat-rail";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { planTimelineTailFetch } from "@/timeline/timeline-sync-plan";
import {
  TurnFooter,
  TURN_FOOTER_BOTTOM_SPACING,
  type AssistantTurnForkHandler,
  type InFlightTurnForkHandler,
  type TurnContentStrategy,
} from "./turn-footer";
import { resolveBottomOverlayTailInset } from "./bottom-overlay-inset";
import { isResponseGroupItem, layoutStream, type StreamLayoutItem } from "./layout";
import {
  type BottomAnchorLocalRequest,
  type BottomAnchorRouteRequest,
} from "./bottom-anchor-controller";
import { createAssistantImageOccurrenceKey } from "@/assistant-image/acquisition-cache";
import { AssistantSelectionCopySurface } from "@/assistant-selection-copy/surface";
import { AssistantFileLinkResolverProvider, createInlinePathOpener } from "@/assistant-file-links";
import { useOpenOutsideWorkspaceFolder } from "@/workspace/open-in-file-manager/outside-folder";
import {
  createWorkspaceFileTabTarget,
  type WorkspaceFileLocation,
  type OpenFileDisposition,
  type WorkspaceFileOpenRequest,
} from "@/workspace/file-open";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useForkAgent } from "@/hooks/use-fork-agent";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";
import { recordRenderProfileReasons } from "@/utils/render-profiler";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useStreamHistoryWindow } from "./use-stream-history-window";
import { resolveStreamPlaceholder } from "./placeholder";
import { PluginTimelineItemView, useInstalledTimelineTransform } from "@/plugins/timeline";
import { ConnectorPermissionCard, readConnectorCard } from "@/clisbot/connectors/connector-card";

// Shared element: AgentFace takes no props, so every response row reuses it.
const AGENT_FACE = <AgentFace />;

function renderLiveAuxiliaryNode(input: {
  pendingPermissions: ReactNode;
  turnFooter: ReactNode;
  bottomOverlayInset: number;
}): ReactNode {
  if (!input.pendingPermissions && !input.turnFooter && input.bottomOverlayInset === 0) {
    return null;
  }
  return (
    <>
      {input.turnFooter}
      {input.pendingPermissions ? (
        <View style={stylesheet.contentWrapper}>
          <View style={stylesheet.listHeaderContent}>{input.pendingPermissions}</View>
        </View>
      ) : null}
      {input.bottomOverlayInset > 0 ? (
        <BottomOverlayInset height={input.bottomOverlayInset} />
      ) : null}
    </>
  );
}

function BottomOverlayInset({ height }: { height: number }) {
  const style = useMemo(() => ({ height }), [height]);
  return <View style={style} />;
}

function renderPendingPermissionsNode(input: {
  serverId: string;
  pendingPermissions: PendingPermission[];
  client: DaemonClient | null;
}): ReactNode {
  if (input.pendingPermissions.length === 0) {
    return null;
  }
  return (
    <View style={stylesheet.permissionsContainer}>
      {input.pendingPermissions.map((permission) => (
        <PermissionRequestCard
          key={permission.key}
          permission={permission}
          client={input.client}
          serverId={input.serverId}
        />
      ))}
    </View>
  );
}

// The agent identity for a response row, or null when the row is not part of a
// response — or when the host does not record authorship.
function responseActor(input: {
  layoutItem: StreamLayoutItem;
  enabled: boolean;
  agentName: string;
}): { name: string; opensGroup: boolean } | null {
  if (!input.enabled || !isResponseGroupItem(input.layoutItem.item)) return null;
  return { name: input.agentName, opensGroup: input.layoutItem.isFirstInResponseGroup };
}
/**
 * Where a row sits in an opened turn: its summary line's row, a row inside the turn, or the
 * turn's last row. The rail runs through the gaps between them so the turn reads as one block.
 */
type TurnIndent = "none" | "openedHost" | "nested" | "lastNested";

function renderStreamItemWithTurnFooter(input: {
  content: ReactNode;
  layoutItem: StreamLayoutItem;
  turnIndent: TurnIndent;
  strategy: TurnContentStrategy;
  supportsTimelineCursor: boolean;
  onForkAssistantTurn?: AssistantTurnForkHandler;
  actor: { name: string; opensGroup: boolean } | null;
  serverId: string;
}): ReactNode {
  if (!input.content) {
    return null;
  }

  const footerHost = input.layoutItem.completedFooter;
  const footer = footerHost ? (
    // The footer renders outside the item wrapper, so it takes the gutter on
    // its own to stay on the response's left edge.
    <ActorGutterInset enabled={input.actor !== null}>
      <HeartbeatCompletedTurnFooterRow
        serverId={input.serverId}
        strategy={input.strategy}
        items={footerHost.items}
        timing={footerHost.timing}
        startIndex={footerHost.startIndex}
        turnMetrics={footerHost.turnMetrics}
        supportsTimelineCursor={input.supportsTimelineCursor}
        onForkAssistantTurn={input.onForkAssistantTurn}
      />
    </ActorGutterInset>
  ) : null;
  const content = (
    // The actor row sits inside the wrapper's padding so the sender name lines
    // up with the content instead of the wrapper's edge. Every row of a
    // response takes the gutter; only the opening row — which may be a tool or
    // thinking, not text — carries the face and the name.
    <StreamItemWrapper gapBelow={input.layoutItem.gapBelow} turnIndent={input.turnIndent}>
      {input.actor ? (
        <ActorResponseRow
          face={AGENT_FACE}
          name={input.actor.name}
          opensGroup={input.actor.opensGroup}
        >
          {input.content}
        </ActorResponseRow>
      ) : (
        input.content
      )}
    </StreamItemWrapper>
  );

  if (input.layoutItem.frameOrder === "footer-then-content") {
    return (
      <>
        {footer}
        {content}
      </>
    );
  }

  return (
    <>
      {content}
      {footer}
    </>
  );
}

function renderListEmptyComponent(input: {
  renderModel: AgentStreamRenderModel;
  isHistoryLoading: boolean;
  emptyStateStyle: StyleProp<ViewStyle>;
  emptyText: string;
  loadingText: string;
}): ReactNode {
  const placeholder = resolveStreamPlaceholder({
    hasVirtualizedHistory: input.renderModel.boundary.hasVirtualizedHistory,
    hasMountedHistory: input.renderModel.boundary.hasMountedHistory,
    hasLiveHead: input.renderModel.boundary.hasLiveHead,
    hasAuxiliaryRows: Boolean(
      input.renderModel.auxiliary.pendingPermissions || input.renderModel.auxiliary.turnFooter,
    ),
    isHistoryLoading: input.isHistoryLoading,
  });
  if (placeholder === "none") return null;
  if (placeholder === "loading") {
    return (
      <View style={stylesheet.syncingIndicator} testID="agent-history-loading-row">
        <ThemedLoadingSpinner size="small" uniProps={mutedColorMapping} />
        <Text style={stylesheet.syncingIndicatorText}>{input.loadingText}</Text>
      </View>
    );
  }
  return (
    <View style={input.emptyStateStyle}>
      <Text style={stylesheet.emptyStateText}>{input.emptyText}</Text>
    </View>
  );
}

export interface AgentStreamViewHandle {
  scrollToBottom(reason?: BottomAnchorLocalRequest["reason"]): void;
  prepareForViewportChange(): void;
}

export interface AgentStreamViewProps {
  agentId: string;
  serverId?: string;
  context: AgentScreenAgent;
  streamItems: StreamItem[];
  streamHead?: StreamItem[];
  pendingPermissions: Map<string, PendingPermission>;
  pendingMessageSubmissions?: readonly PendingMessageSubmission[];
  turnPresentation: TurnPresentation;
  routeBottomAnchorRequest?: BottomAnchorRouteRequest | null;
  isAuthoritativeHistoryReady?: boolean;
  /** No history has reached the screen yet; an empty stream shows a loading row. */
  isHistoryLoading?: boolean;
  isInitialHistoryLoading?: boolean;
  revealInitialHistory?: boolean;
  /** Tail space required by a transparent overlay rendered at the bottom edge. */
  bottomOverlayTailClearance?: number;
  /** Bottom offset required for controls floating above that overlay. */
  bottomOverlayControlClearance?: number;
  toast?: ToastApi | null;
  onOpenWorkspaceFile?: (request: WorkspaceFileOpenRequest) => void;
  readOnly?: boolean;
  /** Owning durable session; null disables activity for an unsaved draft. */
  historyAgentId?: string | null;
  timelineAgentId?: string;
  timelineSubagentId?: string;
  onReadingPositionChange?: (rowId: string | null) => void;
  historyPagination?: AgentStreamHistoryPagination;
}

/** Paging supplied by the pane instead of derived from the agent's own history. */
export interface AgentStreamHistoryPagination {
  hasOlder: boolean;
  isLoadingOlder: boolean;
  progressKey: string | null;
  onLoadOlder: () => boolean | Promise<boolean>;
}

const AGENT_CAPABILITY_FLAG_KEYS: (keyof AgentCapabilityFlags)[] = [
  "supportsStreaming",
  "supportsSessionPersistence",
  "supportsDynamicModes",
  "supportsMcpServers",
  "supportsReasoningStream",
  "supportsToolInvocations",
  "supportsRewindConversation",
  "supportsRewindFiles",
  "supportsRewindBoth",
];

const EMPTY_STREAM_HEAD: StreamItem[] = [];

/** Detached timelines keep the control up even at the bottom of the loaded window. */
function showScrollToBottomControl(isNearBottom: boolean, isTimelineDetached: boolean): boolean {
  return !isNearBottom || isTimelineDetached;
}

/** A panel that owns its own paging (a subagent pane) overrides the agent-history hook. */
function resolveHistoryPagination(
  provided: AgentStreamHistoryPagination | undefined,
  agentHistory: {
    isLoadingOlder: boolean;
    hasOlder: boolean;
    progressKey: string | null;
    loadOlder: () => boolean | Promise<boolean>;
  },
) {
  if (!provided) return agentHistory;
  return {
    isLoadingOlder: provided.isLoadingOlder,
    hasOlder: provided.hasOlder,
    progressKey: provided.progressKey,
    loadOlder: provided.onLoadOlder,
  };
}

function ReadingAnchorStatus({
  anchor,
}: {
  anchor: { restoring: boolean; error: string | null; retry: () => void };
}) {
  if (anchor.error)
    return (
      <Pressable
        onPress={anchor.retry}
        accessibilityRole="button"
        accessibilityLabel="Retry reading position"
      >
        <Text style={stylesheet.readingStatus}>Retry reading position</Text>
      </Pressable>
    );
  if (!anchor.restoring) return null;
  return (
    <Text style={stylesheet.readingStatus} accessibilityLiveRegion="polite">
      Restoring reading position…
    </Text>
  );
}

function useRetainedValue<T>(value: T, active: boolean): T {
  const retainedRef = useRef(value);
  if (active) {
    retainedRef.current = value;
  }
  return active ? value : retainedRef.current;
}
const EMPTY_PENDING_MESSAGE_SUBMISSIONS: readonly PendingMessageSubmission[] = [];
const GROUPED_TOOL_CALL_DETAIL_MAX_HEIGHT = 200;

function resolveBottomOverlayControlOffset(clearance: number | undefined): number {
  return Math.max(16, clearance ?? 0);
}

// Keep entry/exit animations off on Android due to RN dispatchDraw crashes
// tracked in react-native-reanimated#8422.
const shouldDisableEntryExitAnimations = Platform.OS === "android";
const scrollIndicatorFadeIn = shouldDisableEntryExitAnimations ? undefined : FadeIn.duration(200);
const scrollIndicatorFadeOut = shouldDisableEntryExitAnimations ? undefined : FadeOut.duration(200);

function ScrollToBottomButton({
  nearBottom,
  isTimelineDetached,
  bottomOffset,
  onPress,
}: {
  nearBottom: NearBottom;
  isTimelineDetached: boolean;
  bottomOffset: number;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const isNearBottom = useIsNearBottom(nearBottom);
  const containerStyle = useMemo(
    () => [stylesheet.scrollToBottomContainer, { bottom: bottomOffset }],
    [bottomOffset],
  );
  if (!showScrollToBottomControl(isNearBottom, isTimelineDetached)) return null;
  return (
    <View style={containerStyle} dataSet={CHAT_COLUMN_RAIL_DATASET} pointerEvents="box-none">
      <Animated.View entering={scrollIndicatorFadeIn} exiting={scrollIndicatorFadeOut}>
        <Pressable
          style={stylesheet.scrollToBottomButton}
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={t("agentStream.scrollToBottom")}
          testID="scroll-to-bottom-button"
        >
          <ChevronDown size={24} color={stylesheet.scrollToBottomIcon.color} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

const AgentStreamViewComponent = forwardRef<AgentStreamViewHandle, AgentStreamViewProps>(
  function AgentStreamView(
    {
      agentId,
      serverId,
      context,
      streamItems,
      streamHead: providedStreamHead,
      pendingPermissions,
      pendingMessageSubmissions = EMPTY_PENDING_MESSAGE_SUBMISSIONS,
      turnPresentation,
      routeBottomAnchorRequest = null,
      isAuthoritativeHistoryReady = true,
      isHistoryLoading,
      isInitialHistoryLoading,
      revealInitialHistory,
      bottomOverlayTailClearance = 0,
      bottomOverlayControlClearance,
      toast,
      onOpenWorkspaceFile,
      readOnly = false,
      historyAgentId: _historyAgentId = agentId,
      timelineAgentId = agentId,
      timelineSubagentId,
      onReadingPositionChange,
      historyPagination,
    },
    ref,
  ) {
    const { t } = useTranslation();
    const autoExpandReasoning = useSettings((settings) => settings.autoExpandReasoning);
    const chatDisplay = useSettings((settings) => settings.chatDisplay);
    const contentMaxWidth = useSettings(resolveContentMaxWidth);
    const viewportRef = useRef<StreamViewportHandle | null>(null);
    const pendingClientMessageIds = useMemo(
      () => new Set(pendingMessageSubmissions.map((submission) => submission.clientMessageId)),
      [pendingMessageSubmissions],
    );
    const isMobile = useIsCompactFormFactor();
    const streamRenderStrategy = useMemo(
      () =>
        resolveStreamRenderStrategy({
          platform: Platform.OS,
          isMobileBreakpoint: isMobile,
        }),
      [isMobile],
    );
    const nearBottom = useNearBottom(agentId);
    const [expandedInlineToolCallIds, setExpandedInlineToolCallIds] = useState<Set<string>>(
      new Set(),
    );
    const toolCallExpansion = useAgentToolCallExpansion(agentId);
    const userMessageExpansion = useAgentUserMessageExpansion(agentId);
    const expandedToolCallGroups = useExpandedToolCallGroups(toolCallExpansion);
    const [expandedTurnHostIds, setExpandedTurnHostIds] = useState<ReadonlySet<string>>(new Set());

    // Get serverId (fallback to agent's serverId if not provided)
    const resolvedServerId = serverId ?? context.serverId ?? "";
    const transformTimelineItem = useInstalledTimelineTransform(resolvedServerId);

    const client = useSessionStore((state) => state.sessions[resolvedServerId]?.client ?? null);
    const sessionStreamHead = useSessionStore((state) =>
      state.sessions[resolvedServerId]?.agentStreamHead?.get(agentId),
    );
    const streamHead = providedStreamHead ?? sessionStreamHead;
    const forkAgent = useForkAgent({ serverId: resolvedServerId, toast, readOnly });
    const supportsAgentForkContextCursor = useSessionStore(
      (state) =>
        state.sessions[resolvedServerId]?.serverInfo?.features?.agentForkContextCursor === true,
    );
    const timelineEpoch = useSessionStore(
      (state) => state.sessions[resolvedServerId]?.agentTimelineCursor.get(agentId)?.epoch ?? null,
    );
    const isTimelineDetached = useSessionStore(
      (state) => state.sessions[resolvedServerId]?.agentTimelineHasNewer.get(agentId) === true,
    );

    const workspaceRoot = context.cwd?.trim() || "";
    const { revealDirectory } = useFileExplorerActions({
      serverId: resolvedServerId,
      workspaceId: context.workspaceId,
      workspaceRoot,
    });
    const agentHistoryPagination = useLoadOlderAgentHistory({
      serverId: resolvedServerId,
      agentId,
      toast,
    });
    const {
      isLoadingOlder: remoteIsLoadingOlder,
      hasOlder: remoteHasOlder,
      progressKey: remoteProgressKey,
      loadOlder: loadRemoteOlder,
    } = resolveHistoryPagination(historyPagination, agentHistoryPagination);

    const isActive = useRetainedPanelActive();
    const openInlineFile = useStableEvent(
      (location: WorkspaceFileLocation, disposition: OpenFileDisposition) => {
        if (onOpenWorkspaceFile) {
          onOpenWorkspaceFile({ location, disposition });
        } else if (context.workspaceId) {
          navigateToWorkspace({
            serverId: resolvedServerId,
            workspaceId: context.workspaceId,
            target: createWorkspaceFileTabTarget(location),
          });
        }
      },
    );
    const openInlineDirectory = useStableEvent((directoryPath: string) => {
      void revealDirectory(directoryPath);
      openExplorerSidebarView({
        isCompact: isMobile,
        workspaceKey: buildWorkspaceTabPersistenceKey({
          serverId: resolvedServerId,
          workspaceId: context.workspaceId ?? "",
        }),
        view: "files",
      });
    });
    const openInlineOutsideDirectory = useOpenOutsideWorkspaceFolder(resolvedServerId);
    const inlinePathOpener = useMemo(
      () =>
        createInlinePathOpener({
          workspaceRoot,
          resolveRelativeFiles: true,
          client,
          openFile: openInlineFile,
          openDirectory: openInlineDirectory,
          openOutsideDirectory: openInlineOutsideDirectory,
        }),
      [workspaceRoot, client, openInlineFile, openInlineDirectory, openInlineOutsideDirectory],
    );
    useEffect(() => {
      if (!isActive) inlinePathOpener.cancel();
      return () => inlinePathOpener.cancel();
    }, [inlinePathOpener, isActive]);
    const handleInlinePathPress = useStableEvent(
      (target: InlinePathTarget, disposition: OpenFileDisposition) => {
        if (isActive) void inlinePathOpener.open(target, disposition);
      },
    );

    const handleToolCallOpenFile = useStableEvent((filePath: string) => {
      handleInlinePathPress({ raw: filePath, path: filePath }, "preferred");
    });

    const handleForkAssistantTurn: AssistantTurnForkHandler = useStableEvent(
      async ({ target, boundary }) => {
        await forkAgent({
          agentId,
          agent: context,
          workspaceId: context.workspaceId,
          target,
          boundary,
        });
      },
    );

    // The in-flight turn forks with no boundary at all: `selectForkContextRows`
    // projects the whole timeline when neither boundary field is given, so the
    // fork carries everything up to now, including the response still streaming
    // in front of the user.
    const handleForkInFlightTurn: InFlightTurnForkHandler = useStableEvent(async (target) => {
      await forkAgent({
        agentId,
        agent: context,
        workspaceId: context.workspaceId,
        target,
      });
    });

    // History arrays follow store eviction even in hidden tabs. Keeping an old
    // array in a ref would retain payloads after the shared budget released them.
    const effectiveStreamItems = streamItems;
    const effectiveStreamHead = streamHead;
    const effectiveTurnPresentation = useRetainedValue(turnPresentation, isActive);
    const isTurnActive = effectiveTurnPresentation.isActive;
    const presentStream = useMemo(() => createStreamPresentation(), []);
    const presentation = useMemo(
      () =>
        presentStream({
          tail: effectiveStreamItems,
          head: effectiveStreamHead ?? EMPTY_STREAM_HEAD,
          transform: transformTimelineItem,
          display: chatDisplay,
          autoExpandReasoning,
          expandedTurnHostIds,
          isTurnActive,
          activeTurnId: effectiveTurnPresentation.turnId,
        }),
      [
        presentStream,
        effectiveStreamItems,
        effectiveStreamHead,
        transformTimelineItem,
        chatDisplay,
        autoExpandReasoning,
        expandedTurnHostIds,
        isTurnActive,
        effectiveTurnPresentation.turnId,
      ],
    );
    const {
      start: historyWindowStart,
      hasLocalHistory,
      revealLoadedHistory,
      loadOlder,
    } = useStreamHistoryWindow({
      items: presentation.tail,
      loadRemoteOlder,
    });
    const isLoadingOlder = remoteIsLoadingOlder;
    const hasOlder = hasLocalHistory || remoteHasOlder;
    const progressKey = `${remoteProgressKey ?? "local"}:${historyWindowStart}`;

    const baseRenderModel = useMemo(() => {
      return buildAgentStreamRenderModel({
        isTurnActive,
        activeTurnStartedAt: effectiveTurnPresentation.startedAt,
        tail: presentation.tail,
        head: presentation.head,
        platform: isWeb ? "web" : "native",
        isMobileBreakpoint: isMobile,
        historyStart: historyWindowStart,
      });
    }, [
      isMobile,
      isTurnActive,
      presentation.head,
      presentation.tail,
      effectiveTurnPresentation.startedAt,
      historyWindowStart,
    ]);
    const streamLayout = useMemo(
      () =>
        layoutStream({
          strategy: streamRenderStrategy,
          isTurnActive,
          history: baseRenderModel.history,
          liveHead: baseRenderModel.segments.liveHead,
          timingByItemId: baseRenderModel.turnTiming.byItemId,
        }),
      [
        baseRenderModel.history,
        baseRenderModel.segments.liveHead,
        baseRenderModel.turnTiming.byItemId,
        isTurnActive,
        streamRenderStrategy,
      ],
    );
    const handleTimelineHistoryLoadError = useCallback(() => {
      toast?.error(t("agentStream.historyLoadFailed"));
    }, [t, toast]);
    // Chat find and the chat outline address messages, and an assistant message is a
    // group of block rows, so these hold message ids and never row ids. Only the head
    // changes per streamed delta, so the history set is keyed on mounted history alone.
    const mountedHistoryMessageIds = useMemo(
      () => new Set(baseRenderModel.history.map(getStreamItemMessageId)),
      [baseRenderModel.history],
    );
    const visibleHistoryItemIds = useMemo(
      () =>
        new Set(
          [...baseRenderModel.history, ...baseRenderModel.segments.liveHead].map((item) => item.id),
        ),
      [baseRenderModel.history, baseRenderModel.segments.liveHead],
    );
    const readingAnchor = useReadingAnchor({
      serverId: resolvedServerId,
      agentId,
      active: isActive,
      nearBottom,
      ready: isAuthoritativeHistoryReady,
      items: effectiveStreamItems,
      head: effectiveStreamHead,
      viewportRef,
      visibleItemIds: visibleHistoryItemIds,
      reveal: revealLoadedHistory,
    });
    const mountedMessageIds = useMemo(() => {
      const liveHeadMessageIds = new Set(
        baseRenderModel.segments.liveHead.map(getStreamItemMessageId),
      );
      return {
        has: (messageId: string) =>
          mountedHistoryMessageIds.has(messageId) || liveHeadMessageIds.has(messageId),
      };
    }, [baseRenderModel.segments.liveHead, mountedHistoryMessageIds]);
    const outlineRail = useChatOutlineRail();
    const outlineInset = outlineRail.inset;
    const chatOutline = useChatOutline({
      agentId,
      serverId: resolvedServerId,
      timelineEpoch,
      tail: effectiveStreamItems,
      head: effectiveStreamHead,
      enabled: outlineRail.enabled,
      viewportRef,
      onJumpError: handleTimelineHistoryLoadError,
      mountedHistoryMessageIds,
      revealLoadedMessage: revealLoadedHistory,
    });

    useImperativeHandle(
      ref,
      () => ({
        scrollToBottom(reason = "jump-to-bottom") {
          viewportRef.current?.scrollToBottom(reason);
        },
        prepareForViewportChange() {
          viewportRef.current?.prepareForViewportChange();
        },
      }),
      [],
    );

    const reportReadingPosition = useStableEvent((rowId: string | null) => {
      readingAnchor.report(rowId);
      if (onReadingPositionChange) onReadingPositionChange(rowId);
      else
        useSessionStore
          .getState()
          .sessions[resolvedServerId]?.viewedTimelineSync?.reportReadingPosition?.(agentId, rowId);
    });

    const scrollToBottom = useCallback(() => {
      if (!isTimelineDetached) {
        viewportRef.current?.scrollToBottom("jump-to-bottom");
        return;
      }
      void returnToTimelineTail({
        fetchTail: () =>
          getHostRuntimeStore().fetchAgentTimeline(resolvedServerId, agentId, {
            ...planTimelineTailFetch(),
          }),
        scrollToBottom: () => viewportRef.current?.scrollToBottom("jump-to-bottom"),
        onError: handleTimelineHistoryLoadError,
      });
    }, [agentId, handleTimelineHistoryLoadError, isTimelineDetached, resolvedServerId]);

    const sessionStorageReadable = useSessionStorageReadable(resolvedServerId);

    const setInlineDetailsExpanded = useCallback(
      (itemId: string, expanded: boolean) => {
        if (!streamRenderStrategy.shouldDisableParentScrollOnInlineDetailsExpansion()) {
          return;
        }
        setExpandedInlineToolCallIds((previous) => {
          const next = new Set(previous);
          if (expanded) {
            next.add(itemId);
          } else {
            next.delete(itemId);
          }
          return next;
        });
      },
      [streamRenderStrategy],
    );

    // The summary line holds its row around this; chat find opens a turn without a hold.
    const setTurnExpanded = useCallback((hostId: string, expanded: boolean) => {
      setExpandedTurnHostIds((previous) => {
        if (previous.has(hostId) === expanded) return previous;
        const next = new Set(previous);
        if (expanded) {
          next.add(hostId);
        } else {
          next.delete(hostId);
        }
        return next;
      });
    }, []);
    // Chat find reveals a match inside a collapsed turn by opening the turn first.
    const revealLoadedMessage = useStableEvent((messageId: string): boolean => {
      const hostId = presentation.turns.hostIdByFoldedMessageId.get(messageId);
      if (hostId && !expandedTurnHostIds.has(hostId)) {
        setTurnExpanded(hostId, true);
        return true;
      }
      return revealLoadedHistory(messageId);
    });
    // Read through a stable event so a collapse rerun does not change the renderer identity;
    // nested rows are revised through `historyRowRevision`.
    const getTurnIndent = useStableEvent((layoutItem: StreamLayoutItem): TurnIndent => {
      const { nestedItemIds } = presentation.turns;
      const { item } = layoutItem;
      if (nestedItemIds.has(item.id)) {
        const below = layoutItem.belowItem;
        return below && nestedItemIds.has(below.id) ? "nested" : "lastNested";
      }
      return item.kind === "turn_summary" && item.expanded ? "openedHost" : "none";
    });

    const setToolCallGroupExpanded = toolCallExpansion.setGroupExpanded;

    const renderUserMessageItem = useCallback(
      (layoutItem: StreamLayoutItem, item: Extract<StreamItem, { kind: "user_message" }>) => {
        return (
          <UserMessage
            itemId={item.id}
            serverId={resolvedServerId}
            agentId={agentId}
            workspaceId={context.workspaceId ?? undefined}
            sender={item.sender}
            messageId={item.messageId}
            message={item.text}
            agentSender={item.agentSender}
            images={item.images}
            attachments={item.attachments}
            timestamp={item.timestamp.getTime()}
            capabilities={context.capabilities}
            client={client}
            isFirstInGroup={layoutItem.isFirstInUserGroup}
            isLastInGroup={layoutItem.isLastInUserGroup}
            isPending={
              item.clientMessageId !== undefined &&
              pendingClientMessageIds.has(item.clientMessageId)
            }
            isConfirmed={item.timelineCursor !== undefined}
            clientMessageId={item.clientMessageId}
          />
        );
      },
      [
        context.capabilities,
        context.workspaceId,
        agentId,
        client,
        pendingClientMessageIds,
        resolvedServerId,
      ],
    );

    const renderAssistantMessageItem = useCallback(
      (layoutItem: StreamLayoutItem, item: Extract<StreamItem, { kind: "assistant_message" }>) => {
        return (
          <AssistantFileLinkResolverProvider
            client={client}
            serverId={resolvedServerId}
            workspaceRoot={workspaceRoot}
            onOpenWorkspaceFile={handleInlinePathPress}
            toast={toast}
          >
            <ChatFindExpansion messageId={getStreamItemMessageId(item)}>
              {(renderFullContent) => (
                <AssistantMessage
                  renderFullContent={renderFullContent}
                  occurrenceKey={createAssistantImageOccurrenceKey({ agentId, itemId: item.id })}
                  message={item.text}
                  timestamp={item.timestamp.getTime()}
                  workspaceRoot={workspaceRoot}
                  serverId={resolvedServerId}
                  client={client}
                  spacing={layoutItem.assistantSpacing}
                  underSenderName={sessionStorageReadable && layoutItem.isFirstInResponseGroup}
                  phase={layoutItem.phase}
                />
              )}
            </ChatFindExpansion>
          </AssistantFileLinkResolverProvider>
        );
      },
      [
        agentId,
        client,
        handleInlinePathPress,
        resolvedServerId,
        sessionStorageReadable,
        toast,
        workspaceRoot,
      ],
    );

    const renderThoughtItem = useCallback(
      (layoutItem: StreamLayoutItem, item: Extract<StreamItem, { kind: "thought" }>) => {
        return (
          <ThoughtSlot
            itemId={item.id}
            onInlineDetailsExpandedChangeByItemId={setInlineDetailsExpanded}
            text={item.text}
            status={item.status}
            isLastInSequence={layoutItem.isLastInToolSequence}
            defaultExpanded={autoExpandReasoning}
          />
        );
      },
      [autoExpandReasoning, setInlineDetailsExpanded],
    );

    const renderSingleToolCallItem = useCallback(
      (
        item: Extract<StreamItem, { kind: "tool_call" }>,
        isLastInSequence: boolean,
        options: { maxDetailHeight?: number; standalone?: boolean } = {},
      ) => {
        const { payload } = item;

        if (payload.source === "agent") {
          const data = payload.data;

          if (
            data.name === "speak" &&
            data.detail.type === "unknown" &&
            typeof data.detail.input === "string" &&
            data.detail.input.trim()
          ) {
            return (
              <SpeakMessage message={data.detail.input} timestamp={item.timestamp.getTime()} />
            );
          }

          const toolCall = (
            <>
              <ToolCallSlot
                itemId={item.id}
                onInlineDetailsExpandedChangeByItemId={setInlineDetailsExpanded}
                toolName={data.name}
                error={data.error}
                status={data.status}
                detail={data.detail}
                cwd={context.cwd}
                serverId={resolvedServerId}
                metadata={data.metadata}
                agentMessage={data.agentMessage}
                isLastInSequence={isLastInSequence}
                onOpenFilePath={handleToolCallOpenFile}
                standalone={options.standalone}
                maxDetailHeight={options.maxDetailHeight}
              />
              <ToolPermissionActivity toolCallId={data.callId} position={item.timelineCursor} />
            </>
          );
          // Clisbot Heartbeats: a created heartbeat renders as a card that manages it.
          const heartbeatId =
            data.status === "completed" ? heartbeatIdFromToolCall(data.name, data.detail) : null;
          if (heartbeatId) {
            return (
              <HeartbeatCard
                serverId={resolvedServerId}
                scheduleId={heartbeatId}
                fallback={toolCall}
              />
            );
          }
          return toolCall;
        }

        const data = payload.data;
        return (
          <ToolCallSlot
            itemId={item.id}
            onInlineDetailsExpandedChangeByItemId={setInlineDetailsExpanded}
            toolName={data.toolName}
            args={data.arguments}
            result={data.result}
            status={data.status}
            isLastInSequence={isLastInSequence}
            onOpenFilePath={handleToolCallOpenFile}
            standalone={options.standalone}
            maxDetailHeight={options.maxDetailHeight}
          />
        );
      },
      [context.cwd, resolvedServerId, setInlineDetailsExpanded, handleToolCallOpenFile],
    );

    // Read through a stable event so live group updates do not change the renderer identity
    // every tick; history hosts whose group changed are revised through `historyRowRevision`.
    const getToolCallGroup = useStableEvent((hostId: string) =>
      presentation.groupsByHostId.get(hostId),
    );
    const renderToolCallItem = useCallback(
      (
        layoutItem: StreamLayoutItem,
        item: Extract<StreamItem, { kind: "tool_call" | "thought" }>,
      ) => {
        const group = getToolCallGroup(item.id);
        if (!group) {
          return item.kind === "thought"
            ? renderThoughtItem(layoutItem, item)
            : renderSingleToolCallItem(item, layoutItem.isLastInToolSequence);
        }
        const expanded = expandedToolCallGroups.has(group.run.id);
        const children = expanded
          ? group.run.calls.map((call, index) => (
              <React.Fragment key={call.id}>
                {call.kind === "thought" ? (
                  // Reasoning is grouped only while Expand thinking is off, so an opened
                  // group shows each thought as a closed row like any other call.
                  <ThoughtSlot
                    itemId={call.id}
                    text={call.text}
                    status={call.status}
                    isLastInSequence={index === group.run.calls.length - 1}
                    defaultExpanded={false}
                    maxDetailHeight={GROUPED_TOOL_CALL_DETAIL_MAX_HEIGHT}
                    standalone={false}
                    onInlineDetailsExpandedChangeByItemId={setInlineDetailsExpanded}
                  />
                ) : (
                  renderSingleToolCallItem(call, index === group.run.calls.length - 1, {
                    maxDetailHeight: GROUPED_TOOL_CALL_DETAIL_MAX_HEIGHT,
                    standalone: false,
                  })
                )}
              </React.Fragment>
            ))
          : null;
        const props = {
          expanded,
          isLastInSequence: layoutItem.isLastInToolSequence,
          onExpandedChange: setToolCallGroupExpanded,
          children,
        };
        // The chat display setting picked the projection that built this group.
        return <ToolCallGroupView group={group} cwd={context.cwd} {...props} />;
      },
      [
        context.cwd,
        expandedToolCallGroups,
        renderThoughtItem,
        setInlineDetailsExpanded,
        getToolCallGroup,
        renderSingleToolCallItem,
        setToolCallGroupExpanded,
      ],
    );

    const refreshDeferredItem = useCallback(
      (position: TimelinePosition) => {
        const request = {
          direction: "before" as const,
          cursor: { epoch: position.epoch, seq: (position.seqStart ?? position.seq) + 1 },
          limit: 40,
          pagingMode: "source_ranges" as const,
          allowDeferredPayloads: true as const,
        };
        if (timelineSubagentId && client) {
          void client
            .fetchProviderSubagentTimeline(timelineAgentId, timelineSubagentId, request)
            .then((page) =>
              useProviderSubagentStore.getState().replaceTimeline(resolvedServerId, page),
            )
            .catch(handleTimelineHistoryLoadError);
          return;
        }
        void getHostRuntimeStore()
          .fetchAgentTimeline(resolvedServerId, timelineAgentId, { ...request, mergeWindow: true })
          .catch(handleTimelineHistoryLoadError);
      },
      [
        client,
        timelineAgentId,
        timelineSubagentId,
        resolvedServerId,
        handleTimelineHistoryLoadError,
      ],
    );

    const renderStreamItemContent = useCallback(
      (item: StreamItem, layoutItem: StreamLayoutItem) => {
        if (item.timelineCursor?.deferredPayload)
          return (
            <DeferredTimelineItem
              key={item.id}
              item={item}
              serverId={resolvedServerId}
              agentId={timelineAgentId}
              subagentId={timelineSubagentId}
              workspaceId={context.workspaceId}
              refresh={refreshDeferredItem}
            />
          );
        switch (item.kind) {
          case "user_message":
            return renderUserMessageItem(layoutItem, item);

          case "assistant_message":
            return renderAssistantMessageItem(layoutItem, item);

          case "thought":
            return renderToolCallItem(layoutItem, item);

          case "tool_call":
            return renderToolCallItem(layoutItem, item);

          case "turn_summary":
            return <TurnSummaryLine item={item} onExpandedChange={setTurnExpanded} />;

          case "notification":
            // Run metadata belongs beside the response time, not in a separator row.
            if (isHeartbeatRunNotification(item)) {
              return null;
            }
            return <Notification level={item.level} message={item.message} />;

          case "todo_list":
            return <TodoListCard items={item.items} activity={item.activity} />;

          case "compaction":
            return (
              <CompactionMarker
                status={item.status}
                trigger={item.trigger}
                preTokens={item.preTokens}
              />
            );

          case "plugin":
            return (
              <PluginTimelineItemView agentId={agentId} item={item} serverId={resolvedServerId} />
            );

          default:
            return null;
        }
      },
      [
        agentId,
        renderUserMessageItem,
        renderAssistantMessageItem,
        renderToolCallItem,
        setTurnExpanded,
        resolvedServerId,
        timelineAgentId,
        timelineSubagentId,
        context.workspaceId,
        refreshDeferredItem,
      ],
    );

    const bottomTurnFooterHost = streamLayout.auxiliaryTurnFooter;

    const renderStreamItem = useCallback<RenderStreamItem>(
      (item, layoutItem) => {
        return renderStreamItemWithTurnFooter({
          content: renderStreamItemContent(item, layoutItem),
          layoutItem,
          serverId: resolvedServerId,
          turnIndent: getTurnIndent(layoutItem),
          strategy: streamRenderStrategy,
          supportsTimelineCursor: supportsAgentForkContextCursor,
          onForkAssistantTurn: readOnly ? undefined : handleForkAssistantTurn,
          actor: responseActor({
            layoutItem,
            enabled: sessionStorageReadable,
            agentName: t("agentStream.agent"),
          }),
        });
      },
      [
        getTurnIndent,
        handleForkAssistantTurn,
        resolvedServerId,
        readOnly,
        renderStreamItemContent,
        sessionStorageReadable,
        streamRenderStrategy,
        supportsAgentForkContextCursor,
        t,
      ],
    );

    const pendingPermissionItems = useMemo(
      () => Array.from(pendingPermissions.values()).filter((perm) => perm.agentId === agentId),
      [pendingPermissions, agentId],
    );

    const pendingPermissionsNode = useMemo(
      () =>
        renderPendingPermissionsNode({
          serverId: resolvedServerId,
          pendingPermissions: pendingPermissionItems,
          client,
        }),
      [client, pendingPermissionItems, resolvedServerId],
    );
    const footerMetadata = useHeartbeatTurnFooterMetadata({
      serverId: resolvedServerId,
      isTurnActive,
      turnTiming: baseRenderModel.turnTiming,
      host: bottomTurnFooterHost,
    });
    const turnFooterNode = useMemo(() => {
      return isTurnActive || bottomTurnFooterHost ? (
        // The live turn's footer renders outside the item rows, so it takes
        // the gutter on its own to stay on the response's left edge.
        <ActorGutterInset enabled={sessionStorageReadable}>
          <TurnFooter
            isRunning={isTurnActive}
            inFlightTurnStartedAt={baseRenderModel.turnTiming.runningStartedAt}
            host={bottomTurnFooterHost}
            metadata={footerMetadata}
            strategy={streamRenderStrategy}
            supportsTimelineCursor={supportsAgentForkContextCursor}
            onForkAssistantTurn={readOnly ? undefined : handleForkAssistantTurn}
            onForkInFlightTurn={readOnly ? undefined : handleForkInFlightTurn}
          />
        </ActorGutterInset>
      ) : null;
    }, [
      handleForkAssistantTurn,
      handleForkInFlightTurn,
      readOnly,
      sessionStorageReadable,
      isTurnActive,
      baseRenderModel.turnTiming.runningStartedAt,
      footerMetadata,
      bottomTurnFooterHost,
      streamRenderStrategy,
      supportsAgentForkContextCursor,
    ]);
    const renderModel = useMemo<AgentStreamRenderModel>(() => {
      return {
        ...baseRenderModel,
        boundary: baseRenderModel.boundary,
        auxiliary: {
          pendingPermissions: pendingPermissionsNode,
          turnFooter: turnFooterNode,
        },
      };
    }, [baseRenderModel, pendingPermissionsNode, turnFooterNode]);

    const emptyStateStyle = useMemo(() => [stylesheet.emptyState, stylesheet.contentWrapper], []);
    const scrollToBottomOffset = resolveBottomOverlayControlOffset(bottomOverlayControlClearance);
    const listEmptyComponent = useMemo(
      () =>
        renderListEmptyComponent({
          renderModel,
          isHistoryLoading: isHistoryLoading === true,
          emptyStateStyle,
          emptyText: t("agentStream.empty"),
          loadingText: t("agentStream.loadingHistory"),
        }),
      [renderModel, isHistoryLoading, emptyStateStyle, t],
    );

    const { boundary, auxiliary } = renderModel;

    const layoutHistoryItemById = useMemo(() => {
      const itemById = new Map<string, StreamLayoutItem>();
      for (const item of streamLayout.history) {
        itemById.set(item.item.id, item);
      }
      return itemById;
    }, [streamLayout.history]);

    const layoutLiveHeadItemById = useMemo(() => {
      const itemById = new Map<string, StreamLayoutItem>();
      for (const item of streamLayout.liveHead) {
        itemById.set(item.item.id, item);
      }
      return itemById;
    }, [streamLayout.liveHead]);

    const handleReadingPositionChange = useStableEvent((rowId: string | null) => {
      reportReadingPosition(rowId);
      const row =
        rowId === null
          ? undefined
          : (layoutHistoryItemById.get(rowId) ?? layoutLiveHeadItemById.get(rowId));
      chatOutline.reportReadingPosition(row?.item.timelineCursor?.seq ?? null);
    });

    const renderHistoryRow = useCallback(
      (item: StreamItem) =>
        renderStreamRow({
          item,
          layoutItemById: layoutHistoryItemById,
          renderStreamItem,
          viewportRef,
        }),
      [layoutHistoryItemById, renderStreamItem],
    );

    const renderHistoryVirtualizedRow = useCallback<
      StreamSegmentRenderers["renderHistoryVirtualizedRow"]
    >((item) => renderHistoryRow(item), [renderHistoryRow]);
    const renderHistoryMountedRow = useCallback<StreamSegmentRenderers["renderHistoryMountedRow"]>(
      (item) => renderHistoryRow(item),
      [renderHistoryRow],
    );
    // useStableEvent keeps the function reference stable across flushes.
    // layoutLiveHeadItemById and renderStreamItem are read from the ref at call time,
    // so the live-head render always uses the latest layout without causing renderers
    // to be a new object on every text-chunk flush.
    const renderLiveHeadRow: StreamSegmentRenderers["renderLiveHeadRow"] = useStableEvent(
      (item: StreamItem) =>
        renderStreamRow({
          item,
          layoutItemById: layoutLiveHeadItemById,
          renderStreamItem,
          viewportRef,
        }),
    );
    const renderLiveAuxiliary = useCallback<StreamSegmentRenderers["renderLiveAuxiliary"]>(() => {
      const existingTailSpacing =
        auxiliary.turnFooter && !auxiliary.pendingPermissions ? TURN_FOOTER_BOTTOM_SPACING : 0;
      const bottomOverlayInset = resolveBottomOverlayTailInset({
        requiredTailClearance: bottomOverlayTailClearance,
        existingTailSpacing,
      });
      return renderLiveAuxiliaryNode({
        pendingPermissions: auxiliary.pendingPermissions,
        turnFooter: auxiliary.turnFooter,
        bottomOverlayInset,
      });
    }, [auxiliary.pendingPermissions, auxiliary.turnFooter, bottomOverlayTailClearance]);

    const renderers = useMemo<StreamSegmentRenderers>(
      () => ({
        renderHistoryVirtualizedRow,
        renderHistoryMountedRow,
        renderLiveHeadRow,
        renderLiveAuxiliary,
      }),
      [
        renderHistoryVirtualizedRow,
        renderHistoryMountedRow,
        renderLiveHeadRow,
        renderLiveAuxiliary,
      ],
    );

    const streamScrollEnabled =
      !streamRenderStrategy.shouldDisableParentScrollOnInlineDetailsExpansion() ||
      expandedInlineToolCallIds.size === 0;
    const { nestedItemIds } = presentation.turns;
    const historyRowRevision = useMemo(
      () => ({
        contentById: {
          has: (id: string) => presentation.historyGroupUpdatesByHostId.has(id),
        },
        displayStateById: {
          // An opened lone call also marks its future group open; that row stays unrevised
          // until a group actually forms there.
          has: (id: string) =>
            (expandedToolCallGroups.has(id) && getToolCallGroup(id) !== undefined) ||
            nestedItemIds.has(id),
        },
        globalDisplayState: isMobile,
      }),
      [
        expandedToolCallGroups,
        getToolCallGroup,
        isMobile,
        nestedItemIds,
        presentation.historyGroupUpdatesByHostId,
      ],
    );

    const findItems = useMemo(
      () => [...effectiveStreamItems, ...(effectiveStreamHead ?? [])],
      [effectiveStreamItems, effectiveStreamHead],
    );
    return (
      <PermissionActivityProvider
        records={[]}
        serverId={resolvedServerId}
        workspaceId={context.workspaceId}
      >
        <ChatFind
          agentId={agentId}
          serverId={resolvedServerId}
          epoch={timelineEpoch}
          items={findItems}
          viewportRef={viewportRef}
          revealLoadedMessage={revealLoadedMessage}
          visibleMessageIds={mountedMessageIds}
        >
          <ToolCallSheetProvider>
            <AssistantSelectionCopySurface style={stylesheet.container}>
              <ReadingAnchorStatus anchor={readingAnchor} />
              <MessageOuterSpacingProvider disableOuterSpacing>
                <ToolCallExpansionContext.Provider value={toolCallExpansion}>
                  <UserMessageExpansionContext.Provider value={userMessageExpansion}>
                    {streamRenderStrategy.render({
                      readingRowReplacements: presentation.readingRowReplacements,
                      agentId,
                      segments: renderModel.segments,
                      historyRowRevision,
                      liveHeadRowRevision: expandedToolCallGroups,
                      boundary,
                      renderers,
                      listEmptyComponent,
                      viewportRef,
                      routeBottomAnchorRequest,
                      isAuthoritativeHistoryReady,
                      isInitialHistoryLoading,
                      revealInitialHistory,
                      onNearBottomChange: nearBottom.set,
                      onReadingPositionChange: handleReadingPositionChange,
                      onNearHistoryStart: loadOlder,
                      isLoadingOlderHistory: isLoadingOlder,
                      hasOlderHistory: hasOlder,
                      olderHistoryProgressKey: progressKey,
                      scrollEnabled: streamScrollEnabled,
                      listStyle: stylesheet.list,
                      baseListContentContainerStyle: stylesheet.listContentContainer,
                      forwardListContentContainerStyle: stylesheet.forwardListContentContainer,
                      contentMaxWidth,
                      outlineInset,
                    })}
                  </UserMessageExpansionContext.Provider>
                </ToolCallExpansionContext.Provider>
              </MessageOuterSpacingProvider>
              {outlineInset > 0 && chatOutline.prompts.length >= 2 ? (
                <ChatOutlineRail
                  prompts={chatOutline.prompts}
                  activePrompt={chatOutline.activePrompt}
                  onJumpToPrompt={chatOutline.jumpToPrompt}
                />
              ) : null}
              <ScrollToBottomButton
                nearBottom={nearBottom}
                isTimelineDetached={isTimelineDetached}
                bottomOffset={scrollToBottomOffset}
                onPress={scrollToBottom}
              />
            </AssistantSelectionCopySurface>
          </ToolCallSheetProvider>
        </ChatFind>
      </PermissionActivityProvider>
    );
  },
);

function agentCapabilityFlagsEqual(
  left: AgentCapabilityFlags | undefined,
  right: AgentCapabilityFlags | undefined,
): boolean {
  return AGENT_CAPABILITY_FLAG_KEYS.every((key) => left?.[key] === right?.[key]);
}

function collectAgentProjectPlacementDiffs(
  left: AgentScreenAgent["projectPlacement"],
  right: AgentScreenAgent["projectPlacement"],
): string[] {
  const reasons: string[] = [];
  if (left?.checkout?.cwd !== right?.checkout?.cwd) {
    reasons.push("agent.projectPlacement.checkout.cwd");
  }
  if (left?.checkout?.isGit !== right?.checkout?.isGit) {
    reasons.push("agent.projectPlacement.checkout.isGit");
  }
  if (left?.projectName !== right?.projectName) {
    reasons.push("agent.projectPlacement.projectName");
  }
  if (left?.projectKey !== right?.projectKey) {
    reasons.push("agent.projectPlacement.projectKey");
  }
  return reasons;
}

function collectAgentSetupDiffs(left: AgentScreenAgent, right: AgentScreenAgent): string[] {
  const reasons: string[] = [];
  if (left.provider !== right.provider) reasons.push("agent.provider");
  if (left.currentModeId !== right.currentModeId) reasons.push("agent.currentModeId");
  if (left.model !== right.model) reasons.push("agent.model");
  if (left.thinkingOptionId !== right.thinkingOptionId) {
    reasons.push("agent.thinkingOptionId");
  }
  if (left.runtimeInfo?.modeId !== right.runtimeInfo?.modeId) {
    reasons.push("agent.runtimeInfo.modeId");
  }
  if (left.runtimeInfo?.model !== right.runtimeInfo?.model) {
    reasons.push("agent.runtimeInfo.model");
  }
  if (left.runtimeInfo?.thinkingOptionId !== right.runtimeInfo?.thinkingOptionId) {
    reasons.push("agent.runtimeInfo.thinkingOptionId");
  }
  if (left.options !== right.options) reasons.push("agent.options");
  if (left.controls !== right.controls) reasons.push("agent.controls");
  return reasons;
}

function collectAgentScreenAgentDiffs(left: AgentScreenAgent, right: AgentScreenAgent): string[] {
  const reasons: string[] = [];
  if (left.serverId !== right.serverId) reasons.push("agent.serverId");
  if (left.id !== right.id) reasons.push("agent.id");
  if (left.workspaceId !== right.workspaceId) reasons.push("agent.workspaceId");
  if (left.status !== right.status) reasons.push("agent.status");
  if (left.cwd !== right.cwd) reasons.push("agent.cwd");
  if (!agentCapabilityFlagsEqual(left.capabilities, right.capabilities)) {
    reasons.push("agent.capabilities");
  }
  if (left.lastError !== right.lastError) reasons.push("agent.lastError");
  reasons.push(...collectAgentSetupDiffs(left, right));
  reasons.push(...collectAgentProjectPlacementDiffs(left.projectPlacement, right.projectPlacement));
  return reasons;
}

function bottomAnchorRouteRequestsEqual(
  left: BottomAnchorRouteRequest | null | undefined,
  right: BottomAnchorRouteRequest | null | undefined,
): boolean {
  return (
    left?.agentId === right?.agentId &&
    left?.reason === right?.reason &&
    left?.requestKey === right?.requestKey
  );
}

function historyPaginationPropsEqual(
  left: AgentStreamViewProps["historyPagination"],
  right: AgentStreamViewProps["historyPagination"],
): boolean {
  return (
    left?.hasOlder === right?.hasOlder &&
    left?.isLoadingOlder === right?.isLoadingOlder &&
    left?.progressKey === right?.progressKey &&
    left?.onLoadOlder === right?.onLoadOlder
  );
}

/** Appends each key whose value differs by identity between `left` and `right`, in key order. */
function pushIdentityChanges<K extends keyof AgentStreamViewProps>(
  reasons: string[],
  left: AgentStreamViewProps,
  right: AgentStreamViewProps,
  keys: readonly K[],
): void {
  for (const key of keys) {
    if (left[key] !== right[key]) reasons.push(key);
  }
}

const AGENT_STREAM_IDENTITY_PROPS = ["agentId", "serverId"] as const;
const AGENT_STREAM_STREAM_PROPS = [
  "streamItems",
  "streamHead",
  "pendingPermissions",
  "pendingMessageSubmissions",
  "turnPresentation",
] as const;
const AGENT_STREAM_HISTORY_PROPS = [
  "isAuthoritativeHistoryReady",
  "isHistoryLoading",
  "isInitialHistoryLoading",
  "revealInitialHistory",
  "bottomOverlayTailClearance",
  "bottomOverlayControlClearance",
  "toast",
  "onOpenWorkspaceFile",
  "readOnly",
  "historyAgentId",
  "timelineAgentId",
  "timelineSubagentId",
] as const;

function agentStreamViewPropsEqual(
  left: AgentStreamViewProps,
  right: AgentStreamViewProps,
): boolean {
  const reasons: string[] = [];
  pushIdentityChanges(reasons, left, right, AGENT_STREAM_IDENTITY_PROPS);
  reasons.push(...collectAgentScreenAgentDiffs(left.context, right.context));
  pushIdentityChanges(reasons, left, right, AGENT_STREAM_STREAM_PROPS);
  if (
    !bottomAnchorRouteRequestsEqual(left.routeBottomAnchorRequest, right.routeBottomAnchorRequest)
  ) {
    reasons.push("routeBottomAnchorRequest");
  }
  pushIdentityChanges(reasons, left, right, AGENT_STREAM_HISTORY_PROPS);
  if (!historyPaginationPropsEqual(left.historyPagination, right.historyPagination)) {
    reasons.push("historyPagination");
  }
  recordRenderProfileReasons(`AgentStreamView:${right.agentId}`, reasons);
  return reasons.length === 0;
}

export const AgentStreamView = memo(AgentStreamViewComponent, agentStreamViewPropsEqual);
AgentStreamView.displayName = "AgentStreamView";

interface ToolCallSlotProps extends Omit<
  ComponentProps<typeof ToolCall>,
  "onInlineDetailsExpandedChange"
> {
  itemId: string;
  onInlineDetailsExpandedChangeByItemId: (itemId: string, expanded: boolean) => void;
}

interface ThoughtSlotProps {
  itemId: string;
  onInlineDetailsExpandedChangeByItemId: (itemId: string, expanded: boolean) => void;
  text: string;
  status: Extract<StreamItem, { kind: "thought" }>["status"];
  isLastInSequence: boolean;
  defaultExpanded: boolean;
  standalone?: boolean;
  maxDetailHeight?: number;
}

// Reasoning text is paced the same way assistant text is; see @/hooks/use-revealed-text.
function ThoughtSlot({
  itemId,
  onInlineDetailsExpandedChangeByItemId,
  text,
  status,
  isLastInSequence,
  defaultExpanded,
  standalone,
  maxDetailHeight,
}: ThoughtSlotProps) {
  const revealedText = useRevealedText(text, status === "ready" ? "complete" : "streaming");
  return (
    <ToolCallSlot
      itemId={itemId}
      onInlineDetailsExpandedChangeByItemId={onInlineDetailsExpandedChangeByItemId}
      toolName="thinking"
      args={revealedText}
      status={status === "ready" ? "completed" : "executing"}
      isLastInSequence={isLastInSequence}
      defaultExpanded={defaultExpanded}
      standalone={standalone}
      maxDetailHeight={maxDetailHeight}
      forceInline={defaultExpanded}
    />
  );
}

function ToolCallSlot({
  itemId,
  onInlineDetailsExpandedChangeByItemId,
  ...rest
}: ToolCallSlotProps) {
  const handleExpandedChange = useCallback(
    (expanded: boolean) => onInlineDetailsExpandedChangeByItemId(itemId, expanded),
    [onInlineDetailsExpandedChangeByItemId, itemId],
  );
  return (
    <ToolCall {...rest} itemId={itemId} onInlineDetailsExpandedChange={handleExpandedChange} />
  );
}

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const ThemedCheckIcon = withUnistyles(Check);
const ThemedXIcon = withUnistyles(X);

const primaryColorMapping = (theme: Theme) => ({
  color: theme.colors.foreground,
});
const mutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const pressableStyle = ({
  pressed,
  hovered = false,
}: PressableStateCallbackType & { hovered?: boolean }) => [
  permissionStyles.optionButton,
  hovered ? permissionStyles.optionButtonHovered : null,
  pressed ? permissionStyles.optionButtonPressed : null,
];

interface PermissionActionButtonProps {
  action: AgentPermissionAction;
  isRespondingAction: boolean;
  isResponding: boolean;
  isPrimary: boolean;
  Icon: typeof ThemedCheckIcon;
  testID: string;
  onPress: (action: AgentPermissionAction) => void;
}

function PermissionActionButton({
  action,
  isRespondingAction,
  isResponding,
  isPrimary,
  Icon,
  testID,
  onPress,
}: PermissionActionButtonProps) {
  const handlePress = useCallback(() => onPress(action), [onPress, action]);
  const optionTextStyle = isPrimary
    ? [permissionStyles.optionText, permissionStyles.optionTextPrimary]
    : permissionStyles.optionText;
  const colorMapping = isPrimary ? primaryColorMapping : mutedColorMapping;
  return (
    <Pressable
      accessibilityRole="button"
      testID={testID}
      style={pressableStyle}
      onPress={handlePress}
      disabled={isResponding}
    >
      {isRespondingAction ? (
        <ThemedLoadingSpinner size="small" uniProps={colorMapping} />
      ) : (
        <View style={permissionStyles.optionContent}>
          <Icon size={14} uniProps={colorMapping} />
          <Text style={optionTextStyle}>{action.label}</Text>
        </View>
      )}
    </Pressable>
  );
}

function PermissionRequestContext({
  metadata,
}: {
  metadata: PendingPermission["request"]["metadata"];
}) {
  const { t } = useTranslation();
  const decisionReason =
    typeof metadata?.decisionReason === "string" ? metadata.decisionReason.trim() : "";
  const blockedPath = typeof metadata?.blockedPath === "string" ? metadata.blockedPath : "";
  return (
    <>
      {decisionReason ? (
        <View style={permissionStyles.context}>
          <Text style={permissionStyles.contextLabel}>{t("agentStream.permission.reason")}</Text>
          <Text selectable testID="permission-request-reason" style={permissionStyles.title}>
            {decisionReason}
          </Text>
        </View>
      ) : null}
      {blockedPath.trim() ? (
        <View style={permissionStyles.context}>
          <Text style={permissionStyles.contextLabel}>
            {t("agentStream.permission.blockedPath")}
          </Text>
          <Text selectable testID="permission-request-blocked-path" style={permissionStyles.title}>
            {blockedPath}
          </Text>
        </View>
      ) : null}
    </>
  );
}

export function PermissionRequestCard({
  permission,
  client,
  serverId,
}: {
  permission: PendingPermission;
  client: DaemonClient | null;
  serverId: string;
}) {
  const { t } = useTranslation();
  const isMobile = useIsCompactFormFactor();

  const storageEnabled = useSessionStorageEnabled(serverId);
  const { request } = permission;
  const isPlanRequest = request.kind === "plan";
  const title = isPlanRequest
    ? t("agentStream.permission.plan")
    : (request.title ?? request.name ?? t("agentStream.permission.required"));
  const description = request.description ?? "";
  const resolvedToolCallDetail = useMemo(
    () =>
      request.detail ?? {
        type: "unknown" as const,
        input: request.input ?? null,
        output: null,
      },
    [request.detail, request.input],
  );
  const resolvedActions = useMemo((): AgentPermissionAction[] => {
    if (request.kind === "question") {
      return [];
    }
    if (Array.isArray(request.actions) && request.actions.length > 0) {
      return request.actions;
    }
    return [
      {
        id: "reject",
        label: t("agentStream.permission.deny"),
        behavior: "deny",
        variant: "danger",
        intent: "dismiss",
      },
      {
        id: "accept",
        label: isPlanRequest
          ? t("agentStream.permission.implement")
          : t("agentStream.permission.accept"),
        behavior: "allow",
        variant: "primary",
      },
    ];
  }, [isPlanRequest, request, t]);

  const planMarkdown = useMemo(() => {
    if (!request) {
      return undefined;
    }
    const planFromMetadata =
      typeof request.metadata?.planText === "string" ? request.metadata.planText : undefined;
    if (planFromMetadata) {
      return planFromMetadata;
    }
    const candidate = request.input?.["plan"];
    if (typeof candidate === "string") {
      return candidate;
    }
    return undefined;
  }, [request]);

  const permissionMutation = useMutation({
    mutationFn: async (input: {
      agentId: string;
      requestId: string;
      response: AgentPermissionResponse;
    }) => {
      if (!client) {
        throw new Error(t("common.errors.daemonClientUnavailable"));
      }
      const response = JSON.parse(JSON.stringify(input.response)) as AgentPermissionResponse;
      const generation = permission.request.metadata?.clisbotPermissionGeneration;
      const attempt =
        storageEnabled && typeof generation === "string"
          ? await permissionResponseAttempts.admit({
              serverId,
              agentId: input.agentId,
              generation,
              response,
            })
          : undefined;
      const result = await client.respondToPermissionAndWait(
        input.agentId,
        input.requestId,
        response,
        15000,
        attempt ? { responseId: attempt.responseId, requestGeneration: generation as string } : {},
      );
      if (attempt) await permissionResponseAttempts.settled(attempt.key);
      return result;
    },
  });
  const {
    reset: resetPermissionMutation,
    mutateAsync: respondToPermission,
    isPending: isResponding,
  } = permissionMutation;

  const [respondingActionId, setRespondingActionId] = useState<string | null>(null);

  useEffect(() => {
    resetPermissionMutation();
    setRespondingActionId(null);
  }, [permission.request.id, resetPermissionMutation]);
  const handleResponse = useCallback(
    (response: AgentPermissionResponse) => {
      respondToPermission({
        agentId: permission.agentId,
        requestId: permission.request.id,
        response,
      }).catch((error) => {
        console.error("[PermissionRequestCard] Failed to respond to permission:", error);
      });
    },
    [permission.agentId, permission.request.id, respondToPermission],
  );
  const handleActionPress = useCallback(
    (action: AgentPermissionAction) => {
      setRespondingActionId(action.id);
      if (action.behavior === "allow") {
        handleResponse({
          behavior: "allow",
          selectedActionId: action.id,
        });
        return;
      }
      handleResponse({
        behavior: "deny",
        selectedActionId: action.id,
        message: "Denied by user",
      });
    },
    [handleResponse],
  );

  const optionsContainerStyle = useMemo(
    () => [
      permissionStyles.optionsContainer,
      !isMobile && permissionStyles.optionsContainerDesktop,
    ],
    [isMobile],
  );

  const responseError = permissionMutation.error ? (
    <Text
      accessibilityRole="alert"
      testID="permission-response-error"
      style={permissionStyles.description}
    >
      {permissionMutation.error.message}
    </Text>
  ) : null;
  if (request.kind === "question") {
    const responseFailed =
      permissionMutation.isError &&
      permissionMutation.variables?.agentId === permission.agentId &&
      permissionMutation.variables?.requestId === permission.request.id;
    const questionResponseError = responseFailed ? t("message.question.responseFailed") : null;
    return (
      <QuestionFormCard
        permission={permission}
        onRespond={handleResponse}
        isResponding={isResponding}
        responseError={questionResponseError}
      />
    );
  }
  // Clisbot Connectors: a held tool call waiting for an app to be connected or allowed.
  const connectorCard = readConnectorCard(request.metadata);
  if (connectorCard) {
    return (
      <View>
        <ConnectorPermissionCard
          card={connectorCard}
          serverId={serverId}
          onRespond={handleResponse}
          isResponding={isResponding}
        />
        {responseError}
      </View>
    );
  }

  const footer = (
    <>
      <PermissionRequestContext metadata={request.metadata} />
      {responseError}
      <Text testID="permission-request-question" style={permissionStyles.question}>
        {t("agentStream.permission.question")}
      </Text>

      <View style={optionsContainerStyle}>
        {resolvedActions.map((action) => {
          const isPrimary = action.variant === "primary";
          const isRespondingAction = respondingActionId === action.id;
          const Icon = action.behavior === "allow" ? ThemedCheckIcon : ThemedXIcon;
          let testID: string;
          if (action.behavior === "deny") testID = "permission-request-deny";
          else if (action.id === "accept" || action.id === "implement")
            testID = "permission-request-accept";
          else testID = `permission-request-action-${action.id}`;

          return (
            <PermissionActionButton
              key={action.id}
              action={action}
              isRespondingAction={isRespondingAction}
              isResponding={isResponding}
              isPrimary={isPrimary}
              Icon={Icon}
              testID={testID}
              onPress={handleActionPress}
            />
          );
        })}
      </View>
    </>
  );

  if (isPlanRequest && planMarkdown) {
    return (
      <PlanCard
        title={title}
        description={description}
        text={planMarkdown}
        outcome="pending"
        footer={footer}
        testID="permission-plan-card"
        disableOuterSpacing
      />
    );
  }

  return (
    <View style={permissionStyles.container}>
      <Text style={permissionStyles.title}>{title}</Text>

      {description ? <Text style={permissionStyles.description}>{description}</Text> : null}

      {planMarkdown ? (
        <PlanCard
          title={t("agentStream.permission.proposedPlan")}
          text={planMarkdown}
          testID="permission-plan-card"
          disableOuterSpacing
        />
      ) : null}

      {!isPlanRequest ? (
        <ToolCallDetailsContent detail={resolvedToolCallDetail} maxHeight={200} />
      ) : null}

      {footer}
    </View>
  );
}

const stylesheet = StyleSheet.create((theme) => ({
  readingStatus: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[3],
  },
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  contentWrapper: {
    width: "100%",
    maxWidth: theme.contentMaxWidth,
    alignSelf: "center",
    paddingHorizontal: theme.spacing[2],
  },
  listContentContainer: {
    paddingVertical: 0,
    flexGrow: 1,
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[4],
    },
  },
  forwardListContentContainer: {
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[4],
  },
  list: {
    flex: 1,
  },
  streamItemWrapper: {
    width: "100%",
    maxWidth: theme.contentMaxWidth,
    alignSelf: "center",
    paddingHorizontal: theme.spacing[2],
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing[12],
  },
  permissionsContainer: {
    gap: theme.spacing[2],
  },
  listHeaderContent: {
    gap: theme.spacing[3],
  },
  syncingIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    paddingLeft: theme.spacing[2],
  },
  syncingIndicatorText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  emptyStateText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  scrollToBottomContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  scrollToBottomButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.colors.surface2,
    alignItems: "center",
    justifyContent: "center",
    ...theme.shadow.sm,
  },
  scrollToBottomIcon: {
    color: theme.colors.foreground,
  },
}));

const permissionStyles = StyleSheet.create((theme) => ({
  context: {
    gap: theme.spacing[1],
    minWidth: 0,
  },
  contextLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  container: {
    marginVertical: theme.spacing[3],
    padding: theme.spacing[3],
    borderRadius: theme.spacing[2],
    borderWidth: 1,
    gap: theme.spacing[2],
    backgroundColor: theme.colors.surface1,
    borderColor: theme.colors.border,
  },
  title: {
    fontSize: theme.fontSize.base,
    lineHeight: 22,
    color: theme.colors.foreground,
  },
  description: {
    fontSize: theme.fontSize.base,
    lineHeight: 20,
    color: theme.colors.foregroundMuted,
  },
  section: {
    gap: theme.spacing[2],
  },
  sectionTitle: {
    fontSize: theme.fontSize.sm,
  },
  question: {
    fontSize: theme.fontSize.base,
    marginTop: theme.spacing[1],
    marginBottom: theme.spacing[1],
    color: theme.colors.foregroundMuted,
  },
  optionsContainer: {
    gap: theme.spacing[2],
  },
  optionsContainerDesktop: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start",
    alignItems: "center",
    width: "100%",
  },
  optionButton: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    borderWidth: theme.borderWidth[1],
    backgroundColor: theme.colors.surface1,
    borderColor: theme.colors.borderAccent,
  },
  optionButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  optionButtonPressed: {
    opacity: 0.9,
  },
  optionContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  optionText: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
  },
  optionTextPrimary: {
    color: theme.colors.foreground,
  },
}));

interface StreamItemWrapperProps {
  gapBelow: number;
  turnIndent: TurnIndent;
  children: ReactNode;
}

function StreamItemWrapper({ gapBelow, turnIndent, children }: StreamItemWrapperProps) {
  const wrapperStyle = useMemo(
    () => [
      stylesheet.streamItemWrapper,
      { marginBottom: turnIndent === "nested" || turnIndent === "openedHost" ? 0 : gapBelow },
    ],
    [gapBelow, turnIndent],
  );
  const gapStyle = useMemo(() => ({ paddingBottom: gapBelow }), [gapBelow]);
  switch (turnIndent) {
    case "none":
    case "openedHost":
      return (
        <View style={wrapperStyle}>
          {children}
          {turnIndent === "openedHost" ? <IndentRail style={gapStyle} /> : null}
        </View>
      );
    case "nested":
      return (
        <View style={wrapperStyle}>
          <IndentRail style={gapStyle}>{children}</IndentRail>
        </View>
      );
    case "lastNested":
      return (
        <View style={wrapperStyle}>
          <IndentRail>{children}</IndentRail>
        </View>
      );
  }
}
