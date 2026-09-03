import { WebSocket } from "ws";
import { z } from "zod";
import type { ConnectionOffer } from "@getpaseo/protocol/connection-offer";
import type { ManagedAccessMode } from "@getpaseo/protocol/managed-access";
import type { WebSocketLike } from "../websocket-server.js";
import { PROJECT_PRIVILEGES, type ManagedAccessAdmission } from "../managed-access/types.js";
import { parseDaemonPermissions } from "../authorization/index.js";

export interface HubEnrollment {
  daemonId: string;
  idempotencyKey: string;
  hubOrigin: string;
  token: string;
  hostname: string;
  serverId: string;
  daemonPublicKey: string;
  credentialVerifier: string;
  permissions: string[];
}

export interface HubEnrollmentResult {
  daemonId: string;
  permissions: string[];
  webSocketUrl: string;
}

export interface HubPermissionUpdate {
  daemonId: string;
  hubOrigin: string;
  credential: string;
  permissions: string[];
}

export interface HubRevocation {
  daemonId: string;
  hubOrigin: string;
  credential: string;
}

export interface HubSocketCredentials {
  daemonId: string;
  webSocketUrl: string;
  credential: string;
}

export interface HubAccessTicketConsumption {
  daemonId: string;
  hubOrigin: string;
  credential: string;
  accessTicket: string;
  clientId: string;
}

export interface HubAccessLeaseRefresh {
  daemonId: string;
  hubOrigin: string;
  credential: string;
  leaseId: string;
}

export interface HubProject {
  projectId: string;
  name: string;
  agentConfigurationCatalog?: HubAgentConfigurationCatalog;
}

export interface HubAgentConfigurationCatalog {
  providers: readonly {
    id: string;
    label: string;
    defaultModeId?: string | null;
    modes?: readonly {
      id: string;
      label: string;
      /** Absent means the daemon could not classify this Mode safely. */
      isUnattended?: boolean;
    }[];
    models: readonly {
      id: string;
      label: string;
      thinkingOptions: readonly { id: string; label: string }[];
    }[];
  }[];
}

export interface HubProjectReplacement {
  daemonId: string;
  hubOrigin: string;
  credential: string;
  projects: readonly HubProject[];
}

export interface HubConnectionOfferReplacement {
  daemonId: string;
  hubOrigin: string;
  credential: string;
  connectionOffer: ConnectionOffer | null;
  managedAccessMode: ManagedAccessMode;
}

export interface HubSocketEvents {
  connected(socket: WebSocketLike, sessionProtocol: "legacy" | "session-v1"): void;
  rejected(statusCode: 401 | 403): void;
  closed(code: number): void;
  failed(error: Error): void;
}

export interface HubSocketConnection {
  close(): void;
}

export interface HubRelationshipRemote {
  enroll(input: HubEnrollment): Promise<HubEnrollmentResult>;
  updatePermissions(input: HubPermissionUpdate): Promise<{ permissions: string[] }>;
  revoke(input: HubRevocation): Promise<void>;
  consumeAccessTicket(input: HubAccessTicketConsumption): Promise<ManagedAccessAdmission>;
  refreshAccessLease(input: HubAccessLeaseRefresh): Promise<ManagedAccessAdmission>;
  replaceProjects(input: HubProjectReplacement): Promise<void>;
  replaceConnectionOffer(input: HubConnectionOfferReplacement): Promise<void>;
  openSocket(input: HubSocketCredentials, events: HubSocketEvents): HubSocketConnection;
}

export class HubEnrollmentRejectedError extends Error {
  constructor(readonly statusCode: number) {
    super(`Hub enrollment failed (${statusCode})`);
    this.name = "HubEnrollmentRejectedError";
  }
}

const EnrollmentResultSchema = z.object({
  daemonId: z.string(),
  permissions: z.array(z.string()),
  webSocketUrl: z
    .string()
    .url()
    .refine((value) => ["ws:", "wss:"].includes(new URL(value).protocol), {
      message: "Hub WebSocket URL must use ws or wss",
    })
    .refine((value) => new URL(value).hash === "", {
      message: "Hub WebSocket URL cannot include a fragment",
    }),
});

const AccessTicketAdmissionSchema = z.object({
  leaseId: z.string().uuid(),
  principalId: z.string().min(1),
  permissions: z.array(z.string()),
  resourceMode: z.enum(["daemon", "projects"]),
  projects: z.array(
    z.object({
      projectId: z.string().min(1),
      privileges: z.array(z.enum(PROJECT_PRIVILEGES)),
      agentConfigurations: z.array(
        z.object({
          providerId: z.string().min(1),
          modelIds: z.union([z.literal("*"), z.array(z.string().min(1))]),
          thinkingOptionIds: z.union([z.literal("*"), z.array(z.string().min(1))]),
        }),
      ),
    }),
  ),
  leaseExpiresAt: z.string().datetime(),
});

function ensureWebSocketMatchesHubOrigin(hubOrigin: string, webSocketUrl: string): void {
  const hub = new URL(hubOrigin);
  const socket = new URL(webSocketUrl);
  const expectedProtocol = hub.protocol === "https:" ? "wss:" : "ws:";
  if (socket.protocol !== expectedProtocol || socket.host !== hub.host) {
    throw new Error("Hub WebSocket URL must match the Hub origin");
  }
}

export class DirectHubRelationshipRemote implements HubRelationshipRemote {
  private readonly requestTimeoutMs: number;

  constructor(options: { requestTimeoutMs?: number } = {}) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
  }

  async enroll(input: HubEnrollment): Promise<HubEnrollmentResult> {
    return this.withRequestTimeout(async (signal) => {
      const response = await fetch(`${input.hubOrigin}/api/daemons/enroll`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${input.token}`,
        },
        body: JSON.stringify({
          daemonId: input.daemonId,
          idempotencyKey: input.idempotencyKey,
          hostname: input.hostname,
          serverId: input.serverId,
          daemonPublicKey: input.daemonPublicKey,
          credentialVerifier: input.credentialVerifier,
          permissions: input.permissions,
        }),
        signal,
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new HubEnrollmentRejectedError(response.status);
        }
        throw new Error(`Hub enrollment failed (${response.status})`);
      }
      const enrollment = EnrollmentResultSchema.parse(await response.json());
      ensureWebSocketMatchesHubOrigin(input.hubOrigin, enrollment.webSocketUrl);
      return enrollment;
    });
  }

  async updatePermissions(input: HubPermissionUpdate): Promise<{ permissions: string[] }> {
    return this.withRequestTimeout(async (signal) => {
      const response = await fetch(
        `${input.hubOrigin}/api/daemons/${encodeURIComponent(input.daemonId)}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${input.credential}`,
          },
          body: JSON.stringify({ permissions: input.permissions }),
          signal,
        },
      );
      if (!response.ok) throw new Error(`Hub permission update failed (${response.status})`);
      return z.object({ permissions: z.array(z.string()) }).parse(await response.json());
    });
  }

  async revoke(input: HubRevocation): Promise<void> {
    await this.withRequestTimeout(async (signal) => {
      const response = await fetch(
        `${input.hubOrigin}/api/daemons/${encodeURIComponent(input.daemonId)}`,
        {
          method: "DELETE",
          headers: { authorization: `Bearer ${input.credential}` },
          signal,
        },
      );
      if (!response.ok && ![401, 403, 404].includes(response.status)) {
        throw new Error(`Hub revocation failed (${response.status})`);
      }
    });
  }

  async consumeAccessTicket(input: HubAccessTicketConsumption): Promise<ManagedAccessAdmission> {
    return this.withRequestTimeout(async (signal) => {
      const response = await fetch(`${input.hubOrigin}/api/daemons/access-tickets/consume`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${input.credential}`,
          "x-paseo-daemon-id": input.daemonId,
        },
        body: JSON.stringify({
          accessTicket: input.accessTicket,
          clientId: input.clientId,
        }),
        signal,
      });
      if (!response.ok) throw new HubEnrollmentRejectedError(response.status);
      return parseAccessAdmission(await response.json());
    });
  }

  async refreshAccessLease(input: HubAccessLeaseRefresh): Promise<ManagedAccessAdmission> {
    return this.withRequestTimeout(async (signal) => {
      const response = await fetch(`${input.hubOrigin}/api/daemons/access-leases/refresh`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${input.credential}`,
          "x-paseo-daemon-id": input.daemonId,
        },
        body: JSON.stringify({ leaseId: input.leaseId }),
        signal,
      });
      if (!response.ok) throw new HubEnrollmentRejectedError(response.status);
      return parseAccessAdmission(await response.json());
    });
  }

  async replaceProjects(input: HubProjectReplacement): Promise<void> {
    await this.withRequestTimeout(async (signal) => {
      const response = await fetch(
        `${input.hubOrigin}/api/daemons/${encodeURIComponent(input.daemonId)}/projects`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${input.credential}`,
          },
          body: JSON.stringify({ projects: input.projects }),
          signal,
        },
      );
      if (!response.ok) throw new Error(`Hub Project replacement failed (${response.status})`);
    });
  }

  async replaceConnectionOffer(input: HubConnectionOfferReplacement): Promise<void> {
    await this.withRequestTimeout(async (signal) => {
      const response = await fetch(
        `${input.hubOrigin}/api/daemons/${encodeURIComponent(input.daemonId)}/connection-offer`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${input.credential}`,
          },
          body: JSON.stringify({
            connectionOffer: input.connectionOffer,
            managedAccessMode: input.managedAccessMode,
          }),
          signal,
        },
      );
      if (!response.ok) {
        throw new Error(`Hub Connection Offer replacement failed (${response.status})`);
      }
    });
  }

  openSocket(input: HubSocketCredentials, events: HubSocketEvents): HubSocketConnection {
    let sessionProtocol: "legacy" | "session-v1" = "legacy";
    const socket = new WebSocket(input.webSocketUrl, {
      handshakeTimeout: this.requestTimeoutMs,
      headers: {
        authorization: `Bearer ${input.credential}`,
        "x-paseo-daemon-id": input.daemonId,
        "x-paseo-session-protocol": "1",
      },
    });
    let settled = false;
    socket.once("upgrade", (response) => {
      if (response.headers["x-paseo-session-protocol"] === "1") {
        sessionProtocol = "session-v1";
      }
    });
    socket.once("open", () => {
      if (!settled) events.connected(socket as WebSocketLike, sessionProtocol);
    });
    socket.once("unexpected-response", (_request, response) => {
      if (settled) {
        response.destroy();
        return;
      }
      settled = true;
      response.destroy();
      socket.terminate();
      if (response.statusCode === 401 || response.statusCode === 403) {
        events.rejected(response.statusCode);
        return;
      }
      events.closed(1006);
    });
    socket.once("close", (code) => {
      if (settled) return;
      settled = true;
      events.closed(code);
    });
    socket.once("error", (error) => {
      if (settled) return;
      settled = true;
      socket.terminate();
      events.failed(error);
    });
    return socket;
  }

  private async withRequestTimeout<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    timeout.unref?.();
    try {
      return await operation(controller.signal);
    } catch (error) {
      if (controller.signal.aborted) throw new Error("Hub request timed out", { cause: error });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseAccessAdmission(value: unknown): ManagedAccessAdmission {
  const admission = AccessTicketAdmissionSchema.parse(value);
  return {
    leaseId: admission.leaseId,
    principalId: admission.principalId,
    permissions: parseDaemonPermissions(admission.permissions),
    resourceMode: admission.resourceMode,
    projects: new Map(
      admission.projects.map((project) => [
        project.projectId,
        {
          privileges: new Set(project.privileges),
          agentConfigurations: project.agentConfigurations,
        },
      ]),
    ),
    leaseExpiresAt: Date.parse(admission.leaseExpiresAt),
  };
}
