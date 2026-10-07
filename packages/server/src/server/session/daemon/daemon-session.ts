import type pino from "pino";
import type { ProviderAvailability } from "../../agent/agent-manager.js";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import { getPidLockInfo } from "../../pid-lock.js";
import { generateLocalPairingOffer } from "../../pairing-offer.js";
import {
  collectDaemonDiagnostics,
  type DaemonWebSocketRuntimeDiagnosticSnapshot,
} from "./diagnostics.js";
import { DaemonSelfUpdateSessionController } from "./daemon-self-update-session-controller.js";
import type { ManagedAgent } from "../../agent/agent-manager.js";
import type { PersistedProjectRecord, PersistedWorkspaceRecord } from "../../workspace-registry.js";
import type { HubRelationshipManagement } from "../../hub/relationship-controller.js";
import type { DaemonConfigReloadResult } from "../../daemon-config-store.js";
import { readDevicePairingConfiguration } from "../../device-access/runtime.js";
import { discoverEnrolledHub } from "../../hub/discovery.js";

export interface DaemonRuntimeConfig {
  listen: string | null;
  worktreesRoot?: string;
  appBaseUrl?: string;
  desktopManaged?: boolean;
  devicePairingEnabled?: boolean;
  startLocalHub?(
    options: import("@clisbot/protocol/hub-local").HubLocalStartOptions,
  ): Promise<import("@clisbot/protocol/hub-local").HubLocalStartResult>;
  hostTailscale?: {
    read(): Promise<import("@clisbot/protocol/host-tailscale").HostTailscale>;
    setUp(options: {
      httpsPort?: number;
    }): Promise<import("@clisbot/protocol/host-tailscale").HostTailscale>;
  };
  devices?: {
    authority: import("@clisbot/device-access/authority").DeviceAuthority;
    sessions(id: string): { clientId: string; connected: boolean }[];
    revokeSessions(id: string): Promise<void>;
  };
  getRelayConfig(): {
    enabled: boolean;
    endpoint: string;
    publicEndpoint: string;
    useTls: boolean;
    publicUseTls: boolean;
  } | null;
}

export interface DaemonSessionHost {
  emit(msg: SessionOutboundMessage): void;
  emitLifecycleIntent(intent: {
    type: "restart";
    clientId: string;
    requestId: string;
    reason: string;
  }): void;
}

export interface DaemonSessionOptions {
  host: DaemonSessionHost;
  clientId: string;
  clisbotHome: string;
  serverId: string | undefined;
  daemonVersion: string | undefined;
  daemonRuntimeConfig: DaemonRuntimeConfig | undefined;
  listAgents: () => ManagedAgent[];
  listProjects: () => Promise<PersistedProjectRecord[]>;
  listWorkspaces: () => Promise<PersistedWorkspaceRecord[]>;
  listProviderAvailability: () => Promise<ProviderAvailability[]>;
  getWebSocketRuntimeMetrics?: () => DaemonWebSocketRuntimeDiagnosticSnapshot | null;
  getObservationMetrics?: () => Record<string, number>;
  logger: pino.Logger;
  hubRelationships?: HubRelationshipManagement;
  reloadConfig: () => DaemonConfigReloadResult;
}

/**
 * A client's read surface for the daemon process itself: its runtime status
 * (pid-lock start time, listen address, relay config, provider availability) and
 * a fresh local pairing offer for connecting a new client. Owns the `daemon.*`
 * RPCs. Reaches no state beyond the never-mutated runtime values injected at
 * construction and the outbound channel.
 */
export class DaemonSession {
  async handleLocalHubStartRequest(
    msg: Extract<SessionInboundMessage, { type: "hub.local.start.request" }>,
  ): Promise<void> {
    try {
      if (!this.daemonRuntimeConfig?.startLocalHub)
        throw new Error("Local Hub startup is unavailable");
      const result = await this.daemonRuntimeConfig.startLocalHub({
        label: msg.label,
        transport: msg.transport,
        publicUrl: msg.publicUrl,
      });
      this.host.emit({
        type: "hub.local.start.response",
        payload: { requestId: msg.requestId, ...result },
      });
    } catch (error) {
      this.host.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: msg.type,
          error: error instanceof Error ? error.message : "Hub startup failed",
        },
      });
    }
  }
  async handleTailscaleRequest(
    msg: Extract<
      SessionInboundMessage,
      { type: "daemon.tailscale.status.request" | "daemon.tailscale.setup.request" }
    >,
  ): Promise<void> {
    try {
      const hostTailscale = this.daemonRuntimeConfig?.hostTailscale;
      if (!hostTailscale) throw new Error("Tailscale setup is unavailable on this Host");
      if (msg.type === "daemon.tailscale.status.request") {
        this.host.emit({
          type: "daemon.tailscale.status.response",
          payload: { requestId: msg.requestId, tailscale: await hostTailscale.read() },
        });
        return;
      }
      const tailscale = await hostTailscale.setUp({ httpsPort: msg.httpsPort });
      this.host.emit({
        type: "daemon.tailscale.setup.response",
        payload: { requestId: msg.requestId, tailscale },
      });
    } catch (error) {
      this.host.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: msg.type,
          error: error instanceof Error ? error.message : "Tailscale could not be checked",
        },
      });
    }
  }
  async handleDevicesRequest(
    msg: Extract<SessionInboundMessage, { type: "daemon.devices.request" }>,
  ): Promise<void> {
    const devices = this.daemonRuntimeConfig?.devices;
    try {
      if (!devices) throw new Error("Device pairing is disabled");
      if (msg.action.kind === "rename")
        await devices.authority.rename(msg.action.deviceId, msg.action.label);
      if (msg.action.kind === "revoke") {
        await devices.authority.revoke(msg.action.deviceId);
        await devices.revokeSessions(msg.action.deviceId);
      }
      this.host.emit({
        type: "daemon.devices.response",
        payload: {
          requestId: msg.requestId,
          devices: (await devices.authority.list()).map((device) => ({
            id: device.id,
            label: device.label,
            createdAt: device.createdAt,
            lastSeenAt: device.lastSeenAt,
            revokedAt: device.revokedAt,
            sessions: devices.sessions(device.id),
          })),
        },
      });
    } catch (error) {
      this.host.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: msg.type,
          error: error instanceof Error ? error.message : "Device operation failed",
        },
      });
    }
  }
  private readonly host: DaemonSessionHost;
  private readonly clientId: string;
  private readonly clisbotHome: string;
  private readonly serverId: string | undefined;
  private readonly daemonVersion: string | undefined;
  private readonly daemonRuntimeConfig: DaemonRuntimeConfig | undefined;
  private readonly listAgents: () => ManagedAgent[];
  private readonly listProjects: () => Promise<PersistedProjectRecord[]>;
  private readonly listWorkspaces: () => Promise<PersistedWorkspaceRecord[]>;
  private readonly listProviderAvailability: () => Promise<ProviderAvailability[]>;
  private readonly getWebSocketRuntimeMetrics: () => DaemonWebSocketRuntimeDiagnosticSnapshot | null;
  private readonly getObservationMetrics: DaemonSessionOptions["getObservationMetrics"];
  private readonly logger: pino.Logger;
  private readonly selfUpdate: DaemonSelfUpdateSessionController;
  private readonly hubRelationships: HubRelationshipManagement | null;
  private readonly reloadConfig: () => DaemonConfigReloadResult;

  constructor(options: DaemonSessionOptions) {
    this.host = options.host;
    this.clientId = options.clientId;
    this.clisbotHome = options.clisbotHome;
    this.serverId = options.serverId;
    this.daemonVersion = options.daemonVersion;
    this.daemonRuntimeConfig = options.daemonRuntimeConfig;
    this.listAgents = options.listAgents;
    this.listProjects = options.listProjects;
    this.listWorkspaces = options.listWorkspaces;
    this.listProviderAvailability = options.listProviderAvailability;
    this.getWebSocketRuntimeMetrics = options.getWebSocketRuntimeMetrics ?? (() => null);
    this.getObservationMetrics = options.getObservationMetrics;
    this.logger = options.logger;
    this.hubRelationships = options.hubRelationships ?? null;
    this.reloadConfig = options.reloadConfig;
    this.selfUpdate = new DaemonSelfUpdateSessionController({
      clientId: this.clientId,
      daemonVersion: this.daemonVersion ?? null,
      desktopManaged: this.daemonRuntimeConfig?.desktopManaged === true,
      emit: (msg) => this.host.emit(msg),
      emitLifecycleIntent: (intent) => this.host.emitLifecycleIntent(intent),
      sessionLogger: this.logger,
    });
  }

  async handleHubRelationshipRequest(
    msg: Extract<
      SessionInboundMessage,
      {
        type:
          | "hub.management.daemon.connect.request"
          | "hub.management.daemon.get_status.request"
          | "hub.management.daemon.disconnect.request"
          | "hub.management.daemon.permissions.update.request";
      }
    >,
  ): Promise<void> {
    try {
      if (!this.hubRelationships) throw new Error("Hub relationship management is unavailable");
      if (msg.type === "hub.management.daemon.connect.request") {
        const status = await this.hubRelationships.connect({
          hubUrl: msg.hubUrl,
          token: msg.token,
          permissions: msg.permissions,
        });
        this.host.emit({
          type: "hub.management.daemon.connect.response",
          payload: { requestId: msg.requestId, status },
        });
        return;
      }
      if (msg.type === "hub.management.daemon.permissions.update.request") {
        const status = await this.hubRelationships.updatePermissions({
          grant: msg.grant,
          revoke: msg.revoke,
        });
        this.host.emit({
          type: "hub.management.daemon.permissions.update.response",
          payload: { requestId: msg.requestId, status },
        });
        return;
      }
      if (msg.type === "hub.management.daemon.disconnect.request") {
        const result = await this.hubRelationships.disconnect({ force: msg.force ?? false });
        this.host.emit({
          type: "hub.management.daemon.disconnect.response",
          payload: { requestId: msg.requestId, ...result },
        });
        return;
      }
      const status = this.hubRelationships.status();
      const hubConnection = this.daemonRuntimeConfig?.devicePairingEnabled
        ? await discoverEnrolledHub(this.clisbotHome, status.hubOrigin)
        : undefined;
      this.host.emit({
        type: "hub.management.daemon.get_status.response",
        payload: {
          requestId: msg.requestId,
          status: { ...status, ...(hubConnection ? { hubConnection } : {}) },
        },
      });
    } catch (error) {
      this.logger.error({ err: error }, "Failed to handle Hub relationship request");
      this.host.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: msg.type,
          error: error instanceof Error ? error.message : String(error),
          code: "handler_error",
        },
      });
    }
  }

  async handleGetStatusRequest(
    msg: Extract<SessionInboundMessage, { type: "daemon.get_status.request" }>,
  ): Promise<void> {
    try {
      const pidInfo = await getPidLockInfo(this.clisbotHome);
      const providers = (await this.listProviderAvailability()).map((p) => ({
        provider: p.provider,
        available: p.available,
        error: p.error ?? null,
      }));
      this.host.emit({
        type: "daemon.get_status.response",
        payload: {
          requestId: msg.requestId,
          serverId: this.serverId ?? "",
          version: this.daemonVersion ?? null,
          pid: process.pid,
          nodePath: process.execPath,
          startedAt: pidInfo?.startedAt ?? null,
          listen: this.daemonRuntimeConfig?.listen ?? null,
          relay: this.daemonRuntimeConfig?.getRelayConfig() ?? null,
          providers,
        },
      });
    } catch (error) {
      this.logger.error({ err: error }, "Failed to handle daemon status request");
      this.host.emit({
        type: "daemon.get_status.response",
        payload: {
          requestId: msg.requestId,
          serverId: this.serverId ?? "",
          version: this.daemonVersion ?? null,
          pid: process.pid,
          nodePath: process.execPath,
          startedAt: null,
          listen: null,
          relay: null,
          providers: [],
        },
      });
    }
  }

  async handleGetPairingOfferRequest(
    msg: Extract<SessionInboundMessage, { type: "daemon.get_pairing_offer.request" }>,
  ): Promise<void> {
    try {
      const relay = this.daemonRuntimeConfig?.getRelayConfig();
      const configured = readDevicePairingConfiguration(this.clisbotHome);
      const pairing = await generateLocalPairingOffer({
        clisbotHome: this.clisbotHome,
        relayEnabled: relay?.enabled ?? false,
        relayEndpoint: relay?.endpoint,
        relayPublicEndpoint: relay?.publicEndpoint,
        relayUseTls: relay?.useTls,
        relayPublicUseTls: relay?.publicUseTls,
        appBaseUrl: this.daemonRuntimeConfig?.appBaseUrl,
        includeQr: true,
        logger: this.logger,
        devicePairingEnabled: this.daemonRuntimeConfig?.devicePairingEnabled,
        label: msg.label,
        ttlMs: msg.ttlMs,
        direct: msg.direct ?? configured.direct,
        hub: msg.hub,
        managedAccessMode: configured.managedAccessMode,
      });
      if (this.daemonRuntimeConfig?.devicePairingEnabled) {
        void this.hubRelationships
          ?.publishConnectionOffer?.()
          .catch((error) =>
            this.logger.warn({ err: error }, "Failed to publish protected connection routes"),
          );
      }
      this.host.emit({
        type: "daemon.get_pairing_offer.response",
        payload: {
          requestId: msg.requestId,
          url: pairing.url ?? "",
          qr: pairing.qr ?? null,
          relayEnabled: pairing.relayEnabled,
        },
      });
    } catch (error) {
      this.logger.error({ err: error }, "Failed to handle daemon pairing offer request");
      this.host.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: "daemon.get_pairing_offer.request",
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  handleConfigReloadRequest(
    msg: Extract<SessionInboundMessage, { type: "daemon.config.reload.request" }>,
  ): void {
    try {
      this.host.emit({
        type: "daemon.config.reload.response",
        payload: { requestId: msg.requestId, ...this.reloadConfig() },
      });
    } catch (error) {
      this.logger.error({ err: error }, "Failed to reload daemon config");
      this.host.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: msg.type,
          error: error instanceof Error ? error.message : String(error),
          code: "handler_error",
        },
      });
    }
  }

  async handleDiagnosticsRequest(
    msg: Extract<SessionInboundMessage, { type: "diagnostics.request" }>,
  ): Promise<void> {
    try {
      const diagnostic = await collectDaemonDiagnostics({
        clisbotHome: this.clisbotHome,
        serverId: this.serverId,
        daemonVersion: this.daemonVersion,
        daemonRuntimeConfig: this.daemonRuntimeConfig,
        listAgents: this.listAgents,
        listProjects: this.listProjects,
        listWorkspaces: this.listWorkspaces,
        listProviderAvailability: this.listProviderAvailability,
        getWebSocketRuntimeMetrics: this.getWebSocketRuntimeMetrics,
        getObservationMetrics: this.getObservationMetrics,
        logger: this.logger,
      });
      this.host.emit({
        type: "diagnostics.response",
        payload: {
          requestId: msg.requestId,
          diagnostic,
        },
      });
    } catch (error) {
      this.logger.error({ err: error }, "Failed to handle diagnostics request");
      this.host.emit({
        type: "diagnostics.response",
        payload: {
          requestId: msg.requestId,
          diagnostic: `Clisbot diagnostics\n  Error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      });
    }
  }

  async handleUpdateRequest(
    msg: Extract<SessionInboundMessage, { type: "daemon.update.request" }>,
  ): Promise<void> {
    await this.selfUpdate.dispatch(msg);
  }
}
