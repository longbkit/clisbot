import { hubOnlyPairingTarget } from "@/device-access/pairing-target";
import { watchdog } from "@/watchdog";
import { createHostChannelTransport } from "@clisbot/client/internal/hosts";
import type { OwnedSubscription } from "@clisbot/client";
import type { HostDirectory } from "@clisbot/protocol/hosts";
import { useSyncExternalStore, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { persistHostRegistry, type ProviderCacheStorage } from "@/storage/provider-cache-pressure";
import equal from "fast-deep-equal/es6";
import {
  DaemonClient,
  DaemonAuthenticationError,
  type DaemonClientConfig,
  type ConnectionState,
  type FetchAgentsOptions,
} from "@clisbot/client/internal/daemon-client";
import {
  connectionFromListen,
  createRemoteSshHostConnection,
  normalizeStoredHostProfile,
  pinRelayProtectedSecurityInProfiles,
  upsertHostConnectionInProfiles,
  hostHasConnection,
  registryHasConnection,
  relayConnectionFromOffer,
  StoredHostRegistrySchema,
  type HubHostManagement,
  type HostConnection,
  type HostProfile,
} from "@/types/host-connection";
import { defaultHostAppearance, type HostBadgeDisplay, type HostColor } from "@/hosts/appearance";
import {
  parseDevicePairingOfferFromUrl,
  type DevicePairingOffer,
} from "@clisbot/protocol/device-pairing-offer";
import {
  devicePairedHost,
  devicePairingFromOffer,
  offerConnections,
} from "@/device-access/host-profile";
import { pairDaemon } from "@/device-access/pair-daemon";
import { pairHub } from "@/device-access/hub-transport";
import { i18n } from "@/i18n/i18next";
import {
  deviceCredentialAccess,
  resolveHostDeviceAccess,
  usesDeviceCredential,
} from "./device-credential-gate";
import {
  buildDaemonWebSocketUrl,
  buildRelayWebSocketUrl,
  decodeOfferFragmentPayload,
  normalizeHostPort,
  parseRelayConnectionUri,
  shouldUseTlsForDefaultHostedRelay,
} from "@/utils/daemon-endpoints";
import { resolveAppVersion } from "@/utils/app-version";
import {
  ConnectionOfferSchema,
  type ConnectionOffer,
  type ConnectionOfferV2,
} from "@clisbot/protocol/connection-offer";
import { HostConfirmations, type HostConfirmationRequest } from "./host-confirmation";
import { shouldUseDesktopDaemon } from "@/desktop/daemon/desktop-daemon";
import { isWeb } from "@/constants/platform";
import { connectToDaemon, getConnectionAuthFailureReason } from "@/utils/test-daemon-connection";
import { getOrCreateClientId } from "@/utils/client-id";
import { z } from "zod";
import { readValidatedJson, readValidatedString } from "@/storage/validated-storage";
import {
  selectBestConnection,
  type ConnectionCandidate,
  type ConnectionProbeState,
} from "@/utils/connection-selection";
import {
  buildDesktopDaemonTransportUrl,
  createDesktopDaemonTransportFactory,
} from "@/desktop/daemon/desktop-daemon-transport";
import { getDesktopHost } from "@/desktop/host";
import { readDesktopManagedLocalCredential } from "@/desktop/daemon/local-credential";
import { CLIENT_CAPS } from "@clisbot/protocol/client-capabilities";
import { BROWSER_AUTOMATION_COMMAND_NAMES } from "@clisbot/protocol/browser-automation/rpc-schemas";
import {
  useSessionStore,
  toDaemonServerInfo,
  type Agent,
  type WorkspaceDescriptor,
  type ProjectDescriptor,
} from "@/stores/session-store";
import type { TurnLivenessTransition } from "@/timeline/turn-liveness";
import { useWorkspaceSetupStore } from "@/stores/workspace-setup-store";
import { invalidateCheckoutGitQueriesForServer } from "@/git/query-keys";
import { queryClient } from "@/data/query-client";
import { agentHistoryQueryKey, allAgentHistoryQueryRootKey } from "@/hooks/agent-history-query-key";
import {
  hostRequiresSessionAdmission,
  hostAdvertisedConnections,
  matchesAdvertisedHostConnection,
  subscribeHostSessionAccess,
  prefetchedAccessTicket,
  resolveHostAccessTicket,
} from "@/runtime/host-session-access";
import {
  invalidateServerDataQueriesAfterReconnect,
  mountServerDataPushRouter,
} from "@/data/push-router";
import { mountBrowserAutomationDaemonClientHandler } from "@/desktop/browser/automation/handler";
import { schedulesQueryBaseKey } from "@/schedules/aggregated-schedules";
import { dispatchComposerAgentMessage, sendQueuedComposerMessageNow } from "@/composer/actions";
import { createMessageSubmissionWriter } from "@/composer/submission/writer";
import { resolveComposerAttachmentSubmitFormat } from "@/composer/attachments/submit";
import { encodeImages } from "@/utils/encode-images";
import { DirectorySync, type RefreshAgentDirectoryResult } from "@/runtime/directory-sync";
import { createDirectoryFrameClock, type FrameClock } from "@/runtime/directory-sync/live-batch";
import { diagnosticStack, recordHostDiagnostic } from "@/runtime/host-diagnostics";
import { ReplicaCache } from "@/runtime/replica-cache";
import type { ReplicaRowStore } from "@/runtime/replica-cache/row-store";
import { createReplicaRowStore } from "@/runtime/replica-cache/row-store-factory";
import {
  createTimelineReplica,
  createViewedTimelineOwner,
  type TimelineReplica,
  type ViewedTimelineOwner,
  type ViewedTimelineOwnerPorts,
} from "@/timeline/viewed-timeline-sync";
import { projectIconCache } from "@/projects/icon-cache";
import { createPerformanceTrace } from "@/performance/native-trace";
import { perfProbe } from "@/performance/perf-probe/probe";
import { revokePushNotifications } from "@/push-notifications";
import { createAppWebSocketFactory } from "./websocket-factory";
import { selectReceiveCodec } from "./encrypted-receive";
import {
  type BackoffPolicy,
  ConnectLimiter,
  DEFAULT_BACKOFF_POLICY,
  MAX_CONCURRENT_DIRECTORY_PAGES,
  MAX_CONCURRENT_HOST_CONNECTS,
  RECONNECT_MAX_DELAY_MS,
  ReconnectBackoff,
} from "./connection-backoff";
import {
  type ColdStartConnectTimeline,
  type ColdStartPhase,
  getColdStartConnectTimeline,
} from "./cold-start-connect";
import { type NetworkReachability, subscribeNetworkReachability } from "./network-reachability";
import { ReconnectSweep, type ReconnectSweepReason } from "./reconnect-sweep";

export type HostRuntimeConnectionStatus = "idle" | "connecting" | "online" | "offline" | "error";
export type PairingNavigationTarget = "openProject" | "hostRoot" | "hostSettings";
export type HostRegistryStatus = "loading" | "ready";

/** One pairing flow started with `HostRuntimeStore.beginLinkPairing`. */
export interface LinkPairing {
  /** Probes the linked host and saves it. Connection and password errors throw. */
  submit(link: string, password?: string, deviceLabel?: string): Promise<LinkPairingResult>;
}

export type LinkPairingResult =
  | {
      status: "connected";
      profile: HostProfile;
      serverId: string;
      hostname: string | null;
      /** Clisbot: the link was a device-pairing invitation that also paired its Hub. */
      hubPaired?: boolean;
    }
  | { status: "cancelled" };

/** A pairing link the user confirmed whose host then asked for a password. */
export interface PasswordRequiredPairing {
  link: string;
  pairing: LinkPairing;
}

export type ConnectionLinkImport =
  | { status: "connected"; serverId: string }
  // Clisbot: a device-pairing invitation that also enrolled this app in its Hub, or a Hub-only link.
  | { status: "hub_connected" }
  | ({ status: "password_required" } & PasswordRequiredPairing)
  | { status: "cancelled" };

export type ActiveConnection =
  | { type: "routed"; endpoint: string; display: string }
  | { type: "directTcp"; endpoint: string; display: string }
  | { type: "directSocket"; endpoint: string; display: "socket" }
  | { type: "directPipe"; endpoint: string; display: "pipe" }
  | { type: "remoteSsh"; endpoint: string; display: string }
  | { type: "relay"; endpoint: string; display: "relay" };

export type HostRuntimeDirectoryStatus =
  | "idle"
  | "initial_loading"
  | "revalidating"
  | "ready"
  | "error_before_first_success"
  | "error_after_ready";

export type HostRuntimeAgentDirectoryStatus = HostRuntimeDirectoryStatus;

export interface HostRuntimeSnapshot {
  serverId: string;
  activeConnectionId: string | null;
  /** Ephemeral proof from Desktop main, never inferred from the endpoint or persisted. */
  localCredentialConnectionId?: string | null;
  activeConnection: ActiveConnection | null;
  connectionStatus: HostRuntimeConnectionStatus;
  client: DaemonClient | null;
  lastError: string | null;
  authFailureReason?: "password_required" | "incorrect_password" | null;
  lastOnlineAt: string | null;
  agentDirectoryStatus: HostRuntimeAgentDirectoryStatus;
  agentDirectoryError: string | null;
  hasEverLoadedAgentDirectory: boolean;
  workspaceDirectoryStatus: HostRuntimeDirectoryStatus;
  workspaceDirectoryError: string | null;
  hasEverLoadedWorkspaceDirectory: boolean;
  probeByConnectionId: Map<string, ConnectionProbeState>;
  clientGeneration: number;
  connectionEpoch: number;
}

type HostRuntimeSnapshotPatch = Partial<Omit<HostRuntimeSnapshot, "serverId" | "clientGeneration">>;

function setSnapshotPatchField<Key extends keyof HostRuntimeSnapshotPatch>(
  patch: HostRuntimeSnapshotPatch,
  key: Key,
  value: HostRuntimeSnapshot[Key],
): void {
  patch[key] = value;
}

const LATENCY_JITTER_MIN_MS = 20;
const LATENCY_JITTER_RATIO = 0.25;

/**
 * Every heartbeat measures a slightly different RTT. Publishing each one rewrote the snapshot of
 * every online Host every 10 s and re-rendered every Host consumer, so a reading inside the band
 * keeps the published one. The band stays under the adaptive switch threshold for fast routes.
 */
function holdLatencyJitter(
  previous: ReadonlyMap<string, ConnectionProbeState>,
  next: Map<string, ConnectionProbeState>,
): Map<string, ConnectionProbeState> {
  const held = new Map(next);
  for (const [connectionId, probe] of next) {
    const published = previous.get(connectionId);
    if (probe.status !== "available" || published?.status !== "available") continue;
    const band = Math.max(LATENCY_JITTER_MIN_MS, published.latencyMs * LATENCY_JITTER_RATIO);
    if (Math.abs(probe.latencyMs - published.latencyMs) < band) held.set(connectionId, published);
  }
  return held;
}

export function isHostRuntimeConnected(snapshot: HostRuntimeSnapshot | null): boolean {
  return snapshot?.connectionStatus === "online";
}

export function isHostRuntimeDirectoryLoading(snapshot: HostRuntimeSnapshot | null): boolean {
  if (!snapshot) {
    return true;
  }
  if (
    snapshot.agentDirectoryStatus === "initial_loading" ||
    snapshot.agentDirectoryStatus === "revalidating"
  ) {
    return true;
  }
  return (
    !snapshot.hasEverLoadedAgentDirectory &&
    (snapshot.connectionStatus === "connecting" || snapshot.connectionStatus === "online")
  );
}

function sameHubManagement(left: HubHostManagement | undefined, right: HubHostManagement): boolean {
  return (
    left?.kind === "hub" &&
    left.hubOrigin === right.hubOrigin &&
    left.organizationId === right.organizationId &&
    left.daemonId === right.daemonId
  );
}

/**
 * A saved Host is the offered daemon when its relay key matches the offer, or when it has no relay
 * key to contradict it: every connection to that Host already checks the daemon's `serverId`, and
 * the offer comes from that daemon's own authenticated Hub connection.
 */
function provesOfferedDaemon(host: HostProfile, offer: ConnectionOffer): boolean {
  if (host.devicePairing) return host.devicePairing.daemonPublicKeyB64 === offer.daemonPublicKeyB64;
  const relayKeys = host.connections.flatMap((connection) =>
    connection.type === "relay" ? [connection.daemonPublicKeyB64] : [],
  );
  if (relayKeys.length === 0) return host.management === undefined;
  return relayKeys.includes(offer.daemonPublicKeyB64);
}

function withManualConnections(
  management: HubHostManagement,
  adoptedHost: HostProfile | undefined,
): HubHostManagement {
  if (adoptedHost === undefined) return management;
  const manualConnectionIds =
    adoptedHost.management?.manualConnectionIds ??
    (adoptedHost.management === undefined
      ? adoptedHost.connections.map((connection) => connection.id)
      : undefined);
  return manualConnectionIds === undefined ? management : { ...management, manualConnectionIds };
}

function restoreManualHost(host: HostProfile, manualConnectionIds: string[]): HostProfile {
  const { management: _management, ...manual } = host;
  const connections = host.connections.filter((connection) =>
    manualConnectionIds.includes(connection.id),
  );
  return {
    ...manual,
    connections,
    preferredConnectionId: connections.some(({ id }) => id === host.preferredConnectionId)
      ? host.preferredConnectionId
      : (connections[0]?.id ?? null),
    updatedAt: new Date().toISOString(),
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A daemon identity that negotiated protected relay security. */
export interface RelaySecurityPin {
  serverId: string;
  daemonPublicKeyB64: string;
}

export interface HostRuntimeControllerDeps {
  createClient: (input: {
    host: HostProfile;
    connection: HostConnection;
    clientId: string;
    runtimeGeneration: number;
    onAdmissionFailure?: (revoked: boolean) => boolean;
    /** Request the Hub ticket while the transport opens (`prefetchedAccessTicket`). */
    prefetchAccessTicket?: boolean;
  }) => DaemonClient;
  connectToDaemon: (input: {
    host: HostProfile;
    connection: HostConnection;
    timeoutMs?: number;
  }) => Promise<{
    client: DaemonClient;
    serverId: string;
    hostname: string | null;
  }>;
  getClientId: () => Promise<string>;
  readInitialConnectionHint?: () => InitialDaemonConnectionHint | null;
  mountClientHandlers?: (input: {
    client: DaemonClient;
    host: HostProfile;
    connection: HostConnection;
  }) => () => void;
  /** Bounds connect attempts across Hosts; the store shares one, a lone controller owns one. */
  connectLimiter?: ConnectLimiter;
  /** Pacing of retries for a Host that is not online. */
  backoffPolicy?: BackoffPolicy;
}

export interface HostRuntimeStorage extends ProviderCacheStorage {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}

export interface HostRuntimeStartOptions {
  autoProbe?: boolean;
  initialConnection?: {
    connectionId: string;
    existingClient: DaemonClient;
  };
}

const PROBE_TICK_MS = 2_000;
const PROBE_STEADY_MS = 10_000;
const PROBE_MAX_BACKOFF_MS = 30_000;
const PROBE_INACTIVE_WHILE_ONLINE_MS = 120_000;
const ADAPTIVE_SWITCH_THRESHOLD_MS = 40;
const ADAPTIVE_SWITCH_CONSECUTIVE_PROBES = 3;
const CONFIGURED_OVERRIDE_BOOTSTRAP_RETRY_MS = 1_000;

function toActiveConnection(connection: HostConnection): ActiveConnection {
  if (connection.type === "routed")
    return {
      type: "routed",
      endpoint: connection.originServerId,
      display: `via ${connection.originServerId}`,
    };
  if (connection.type === "directSocket") {
    return {
      type: "directSocket",
      endpoint: connection.path,
      display: "socket",
    };
  }
  if (connection.type === "directPipe") {
    return {
      type: "directPipe",
      endpoint: connection.path,
      display: "pipe",
    };
  }
  if (connection.type === "remoteSsh") {
    return {
      type: "remoteSsh",
      endpoint: connection.host,
      display: connection.host,
    };
  }
  if (connection.type === "directTcp") {
    return {
      type: "directTcp",
      endpoint: connection.endpoint,
      display: connection.endpoint,
    };
  }
  return {
    type: "relay",
    endpoint: connection.relayEndpoint,
    display: "relay",
  };
}

type HostRuntimeConnectionMachineState =
  | { tag: "booting" }
  | {
      tag: "connecting";
      activeConnectionId: string;
      activeConnection: ActiveConnection;
    }
  | {
      tag: "online";
      activeConnectionId: string;
      activeConnection: ActiveConnection;
      lastOnlineAt: string;
    }
  | {
      tag: "offline";
      activeConnectionId: string | null;
      activeConnection: ActiveConnection | null;
    }
  | {
      tag: "error";
      activeConnectionId: string | null;
      activeConnection: ActiveConnection | null;
      message: string;
    };

type HostRuntimeConnectionMachineEvent =
  | {
      type: "select_connection";
      connectionId: string;
      connection: ActiveConnection;
    }
  | { type: "client_state"; state: ConnectionState; lastError: string | null }
  | { type: "connect_failed"; message: string }
  | { type: "no_connections" }
  | { type: "stopped" };

function extractPreviousConnectionRef(state: HostRuntimeConnectionMachineState): {
  id: string | null;
  connection: ActiveConnection | null;
} {
  if (
    state.tag === "connecting" ||
    state.tag === "online" ||
    state.tag === "offline" ||
    state.tag === "error"
  ) {
    return { id: state.activeConnectionId, connection: state.activeConnection };
  }
  return { id: null, connection: null };
}

function buildConnectionStateFromStatus(
  previousActiveConnectionId: string,
  previousActiveConnection: ActiveConnection,
  event: Extract<HostRuntimeConnectionMachineEvent, { type: "client_state" }>,
): HostRuntimeConnectionMachineState | null {
  const status = event.state.status;
  if (status === "connected") {
    return {
      tag: "online",
      activeConnectionId: previousActiveConnectionId,
      activeConnection: previousActiveConnection,
      lastOnlineAt: new Date().toISOString(),
    };
  }
  if (status === "connecting" || status === "idle") {
    return {
      tag: "connecting",
      activeConnectionId: previousActiveConnectionId,
      activeConnection: previousActiveConnection,
    };
  }
  if (status === "disposed") {
    return {
      tag: "offline",
      activeConnectionId: previousActiveConnectionId,
      activeConnection: previousActiveConnection,
    };
  }
  return null;
}

function resolveConnectionStateResult(
  previousActiveConnectionId: string,
  previousActiveConnection: ActiveConnection,
  event: Extract<HostRuntimeConnectionMachineEvent, { type: "client_state" }>,
): HostRuntimeConnectionMachineState {
  const statusResult = buildConnectionStateFromStatus(
    previousActiveConnectionId,
    previousActiveConnection,
    event,
  );
  if (statusResult) return statusResult;

  const disconnectedReason =
    event.state.status === "disconnected" ? (event.state.reason ?? null) : null;
  const reason = disconnectedReason ?? event.lastError ?? null;
  if (!reason || reason === "client_closed") {
    return {
      tag: "offline",
      activeConnectionId: previousActiveConnectionId,
      activeConnection: previousActiveConnection,
    };
  }
  return {
    tag: "error",
    activeConnectionId: previousActiveConnectionId,
    activeConnection: previousActiveConnection,
    message: reason,
  };
}

function nextConnectionMachineState(input: {
  state: HostRuntimeConnectionMachineState;
  event: HostRuntimeConnectionMachineEvent;
}): HostRuntimeConnectionMachineState {
  const { state, event } = input;

  if (event.type === "select_connection") {
    return {
      tag: "connecting",
      activeConnectionId: event.connectionId,
      activeConnection: event.connection,
    };
  }

  if (event.type === "connect_failed") {
    const failed = extractPreviousConnectionRef(state);
    return {
      tag: "error",
      activeConnectionId: failed.id,
      activeConnection: failed.connection,
      message: event.message,
    };
  }

  if (event.type === "no_connections" || event.type === "stopped") {
    return {
      tag: "offline",
      activeConnectionId: null,
      activeConnection: null,
    };
  }

  const previous = extractPreviousConnectionRef(state);
  if (!previous.id || !previous.connection) {
    return state.tag === "booting"
      ? state
      : {
          tag: "offline",
          activeConnectionId: null,
          activeConnection: null,
        };
  }

  return resolveConnectionStateResult(previous.id, previous.connection, event);
}

function toSnapshotConnectionPatch(
  state: HostRuntimeConnectionMachineState,
  connectionEpoch: number,
): Pick<
  HostRuntimeSnapshot,
  | "activeConnectionId"
  | "activeConnection"
  | "connectionStatus"
  | "lastError"
  | "lastOnlineAt"
  | "connectionEpoch"
> {
  if (state.tag === "booting") {
    return {
      activeConnectionId: null,
      activeConnection: null,
      connectionStatus: "connecting",
      lastError: null,
      lastOnlineAt: null,
      connectionEpoch,
    };
  }
  if (state.tag === "connecting") {
    return {
      activeConnectionId: state.activeConnectionId,
      activeConnection: state.activeConnection,
      connectionStatus: "connecting",
      lastError: null,
      lastOnlineAt: null,
      connectionEpoch,
    };
  }
  if (state.tag === "online") {
    return {
      activeConnectionId: state.activeConnectionId,
      activeConnection: state.activeConnection,
      connectionStatus: "online",
      lastError: null,
      lastOnlineAt: state.lastOnlineAt,
      connectionEpoch,
    };
  }
  if (state.tag === "offline") {
    return {
      activeConnectionId: state.activeConnectionId,
      activeConnection: state.activeConnection,
      connectionStatus: "offline",
      lastError: null,
      lastOnlineAt: null,
      connectionEpoch,
    };
  }
  return {
    activeConnectionId: state.activeConnectionId,
    activeConnection: state.activeConnection,
    connectionStatus: "error",
    lastError: state.message,
    lastOnlineAt: null,
    connectionEpoch,
  };
}

function buildConnectionCandidates(host: HostProfile): ConnectionCandidate[] {
  return host.connections.map((connection) => ({
    connectionId: connection.id,
    connection,
  }));
}

/**
 * A pin learned from the active client is already enforced by that client, so
 * it keeps running. A pin that arrived from elsewhere (a strict offer) while
 * the active client is still legacy needs a client that enforces it.
 */
function connectionNeedsNewClient(
  previous: HostConnection,
  next: HostConnection,
  activeClient: DaemonClient | null,
): boolean {
  if (previous.type === "relay" && next.type === "relay") {
    const { minimumSecurityMode: previousPin, ...previousRest } = previous;
    const { minimumSecurityMode: nextPin, ...nextRest } = next;
    if (!equal(previousRest, nextRest)) return true;
    return (
      nextPin === "protected" &&
      previousPin !== "protected" &&
      activeClient?.relaySecurityFloor !== "protected"
    );
  }
  return !equal(previous, next);
}

function findConnectionById(host: HostProfile, connectionId: string | null): HostConnection | null {
  if (!connectionId) {
    return null;
  }
  return host.connections.find((connection) => connection.id === connectionId) ?? null;
}

function probeIntervalForConnection(
  firstSeenAt: number,
  isActiveOnline: boolean,
  hasActiveOnlineConnection: boolean,
  now: number,
): number {
  if (isActiveOnline) {
    return PROBE_STEADY_MS;
  }
  if (hasActiveOnlineConnection) {
    return PROBE_INACTIVE_WHILE_ONLINE_MS;
  }
  const age = now - firstSeenAt;
  if (age < 10_000) return 2_000;
  if (age < 30_000) return 5_000;
  if (age < 60_000) return PROBE_STEADY_MS;
  return PROBE_MAX_BACKOFF_MS;
}

function relayEncryptionForHost(
  connection: Extract<HostConnection, { type: "relay" }>,
  devicePairing: HostProfile["devicePairing"],
): DaemonClientConfig["e2ee"] {
  return {
    enabled: true,
    daemonPublicKeyB64: connection.daemonPublicKeyB64,
    minimumMode: connection.minimumSecurityMode ?? devicePairing?.minimumSecurityMode,
  };
}

function createDefaultDeps(
  onManagedHostRevoked: (management: HubHostManagement) => void = () => undefined,
  resolveOrigin: (serverId: string) => DaemonClient | null = () => null,
): HostRuntimeControllerDeps {
  const browserHostAvailable =
    typeof getDesktopHost()?.browser?.executeAutomationCommand === "function";
  const browserAutomationCapabilities = browserHostAvailable
    ? {
        [CLIENT_CAPS.browserHost]: {
          supportedCommands: [...BROWSER_AUTOMATION_COMMAND_NAMES],
          hostKind: "desktop app",
        },
      }
    : undefined;
  const appCapabilities = {
    ...browserAutomationCapabilities,
  };

  return {
    createClient: ({
      host,
      connection,
      clientId,
      runtimeGeneration,
      onAdmissionFailure,
      prefetchAccessTicket,
    }) => {
      const requestAccessTicket = async () => {
        // Electron validates the live local target; this authority does not depend on Hub.
        if (await readDesktopManagedLocalCredential(connection).catch(() => undefined))
          return undefined;
        return resolveHostAccessTicket(
          host.serverId,
          clientId,
          host.management,
          usesDeviceCredential(host),
        );
      };
      const takeAccessTicket = prefetchAccessTicket
        ? prefetchedAccessTicket(requestAccessTicket)
        : requestAccessTicket;
      const desktopTransportFactory = createDesktopDaemonTransportFactory();
      const webSocketConfig = { webSocketFactory: createAppWebSocketFactory() };
      const base = {
        selectReceiveCodec,
        ...(host.devicePairing
          ? {
              resolveDeviceAccess: async () => {
                try {
                  return await resolveHostDeviceAccess(host, connection);
                } catch (error) {
                  onAdmissionFailure?.(false);
                  throw error;
                }
              },
              e2ee: {
                enabled: true,
                daemonPublicKeyB64: host.devicePairing.daemonPublicKeyB64,
                minimumMode: host.devicePairing.minimumSecurityMode,
              },
            }
          : {}),
        suppressSendErrors: true,
        reconnect: { maxDelayMs: RECONNECT_MAX_DELAY_MS, jitter: "full" },
        clientId,
        clientType: "mobile",
        appVersion: resolveAppVersion() ?? undefined,
        runtimeGeneration,
        capabilities: appCapabilities,
        trace: createPerformanceTrace({ host: host.serverId, connection: connection.id }),
        onInboundMessage: perfProbe?.message,
        // Admission is resolved per hello, not per client: Hub binding
        // registration races host hydration, so a client born before its
        // binding must still present a ticket once admission is required.
        resolveAccessTicket: async () => {
          if (host.management) getColdStartConnectTimeline().mark("hostTransportOpen");
          try {
            return await takeAccessTicket();
          } catch (error) {
            onAdmissionFailure?.(false);
            throw error;
          }
        },
        // Only a closed admission removes a Hub Host. A single operation denied for missing
        // permission (`access_denied`) is an ordinary authorization result, not revocation.
        onAccessRevoked: () => {
          if (onAdmissionFailure?.(true) === false) return;
          if (host.management) onManagedHostRevoked(host.management);
        },
        providerSnapshots: "wire",
        ...(host.password ? { password: host.password } : {}),
        localCredential: () => readDesktopManagedLocalCredential(connection),
      } satisfies Omit<DaemonClientConfig, "url">;
      if (connection.type === "routed") {
        const origin = resolveOrigin(connection.originServerId);
        if (!origin) throw new Error(`Origin host ${connection.originServerId} is unavailable`);
        return new DaemonClient({
          ...base,
          url: "ws://routed-host/ws",
          transportFactory: createHostChannelTransport(origin, host.serverId, clientId, null),
        });
      }
      if (connection.type === "directSocket" || connection.type === "directPipe") {
        return new DaemonClient({
          ...base,
          ...(desktopTransportFactory ? { transportFactory: desktopTransportFactory } : {}),
          url: buildDesktopDaemonTransportUrl({
            transportType: connection.type === "directSocket" ? "socket" : "pipe",
            transportPath: connection.path,
          }),
        });
      }
      if (connection.type === "remoteSsh") {
        if (!desktopTransportFactory) {
          throw new Error("Remote SSH is only available in the desktop app.");
        }
        return new DaemonClient({
          ...base,
          transportFactory: desktopTransportFactory,
          url: buildDesktopDaemonTransportUrl({
            transportType: "ssh",
            host: connection.host,
            ...(connection.sshPort !== undefined ? { sshPort: connection.sshPort } : {}),
            ...(connection.daemonPort !== undefined ? { daemonPort: connection.daemonPort } : {}),
          }),
        });
      }
      if (connection.type === "directTcp") {
        return new DaemonClient({
          ...base,
          ...webSocketConfig,
          url: buildDaemonWebSocketUrl(connection.endpoint, {
            useTls: connection.useTls ?? false,
          }),
        });
      }
      return new DaemonClient({
        ...base,
        ...webSocketConfig,
        url: buildRelayWebSocketUrl({
          endpoint: connection.relayEndpoint,
          useTls: connection.useTls ?? shouldUseTlsForDefaultHostedRelay(connection.relayEndpoint),
          serverId: host.serverId,
        }),
        e2ee: relayEncryptionForHost(connection, host.devicePairing),
      });
    },
    connectToDaemon: async ({ host, connection, timeoutMs }) => {
      if (connection.type === "routed") {
        const origin = resolveOrigin(connection.originServerId);
        if (!origin?.isConnected)
          throw new Error(`Origin host ${connection.originServerId} is unavailable`);
        const client = new DaemonClient({
          url: "ws://routed-host/ws",
          clientId: crypto.randomUUID(),
          transportFactory: createHostChannelTransport(
            origin,
            host.serverId,
            crypto.randomUUID(),
            null,
          ),
          reconnect: { enabled: false },
          appVersion: resolveAppVersion() ?? undefined,
        });
        try {
          await client.connect();
          return { client, serverId: host.serverId, hostname: null };
        } catch (error) {
          await client.close();
          throw error;
        }
      }
      return connectToDaemon(connection, {
        ...(host.devicePairing
          ? {
              resolveDeviceAccess: () => resolveHostDeviceAccess(host, connection),
              e2ee: {
                enabled: true,
                daemonPublicKeyB64: host.devicePairing.daemonPublicKeyB64,
                minimumMode: host.devicePairing.minimumSecurityMode,
              },
            }
          : {}),
        ...(host.serverId ? { serverId: host.serverId } : {}),
        ...(host.password ? { password: host.password } : {}),
        localCredential: () => readDesktopManagedLocalCredential(connection),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        capabilities: appCapabilities,
        trace: createPerformanceTrace({ host: host.serverId, connection: connection.id }),
      });
    },
    getClientId: () => getOrCreateClientId(),
    mountClientHandlers: ({ client, host }) => {
      const unmountServerData = mountServerDataPushRouter({
        client,
        queryClient,
        serverId: host.serverId,
      });
      if (!browserAutomationCapabilities) {
        return unmountServerData;
      }
      const unmountBrowserAutomation = mountBrowserAutomationDaemonClientHandler(client, {
        serverId: host.serverId,
      });
      return () => {
        unmountBrowserAutomation();
        unmountServerData();
      };
    },
  };
}

export class HostRuntimeController {
  private host: HostProfile;
  private deps: HostRuntimeControllerDeps;
  private onReconcileServerId: ((oldId: string, newId: string) => void) | null;
  private onRelayProtectedSecurityNegotiated: ((input: RelaySecurityPin) => void) | null;
  private connectionMachineState: HostRuntimeConnectionMachineState;
  private connectionEpoch = 0;
  private snapshot: HostRuntimeSnapshot;
  private listeners = new Set<() => void>();
  private activeClient: DaemonClient | null = null;
  private unsubscribeClientStatus: (() => void) | null = null;
  private unsubscribeClientHandlers: (() => void) | null = null;
  private probeIntervalHandle: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private connectionFirstSeenAt = new Map<string, number>();
  private connectionLastProbedAt = new Map<string, number>();
  private switchCandidateConnectionId: string | null = null;
  private switchCandidateHitCount = 0;
  private clientIdPromise: Promise<string> | null = null;
  private switchRequestVersion = 0;
  private probeRequestVersion = 0;
  private probeCycleInFlight: Promise<void> | null = null;
  private readonly authRejectedConnectionIds = new Set<string>();
  private advertisedConnections: readonly HostConnection[] | undefined;
  private admissionBindingRegistered = false;
  private unsubscribeAdmission: (() => void) | null = null;
  private admissionAttemptFailed = false;
  private admissionRevoked = false;
  private readonly reconnectBackoff: ReconnectBackoff;
  private readonly connectLimiter: ConnectLimiter;

  constructor(input: {
    host: HostProfile;
    deps?: HostRuntimeControllerDeps;
    onReconcileServerId?: (oldId: string, newId: string) => void;
    onRelayProtectedSecurityNegotiated?: (input: RelaySecurityPin) => void;
  }) {
    this.host = input.host;
    this.deps = input.deps ?? createDefaultDeps();
    this.onReconcileServerId = input.onReconcileServerId ?? null;
    this.onRelayProtectedSecurityNegotiated = input.onRelayProtectedSecurityNegotiated ?? null;
    this.reconnectBackoff = new ReconnectBackoff(
      this.deps.backoffPolicy ?? DEFAULT_BACKOFF_POLICY,
      () => Date.now(),
    );
    this.connectLimiter =
      this.deps.connectLimiter ?? new ConnectLimiter(MAX_CONCURRENT_HOST_CONNECTS);
    this.connectionMachineState = {
      tag: "booting",
    };
    this.snapshot = {
      serverId: this.host.serverId,
      ...toSnapshotConnectionPatch(this.connectionMachineState, this.connectionEpoch),
      client: null,
      agentDirectoryStatus: "idle",
      agentDirectoryError: null,
      hasEverLoadedAgentDirectory: false,
      workspaceDirectoryStatus: "idle",
      workspaceDirectoryError: null,
      hasEverLoadedWorkspaceDirectory: false,
      probeByConnectionId: new Map(),
      clientGeneration: 0,
    };
  }

  getSnapshot(): HostRuntimeSnapshot {
    return this.snapshot;
  }

  getClient(): DaemonClient | null {
    return this.snapshot.client;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async start(options?: HostRuntimeStartOptions): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    this.reconnectBackoff.reset();
    const advertised = hostAdvertisedConnections(this.host.serverId);
    if (advertised !== undefined) this.advertisedConnections = advertised;
    this.admissionBindingRegistered = hostRequiresSessionAdmission(this.host.serverId);
    this.unsubscribeAdmission = subscribeHostSessionAccess(() => this.refreshAdmissionRoutes());
    this.trackConnectionFirstSeen();
    if (options?.initialConnection) {
      await this.switchToConnection({
        connectionId: options.initialConnection.connectionId,
        existingClient: options.initialConnection.existingClient,
      });
      if (!this.started) {
        return;
      }
    }
    await this.runProbeCycleNow();
    // stop() can run while startup is pending; a stopped controller never probes again.
    if (!this.started) {
      return;
    }
    if (options?.autoProbe !== false) {
      this.probeIntervalHandle = setInterval(() => {
        void this.runScheduledProbeCycle();
      }, PROBE_TICK_MS);
    }
  }

  async stop(): Promise<void> {
    this.switchRequestVersion += 1;
    this.probeRequestVersion += 1;
    // The in-flight cycle belongs to the stopped run; a restart must not wait on it, since a
    // connect that was cut off mid-admission may never settle.
    this.probeCycleInFlight = null;
    this.started = false;
    this.unsubscribeAdmission?.();
    this.unsubscribeAdmission = null;
    if (this.probeIntervalHandle) {
      clearInterval(this.probeIntervalHandle);
      this.probeIntervalHandle = null;
    }
    if (this.unsubscribeClientStatus) {
      this.unsubscribeClientStatus();
      this.unsubscribeClientStatus = null;
    }
    if (this.unsubscribeClientHandlers) {
      this.unsubscribeClientHandlers();
      this.unsubscribeClientHandlers = null;
    }
    if (this.activeClient) {
      const prev = this.activeClient;
      this.activeClient = null;
      await prev.close().catch(() => undefined);
    }
    this.applyConnectionEvent({ type: "stopped" });
    this.updateSnapshot({
      ...toSnapshotConnectionPatch(this.connectionMachineState, this.connectionEpoch),
      client: null,
    });
  }

  private refreshAdmissionRoutes(): void {
    const advertised = hostAdvertisedConnections(this.host.serverId);
    const registered = hostRequiresSessionAdmission(this.host.serverId);
    if (
      registered === this.admissionBindingRegistered &&
      (advertised === undefined || equal(advertised, this.advertisedConnections))
    )
      return;
    this.admissionBindingRegistered = registered;
    // Cleanup or a failed refresh is not an empty offer. Retain the last authoritative
    // inventory so stale manually saved Relay routes cannot become automatic candidates.
    if (advertised !== undefined) this.advertisedConnections = advertised;
    if (registered) this.admissionRevoked = false;
    this.switchRequestVersion += 1;
    this.probeRequestVersion += 1;
    const pending = this.probeCycleInFlight;
    this.applyConnectionEvent({ type: "stopped" });
    this.updateSnapshot({
      ...toSnapshotConnectionPatch(this.connectionMachineState, this.connectionEpoch),
      client: null,
    });
    void this.disposePreviousActiveClient().then(async () => {
      await pending;
      if (this.started) await this.runProbeCycleNow();
      return undefined;
    });
  }

  async updateHost(host: HostProfile): Promise<void> {
    const passwordChanged = this.host.password !== host.password;
    if (passwordChanged) {
      this.probeRequestVersion += 1;
      this.authRejectedConnectionIds.clear();
      this.updateSnapshot({ authFailureReason: null });
    }
    const preferredChanged = this.host.preferredConnectionId !== host.preferredConnectionId;
    const deviceSecurityFloorRaised =
      this.host.devicePairing?.minimumSecurityMode !== "protected" &&
      host.devicePairing?.minimumSecurityMode === "protected" &&
      this.activeClient?.relaySecurityFloor !== "protected";
    const activeConnectionId = this.snapshot.activeConnectionId;
    const previousActiveConnection = findConnectionById(this.host, activeConnectionId);
    this.resetBackoffForChangedRoutes(host);
    this.host = host;
    this.trackConnectionFirstSeen();
    const nextActiveConnection = findConnectionById(this.host, activeConnectionId);
    if (
      activeConnectionId &&
      previousActiveConnection &&
      (!nextActiveConnection ||
        connectionNeedsNewClient(
          previousActiveConnection,
          nextActiveConnection,
          this.activeClient,
        ) ||
        passwordChanged ||
        deviceSecurityFloorRaised ||
        (preferredChanged && this.snapshot.connectionStatus !== "online"))
    ) {
      this.switchRequestVersion += 1;
      this.probeRequestVersion += 1;
      this.connectionLastProbedAt.delete(activeConnectionId);
      await this.disposePreviousActiveClient();
      this.applyConnectionEvent({ type: "stopped" });
      this.updateSnapshot({
        ...toSnapshotConnectionPatch(this.connectionMachineState, this.connectionEpoch),
        client: null,
      });
      await this.probeCycleInFlight;
      if (
        nextActiveConnection &&
        !this.host.management &&
        !hostRequiresSessionAdmission(this.host.serverId)
      ) {
        await this.switchToConnection({ connectionId: activeConnectionId });
      }
    }
    if (passwordChanged) this.connectionLastProbedAt.clear();
    if (passwordChanged) await this.probeCycleInFlight;
    await this.runProbeCycleNow();
  }

  /**
   * The network or the app came back (`runtime/reconnect-sweep.ts`): an online Host verifies its
   * socket, any other Host drops its remaining backoff and tries now. Admission and probe
   * connects still take a shared slot.
   */
  retryAfterNetworkChange(): void {
    if (this.usesSessionAdmission() || !this.activeClient) {
      if (this.snapshot.connectionStatus === "online") this.activeClient?.verifyConnection();
      else void this.runProbeCycleNow();
      return;
    }
    // A self-retrying client verifies a live socket and reconnects a dropped one at once.
    this.activeClient.ensureConnected({ verify: true });
  }

  /** Whether `retryAfterNetworkChange` would start a connect that waits for a shared slot. */
  retryTakesConnectSlot(): boolean {
    const routedHere = this.usesSessionAdmission() || !this.activeClient;
    return routedHere && this.snapshot.connectionStatus !== "online";
  }

  /** The device lost its network: probe live sockets now so they report offline promptly. */
  verifyIfOnline(): void {
    if (this.snapshot.connectionStatus === "online") this.activeClient?.verifyConnection();
  }

  /** A changed route is new information, not another failure of the old one. */
  private resetBackoffForChangedRoutes(next: HostProfile): void {
    if (!equal(this.host.connections, next.connections)) this.reconnectBackoff.reset();
  }

  markAgentDirectorySyncLoading(): void {
    const status = this.snapshot.hasEverLoadedAgentDirectory ? "revalidating" : "initial_loading";
    this.updateSnapshot({
      agentDirectoryStatus: status,
      agentDirectoryError: null,
    });
  }

  markAgentDirectorySyncReady(): void {
    this.updateSnapshot({
      agentDirectoryStatus: "ready",
      agentDirectoryError: null,
      hasEverLoadedAgentDirectory: true,
    });
  }

  markAgentDirectorySyncError(error: string): void {
    const hasEverLoadedAgentDirectory = this.snapshot.hasEverLoadedAgentDirectory;
    this.updateSnapshot({
      agentDirectoryStatus: hasEverLoadedAgentDirectory
        ? "error_after_ready"
        : "error_before_first_success",
      agentDirectoryError: error,
      hasEverLoadedAgentDirectory,
    });
  }

  markAgentDirectorySyncIdle(): void {
    this.updateSnapshot({
      agentDirectoryStatus: this.snapshot.hasEverLoadedAgentDirectory ? "ready" : "idle",
      agentDirectoryError: null,
    });
  }

  markWorkspaceDirectorySyncLoading(): void {
    this.updateSnapshot({
      workspaceDirectoryStatus: this.snapshot.hasEverLoadedWorkspaceDirectory
        ? "revalidating"
        : "initial_loading",
      workspaceDirectoryError: null,
    });
  }

  markWorkspaceDirectorySyncReady(): void {
    this.updateSnapshot({
      workspaceDirectoryStatus: "ready",
      workspaceDirectoryError: null,
      hasEverLoadedWorkspaceDirectory: true,
    });
  }

  markWorkspaceDirectorySyncError(error: string): void {
    this.updateSnapshot({
      workspaceDirectoryStatus: this.snapshot.hasEverLoadedWorkspaceDirectory
        ? "error_after_ready"
        : "error_before_first_success",
      workspaceDirectoryError: error,
    });
  }

  markStartupError(message: string): void {
    this.applyConnectionEvent({ type: "connect_failed", message });
    this.updateSnapshot({
      ...toSnapshotConnectionPatch(this.connectionMachineState, this.connectionEpoch),
    });
  }

  async activateConnection(input: {
    connectionId: string;
    existingClient?: DaemonClient;
  }): Promise<void> {
    await this.switchToConnection(input);
  }

  /** An explicit attempt (user Retry, new route or authority): skips the remaining backoff. */
  async runProbeCycleNow(): Promise<void> {
    this.reconnectBackoff.reset();
    return this.runScheduledProbeCycle();
  }

  /** The periodic tick; a Host that is not online is attempted only when its backoff is due. */
  private async runScheduledProbeCycle(): Promise<void> {
    if (this.probeCycleInFlight) {
      return this.probeCycleInFlight;
    }

    const cycle = this.runProbeCycle().finally(() => {
      if (this.probeCycleInFlight === cycle) {
        this.probeCycleInFlight = null;
      }
    });
    this.probeCycleInFlight = cycle;
    return cycle;
  }

  private async runProbeCycle(): Promise<void> {
    const requestVersion = ++this.probeRequestVersion;
    if (this.host.connections.length === 0) {
      if (!this.isCurrentProbeRequest(requestVersion)) {
        return;
      }
      this.applyConnectionEvent({ type: "no_connections" });
      this.updateSnapshot({
        ...toSnapshotConnectionPatch(this.connectionMachineState, this.connectionEpoch),
        probeByConnectionId: new Map(),
      });
      return;
    }

    let localConnectionId: string | null = null;
    if (this.snapshot.connectionStatus !== "online") {
      const access = await deviceCredentialAccess(this.host);
      if (access.missing) {
        // Pairing again is the only way forward. Retrying every tick would flip the Host
        // through "connecting" and back; the next tick connects once a credential is saved.
        if (this.isCurrentProbeRequest(requestVersion))
          this.markStartupError(i18n.t("hub.connection.errors.credentialUnavailable"));
        return;
      }
      localConnectionId = access.localConnectionId;
      if (!this.isCurrentProbeRequest(requestVersion)) return;
      this.updateSnapshot({ localCredentialConnectionId: localConnectionId });
    }

    if (this.host.management || hostRequiresSessionAdmission(this.host.serverId)) {
      await this.runSessionAdmissionConnectionCycle(requestVersion, localConnectionId);
      return;
    }

    const now = performance.now();
    const isOnline = this.snapshot.connectionStatus === "online";
    const activeConnectionId = this.snapshot.activeConnectionId;
    const hasActiveOnlineConnection = isOnline && activeConnectionId !== null;

    const connectionsToProbe = this.host.connections.filter((connection) => {
      if (this.authRejectedConnectionIds.has(connection.id)) return false;
      const lastProbed = this.connectionLastProbedAt.get(connection.id);
      if (lastProbed == null) {
        return true;
      }
      const firstSeen = this.connectionFirstSeenAt.get(connection.id) ?? now;
      const isActiveOnline = isOnline && connection.id === activeConnectionId;
      const interval = probeIntervalForConnection(
        firstSeen,
        isActiveOnline,
        hasActiveOnlineConnection,
        now,
      );
      return now - lastProbed >= interval;
    });

    if (connectionsToProbe.length === 0) {
      return;
    }

    const probeByConnectionId = new Map(this.snapshot.probeByConnectionId);
    for (const connection of connectionsToProbe) {
      this.connectionLastProbedAt.set(connection.id, performance.now());
      const existingProbe = probeByConnectionId.get(connection.id);
      const shouldPreserveActiveLatency =
        isOnline && connection.id === activeConnectionId && existingProbe?.status === "available";
      if (!shouldPreserveActiveLatency) {
        probeByConnectionId.set(connection.id, {
          status: "pending",
          latencyMs: null,
        });
      }
    }
    this.updateSnapshot({ probeByConnectionId: new Map(probeByConnectionId) });

    let remaining = connectionsToProbe.length;
    let probeAuthFailure: "password_required" | "incorrect_password" | null = null;
    let activationLock: Promise<void> | null = null;

    const publishProbeState = (): void => {
      if (!this.isCurrentProbeRequest(requestVersion)) {
        return;
      }
      this.updateSnapshot({ probeByConnectionId: new Map(probeByConnectionId) });
    };

    const maybeActivateFirstAvailable = async (
      connectionId: string,
      client: DaemonClient,
    ): Promise<boolean> => {
      while (!this.snapshot.activeConnectionId) {
        if (!activationLock) {
          activationLock = this.switchToConnection({
            connectionId,
            expectedProbeVersion: requestVersion,
            existingClient: client,
          }).finally(() => {
            activationLock = null;
          });
          await activationLock;
          return this.snapshot.activeConnectionId === connectionId;
        }
        await activationLock;
      }
      return false;
    };

    const finalizeProbeCycle = async (): Promise<void> => {
      if (remaining > 0 || !this.isCurrentProbeRequest(requestVersion)) {
        return;
      }

      const currentActiveConnectionId = this.snapshot.activeConnectionId;
      const activeProbe = currentActiveConnectionId
        ? probeByConnectionId.get(currentActiveConnectionId)
        : null;

      if (!currentActiveConnectionId || !findConnectionById(this.host, currentActiveConnectionId)) {
        const nextConnectionId = selectBestConnection({
          candidates: buildConnectionCandidates(this.host),
          probeByConnectionId,
        });
        if (nextConnectionId) {
          await this.switchToConnection({
            connectionId: nextConnectionId,
            expectedProbeVersion: requestVersion,
          });
        } else if (probeAuthFailure) {
          const message = new DaemonAuthenticationError(probeAuthFailure).message;
          this.applyConnectionEvent({ type: "connect_failed", message });
          this.updateSnapshot({
            ...toSnapshotConnectionPatch(this.connectionMachineState, this.connectionEpoch),
            authFailureReason: probeAuthFailure,
          });
        }
        return;
      }

      if (this.isConnectionUnavailable(currentActiveConnectionId, activeProbe)) {
        const nextConnectionId = selectBestConnection({
          candidates: buildConnectionCandidates(this.host),
          probeByConnectionId,
        });
        if (nextConnectionId && nextConnectionId !== currentActiveConnectionId) {
          await this.switchToConnection({
            connectionId: nextConnectionId,
            expectedProbeVersion: requestVersion,
          });
        }
        this.switchCandidateConnectionId = null;
        this.switchCandidateHitCount = 0;
        return;
      }

      if (!activeProbe || activeProbe.status !== "available") {
        return;
      }

      const available = Array.from(probeByConnectionId.entries())
        .filter(
          (entry): entry is [string, Extract<ConnectionProbeState, { status: "available" }>] =>
            entry[1].status === "available",
        )
        .map(([connectionId, probe]) => ({
          connectionId,
          latencyMs: probe.latencyMs,
        }))
        .sort((left, right) => left.latencyMs - right.latencyMs);

      const fastest = available[0] ?? null;
      if (!fastest || fastest.connectionId === currentActiveConnectionId) {
        this.switchCandidateConnectionId = null;
        this.switchCandidateHitCount = 0;
        return;
      }

      const improvement = activeProbe.latencyMs - fastest.latencyMs;
      if (improvement < ADAPTIVE_SWITCH_THRESHOLD_MS) {
        this.switchCandidateConnectionId = null;
        this.switchCandidateHitCount = 0;
        return;
      }

      if (this.switchCandidateConnectionId === fastest.connectionId) {
        this.switchCandidateHitCount += 1;
      } else {
        this.switchCandidateConnectionId = fastest.connectionId;
        this.switchCandidateHitCount = 1;
      }

      if (this.switchCandidateHitCount >= ADAPTIVE_SWITCH_CONSECUTIVE_PROBES) {
        this.switchCandidateConnectionId = null;
        this.switchCandidateHitCount = 0;
        await this.switchToConnection({
          connectionId: fastest.connectionId,
          expectedProbeVersion: requestVersion,
        });
      }
    };

    await new Promise<void>((resolve) => {
      const settleProbe = (): void => {
        remaining -= 1;
        void finalizeProbeCycle().finally(() => {
          if (remaining === 0) {
            resolve();
          }
        });
      };

      for (const connection of connectionsToProbe) {
        void (async () => {
          let connectedClient: DaemonClient | null = null;
          let shouldCloseClient = false;
          try {
            const activeClient =
              this.snapshot.activeConnectionId === connection.id ? this.snapshot.client : null;

            if (activeClient) {
              connectedClient = activeClient;
            } else {
              const { client, serverId } = await this.connectLimiter.run(() =>
                this.deps.connectToDaemon({ host: this.host, connection }),
              );
              if (serverId !== this.host.serverId) {
                if (isPlaceholderServerId(this.host.serverId) && this.onReconcileServerId) {
                  this.onReconcileServerId(this.host.serverId, serverId);
                } else {
                  await client.close().catch(() => undefined);
                  throw new Error(
                    `Connection resolved to ${serverId}, expected ${this.host.serverId}.`,
                  );
                }
              }
              connectedClient = client;
              shouldCloseClient = true;
            }

            if (!this.isCurrentProbeRequest(requestVersion)) {
              return;
            }

            const activated = await maybeActivateFirstAvailable(connection.id, connectedClient);
            shouldCloseClient = shouldCloseClient && !activated;

            if (activeClient) {
              if (activeClient.getConnectionState().status !== "connected") {
                probeByConnectionId.set(connection.id, {
                  status: "unavailable",
                  latencyMs: null,
                });
                publishProbeState();
                return;
              }
              const rttMs = activeClient.getLastLivenessRttMs();
              if (!this.isCurrentProbeRequest(requestVersion)) {
                return;
              }
              if (rttMs !== null) {
                probeByConnectionId.set(connection.id, {
                  status: "available",
                  latencyMs: rttMs,
                });
                publishProbeState();
              }
              return;
            }

            const rttMs = await connectedClient.measureLatency({ timeoutMs: 5000 });
            if (!this.isCurrentProbeRequest(requestVersion)) {
              return;
            }

            probeByConnectionId.set(connection.id, {
              status: "available",
              latencyMs: rttMs,
            });
            publishProbeState();
          } catch (error) {
            if (this.isCurrentProbeRequest(requestVersion)) {
              const authFailure = getConnectionAuthFailureReason(error);
              if (authFailure) {
                this.authRejectedConnectionIds.add(connection.id);
                probeAuthFailure = authFailure;
              }
              probeByConnectionId.set(connection.id, {
                status: "unavailable",
                latencyMs: null,
              });
              publishProbeState();
            }
          } finally {
            if (connectedClient && shouldCloseClient) {
              await connectedClient.close().catch(() => undefined);
            }
            settleProbe();
          }
        })();
      }
    });
  }

  private async runSessionAdmissionConnectionCycle(
    requestVersion: number,
    localConnectionId: string | null = null,
  ): Promise<void> {
    const hasLocalAccess =
      localConnectionId !== null && !this.authRejectedConnectionIds.has(localConnectionId);
    if (
      !this.isCurrentProbeRequest(requestVersion) ||
      ((this.admissionRevoked || this.snapshot.authFailureReason) && !hasLocalAccess)
    )
      return;
    this.admissionAttemptFailed = false;
    const activeConnectionId = this.snapshot.activeConnectionId;
    const activeConnection = findConnectionById(this.host, activeConnectionId);
    if (activeConnection !== null && this.snapshot.connectionStatus === "online") {
      const rttMs = this.snapshot.client?.getLastLivenessRttMs() ?? null;
      if (rttMs !== null) {
        this.updateSnapshot({
          probeByConnectionId: new Map([
            [activeConnection.id, { status: "available", latencyMs: rttMs }],
          ]),
        });
      }
      return;
    }
    // Hub-managed Hosts own their retries here (their clients do not auto-reconnect), so an
    // unreachable sandbox waits out a jittered backoff instead of minting a session every tick.
    if (!this.reconnectBackoff.isDue()) return;
    await this.tryAdmissionCandidates(requestVersion, localConnectionId);
    if (!this.isCurrentProbeRequest(requestVersion)) return;
    if (this.snapshot.connectionStatus === "online") {
      this.reconnectBackoff.reset();
      return;
    }
    const delayMs = this.reconnectBackoff.recordFailure();
    recordHostDiagnostic("host-reconnect-backoff", {
      serverId: this.host.serverId,
      failures: this.reconnectBackoff.failureCount,
      delayMs,
    });
  }

  private async tryAdmissionCandidates(
    requestVersion: number,
    localConnectionId: string | null,
  ): Promise<void> {
    for (const connection of this.sessionAdmissionCandidates(localConnectionId)) {
      if (!this.isCurrentProbeRequest(requestVersion)) return;
      await this.switchToConnection({
        connectionId: connection.id,
        expectedProbeVersion: requestVersion,
      });
      if (
        this.snapshot.connectionStatus === "online" ||
        this.snapshot.authFailureReason ||
        this.admissionAttemptFailed
      )
        return;
    }
  }

  private sessionAdmissionCandidates(localConnectionId: string | null): HostConnection[] {
    // A local credential never authorizes a remote attempt, even after local failure.
    const candidates = this.host.connections.filter((connection) => {
      if (this.authRejectedConnectionIds.has(connection.id)) return false;
      if (localConnectionId) return connection.id === localConnectionId;
      return (
        this.advertisedConnections?.some((offered) =>
          matchesAdvertisedHostConnection(connection, offered),
        ) ?? true
      );
    });
    const preferredId = localConnectionId ?? this.host.preferredConnectionId;
    candidates.sort((a, b) => Number(b.id === preferredId) - Number(a.id === preferredId));
    // Once a connected route breaks, try the other advertised routes before retrying it.
    if (this.snapshot.client) {
      const failedId = this.snapshot.activeConnectionId;
      candidates.sort((a, b) => Number(a.id === failedId) - Number(b.id === failedId));
    }
    return candidates;
  }

  private isConnectionUnavailable(
    connectionId: string,
    probe: ConnectionProbeState | null | undefined,
  ): boolean {
    return probe?.status === "unavailable" || this.authRejectedConnectionIds.has(connectionId);
  }

  private updateSnapshot(patch: HostRuntimeSnapshotPatch): void {
    if (patch.probeByConnectionId) {
      patch = {
        ...patch,
        probeByConnectionId: holdLatencyJitter(
          this.snapshot.probeByConnectionId,
          patch.probeByConnectionId,
        ),
      };
    }
    const preservedPatch: HostRuntimeSnapshotPatch = { ...patch };
    let hasChanged = this.host.serverId !== this.snapshot.serverId;
    for (const key of Object.keys(patch) as (keyof HostRuntimeSnapshotPatch)[]) {
      const incomingValue = patch[key];
      if (equal(this.snapshot[key], incomingValue)) {
        setSnapshotPatchField(preservedPatch, key, this.snapshot[key]);
        continue;
      }
      hasChanged = true;
    }
    if (!hasChanged) {
      return;
    }
    this.snapshot = {
      ...this.snapshot,
      ...preservedPatch,
      serverId: this.host.serverId,
    };
    for (const listener of this.listeners) {
      listener();
    }
  }

  private applyConnectionEvent(event: HostRuntimeConnectionMachineEvent): void {
    const previousState = this.connectionMachineState;
    const nextState = nextConnectionMachineState({
      state: previousState,
      event,
    });
    if (previousState.tag !== "online" && nextState.tag === "online") {
      this.connectionEpoch += 1;
    }
    this.connectionMachineState = nextState;
    this.logConnectionTransition({
      from: previousState.tag,
      to: nextState.tag,
      event,
    });
  }

  private logConnectionTransition(input: {
    from: HostRuntimeConnectionMachineState["tag"];
    to: HostRuntimeConnectionMachineState["tag"];
    event: HostRuntimeConnectionMachineEvent;
  }): void {
    watchdog?.record("host.transition", {
      host: this.host.serverId,
      from: input.from,
      to: input.to,
      event: input.event.type,
      epoch: String(this.connectionEpoch),
    });
  }

  private trackConnectionFirstSeen(): void {
    const now = performance.now();
    const currentIds = new Set(this.host.connections.map((c) => c.id));
    for (const id of this.connectionFirstSeenAt.keys()) {
      if (!currentIds.has(id)) {
        this.connectionFirstSeenAt.delete(id);
        this.connectionLastProbedAt.delete(id);
      }
    }
    for (const connection of this.host.connections) {
      if (!this.connectionFirstSeenAt.has(connection.id)) {
        this.connectionFirstSeenAt.set(connection.id, now);
      }
    }
  }

  private isCurrentSwitchRequest(version: number): boolean {
    return version === this.switchRequestVersion;
  }

  private isCurrentProbeRequest(version: number): boolean {
    return version === this.probeRequestVersion;
  }

  private canProceedForProbe(expectedProbeVersion: number | undefined): boolean {
    if (expectedProbeVersion === undefined) {
      return true;
    }
    return this.isCurrentProbeRequest(expectedProbeVersion);
  }

  private async abortSwitchWithClient(client: DaemonClient | undefined): Promise<void> {
    if (client) {
      await client.close().catch(() => undefined);
    }
  }

  private isSwitchStillValid(requestVersion: number, expectedProbeVersion?: number): boolean {
    return (
      this.isCurrentSwitchRequest(requestVersion) && this.canProceedForProbe(expectedProbeVersion)
    );
  }

  private async resolveClientIdForSwitch(args: {
    existingClient: DaemonClient | undefined;
    requestVersion: number;
  }): Promise<string | null> {
    try {
      return await this.resolveClientId();
    } catch (error) {
      await this.abortSwitchWithClient(args.existingClient);
      if (!this.isCurrentSwitchRequest(args.requestVersion)) {
        return null;
      }
      const message = toErrorMessage(error);
      this.applyConnectionEvent({
        type: "connect_failed",
        message: `Failed to resolve client id: ${message}`,
      });
      this.updateSnapshot({
        ...toSnapshotConnectionPatch(this.connectionMachineState, this.connectionEpoch),
      });
      return null;
    }
  }

  private async disposePreviousActiveClient(): Promise<void> {
    if (this.unsubscribeClientStatus) {
      this.unsubscribeClientStatus();
      this.unsubscribeClientStatus = null;
    }
    if (this.unsubscribeClientHandlers) {
      this.unsubscribeClientHandlers();
      this.unsubscribeClientHandlers = null;
    }
    if (this.activeClient) {
      const previousClient = this.activeClient;
      this.activeClient = null;
      await previousClient.close().catch(() => undefined);
    }
  }

  private buildAgentDirectoryStatusPatch(): Partial<HostRuntimeSnapshotPatch> {
    if (this.snapshot.hasEverLoadedAgentDirectory) return {};
    const tag = this.connectionMachineState.tag;
    if (tag === "connecting" || tag === "online") {
      return { agentDirectoryStatus: "initial_loading", agentDirectoryError: null };
    }
    if (tag === "error") {
      return {
        agentDirectoryStatus: "error_before_first_success",
        agentDirectoryError: this.connectionMachineState.message,
      };
    }
    return { agentDirectoryStatus: "idle", agentDirectoryError: null };
  }

  private async switchToConnection(input: {
    connectionId: string;
    expectedProbeVersion?: number;
    existingClient?: DaemonClient;
  }): Promise<void> {
    const { connectionId, expectedProbeVersion, existingClient } = input;
    if (!this.canProceedForProbe(expectedProbeVersion)) {
      await this.abortSwitchWithClient(existingClient);
      return;
    }
    const connection = findConnectionById(this.host, connectionId);
    if (!connection) {
      await this.abortSwitchWithClient(existingClient);
      return;
    }
    const requestVersion = ++this.switchRequestVersion;

    const clientId = await this.resolveClientIdForSwitch({ existingClient, requestVersion });
    if (clientId === null) return;

    if (!this.isSwitchStillValid(requestVersion, expectedProbeVersion)) {
      await this.abortSwitchWithClient(existingClient);
      return;
    }

    await this.disposePreviousActiveClient();

    if (!this.isSwitchStillValid(requestVersion, expectedProbeVersion)) {
      await this.abortSwitchWithClient(existingClient);
      return;
    }

    const nextGeneration = this.snapshot.clientGeneration + 1;
    // A Host that has been failing may be unreachable: its ticket waits for the transport, so
    // an unreachable sandbox costs the Hub no ticket per retry.
    const prefetchAccessTicket =
      this.usesSessionAdmission() && this.reconnectBackoff.failureCount === 0;
    const client =
      existingClient ??
      this.deps.createClient({
        host: this.host,
        connection,
        clientId,
        runtimeGeneration: nextGeneration,
        prefetchAccessTicket,
        onAdmissionFailure: (revoked) => {
          if (!this.isCurrentSwitchRequest(requestVersion)) return false;
          this.admissionAttemptFailed = true;
          if (revoked) this.admissionRevoked = true;
          return true;
        },
      });
    // Admission is a real session, not a disposable latency probe. This controller owns
    // sequential route retries; client auto-retry would keep connect() pending forever.
    client.setReconnectEnabled(
      !(this.host.management || hostRequiresSessionAdmission(this.host.serverId)),
    );

    if (!this.isSwitchStillValid(requestVersion, expectedProbeVersion)) {
      await client.close().catch(() => undefined);
      return;
    }

    this.activeClient = client;
    this.applyConnectionEvent({
      type: "select_connection",
      connectionId: connection.id,
      connection: toActiveConnection(connection),
    });
    this.snapshot = { ...this.snapshot, clientGeneration: nextGeneration };
    this.updateSnapshot({
      ...toSnapshotConnectionPatch(this.connectionMachineState, this.connectionEpoch),
      client: null,
    });

    const failConnection = async (error: unknown) => {
      if (!this.isCurrentSwitchRequest(requestVersion) || this.activeClient !== client) return;
      const authFailure = getConnectionAuthFailureReason(error);
      if (authFailure) this.authRejectedConnectionIds.add(connection.id);
      this.unsubscribeClientStatus?.();
      this.unsubscribeClientStatus = null;
      this.unsubscribeClientHandlers?.();
      this.unsubscribeClientHandlers = null;
      client.setReconnectEnabled(false);
      this.applyConnectionEvent({ type: "connect_failed", message: toErrorMessage(error) });
      this.updateSnapshot({
        ...toSnapshotConnectionPatch(this.connectionMachineState, this.connectionEpoch),
        client: null,
        authFailureReason: authFailure,
      });
      if (authFailure) {
        const probes = new Map(this.snapshot.probeByConnectionId);
        probes.set(connection.id, { status: "unavailable", latencyMs: null });
        this.updateSnapshot({ probeByConnectionId: probes });
        for (const candidate of this.host.connections) {
          if (!this.authRejectedConnectionIds.has(candidate.id)) {
            this.connectionLastProbedAt.delete(candidate.id);
          }
        }
      }
      try {
        await client.close();
      } catch {
        /* Preserve the compatibility/connection error. */
      }
      if (
        authFailure &&
        this.host.connections.some((candidate) => !this.authRejectedConnectionIds.has(candidate.id))
      ) {
        void this.runProbeCycleNow();
      }
    };
    try {
      if (!existingClient) await this.connectClient(client, requestVersion);
      if (!this.isCurrentSwitchRequest(requestVersion) || this.activeClient !== client) return;
      this.unsubscribeClientHandlers =
        this.deps.mountClientHandlers?.({ client, host: this.host, connection }) ?? null;
      this.unsubscribeClientStatus = client.subscribeConnectionStatus((state) => {
        if (!this.isCurrentSwitchRequest(requestVersion) || this.activeClient !== client) return;
        if (client.authFailureReason) {
          void failConnection(new DaemonAuthenticationError(client.authFailureReason));
          return;
        }
        if (state.status === "connected") {
          this.reconnectBackoff.reset();
          this.learnRelaySecurity(client, connection.id);
        }
        this.applyConnectionEvent({ type: "client_state", state, lastError: client.lastError });
        this.updateSnapshot({
          ...toSnapshotConnectionPatch(this.connectionMachineState, this.connectionEpoch),
          ...this.buildAgentDirectoryStatusPatch(),
          client,
          authFailureReason: null,
        });
      });
    } catch (error) {
      await failConnection(error);
    }
  }

  /**
   * An admission client does not auto-retry, so its connect settles (or times out) and may hold
   * one of the shared connect slots. A self-retrying client's connect can stay pending across
   * retries, so it is never gated here.
   */
  private async connectClient(client: DaemonClient, requestVersion: number): Promise<void> {
    if (!this.usesSessionAdmission()) {
      await client.connect();
      return;
    }
    const release = await this.connectLimiter.acquire();
    try {
      // Stopped or superseded while queued: the caller closes the client and returns.
      if (!this.isCurrentSwitchRequest(requestVersion) || this.activeClient !== client) return;
      await client.connect();
    } finally {
      release();
    }
  }

  private usesSessionAdmission(): boolean {
    return Boolean(this.host.management) || hostRequiresSessionAdmission(this.host.serverId);
  }

  // The active client is the one place every connection path meets: clients
  // created here and probe clients adopted from `connectToDaemon` both land in
  // `switchToConnection`. A protected handshake observed here becomes the
  // persisted pin for that daemon identity.
  private learnRelaySecurity(client: DaemonClient, connectionId: string): void {
    const connection = findConnectionById(this.host, connectionId);
    if (!connection || client.relaySecurityFloor !== "protected") return;
    const pairing = this.host.devicePairing;
    const daemonPublicKeyB64 =
      connection.type === "relay" ? connection.daemonPublicKeyB64 : pairing?.daemonPublicKeyB64;
    if (!daemonPublicKeyB64) return;
    const routePinned =
      connection.type !== "relay" || connection.minimumSecurityMode === "protected";
    const identityPinned = !pairing || pairing.minimumSecurityMode === "protected";
    if (routePinned && identityPinned) return;
    this.onRelayProtectedSecurityNegotiated?.({
      serverId: this.host.serverId,
      daemonPublicKeyB64,
    });
  }

  adoptReconciledServerId(newServerId: string): void {
    this.host = { ...this.host, serverId: newServerId };
    this.snapshot = { ...this.snapshot, serverId: newServerId };
    for (const listener of this.listeners) {
      listener();
    }
  }

  private resolveClientId(): Promise<string> {
    if (!this.clientIdPromise) {
      this.clientIdPromise = this.deps.getClientId();
    }
    return this.clientIdPromise;
  }
}

const REGISTRY_STORAGE_KEY = "@clisbot:daemon-registry";
const LOCALHOST_FALLBACK_ENDPOINT = "localhost:6868";
const DEFAULT_LOCALHOST_BOOTSTRAP_TIMEOUT_MS = 2500;
const E2E_STORAGE_KEY = "@clisbot:e2e";
const INITIAL_DAEMON_CONNECTION_HINT_GLOBAL_KEY = "__CLISBOT_INITIAL_DAEMON_CONNECTION__";

export interface InitialDaemonConnectionHint {
  listen: string;
  useTls?: boolean;
}

const InitialDaemonConnectionHintSchema: z.ZodType<InitialDaemonConnectionHint> = z.object({
  listen: z.string().trim().min(1),
  useTls: z.boolean().optional().default(false),
});

export function readInitialDaemonConnectionHint(input?: {
  isWebRuntime?: boolean;
}): InitialDaemonConnectionHint | null {
  const isWebRuntime = input?.isWebRuntime ?? isWeb;
  if (!isWebRuntime || typeof globalThis === "undefined") {
    return null;
  }
  const result = InitialDaemonConnectionHintSchema.safeParse(
    Reflect.get(globalThis, INITIAL_DAEMON_CONNECTION_HINT_GLOBAL_KEY),
  );
  return result.success ? result.data : null;
}

function readConfiguredLocalDaemonOverride(): string | null {
  const value = process.env.EXPO_PUBLIC_LOCAL_DAEMON?.trim();
  return value && value.length > 0 ? value : null;
}

const PROTECTED_HOST_LINK_ERROR =
  "This protected Host needs a pairing invitation or a Hub access grant";

function isSameLinkedConnection(left: ConnectionOfferV2, right: ConnectionOfferV2): boolean {
  return (
    left.serverId === right.serverId &&
    equal(relayConnectionFromOffer(left), relayConnectionFromOffer(right))
  );
}

function parseOfferConnectionUrl(input: string): {
  offer: ConnectionOffer;
  password?: string;
} {
  if (input.trim().startsWith("relay://") || input.includes("#connect=")) {
    return parseRelayConnectionUri(input);
  }
  const marker = "#offer=";
  const idx = input.indexOf(marker);
  if (idx === -1) throw new Error("Missing #offer= fragment");
  const encoded = input.slice(idx + marker.length).trim();
  if (!encoded) throw new Error("Offer payload is empty");
  const payload = decodeOfferFragmentPayload(encoded);
  return { offer: ConnectionOfferSchema.parse(payload) };
}

export function hasConfiguredLocalDaemonOverride(): boolean {
  return readConfiguredLocalDaemonOverride() !== null;
}

function isPlaceholderServerId(serverId: string): boolean {
  return serverId.startsWith("local:");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rekeyMap<V>(map: Map<string, V>, oldKey: string, newKey: string): void {
  const value = map.get(oldKey);
  if (value === undefined) {
    return;
  }
  map.delete(oldKey);
  map.set(newKey, value);
}

interface AgentDirectoryRefreshInput {
  serverId: string;
  filter?: FetchAgentsOptions["filter"];
  subscribe?: FetchAgentsOptions["subscribe"];
  page?: FetchAgentsOptions["page"];
}

export class HostRuntimeStore {
  private controllers = new Map<string, HostRuntimeController>();
  private hostObservations = new Map<
    string,
    { client: DaemonClient; observation: OwnedSubscription<HostDirectory>; unsubscribe: () => void }
  >();
  private fleetDirectoryDemand = new Map<string, () => void>();
  private serverListeners = new Map<string, Set<() => void>>();
  private globalListeners = new Set<() => void>();
  private hostListListeners = new Set<() => void>();
  private version = 0;
  private hostListVersion = 0;
  private hostRegistryLoaded = false;
  private hosts: HostProfile[] = [];
  private hostRegistryMutationTail: Promise<void> = Promise.resolve();
  private hostRegistryStatus: HostRegistryStatus = "loading";
  private deps: HostRuntimeControllerDeps;
  private lastConnectionStatusByServer = new Map<string, HostRuntimeConnectionStatus>();
  private connectionStatusStartedAtByServer = new Map<string, number>();
  private readonly reconnectSweep = new ReconnectSweep();
  private readonly failedSinceOnline = new Set<string>();
  private queuedAgentDrainInFlight = new Set<string>();
  private directorySyncByServer = new Map<string, DirectorySync>();
  private nextCancellationRequestId = 0;
  private timelineReplicaByServer = new Map<string, TimelineReplica>();
  private configuredOverrideBootstrapInFlight: Promise<void> | null = null;
  private bootPromise: Promise<void> | null = null;
  private registryLoad: Promise<void> | null = null;
  private readonly hostConfirmations = new HostConfirmations();
  private storage: HostRuntimeStorage;
  private replicaCache: ReplicaCache;
  private readonly revokePushNotifications: typeof revokePushNotifications;
  private readonly directoryFrameClock: FrameClock | null;
  private readonly directoryPageLimiter = new ConnectLimiter(MAX_CONCURRENT_DIRECTORY_PAGES);
  private readonly coldStartTimeline: ColdStartConnectTimeline;

  constructor(input?: {
    deps?: HostRuntimeControllerDeps;
    storage?: HostRuntimeStorage;
    replicaRowStore?: ReplicaRowStore;
    revokePushNotifications?: typeof revokePushNotifications;
    /** Clisbot: paces each Host's live directory updates to one commit per frame. */
    directoryFrameClock?: FrameClock | null;
    coldStartTimeline?: ColdStartConnectTimeline;
  }) {
    const deps =
      input?.deps ??
      createDefaultDeps(
        (management) => {
          void this.removeManagedHost(management, "access revoked by the Host or Hub");
        },
        (serverId) => this.getClient(serverId),
      );
    // Every controller of this store shares one connect budget.
    this.deps = {
      ...deps,
      connectLimiter: deps.connectLimiter ?? new ConnectLimiter(MAX_CONCURRENT_HOST_CONNECTS),
    };
    this.storage = input?.storage ?? AsyncStorage;
    this.replicaCache = new ReplicaCache(input?.replicaRowStore ?? createReplicaRowStore());
    this.revokePushNotifications = input?.revokePushNotifications ?? revokePushNotifications;
    this.directoryFrameClock = input?.directoryFrameClock ?? null;
    this.coldStartTimeline = input?.coldStartTimeline ?? getColdStartConnectTimeline();
  }

  // --- Host registry ---

  getHosts(): HostProfile[] {
    return this.hosts;
  }

  getHostRegistryStatus(): HostRegistryStatus {
    return this.hostRegistryStatus;
  }

  subscribeHostList(listener: () => void): () => void {
    this.hostListListeners.add(listener);
    return () => {
      this.hostListListeners.delete(listener);
    };
  }

  getHostListVersion(): number {
    return this.hostListVersion;
  }

  isHostRegistryLoaded(): boolean {
    return this.hostRegistryLoaded;
  }

  markColdStartPhase(phase: ColdStartPhase): void {
    this.coldStartTimeline.mark(phase);
  }

  /** Resolves once the stored registry is loaded; a write before that would replace it. */
  whenHostRegistryLoaded(): Promise<void> {
    return this.loadRegistry();
  }

  boot(): Promise<void> {
    if (!this.bootPromise) {
      this.bootPromise = this.runBoot();
    }
    return this.bootPromise;
  }

  private async runBoot(): Promise<void> {
    const override = readConfiguredLocalDaemonOverride();
    await this.loadRegistry();

    let isE2E: string | null = null;
    try {
      isE2E = await readValidatedString(this.storage, E2E_STORAGE_KEY, z.string().min(1));
    } catch {
      return;
    }
    if (isE2E) {
      return;
    }

    if (shouldUseDesktopDaemon()) {
      return;
    }

    const initialHint = this.deps.readInitialConnectionHint
      ? this.deps.readInitialConnectionHint()
      : readInitialDaemonConnectionHint();
    if (initialHint) {
      const bootstrapped = await this.bootstrapInitialConnectionHint(initialHint);
      // A served UI points at its own Host. A failed protected pairing probe
      // must not discover a different daemon on the default localhost port.
      if (bootstrapped || !override) return;
    }

    if (override) {
      this.bootstrapConfiguredOverride(override);
    } else {
      await this.bootstrapDefaultLocalhost();
    }
  }

  private loadRegistry(): Promise<void> {
    if (!this.registryLoad) {
      this.registryLoad = this.loadFromStorage().then(() => this.markHostRegistryLoaded());
    }
    return this.registryLoad;
  }

  private async loadFromStorage(): Promise<void> {
    let shouldPersistHosts = false;
    let profiles: HostProfile[] = [];
    try {
      const stored = await readValidatedJson(
        this.storage,
        REGISTRY_STORAGE_KEY,
        StoredHostRegistrySchema,
      );
      if (stored) {
        const normalizedProfiles: HostProfile[] = [];
        for (const entry of stored) {
          const profile = normalizeStoredHostProfile(entry);
          if (!profile) {
            await this.storage.removeItem(REGISTRY_STORAGE_KEY);
            normalizedProfiles.length = 0;
            break;
          }
          // COMPAT(connectionPassword): added in v0.9.1, remove after 2027-03-24 with stored-password migration.
          if (
            entry.connections.some(
              (connection) => connection.type === "directTcp" && connection.password,
            )
          ) {
            shouldPersistHosts = true;
          }
          normalizedProfiles.push(profile);
        }
        profiles = normalizedProfiles.filter((entry) => !isPlaceholderServerId(entry.serverId));
        if (profiles.length !== normalizedProfiles.length) {
          shouldPersistHosts = true;
        }
      }
      this.hosts = profiles;
      this.replicaCache.setHosts(profiles.map((profile) => profile.serverId));
      projectIconCache.setHosts(profiles.map((profile) => profile.serverId));
      await projectIconCache.restore();
      this.syncHosts(profiles);
      void Promise.all(
        profiles.map((profile) =>
          this.directorySyncByServer
            .get(profile.serverId)
            ?.restoreCachedDirectory()
            .catch(() => undefined),
        ),
      ).then(() => this.coldStartTimeline.mark("cachedDirectories"));
    } catch (error) {
      console.error("[HostRuntime] Failed to load host registry from storage", error);
    } finally {
      this.hostRegistryStatus = "ready";
      this.coldStartTimeline.registryRestored(
        this.hosts.filter((host) => host.management).map((host) => host.serverId),
      );
      this.emitHostList();
      if (shouldPersistHosts) {
        void this.persistHosts().catch((error) =>
          console.error("[HostRuntime] Failed to persist host registry", error),
        );
      }
    }
  }

  private markHostRegistryLoaded(): void {
    if (this.hostRegistryLoaded) {
      return;
    }
    this.hostRegistryLoaded = true;
    this.emitHostList();
  }

  private async bootstrapDefaultLocalhost(): Promise<void> {
    const connection = connectionFromListen(LOCALHOST_FALLBACK_ENDPOINT);
    if (!connection || registryHasConnection(this.hosts, connection)) {
      return;
    }

    try {
      await this.probeAndUpsertConnection({
        connection,
        timeoutMs: DEFAULT_LOCALHOST_BOOTSTRAP_TIMEOUT_MS,
      });
    } catch (error) {
      console.warn("[HostRuntime] bootstrap probe failed", {
        endpoint: LOCALHOST_FALLBACK_ENDPOINT,
        error,
      });
    }
  }

  private bootstrapConfiguredOverride(endpoint: string): void {
    const connection = connectionFromListen(endpoint);
    if (!connection) {
      return;
    }
    if (registryHasConnection(this.hosts, connection)) {
      return;
    }
    if (this.configuredOverrideBootstrapInFlight) {
      return;
    }

    const bootstrap = this.runConfiguredOverrideBootstrap(endpoint, connection).finally(() => {
      if (this.configuredOverrideBootstrapInFlight === bootstrap) {
        this.configuredOverrideBootstrapInFlight = null;
      }
    });
    this.configuredOverrideBootstrapInFlight = bootstrap;
  }

  private async runConfiguredOverrideBootstrap(
    endpoint: string,
    connection: HostConnection,
  ): Promise<void> {
    let attempt = 0;
    while (!registryHasConnection(this.hosts, connection)) {
      attempt += 1;
      try {
        await this.probeAndUpsertConnection({
          connection,
          timeoutMs: DEFAULT_LOCALHOST_BOOTSTRAP_TIMEOUT_MS,
        });
        return;
      } catch (error) {
        if (attempt === 1 || attempt % 10 === 0) {
          console.warn("[HostRuntime] configured bootstrap probe failed", {
            endpoint,
            attempt,
            error,
          });
        }
        await delay(CONFIGURED_OVERRIDE_BOOTSTRAP_RETRY_MS);
      }
    }
  }

  private async bootstrapInitialConnectionHint(
    hint: InitialDaemonConnectionHint,
  ): Promise<boolean> {
    const connection = connectionFromListen(hint.listen);
    if (!connection) {
      return false;
    }
    const connectionWithHint: HostConnection =
      connection.type === "directTcp"
        ? { ...connection, useTls: hint.useTls ?? connection.useTls ?? false }
        : connection;
    if (registryHasConnection(this.hosts, connectionWithHint)) {
      return true;
    }

    try {
      await this.probeAndUpsertConnection({
        connection: connectionWithHint,
        timeoutMs: DEFAULT_LOCALHOST_BOOTSTRAP_TIMEOUT_MS,
      });
      return true;
    } catch (error) {
      console.warn("[HostRuntime] initial connection hint probe failed", {
        listen: hint.listen,
        useTls: hint.useTls,
        error,
      });
      return false;
    }
  }

  reconcileServerId(oldServerId: string, newServerId: string): void {
    if (oldServerId === newServerId) {
      return;
    }
    const controller = this.controllers.get(oldServerId);
    if (!controller) {
      return;
    }
    if (this.controllers.has(newServerId)) {
      return;
    }

    rekeyMap(this.controllers, oldServerId, newServerId);
    rekeyMap(this.lastConnectionStatusByServer, oldServerId, newServerId);
    rekeyMap(this.connectionStatusStartedAtByServer, oldServerId, newServerId);
    if (this.failedSinceOnline.delete(oldServerId)) this.failedSinceOnline.add(newServerId);
    this.replicaCache.reconcileServerId(oldServerId, newServerId);
    projectIconCache.reconcileServerId(oldServerId, newServerId);
    this.directorySyncByServer.get(oldServerId)?.dispose();
    this.directorySyncByServer.delete(oldServerId);
    this.timelineReplicaByServer.delete(oldServerId);
    const directory = new DirectorySync(
      newServerId,
      {
        onAgentStoppedRunning: (agentId) => this.drainQueuedAgentMessage(newServerId, agentId),
        markAgentLoading: () => controller.markAgentDirectorySyncLoading(),
        markAgentReady: () => controller.markAgentDirectorySyncReady(),
        markAgentError: (error) => controller.markAgentDirectorySyncError(error),
        markWorkspaceLoading: () => controller.markWorkspaceDirectorySyncLoading(),
        markWorkspaceReady: () => controller.markWorkspaceDirectorySyncReady(),
        markWorkspaceError: (error) => controller.markWorkspaceDirectorySyncError(error),
      },
      this.replicaCache,
      { frameClock: this.directoryFrameClock, pageFetchLimiter: this.directoryPageLimiter },
    );
    this.directorySyncByServer.set(newServerId, directory);
    this.timelineReplicaByServer.set(
      newServerId,
      createTimelineReplica({
        serverId: newServerId,
        storage: this.replicaCache,
        prepareAgent: (agentId) => directory.prepareAgentRoute(agentId),
      }),
    );
    controller.adoptReconciledServerId(newServerId);
    const snapshot = controller.getSnapshot();
    this.clearHostReplica(oldServerId);
    this.syncSessionReplica(newServerId, snapshot);
    directory.connectionChanged({
      client: snapshot.client,
      status: snapshot.connectionStatus === "online" ? "online" : "offline",
      source: {
        clientGeneration: snapshot.clientGeneration,
        connectionEpoch: snapshot.connectionEpoch,
      },
    });

    const listeners = this.serverListeners.get(oldServerId);
    if (listeners) {
      this.serverListeners.delete(oldServerId);
      const merged = this.serverListeners.get(newServerId) ?? new Set<() => void>();
      for (const listener of listeners) {
        merged.add(listener);
      }
      this.serverListeners.set(newServerId, merged);
    }

    this.hosts = this.hosts.map((host) =>
      host.serverId === oldServerId
        ? { ...host, serverId: newServerId, updatedAt: new Date().toISOString() }
        : host,
    );
    this.emitHostList();
    this.emit(newServerId);
    void this.persistHosts().catch((error) =>
      console.error("[HostRuntime] Failed to persist host registry", error),
    );
  }

  async upsertDirectConnection(input: {
    serverId: string;
    endpoint: string;
    useTls?: boolean;
    password?: string;
    label?: string;
    existingClient?: DaemonClient;
  }): Promise<HostProfile> {
    const endpoint = normalizeHostPort(input.endpoint);
    const password = input.password?.trim();
    return this.upsertHostConnection({
      serverId: input.serverId,
      label: input.label,
      password,
      connection: {
        id: `direct:${endpoint}`,
        type: "directTcp",
        endpoint,
        useTls: input.useTls ?? false,
      },
      existingClient: input.existingClient,
    });
  }

  async probeAndUpsertConnection(input: {
    connection: HostConnection;
    password?: string;
    label?: string;
    timeoutMs?: number;
  }): Promise<{
    profile: HostProfile;
    serverId: string;
    hostname: string | null;
  }> {
    if (input.connection.type === "relay") {
      throw new Error("Cannot probe a relay connection without a server id.");
    }
    const probeHost: HostProfile = {
      serverId: "",
      ...(input.password ? { password: input.password } : {}),
      label: input.label ?? input.connection.id,
      appearance: defaultHostAppearance(),
      lifecycle: {},
      connections: [input.connection],
      preferredConnectionId: input.connection.id,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    const { client, serverId, hostname } = await this.deps.connectToDaemon({
      host: probeHost,
      connection: input.connection,
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    });
    const profile = await this.upsertHostConnection({
      serverId,
      label: input.label ?? hostname ?? undefined,
      password: input.password,
      connection: input.connection,
      existingClient: client,
    });
    return { profile, serverId, hostname };
  }

  async probeAndUpsertDirectConnection(input: {
    endpoint: string;
    useTls?: boolean;
    password?: string;
    label?: string;
  }): Promise<{
    profile: HostProfile;
    serverId: string;
    hostname: string | null;
  }> {
    const endpoint = normalizeHostPort(input.endpoint);
    const password = input.password?.trim();
    return this.probeAndUpsertConnection({
      label: input.label,
      password,
      connection: {
        id: `direct:${endpoint}`,
        type: "directTcp",
        endpoint,
        useTls: input.useTls ?? false,
      },
    });
  }

  async probeAndUpsertRemoteSshConnection(input: {
    host: string;
    sshPort?: number;
    daemonPort?: number;
    password?: string;
    label?: string;
  }): Promise<{
    profile: HostProfile;
    serverId: string;
    hostname: string | null;
  }> {
    return this.probeAndUpsertConnection({
      label: input.label,
      // The daemon hashes and compares the password verbatim (`clisbot daemon
      // set-password` keeps what it reads), so whitespace is significant here.
      password: input.password ? input.password : undefined,
      connection: createRemoteSshHostConnection(input),
    });
  }

  // A pairing link (a URL, a QR code, or a pasted link) asks the user to
  // confirm when it adds a new host or changes a saved host's key, relay, or
  // TLS setting. The answer needs the saved hosts, so it waits for them to load.
  private async confirmLink(offer: ConnectionOfferV2): Promise<boolean> {
    await this.loadRegistry();
    return this.hostConfirmations.confirmLink(offer, this.hosts);
  }

  getPendingHostConfirmation(): HostConfirmationRequest | null {
    return this.hostConfirmations.getPending();
  }

  subscribeHostConfirmation(listener: () => void): () => void {
    return this.hostConfirmations.subscribe(listener);
  }

  answerHostConfirmation(requestId: number, approved: boolean): void {
    this.hostConfirmations.answer(requestId, approved);
  }

  /**
   * Starts one pairing flow, such as one open pairing modal. Once the user
   * confirms a link, submitting the same link again in this flow (the
   * password retry) does not ask again. A new flow asks again.
   */
  beginLinkPairing(): LinkPairing {
    let approvedOffer: ConnectionOfferV2 | null = null;
    return {
      submit: async (link, password, deviceLabel) => {
        // Clisbot device-pairing invitations pair with their own one-time grant.
        const deviceOffer = parseDevicePairingOfferFromUrl(link);
        if (deviceOffer) {
          const profile = await this.upsertDevicePairingOffer(deviceOffer, undefined, deviceLabel);
          return {
            status: "connected",
            profile,
            serverId: profile.serverId,
            hostname: profile.label,
            hubPaired: Boolean(deviceOffer.hub),
          };
        }
        const { offer, password: linkPassword } = parseOfferConnectionUrl(link);
        if (offer.v === 5) throw new Error(PROTECTED_HOST_LINK_ERROR);
        if (!approvedOffer || !isSameLinkedConnection(approvedOffer, offer)) {
          if (!(await this.confirmLink(offer))) return { status: "cancelled" };
          approvedOffer = offer;
        }
        const result = await this.probeAndUpsertOffer(offer, password ?? linkPassword);
        return { status: "connected", ...result };
      },
    };
  }

  async importConnectionLink(
    url: string,
    target: PairingNavigationTarget,
  ): Promise<ConnectionLinkImport> {
    const hub = hubOnlyPairingTarget(url);
    if (hub) {
      await pairHub(hub);
      return { status: "hub_connected" };
    }
    const deviceOffer = parseDevicePairingOfferFromUrl(url);
    if (deviceOffer) {
      const profile = await this.upsertDevicePairingOffer(deviceOffer);
      return deviceOffer.hub
        ? { status: "hub_connected" }
        : { status: "connected", serverId: profile.serverId };
    }
    if (target === "openProject") {
      const { offer, password } = parseOfferConnectionUrl(url);
      if (offer.v === 5) throw new Error(PROTECTED_HOST_LINK_ERROR);
      if (!(await this.confirmLink(offer))) return { status: "cancelled" };
      const profile = await this.upsertConnectionFromOffer(offer, undefined, password);
      return { status: "connected", serverId: profile.serverId };
    }
    const pairing = this.beginLinkPairing();
    try {
      const result = await pairing.submit(url);
      if (result.status === "cancelled") return result;
      return { status: "connected", serverId: result.serverId };
    } catch (error) {
      if (!getConnectionAuthFailureReason(error)) throw error;
      return { status: "password_required", link: url, pairing };
    }
  }

  async upsertConnectionFromOffer(
    offer: ConnectionOffer,
    label?: string,
    password?: string,
  ): Promise<HostProfile> {
    if (offer.v === 5) throw new Error(PROTECTED_HOST_LINK_ERROR);
    const connection = relayConnectionFromOffer(offer);
    if (!connection.daemonPublicKeyB64) {
      throw new Error("daemonPublicKeyB64 is required");
    }
    const profile = await this.upsertHostConnection({
      serverId: offer.serverId,
      label,
      connection,
    });
    if (password) {
      await this.setHostPassword(profile.serverId, password);
      return this.hosts.find((host) => host.serverId === profile.serverId) ?? profile;
    }
    return profile;
  }

  async upsertManagedConnectionFromOffer(input: {
    offer: ConnectionOffer;
    management: HubHostManagement;
    label?: string;
  }): Promise<HostProfile | null> {
    if (input.offer.v === 5) return this.upsertDeviceManagedConnection(input);
    const relayConnection = relayConnectionFromOffer(input.offer);
    const directConnection: HostConnection | null = input.offer.direct
      ? {
          id: `direct:${input.offer.direct.endpoint}`,
          type: "directTcp",
          endpoint: input.offer.direct.endpoint,
          useTls: input.offer.direct.useTls ?? true,
        }
      : null;
    // An authenticated projection may replace a stale enrollment on this Hub or attach to a Host
    // the user saved. Require the same daemon identity; an endpoint match alone is insufficient.
    const refreshedHost = this.hosts.find(
      (host) =>
        host.serverId === input.offer.serverId &&
        (host.management?.hubOrigin === input.management.hubOrigin ||
          host.management === undefined) &&
        provesOfferedDaemon(host, input.offer),
    );
    const conflictingHost = this.hosts.find(
      (host) =>
        (host.serverId === input.offer.serverId ||
          hostHasConnection(host, relayConnection) ||
          (directConnection !== null && hostHasConnection(host, directConnection))) &&
        host !== refreshedHost &&
        !sameHubManagement(host.management, input.management),
    );
    if (conflictingHost) return null;

    const management = withManualConnections(input.management, refreshedHost);
    if (directConnection !== null) {
      await this.upsertHostConnection({
        serverId: input.offer.serverId,
        label: input.label,
        management,
        connection: directConnection,
      });
    }
    return this.upsertHostConnection({
      serverId: input.offer.serverId,
      label: input.label,
      management,
      connection: relayConnection,
    });
  }

  private async upsertDeviceManagedConnection(input: {
    offer: ConnectionOffer;
    management: HubHostManagement;
    label?: string;
  }): Promise<HostProfile | null> {
    return this.withHostRegistryMutation(async () => {
      const existing = this.hosts.find((host) => host.serverId === input.offer.serverId);
      if (
        existing &&
        (!provesOfferedDaemon(existing, input.offer) ||
          (existing.management && !sameHubManagement(existing.management, input.management)))
      )
        return null;
      const devicePairing = devicePairingFromOffer(input.offer, existing);
      const connections = offerConnections({
        ...input.offer,
        minimumSecurityMode: devicePairing.minimumSecurityMode,
      });
      const now = new Date().toISOString();
      const management = withManualConnections(input.management, existing);
      const profile: HostProfile = {
        serverId: input.offer.serverId,
        label: input.label ?? input.offer.serverId,
        appearance: defaultHostAppearance(),
        lifecycle: {},
        createdAt: now,
        ...existing,
        devicePairing,
        management,
        connections: [
          ...connections,
          ...(existing?.connections ?? []).filter(
            (old) =>
              management.manualConnectionIds?.includes(old.id) &&
              !connections.some((next) => next.id === old.id),
          ),
        ],
        preferredConnectionId: connections[0]!.id,
        updatedAt: now,
      };
      const next = [...this.hosts.filter((host) => host.serverId !== profile.serverId), profile];
      await this.persistHosts(next);
      this.setHostsAndSync(next);
      return profile;
    });
  }

  private async upsertDevicePairingOffer(
    offer: DevicePairingOffer,
    label?: string,
    deviceLabel?: string,
  ): Promise<HostProfile> {
    return this.withHostRegistryMutation(async () => {
      if (offer.managedAccessMode === "external")
        throw new Error(
          "Pair the Hub for this managed Host, then sign in to load your granted Hosts",
        );
      const existing = this.hosts.find((host) => host.serverId === offer.serverId);
      const profile = devicePairedHost({ offer, existing, label });
      const hostname = await pairDaemon(offer, profile, deviceLabel);
      if (!label && !existing && hostname) profile.label = hostname;
      const next = [...this.hosts.filter((host) => host.serverId !== profile.serverId), profile];
      await this.persistHosts(next);
      this.setHostsAndSync(next);
      if (offer.hub) {
        try {
          await pairHub(offer.hub, deviceLabel);
        } catch (error) {
          throw new Error(
            `Daemon paired and saved. Hub pairing needs a retry with the same link: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
        }
      }
      return profile;
    });
  }

  private async probeAndUpsertOffer(
    offer: ConnectionOfferV2,
    password: string | undefined,
  ): Promise<{ profile: HostProfile; serverId: string; hostname: string | null }> {
    const connection = relayConnectionFromOffer(offer);
    const probeHost: HostProfile = {
      serverId: offer.serverId,
      ...(password ? { password } : {}),
      label: offer.serverId,
      appearance: defaultHostAppearance(),
      lifecycle: {},
      connections: [connection],
      preferredConnectionId: connection.id,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    const { client, hostname } = await this.deps.connectToDaemon({ host: probeHost, connection });
    await client.close().catch(() => undefined);
    const profile = await this.upsertConnectionFromOffer(offer, hostname ?? undefined, password);
    return { profile, serverId: offer.serverId, hostname };
  }

  async upsertConnectionFromListen(input: {
    listenAddress: string;
    serverId: string;
    hostname: string | null;
  }): Promise<HostProfile> {
    const normalizedListenAddress = input.listenAddress.trim();
    const serverId = input.serverId.trim();
    const connection = connectionFromListen(normalizedListenAddress);
    if (!connection) {
      throw new Error(`Unsupported listen address: ${input.listenAddress}`);
    }
    if (!serverId) {
      throw new Error("Desktop daemon did not return a server id.");
    }
    return this.withHostRegistryMutation(async () => {
      const existing = this.hosts.find((host) => host.serverId === serverId);
      // Desktop-discovered routes belong to this installation, not the Hub's offer.
      const management = existing?.management
        ? {
            ...existing.management,
            manualConnectionIds: [
              ...new Set([...(existing.management.manualConnectionIds ?? []), connection.id]),
            ],
          }
        : undefined;
      // A reused port is not proof that two saved daemon identities are the same Host.
      const profiles = upsertHostConnectionInProfiles({
        profiles: existing ? [existing] : [],
        serverId,
        connection,
        label: input.hostname ?? undefined,
        management,
      });
      const profile = { ...profiles[0]!, preferredConnectionId: connection.id };
      const next = existing
        ? this.hosts.with(this.hosts.indexOf(existing), profile)
        : [...this.hosts, profile];
      await this.persistHosts(next);
      this.setHostsAndSync(next);
      return profile;
    });
  }

  private async pinRelayProtectedSecurity(input: RelaySecurityPin): Promise<void> {
    const next = pinRelayProtectedSecurityInProfiles({ profiles: this.hosts, ...input });
    if (next === this.hosts) return;
    this.setHostsAndSync(next);
    await this.persistHosts();
  }

  private async updateHost(
    serverId: string,
    apply: (host: HostProfile) => HostProfile,
  ): Promise<void> {
    return this.withHostRegistryMutation(async () => {
      const updatedAt = new Date().toISOString();
      const next = this.hosts.map((host) =>
        host.serverId === serverId ? { ...apply(host), updatedAt } : host,
      );
      await this.persistHosts(next);
      this.setHostsAndSync(next);
    });
  }

  async renameHost(serverId: string, label: string): Promise<void> {
    await this.updateHost(serverId, (host) => ({ ...host, label }));
  }

  async setHostPassword(serverId: string, password: string): Promise<void> {
    await this.updateHost(serverId, (host) => {
      const { password: _previous, ...rest } = host;
      return password ? { ...rest, password } : rest;
    });
  }

  async setHostColor(serverId: string, color: HostColor): Promise<void> {
    await this.updateHostAppearance(serverId, (host) => ({
      ...host,
      appearance: { ...host.appearance, color },
    }));
  }

  async setHostBadgeDisplay(serverId: string, badgeDisplay: HostBadgeDisplay): Promise<void> {
    await this.updateHostAppearance(serverId, (host) => ({
      ...host,
      appearance: { ...host.appearance, badgeDisplay },
    }));
  }

  private updateHostAppearance(
    serverId: string,
    apply: (host: HostProfile) => HostProfile,
  ): Promise<void> {
    return this.applyHostAppearance(serverId, apply);
  }

  private withHostRegistryMutation<T>(operation: () => Promise<T>): Promise<T> {
    const mutation = this.hostRegistryMutationTail.then(operation);
    this.hostRegistryMutationTail = mutation.then(
      () => undefined,
      () => undefined,
    );
    return mutation;
  }

  private async applyHostAppearance(
    serverId: string,
    apply: (host: HostProfile) => HostProfile,
  ): Promise<void> {
    return this.withHostRegistryMutation(async () => {
      const updatedAt = new Date().toISOString();
      const next = this.hosts.map((host) =>
        host.serverId === serverId ? { ...apply(host), updatedAt } : host,
      );
      await this.persistHosts(next);
      this.setHostsAndSync(next);
    });
  }

  async removeHost(serverId: string): Promise<void> {
    return this.withHostRegistryMutation(() => this.applyHostRemoval(serverId));
  }

  private async applyHostRemoval(serverId: string): Promise<void> {
    await this.revokePushNotifications({ client: this.getClient(serverId), serverId });
    const remaining = this.hosts.filter((daemon) => daemon.serverId !== serverId);
    await this.persistHosts(remaining);
    this.setHostsAndSync(remaining);
  }

  async removeManagedHost(management: HubHostManagement, reason = "unspecified"): Promise<boolean> {
    return this.withHostRegistryMutation(async () => {
      const host = this.hosts.find(
        (candidate) =>
          candidate.management?.kind === "hub" &&
          sameHubManagement(candidate.management, management),
      );
      if (!host) return false;
      recordHostDiagnostic("managed-host-removed", {
        reason,
        serverId: host.serverId,
        daemonId: management.daemonId,
        label: host.label,
        stack: diagnosticStack(),
      });
      const manualConnectionIds = host.management?.manualConnectionIds;
      if (manualConnectionIds === undefined) {
        await this.applyHostRemoval(host.serverId);
        return true;
      }
      const next = this.hosts.map((candidate) =>
        candidate === host ? restoreManualHost(host, manualConnectionIds) : candidate,
      );
      await this.persistHosts(next);
      this.setHostsAndSync(next);
      // A revoked managed client stops reconnecting; the restored Host needs a fresh one.
      await this.restartHostConnection(host.serverId);
      return true;
    });
  }

  async removeConnection(serverId: string, connectionId: string): Promise<void> {
    return this.withHostRegistryMutation(async () => {
      const host = this.hosts.find((candidate) => candidate.serverId === serverId);
      if (host?.connections.length === 1 && host.connections[0]?.id === connectionId) {
        await this.applyHostRemoval(serverId);
        return;
      }
      const now = new Date().toISOString();
      const next = this.hosts
        .map((daemon) => {
          if (daemon.serverId !== serverId) return daemon;
          const remaining = daemon.connections.filter((conn) => conn.id !== connectionId);
          if (remaining.length === 0) {
            return null;
          }
          const preferred =
            daemon.preferredConnectionId === connectionId
              ? (remaining[0]?.id ?? null)
              : daemon.preferredConnectionId;
          return {
            ...daemon,
            connections: remaining,
            preferredConnectionId: preferred,
            updatedAt: now,
          } satisfies HostProfile;
        })
        .filter((entry): entry is HostProfile => entry !== null);
      await this.persistHosts(next);
      this.setHostsAndSync(next);
    });
  }

  private async upsertHostConnection(input: {
    serverId: string;
    label?: string;
    password?: string;
    connection: HostConnection;
    management?: HubHostManagement;
    existingClient?: DaemonClient;
  }): Promise<HostProfile> {
    return this.withHostRegistryMutation(async () => {
      const now = new Date().toISOString();
      const next = upsertHostConnectionInProfiles({
        profiles: this.hosts,
        serverId: input.serverId,
        label: input.label,
        connection: input.connection,
        ...(input.management ? { management: input.management } : {}),
        password: input.password,
        now,
      });
      await this.persistHosts(next);
      this.setHostsAndSync(next, {
        initialConnectionByServerId: input.existingClient
          ? new Map([
              [
                input.serverId,
                {
                  connectionId: input.connection.id,
                  existingClient: input.existingClient,
                },
              ],
            ])
          : undefined,
      });
      const profile = next.find((daemon) => daemon.serverId === input.serverId);
      if (!profile) {
        throw new Error(`Host ${input.serverId} was not inserted`);
      }
      return profile;
    });
  }

  private setHostsAndSync(
    hosts: HostProfile[],
    options?: {
      initialConnectionByServerId?: Map<
        string,
        { connectionId: string; existingClient: DaemonClient }
      >;
    },
  ): void {
    this.hosts = hosts;
    this.syncHosts(hosts, options);
    this.emitHostList();
  }

  private async persistHosts(hosts = this.hosts): Promise<void> {
    const expectedHosts = this.hosts;
    await persistHostRegistry(this.storage, REGISTRY_STORAGE_KEY, JSON.stringify(hosts));
    // Proved identity reconciliation remains synchronous. Its authoritative save is
    // already queued; a delayed user edit must not reinstall its stale profile.
    if (hosts !== expectedHosts && this.hosts !== expectedHosts) {
      throw new Error("Host registry changed while saving. Retry the change on the current Host.");
    }
  }

  private emitHostList(): void {
    this.hostListVersion += 1;
    for (const listener of this.hostListListeners) {
      listener();
    }
  }

  syncHosts(
    hosts: HostProfile[],
    options?: {
      initialConnectionByServerId?: Map<
        string,
        { connectionId: string; existingClient: DaemonClient }
      >;
    },
  ): void {
    this.replicaCache.setHosts(hosts.map((host) => host.serverId));
    projectIconCache.setHosts(hosts.map((host) => host.serverId));
    const nextIds = new Set(hosts.map((host) => host.serverId));
    for (const [serverId, controller] of this.controllers) {
      if (nextIds.has(serverId)) {
        continue;
      }
      this.hostObservations.get(serverId)?.unsubscribe();
      void this.hostObservations.get(serverId)?.observation.release();
      this.hostObservations.delete(serverId);
      this.fleetDirectoryDemand.get(serverId)?.();
      this.fleetDirectoryDemand.delete(serverId);
      this.controllers.delete(serverId);
      this.lastConnectionStatusByServer.delete(serverId);
      this.connectionStatusStartedAtByServer.delete(serverId);
      this.failedSinceOnline.delete(serverId);
      this.directorySyncByServer.get(serverId)?.dispose();
      this.directorySyncByServer.delete(serverId);
      this.timelineReplicaByServer.delete(serverId);
      this.clearHostReplica(serverId);
      void controller.stop();
      this.emit(serverId);
    }

    for (const host of hosts) {
      const initialConnection = options?.initialConnectionByServerId?.get(host.serverId);
      const existing = this.controllers.get(host.serverId);
      if (existing) {
        void existing.updateHost(host);
        if (initialConnection) {
          void existing.activateConnection(initialConnection).catch(() => {
            void initialConnection.existingClient.close().catch(() => undefined);
          });
        }
        continue;
      }
      const controller = new HostRuntimeController({
        host,
        deps: this.deps,
        onReconcileServerId: (oldId, newId) => this.reconcileServerId(oldId, newId),
        onRelayProtectedSecurityNegotiated: (pin) => void this.pinRelayProtectedSecurity(pin),
      });
      this.controllers.set(host.serverId, controller);
      useSessionStore.getState().initializeSession(host.serverId, null);
      const directory = new DirectorySync(
        host.serverId,
        {
          onAgentStoppedRunning: (agentId) => this.drainQueuedAgentMessage(host.serverId, agentId),
          markAgentLoading: () => controller.markAgentDirectorySyncLoading(),
          markAgentReady: () => controller.markAgentDirectorySyncReady(),
          markAgentError: (error) => controller.markAgentDirectorySyncError(error),
          markWorkspaceLoading: () => controller.markWorkspaceDirectorySyncLoading(),
          markWorkspaceReady: () => controller.markWorkspaceDirectorySyncReady(),
          markWorkspaceError: (error) => controller.markWorkspaceDirectorySyncError(error),
        },
        this.replicaCache,
        { frameClock: this.directoryFrameClock, pageFetchLimiter: this.directoryPageLimiter },
      );
      this.directorySyncByServer.set(host.serverId, directory);
      this.timelineReplicaByServer.set(
        host.serverId,
        createTimelineReplica({
          serverId: host.serverId,
          storage: this.replicaCache,
          prepareAgent: (agentId) => directory.prepareAgentRoute(agentId),
        }),
      );
      const initialSnapshot = controller.getSnapshot();
      this.lastConnectionStatusByServer.set(host.serverId, initialSnapshot.connectionStatus);
      this.connectionStatusStartedAtByServer.set(host.serverId, Date.now());
      controller.subscribe(() => {
        const snapshot = controller.getSnapshot();
        this.syncSessionReplica(snapshot.serverId, snapshot);
        this.syncDirectoryConnection(snapshot.serverId);
        this.syncHostDiscovery(snapshot.serverId);
        this.emit(snapshot.serverId);
      });
      void controller
        .start(
          initialConnection
            ? {
                initialConnection,
              }
            : {},
        )
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          controller.markStartupError(message);
        });
      this.emit(host.serverId);
    }
  }

  private syncHostDiscovery(serverId: string): void {
    const client = this.getClient(serverId);
    const previous = this.hostObservations.get(serverId);
    if (previous?.client === client) return;
    previous?.unsubscribe();
    void previous?.observation.release();
    this.hostObservations.delete(serverId);
    const host = this.hosts.find((candidate) => candidate.serverId === serverId);
    if (
      !client?.isConnected ||
      !client.getLastServerInfoMessage()?.features?.connectedHosts ||
      host?.connections.some((connection) => connection.type === "routed")
    )
      return;
    const observation = client.observeHosts();
    const apply = (directory: HostDirectory) => {
      if (this.hostObservations.get(serverId)?.client !== client) return;
      for (const target of directory.hosts) {
        if (!target.serverId || target.serverId === serverId) continue;
        const next = upsertHostConnectionInProfiles({
          profiles: this.hosts,
          serverId: target.serverId,
          label: target.label ?? undefined,
          connection: {
            id: `via:${serverId}`,
            type: "routed",
            originServerId: serverId,
          },
        });
        if (next !== this.hosts) {
          this.setHostsAndSync(next);
          void this.persistHosts();
        }
        if (!this.fleetDirectoryDemand.has(target.serverId))
          this.fleetDirectoryDemand.set(
            target.serverId,
            this.acquireDirectoryDemand(target.serverId),
          );
      }
    };
    const unsubscribe = observation.subscribe({
      snapshot: apply,
      update: (message) => {
        if (message.type === "hosts.changed") apply(message.payload.directory);
      },
    });
    this.hostObservations.set(serverId, { client, observation, unsubscribe });
    void observation.ready.then(apply).catch(() => undefined);
  }

  private syncSessionReplica(serverId: string, snapshot: HostRuntimeSnapshot): void {
    if (!snapshot.client) {
      return;
    }
    const sessionStore = useSessionStore.getState();
    sessionStore.initializeSession(serverId, snapshot.client, snapshot.clientGeneration);
    sessionStore.updateSessionClient(serverId, snapshot.client, snapshot.clientGeneration);
    // A reconnect keeps the same client, so the daemon's handshake (a restart or upgrade can
    // change its version and features) only reaches the store here. The client clears it while
    // disconnected; keep the last known value until the next handshake.
    const serverInfo = snapshot.client.getLastServerInfoMessage();
    if (serverInfo) {
      sessionStore.updateSessionServerInfo(serverId, toDaemonServerInfo(serverInfo));
    }
  }

  private clearHostReplica(serverId: string): void {
    useSessionStore.getState().clearSession(serverId);
    useWorkspaceSetupStore.getState().clearServer(serverId);
  }

  private syncDirectoryConnection(serverId: string): void {
    const controller = this.controllers.get(serverId);
    if (!controller) {
      this.lastConnectionStatusByServer.delete(serverId);
      this.connectionStatusStartedAtByServer.delete(serverId);
      return;
    }
    const snapshot = controller.getSnapshot();
    const directory = this.directorySyncByServer.get(serverId);
    directory?.connectionChanged({
      client: snapshot.client,
      status: snapshot.connectionStatus === "online" ? "online" : "offline",
      source: {
        clientGeneration: snapshot.clientGeneration,
        connectionEpoch: snapshot.connectionEpoch,
      },
    });
    const previousStatus = this.lastConnectionStatusByServer.get(serverId);
    const statusChanged = previousStatus !== snapshot.connectionStatus;
    const isUnavailable =
      snapshot.connectionStatus !== "online" && snapshot.connectionStatus !== "idle";
    const wasUnavailable =
      previousStatus !== undefined && previousStatus !== "online" && previousStatus !== "idle";
    if (statusChanged && (!wasUnavailable || !isUnavailable)) {
      this.connectionStatusStartedAtByServer.set(serverId, Date.now());
    }
    this.lastConnectionStatusByServer.set(serverId, snapshot.connectionStatus);
    if (snapshot.connectionStatus === "offline" || snapshot.connectionStatus === "error") {
      this.failedSinceOnline.add(serverId);
      if (statusChanged) this.coldStartTimeline.attemptFailed(serverId);
    }
    const didTransitionOnline =
      snapshot.connectionStatus === "online" && previousStatus !== "online";
    if (didTransitionOnline) {
      this.coldStartTimeline.hostOnline(serverId);
      this.noteHostRecovered(serverId);
      useSessionStore.getState().bumpHistorySyncGeneration(serverId);
      // Availability no longer changes history membership/query identity. Recovery uses the
      // same invalidation roots as archive/restore actions to revalidate accepted history.
      void queryClient.invalidateQueries({ queryKey: agentHistoryQueryKey(serverId) });
      void queryClient.invalidateQueries({ queryKey: allAgentHistoryQueryRootKey() });
      // Checkout git data is push-driven; pushes emitted while disconnected are gone for
      // good (the daemon dedupes by snapshot fingerprint). Mark the caches stale so active
      // queries refetch now and evicted ones on their next mount.
      void invalidateCheckoutGitQueriesForServer(queryClient, serverId);
      invalidateServerDataQueriesAfterReconnect({ queryClient, serverId });
      void queryClient.invalidateQueries({ queryKey: schedulesQueryBaseKey });
    }
  }

  drainQueuedAgentMessage(serverId: string, agentId: string): void {
    const drainKey = `${serverId}:${agentId}`;
    if (this.queuedAgentDrainInFlight.has(drainKey)) return;
    const store = useSessionStore.getState();
    const session = store.sessions[serverId];
    const queue = session?.queuedMessages.get(agentId);
    const client = session?.client;
    if (!client || !queue?.length || session.initializingAgents.get(agentId) === true) {
      return;
    }
    this.queuedAgentDrainInFlight.add(drainKey);
    const next = queue[0];
    void sendQueuedComposerMessageNow({
      agentId,
      messageId: next.id,
      queue: {
        read: (queuedAgentId) =>
          useSessionStore.getState().sessions[serverId]?.queuedMessages.get(queuedAgentId) ?? [],
        write: (update) => useSessionStore.getState().setQueuedMessages(serverId, update),
      },
      submitMessage: async ({ text, attachments }) => {
        const supportsForgeAttachments =
          useSessionStore.getState().sessions[serverId]?.serverInfo?.features?.forgeSearch === true;
        await dispatchComposerAgentMessage({
          client,
          agentId,
          text,
          attachments,
          attachmentSubmitFormat: resolveComposerAttachmentSubmitFormat({
            supportsForgeAttachments,
          }),
          encodeImages,
          submission: createMessageSubmissionWriter(serverId),
          // The queue drains when the agent goes idle, but the agent can start a turn of its own
          // in that same moment (a wake-up after background work). Steering folds the message
          // into that turn instead of interrupting it; with no turn running, the daemon starts
          // a normal one.
          activeTurnBehavior: "steer",
        });
      },
    })
      .then((result) => {
        if (result.status === "failed") {
          console.error("[HostRuntime] failed to drain queued agent message", {
            serverId,
            agentId,
            error: result.errorMessage,
          });
        }
        return result;
      })
      .finally(() => {
        this.queuedAgentDrainInFlight.delete(drainKey);
      });
  }

  applyAgentTurnLiveness(
    serverId: string,
    agentId: string,
    transition: TurnLivenessTransition | readonly TurnLivenessTransition[],
  ): void {
    this.directorySyncByServer.get(serverId)?.applyAgentTurnLiveness(agentId, transition);
  }

  beginAgentCancellation(serverId: string, agentId: string): number {
    const requestId = ++this.nextCancellationRequestId;
    this.applyAgentTurnLiveness(serverId, agentId, { type: "cancellation_started", requestId });
    return requestId;
  }

  settleAgentCancellation(serverId: string, agentId: string, requestId: number): void {
    this.applyAgentTurnLiveness(serverId, agentId, { type: "cancellation_settled", requestId });
  }

  acceptAgentSnapshot(serverId: string, agent: Agent): Agent {
    return this.requireDirectory(serverId).acceptAgent(agent);
  }

  archiveAgentSnapshot(serverId: string, agentId: string, archivedAt: string): void {
    this.requireDirectory(serverId).archiveAgent(agentId, archivedAt);
  }

  restoreAgentSnapshot(serverId: string, agentId: string, agent: Agent | undefined): void {
    const directory = this.requireDirectory(serverId);
    if (agent) directory.acceptAgent(agent);
    else directory.removeAgent(agentId);
  }

  acceptWorkspaceSnapshots(serverId: string, workspaces: readonly WorkspaceDescriptor[]): void {
    this.requireDirectory(serverId).acceptWorkspaces(workspaces);
  }

  acceptProjectSnapshot(serverId: string, project: ProjectDescriptor): void {
    this.requireDirectory(serverId).acceptProject(project);
  }

  removeWorkspaceSnapshot(serverId: string, workspaceId: string): void {
    this.requireDirectory(serverId).removeWorkspace(workspaceId);
  }

  private requireDirectory(serverId: string): DirectorySync {
    const directory = this.directorySyncByServer.get(serverId);
    if (!directory) throw new Error(`Unknown host runtime for serverId ${serverId}`);
    return directory;
  }

  getSnapshot(serverId: string): HostRuntimeSnapshot | null {
    return this.controllers.get(serverId)?.getSnapshot() ?? null;
  }

  getConnectionStatusSince(serverId: string): number | null {
    return this.connectionStatusStartedAtByServer.get(serverId) ?? null;
  }

  getVersion(): number {
    return this.version;
  }

  getClient(serverId: string): DaemonClient | null {
    return this.controllers.get(serverId)?.getClient() ?? null;
  }

  subscribe(serverId: string, listener: () => void): () => void {
    const existing = this.serverListeners.get(serverId) ?? new Set<() => void>();
    existing.add(listener);
    this.serverListeners.set(serverId, existing);
    return () => {
      const set = this.serverListeners.get(serverId);
      if (!set) {
        return;
      }
      set.delete(listener);
      if (set.size === 0) {
        this.serverListeners.delete(serverId);
      }
    };
  }

  subscribeAll(listener: () => void): () => void {
    this.globalListeners.add(listener);
    return () => {
      this.globalListeners.delete(listener);
    };
  }

  getEarliestOnlineHostServerId(): string | null {
    let earliestServerId: string | null = null;
    let earliestOnlineAt: string | null = null;
    for (const host of this.hosts) {
      const snapshot = this.getSnapshot(host.serverId);
      if (!isHostRuntimeConnected(snapshot) || !snapshot?.lastOnlineAt) continue;
      if (!earliestOnlineAt || snapshot.lastOnlineAt < earliestOnlineAt) {
        earliestOnlineAt = snapshot.lastOnlineAt;
        earliestServerId = host.serverId;
      }
    }
    return earliestServerId;
  }

  async restartHostConnection(serverId: string): Promise<void> {
    const controller = this.controllers.get(serverId);
    if (controller === undefined) return;
    await controller.stop();
    await controller.start();
  }

  /**
   * Take over a Host for a newly mounted owner (a Hub binding) without tearing down what is
   * already working. An online or connecting controller is kept: registering the binding has
   * already re-run admission if it changed anything. Anything else gets one immediate attempt.
   */
  async adoptHostConnection(serverId: string): Promise<void> {
    const controller = this.controllers.get(serverId);
    if (controller === undefined) return;
    const status = controller.getSnapshot().connectionStatus;
    if (status === "online" || status === "connecting") return;
    await controller.runProbeCycleNow();
  }

  /** OS network changes (web and Electron; native relies on foreground and recovered Hosts). */
  handleNetworkChange(state: NetworkReachability): void {
    recordHostDiagnostic("network-change", { state });
    if (state === "online") {
      this.sweepReconnect("network");
      return;
    }
    this.reconnectSweep.cancel();
    for (const controller of this.controllers.values()) controller.verifyIfOnline();
  }

  setAppVisible(visible: boolean): void {
    // Keep normal reconnect backoff running while hidden, for as long as the OS
    // lets us execute. Foregrounding drops that backoff without closing healthy sockets.
    if (!visible) {
      // Frames stop in the background; held live directory updates land now, then persist.
      for (const directory of this.directorySyncByServer.values()) directory.flushLiveUpdates();
      void this.replicaCache.flush();
      return;
    }

    this.sweepReconnect("foreground");
  }

  /** Clisbot: every offline Host tries now, staggered and within the shared connect limit. */
  private sweepReconnect(reason: ReconnectSweepReason): void {
    const controllers = Array.from(this.controllers);
    recordHostDiagnostic("host-reconnect-sweep", { reason, hosts: controllers.length });
    this.reconnectSweep.run(
      controllers.map(([serverId, controller]) => ({
        takesConnectSlot: () => controller.retryTakesConnectSlot(),
        retryNow: () => {
          // A Host removed while its staggered turn was pending is stopped; leave it alone.
          if (this.controllers.get(serverId) === controller) controller.retryAfterNetworkChange();
        },
      })),
    );
  }

  /** A Host that had failed connected: the network is likely back for its siblings too. */
  private noteHostRecovered(serverId: string): void {
    if (!this.failedSinceOnline.delete(serverId)) return;
    if (!this.reconnectSweep.shouldSweepAfterRecovery()) return;
    const othersOffline = Array.from(this.controllers).some(
      ([id, controller]) =>
        id !== serverId && controller.getSnapshot().connectionStatus !== "online",
    );
    if (othersOffline) this.sweepReconnect("host-recovered");
  }

  runProbeCycleNow(serverId?: string): Promise<void> {
    if (serverId) {
      return this.controllers.get(serverId)?.runProbeCycleNow() ?? Promise.resolve();
    }
    return Promise.all(
      Array.from(this.controllers.values(), (controller) => controller.runProbeCycleNow()),
    ).then(() => undefined);
  }

  async refreshAgentDirectory(
    input: AgentDirectoryRefreshInput,
  ): Promise<RefreshAgentDirectoryResult> {
    const directory = this.directorySyncByServer.get(input.serverId);
    if (!directory) throw new Error(`Unknown host runtime for serverId ${input.serverId}`);
    return directory.refreshAgents(input);
  }

  async refreshWorkspaceDirectory(input: { serverId: string; subscribe?: boolean }): Promise<void> {
    const directory = this.directorySyncByServer.get(input.serverId);
    if (!directory) throw new Error(`Unknown host runtime for serverId ${input.serverId}`);
    await directory.refreshWorkspaces({ subscribe: input.subscribe });
  }

  async refreshDirectories(serverId: string): Promise<void> {
    const directory = this.directorySyncByServer.get(serverId);
    if (!directory) throw new Error(`Unknown host runtime for serverId ${serverId}`);
    await directory.refreshDemand();
  }

  acquireDirectoryDemand(serverId: string): () => void {
    const directory = this.directorySyncByServer.get(serverId);
    if (!directory) return () => undefined;
    const source = {};
    directory.setDemand(source, true);
    return () => directory.setDemand(source, false);
  }

  acquireScriptStatusDemand(serverId: string, workspaceId: string): () => void {
    const directory = this.directorySyncByServer.get(serverId);
    if (!directory) return () => undefined;
    const source = {};
    directory.setScriptStatusDemand(source, workspaceId);
    return () => directory.setScriptStatusDemand(source, null);
  }

  async prepareAgentRoute(serverId: string, agentId: string): Promise<void> {
    const directory = this.directorySyncByServer.get(serverId);
    if (!directory) throw new Error(`Unknown host runtime for serverId ${serverId}`);
    await directory.prepareAgentRoute(agentId);
  }

  async prepareWorkspaceRoute(serverId: string, workspaceId: string): Promise<void> {
    const directory = this.directorySyncByServer.get(serverId);
    if (!directory) throw new Error(`Unknown host runtime for serverId ${serverId}`);
    await directory.prepareWorkspaceRoute(workspaceId);
  }

  /** The device's offline cache: chat tails and Settings → Storage read and clear it here. */
  getReplicaCache(): ReplicaCache {
    return this.replicaCache;
  }

  async prepareAgentTimeline(serverId: string, agentId: string): Promise<void> {
    const replica = this.timelineReplicaByServer.get(serverId);
    if (!replica) throw new Error(`Unknown host runtime for serverId ${serverId}`);
    await replica.prepare(agentId);
  }

  async fetchAgentTimeline(
    serverId: string,
    agentId: string,
    request: Parameters<DaemonClient["fetchAgentTimeline"]>[1],
  ): Promise<Awaited<ReturnType<DaemonClient["fetchAgentTimeline"]>>> {
    const directory = this.directorySyncByServer.get(serverId);
    if (!directory) throw new Error(`Unknown host runtime for serverId ${serverId}`);
    const owner = useSessionStore.getState().sessions[serverId]?.viewedTimelineSync;
    const page = await directory.fetchTimeline(agentId, request);
    if (owner && useSessionStore.getState().sessions[serverId]?.viewedTimelineSync === owner) {
      owner.flushStreamAgent(agentId);
      owner.applyTimelineResponse(page);
    }
    return page;
  }

  createViewedTimelineOwner(
    serverId: string,
    ports: ViewedTimelineOwnerPorts,
  ): ViewedTimelineOwner {
    const directory = this.directorySyncByServer.get(serverId);
    if (!directory) throw new Error(`Unknown host runtime for serverId ${serverId}`);
    const replica = this.timelineReplicaByServer.get(serverId);
    if (!replica) throw new Error(`Unknown host runtime for serverId ${serverId}`);
    return createViewedTimelineOwner({
      serverId,
      replica,
      replaceDemandedAgentIds: (agentIds) => directory.setAgentRouteDemand(agentIds),
      drainQueuedAgentMessage: (agentId) => this.drainQueuedAgentMessage(serverId, agentId),
      ports,
    });
  }

  private emit(serverId: string): void {
    this.version += 1;
    const listeners = this.serverListeners.get(serverId);
    if (!listeners) {
      for (const listener of this.globalListeners) {
        listener();
      }
      return;
    }
    for (const listener of listeners) {
      listener();
    }
    for (const listener of this.globalListeners) {
      listener();
    }
  }
}

let singletonHostRuntimeStore: HostRuntimeStore | null = null;
const HOST_RUNTIME_STORE_GLOBAL_KEY = "__clisbotHostRuntimeStore";

export function getHostRuntimeStore(): HostRuntimeStore {
  if (singletonHostRuntimeStore) {
    return singletonHostRuntimeStore;
  }

  const existing = Reflect.get(globalThis, HOST_RUNTIME_STORE_GLOBAL_KEY);
  if (existing instanceof HostRuntimeStore) {
    singletonHostRuntimeStore = existing;
    return existing;
  }

  const store = new HostRuntimeStore({ directoryFrameClock: createDirectoryFrameClock() });
  singletonHostRuntimeStore = store;
  Reflect.set(globalThis, HOST_RUNTIME_STORE_GLOBAL_KEY, store);
  // The app store lives for the process; it follows OS network changes where the platform has them.
  subscribeNetworkReachability((state) => store.handleNetworkChange(state));
  return store;
}

export function getHostRuntimeConnectionStatusSince(serverId: string): number | null {
  return getHostRuntimeStore().getConnectionStatusSince(serverId);
}

export function useHostRuntimeSnapshot(serverId: string): HostRuntimeSnapshot | null {
  const store = getHostRuntimeStore();
  return useSyncExternalStore(
    (onStoreChange) => store.subscribe(serverId, onStoreChange),
    () => store.getSnapshot(serverId),
    () => store.getSnapshot(serverId),
  );
}

export function useHostRuntimeClient(serverId: string): DaemonClient | null {
  const store = getHostRuntimeStore();
  return useSyncExternalStore(
    (onStoreChange) => store.subscribe(serverId, onStoreChange),
    () => store.getSnapshot(serverId)?.client ?? null,
    () => store.getSnapshot(serverId)?.client ?? null,
  );
}

export function useHostRuntimeIsConnected(serverId: string): boolean {
  const store = getHostRuntimeStore();
  return useSyncExternalStore(
    (onStoreChange) => store.subscribe(serverId, onStoreChange),
    () => isHostRuntimeConnected(store.getSnapshot(serverId)),
    () => isHostRuntimeConnected(store.getSnapshot(serverId)),
  );
}

/** An online session admitted with the existing Desktop credential, not merely a local address. */
export function isHostRuntimeLocallyConnected(snapshot: HostRuntimeSnapshot | null): boolean {
  return (
    isHostRuntimeConnected(snapshot) &&
    !!snapshot?.localCredentialConnectionId &&
    snapshot.activeConnectionId === snapshot.localCredentialConnectionId
  );
}

/** Server ids whose live connection is currently authorized and online. */
export function useHostRuntimeConnectedServerIds(
  serverIds: readonly string[],
  localOnly = false,
): string[] {
  const store = getHostRuntimeStore();
  const connectedKey = useSyncExternalStore(
    (onStoreChange) => {
      const unsubscribers = serverIds.map((serverId) => store.subscribe(serverId, onStoreChange));
      return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
    },
    () =>
      serverIds
        .filter((serverId) => {
          const snapshot = store.getSnapshot(serverId);
          return localOnly
            ? isHostRuntimeLocallyConnected(snapshot)
            : isHostRuntimeConnected(snapshot);
        })
        .join("\u0000"),
    () =>
      serverIds
        .filter((serverId) => {
          const snapshot = store.getSnapshot(serverId);
          return localOnly
            ? isHostRuntimeLocallyConnected(snapshot)
            : isHostRuntimeConnected(snapshot);
        })
        .join("\u0000"),
  );
  return useMemo(() => (connectedKey ? connectedKey.split("\u0000") : []), [connectedKey]);
}

export function useHostRuntimeConnectionStatus(serverId: string): HostRuntimeConnectionStatus {
  const store = getHostRuntimeStore();
  return useSyncExternalStore(
    (onStoreChange) => store.subscribe(serverId, onStoreChange),
    () => store.getSnapshot(serverId)?.connectionStatus ?? "connecting",
    () => store.getSnapshot(serverId)?.connectionStatus ?? "connecting",
  );
}

export function useHostRuntimeConnectionStatuses(
  serverIds: readonly string[],
): ReadonlyMap<string, HostRuntimeConnectionStatus> {
  const store = getHostRuntimeStore();
  // The snapshot is the statuses themselves, joined into a string so React compares by
  // value. A version counter read only for reactivity is dropped by the React Compiler.
  const readStatuses = () =>
    serverIds
      .map((serverId) => store.getSnapshot(serverId)?.connectionStatus ?? "connecting")
      .join("\n");
  const statuses = useSyncExternalStore(
    (onStoreChange) => store.subscribeAll(onStoreChange),
    readStatuses,
    readStatuses,
  );

  return useMemo(() => {
    const values = statuses.split("\n") as HostRuntimeConnectionStatus[];
    return new Map(serverIds.map((serverId, index) => [serverId, values[index]]));
  }, [serverIds, statuses]);
}

export function useHostRuntimeLastError(serverId: string): string | null {
  const store = getHostRuntimeStore();
  return useSyncExternalStore(
    (onStoreChange) => store.subscribe(serverId, onStoreChange),
    () => store.getSnapshot(serverId)?.lastError ?? null,
    () => store.getSnapshot(serverId)?.lastError ?? null,
  );
}

export function useHostRuntimeAgentDirectoryStatus(
  serverId: string,
): HostRuntimeAgentDirectoryStatus {
  const store = getHostRuntimeStore();
  return useSyncExternalStore(
    (onStoreChange) => store.subscribe(serverId, onStoreChange),
    () => store.getSnapshot(serverId)?.agentDirectoryStatus ?? "idle",
    () => store.getSnapshot(serverId)?.agentDirectoryStatus ?? "idle",
  );
}

export function useHostRuntimeIsDirectoryLoading(serverId: string): boolean {
  const store = getHostRuntimeStore();
  return useSyncExternalStore(
    (onStoreChange) => store.subscribe(serverId, onStoreChange),
    () => isHostRuntimeDirectoryLoading(store.getSnapshot(serverId)),
    () => isHostRuntimeDirectoryLoading(store.getSnapshot(serverId)),
  );
}

export function useHosts(): HostProfile[] {
  const store = getHostRuntimeStore();
  return useSyncExternalStore(
    (onStoreChange) => store.subscribeHostList(onStoreChange),
    () => store.getHosts(),
    () => store.getHosts(),
  );
}

export function useHostRegistryStatus(): HostRegistryStatus {
  const store = getHostRuntimeStore();
  return useSyncExternalStore(
    (onStoreChange) => store.subscribeHostList(onStoreChange),
    () => store.getHostRegistryStatus(),
    () => store.getHostRegistryStatus(),
  );
}

export function useHostRegistryLoaded(): boolean {
  const store = getHostRuntimeStore();
  return useSyncExternalStore(
    (onStoreChange) => store.subscribeHostList(onStoreChange),
    () => store.isHostRegistryLoaded(),
    () => store.isHostRegistryLoaded(),
  );
}

export function useHostConfirmation(): {
  pending: HostConfirmationRequest | null;
  answer: (approved: boolean) => void;
} {
  const store = getHostRuntimeStore();
  const pending = useSyncExternalStore(
    (onStoreChange) => store.subscribeHostConfirmation(onStoreChange),
    () => store.getPendingHostConfirmation(),
    () => store.getPendingHostConfirmation(),
  );
  // The answer is bound to the request this render shows, so a tap never
  // answers a request that replaced it.
  return useMemo(
    () => ({
      pending,
      answer: (approved: boolean) => {
        if (pending) store.answerHostConfirmation(pending.id, approved);
      },
    }),
    [pending, store],
  );
}

export interface HostMutations {
  upsertDirectConnection: (input: {
    serverId: string;
    endpoint: string;
    useTls?: boolean;
    password?: string;
    label?: string;
  }) => Promise<HostProfile>;
  probeAndUpsertDirectConnection: (input: {
    endpoint: string;
    useTls?: boolean;
    password?: string;
    label?: string;
  }) => Promise<{
    profile: HostProfile;
    serverId: string;
    hostname: string | null;
  }>;
  probeAndUpsertRemoteSshConnection: (input: {
    host: string;
    sshPort?: number;
    daemonPort?: number;
    password?: string;
    label?: string;
  }) => Promise<{ profile: HostProfile; serverId: string; hostname: string | null }>;
  beginLinkPairing: () => LinkPairing;
  renameHost: (serverId: string, label: string) => Promise<void>;
  setHostColor: (serverId: string, color: HostColor) => Promise<void>;
  setHostBadgeDisplay: (serverId: string, badgeDisplay: HostBadgeDisplay) => Promise<void>;
  removeHost: (serverId: string) => Promise<void>;
  removeConnection: (serverId: string, connectionId: string) => Promise<void>;
}

export function useHostMutations(): HostMutations {
  const store = getHostRuntimeStore();
  return useMemo(
    () => ({
      upsertDirectConnection: (input) => store.upsertDirectConnection(input),
      probeAndUpsertDirectConnection: (input) => store.probeAndUpsertDirectConnection(input),
      probeAndUpsertRemoteSshConnection: (input) => store.probeAndUpsertRemoteSshConnection(input),
      beginLinkPairing: () => store.beginLinkPairing(),
      renameHost: (serverId, label) => store.renameHost(serverId, label),
      setHostColor: (serverId, color) => store.setHostColor(serverId, color),
      setHostBadgeDisplay: (serverId, badgeDisplay) =>
        store.setHostBadgeDisplay(serverId, badgeDisplay),
      removeHost: (serverId) => store.removeHost(serverId),
      removeConnection: (serverId, connectionId) => store.removeConnection(serverId, connectionId),
    }),
    [store],
  );
}
