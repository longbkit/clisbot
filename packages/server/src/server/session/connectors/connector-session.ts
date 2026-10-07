import type pino from "pino";
import type { ConnectorSettings } from "@clisbot/protocol/connectors/types";
import { chatAllowsKey } from "@clisbot/protocol/connectors/rpc-schemas";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import {
  ConnectorRequestError,
  type ConnectorService,
} from "../../connectors/connector-service.js";
import { getErrorMessage } from "@clisbot/protocol/error-utils";

/**
 * The `connectors.*` RPC handlers of one session (docs/features/connectors/README.md).
 * `session.ts` routes the requests here; with the flag off `dispatchConnectorMessage`
 * answers `connectors_disabled`. Daemon permissions are checked before dispatch
 * (`authorization/operation-permissions.ts`): reads need `daemon.read`, changes `daemon.manage`.
 */

type ConnectorRequest = Extract<SessionInboundMessage, { type: `connectors.${string}.request` }>;
type RequestOf<T extends ConnectorRequest["type"]> = Extract<ConnectorRequest, { type: T }>;
type Emit = (msg: SessionOutboundMessage) => void;

/**
 * Settings as a session without `daemon.manage` sees them: a server's address without its path
 * or query, and no arguments, where people put tokens. Managers see them whole to edit them.
 */
function settingsForReaders(settings: ConnectorSettings): ConnectorSettings {
  return {
    ...settings,
    mcpServers: settings.mcpServers.map((server) => {
      const { args: _args, ...rest } = server;
      return server.url ? { ...rest, url: originOnly(server.url) } : rest;
    }),
  };
}

function originOnly(value: string): string {
  try {
    const url = new URL(value);
    const hidden = url.pathname !== "/" || url.search || url.hash;
    return hidden ? `${url.origin}/…` : url.origin;
  } catch {
    return "…";
  }
}

function errorFields(error: unknown): { error: string; errorCode?: string } {
  if (error instanceof ConnectorRequestError)
    return { error: error.message, errorCode: error.code };
  return { error: getErrorMessage(error) };
}

/** What this session may do beyond the per-RPC permission (`operation-permissions.ts`). */
export interface ConnectorSessionAccess {
  /** True for a session limited to some Projects (Managed Access). */
  isRestricted(): boolean;
  /** Holds `daemon.manage`: sees a server's full address and arguments, and lists its tools. */
  canManage(): boolean;
}

const UNRESTRICTED_MANAGER: ConnectorSessionAccess = {
  isRestricted: () => false,
  canManage: () => true,
};

export class ConnectorSession {
  constructor(
    private readonly service: ConnectorService,
    private readonly emit: Emit,
    private readonly logger: pino.Logger,
    private readonly access: ConnectorSessionAccess = UNRESTRICTED_MANAGER,
  ) {}

  private async reply<T>(
    requestType: ConnectorRequest["type"],
    work: () => Promise<T>,
    respond: (
      result: { ok: true; value: T } | { ok: false; error: unknown },
    ) => SessionOutboundMessage,
  ): Promise<void> {
    try {
      this.emit(respond({ ok: true, value: await work() }));
    } catch (error) {
      if (!(error instanceof ConnectorRequestError)) {
        this.logger.warn({ err: error, requestType }, "Connector request failed");
      }
      this.emit(respond({ ok: false, error }));
    }
  }

  handleSettingsGet(request: RequestOf<"connectors.settings.get.request">): Promise<void> {
    return this.reply(
      request.type,
      async () => {
        const settings = await this.service.settings();
        return this.access.canManage() ? settings : settingsForReaders(settings);
      },
      (result) => ({
        type: "connectors.settings.get.response",
        payload: result.ok
          ? { requestId: request.requestId, settings: result.value, error: null }
          : { requestId: request.requestId, settings: null, ...errorFields(result.error) },
      }),
    );
  }

  handleComposioKeySet(request: RequestOf<"connectors.composio.key.set.request">): Promise<void> {
    return this.reply(
      request.type,
      () => this.service.setComposioKey(request.apiKey),
      (result) => ({
        type: "connectors.composio.key.set.response",
        payload: result.ok
          ? { requestId: request.requestId, settings: result.value, error: null }
          : { requestId: request.requestId, settings: null, ...errorFields(result.error) },
      }),
    );
  }

  handleCatalogList(request: RequestOf<"connectors.catalog.list.request">): Promise<void> {
    const query = {
      ...(request.search ? { search: request.search } : {}),
      ...(request.category ? { category: request.category } : {}),
      ...(request.cursor ? { cursor: request.cursor } : {}),
    };
    return this.reply(
      request.type,
      () => this.service.catalogPage(query),
      (result) => ({
        type: "connectors.catalog.list.response",
        payload: result.ok
          ? {
              requestId: request.requestId,
              items: result.value.items,
              nextCursor: result.value.nextCursor,
              ...(result.value.totalItems !== undefined
                ? { totalItems: result.value.totalItems }
                : {}),
              error: null,
            }
          : { requestId: request.requestId, items: [], ...errorFields(result.error) },
      }),
    );
  }

  handleAccountsList(request: RequestOf<"connectors.accounts.list.request">): Promise<void> {
    return this.reply(
      request.type,
      () => this.service.accounts(request.slugs),
      (result) => ({
        type: "connectors.accounts.list.response",
        payload: result.ok
          ? { requestId: request.requestId, apps: result.value, error: null }
          : { requestId: request.requestId, apps: [], ...errorFields(result.error) },
      }),
    );
  }

  handleAccountConnect(request: RequestOf<"connectors.account.connect.request">): Promise<void> {
    return this.reply(
      request.type,
      () => this.service.connect(request.slug, request.alias),
      (result) => ({
        type: "connectors.account.connect.response",
        payload: result.ok
          ? {
              requestId: request.requestId,
              slug: request.slug,
              redirectUrl: result.value,
              error: null,
            }
          : {
              requestId: request.requestId,
              slug: request.slug,
              redirectUrl: null,
              ...errorFields(result.error),
            },
      }),
    );
  }

  handleAccountRemove(request: RequestOf<"connectors.account.remove.request">): Promise<void> {
    return this.reply(
      request.type,
      () => this.service.removeAccount(request.accountId),
      (result) => ({
        type: "connectors.account.remove.response",
        payload: result.ok
          ? {
              requestId: request.requestId,
              accountId: request.accountId,
              removed: true,
              error: null,
            }
          : {
              requestId: request.requestId,
              accountId: request.accountId,
              removed: false,
              ...errorFields(result.error),
            },
      }),
    );
  }

  handleMcpServerSave(request: RequestOf<"connectors.mcp_server.save.request">): Promise<void> {
    const input = {
      server: request.server,
      ...(request.previousName ? { previousName: request.previousName } : {}),
      ...(request.headers ? { headers: request.headers } : {}),
      ...(request.env ? { env: request.env } : {}),
    };
    return this.reply(
      request.type,
      () => this.service.saveMcpServer(input),
      (result) => ({
        type: "connectors.mcp_server.save.response",
        payload: result.ok
          ? { requestId: request.requestId, settings: result.value, error: null }
          : { requestId: request.requestId, settings: null, ...errorFields(result.error) },
      }),
    );
  }

  handleMcpServerRemove(request: RequestOf<"connectors.mcp_server.remove.request">): Promise<void> {
    return this.reply(
      request.type,
      () => this.service.removeMcpServer(request.name),
      (result) => ({
        type: "connectors.mcp_server.remove.response",
        payload: result.ok
          ? { requestId: request.requestId, settings: result.value, error: null }
          : { requestId: request.requestId, settings: null, ...errorFields(result.error) },
      }),
    );
  }

  handleToolsList(request: RequestOf<"connectors.tools.list.request">): Promise<void> {
    const target = {
      ...(request.app ? { app: request.app } : {}),
      ...(request.mcpServer ? { mcpServer: request.mcpServer } : {}),
    };
    return this.reply(
      request.type,
      async () => {
        // Listing a server's tools starts its command or calls it with the stored headers.
        if (request.mcpServer && !this.access.canManage()) {
          throw new ConnectorRequestError(
            "access_denied",
            "Only someone who manages this Host can list an MCP server's tools.",
          );
        }
        return this.service.tools(target);
      },
      (result) => ({
        type: "connectors.tools.list.response",
        payload: result.ok
          ? { requestId: request.requestId, tools: result.value, error: null }
          : { requestId: request.requestId, tools: [], ...errorFields(result.error) },
      }),
    );
  }

  handleProjectGrantsList(
    request: RequestOf<"connectors.project_grants.list.request">,
  ): Promise<void> {
    return this.reply(
      request.type,
      async () => ({
        grants: await this.service.projectGrants(),
        sessionAllows: await this.service.sessionAllows(),
      }),
      (result) => ({
        type: "connectors.project_grants.list.response",
        payload: result.ok
          ? {
              requestId: request.requestId,
              grants: result.value.grants,
              agentToolDefaults: this.service.agentToolDefaults(),
              // Agent ids of other Projects: only an unrestricted session sees them.
              ...(this.access.isRestricted() ? {} : { sessionAllows: result.value.sessionAllows }),
              error: null,
            }
          : { requestId: request.requestId, grants: [], ...errorFields(result.error) },
      }),
    );
  }

  /**
   * Connectors act with the Host owner's accounts, so a session limited to some Projects may not
   * grant them, even on a Project it fully manages; `daemon.manage` is checked before dispatch.
   */
  handleProjectGrantSet(request: RequestOf<"connectors.project_grant.set.request">): Promise<void> {
    return this.reply(
      request.type,
      async () => {
        if (this.access.isRestricted()) {
          throw new ConnectorRequestError(
            "access_denied",
            "Only the Host's owner or an Administrator can change which Connectors a Project may use.",
          );
        }
        return this.service.setProjectGrant(request.projectId, request.grant);
      },
      (result) => ({
        type: "connectors.project_grant.set.response",
        payload: result.ok
          ? { requestId: request.requestId, grant: result.value, error: null }
          : { requestId: request.requestId, grant: null, ...errorFields(result.error) },
      }),
    );
  }

  /** Same rights as changing the Project: a session's allows widen what its agent may use. */
  handleSessionAllowsSet(
    request: RequestOf<"connectors.session_allows.set.request">,
  ): Promise<void> {
    return this.reply(
      request.type,
      async () => {
        if (this.access.isRestricted()) {
          throw new ConnectorRequestError(
            "access_denied",
            "Only the Host's owner or an Administrator can let a session use more than its Project.",
          );
        }
        const owner = request.chatId ? chatAllowsKey(request.chatId) : request.agentId;
        if (!owner || (request.chatId && request.agentId)) {
          throw new ConnectorRequestError("invalid_request", "Name one agent or one Chat.");
        }
        return this.service.setSessionAllows(owner, request.allow);
      },
      (result) => ({
        type: "connectors.session_allows.set.response",
        payload: result.ok
          ? { requestId: request.requestId, allow: result.value, error: null }
          : { requestId: request.requestId, allow: null, ...errorFields(result.error) },
      }),
    );
  }
}

export function createConnectorSession(
  service: ConnectorService | undefined,
  emit: Emit,
  logger: pino.Logger,
  access: ConnectorSessionAccess,
): ConnectorSession | null {
  return service ? new ConnectorSession(service, emit, logger, access) : null;
}

/** Routes a `connectors.*` request, or answers `connectors_disabled`. Undefined for other messages. */
export function dispatchConnectorMessage(
  session: ConnectorSession | null,
  msg: SessionInboundMessage,
  emit: Emit,
): Promise<void> | undefined {
  if (!msg.type.startsWith("connectors.")) return undefined;
  const request = msg as ConnectorRequest;
  if (!session) return emitDisabled(request, emit);
  switch (request.type) {
    case "connectors.settings.get.request":
      return session.handleSettingsGet(request);
    case "connectors.composio.key.set.request":
      return session.handleComposioKeySet(request);
    case "connectors.catalog.list.request":
      return session.handleCatalogList(request);
    case "connectors.accounts.list.request":
      return session.handleAccountsList(request);
    case "connectors.account.connect.request":
      return session.handleAccountConnect(request);
    case "connectors.account.remove.request":
      return session.handleAccountRemove(request);
    case "connectors.mcp_server.save.request":
      return session.handleMcpServerSave(request);
    case "connectors.mcp_server.remove.request":
      return session.handleMcpServerRemove(request);
    case "connectors.tools.list.request":
      return session.handleToolsList(request);
    case "connectors.project_grants.list.request":
      return session.handleProjectGrantsList(request);
    case "connectors.project_grant.set.request":
      return session.handleProjectGrantSet(request);
    case "connectors.session_allows.set.request":
      return session.handleSessionAllowsSet(request);
    default:
      return undefined;
  }
}

async function emitDisabled(request: ConnectorRequest, emit: Emit): Promise<void> {
  emit({
    type: "rpc_error",
    payload: {
      requestId: request.requestId,
      requestType: request.type,
      error: "Connectors are not enabled on this Host (daemon.connectors.enabled).",
      code: "connectors_disabled",
    },
  });
}
