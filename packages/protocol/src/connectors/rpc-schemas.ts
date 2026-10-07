import { z } from "zod";
import {
  ConnectorAppStateSchema,
  ConnectorCatalogItemSchema,
  ConnectorMcpServerSchema,
  ConnectorSettingsSchema,
  ConnectorGrantSchema,
  ConnectorToolSchema,
  ProjectConnectorGrantSchema,
} from "./types.js";

/**
 * `connectors.*` RPCs (docs/features/connectors/README.md). Gated once on
 * `server_info.features.connectors`; a daemon with the flag off answers
 * `rpc_error connectors_disabled`. Every reply carries `error` and an optional `errorCode`.
 */

const ErrorFields = {
  error: z.string().nullable(),
  errorCode: z.string().optional(),
};

export const ConnectorsSettingsGetRequestSchema = z.object({
  type: z.literal("connectors.settings.get.request"),
  requestId: z.string(),
});

export const ConnectorsSettingsGetResponseSchema = z.object({
  type: z.literal("connectors.settings.get.response"),
  payload: z.object({
    requestId: z.string(),
    settings: ConnectorSettingsSchema.nullable(),
    ...ErrorFields,
  }),
});

/** `apiKey: null` removes the key; the daemon checks a new key against Composio first. */
export const ConnectorsComposioKeySetRequestSchema = z.object({
  type: z.literal("connectors.composio.key.set.request"),
  requestId: z.string(),
  apiKey: z.string().nullable(),
});

export const ConnectorsComposioKeySetResponseSchema = z.object({
  type: z.literal("connectors.composio.key.set.response"),
  payload: z.object({
    requestId: z.string(),
    settings: ConnectorSettingsSchema.nullable(),
    ...ErrorFields,
  }),
});

export const ConnectorsCatalogListRequestSchema = z.object({
  type: z.literal("connectors.catalog.list.request"),
  requestId: z.string(),
  search: z.string().optional(),
  category: z.string().optional(),
  cursor: z.string().optional(),
});

export const ConnectorsCatalogListResponseSchema = z.object({
  type: z.literal("connectors.catalog.list.response"),
  payload: z.object({
    requestId: z.string(),
    items: z.array(ConnectorCatalogItemSchema),
    nextCursor: z.string().nullable().optional(),
    /** Composio's count of the whole catalog, when it reports one. */
    totalItems: z.number().optional(),
    ...ErrorFields,
  }),
});

/** Accounts per app. No `slugs` means every app with at least one account. */
export const ConnectorsAccountsListRequestSchema = z.object({
  type: z.literal("connectors.accounts.list.request"),
  requestId: z.string(),
  slugs: z.array(z.string()).optional(),
});

export const ConnectorsAccountsListResponseSchema = z.object({
  type: z.literal("connectors.accounts.list.response"),
  payload: z.object({
    requestId: z.string(),
    apps: z.array(ConnectorAppStateSchema),
    ...ErrorFields,
  }),
});

/** Starts a sign-in; the app opens `redirectUrl` in the browser and polls the accounts. */
export const ConnectorsAccountConnectRequestSchema = z.object({
  type: z.literal("connectors.account.connect.request"),
  requestId: z.string(),
  slug: z.string(),
  alias: z.string().optional(),
});

export const ConnectorsAccountConnectResponseSchema = z.object({
  type: z.literal("connectors.account.connect.response"),
  payload: z.object({
    requestId: z.string(),
    slug: z.string(),
    redirectUrl: z.string().nullable(),
    ...ErrorFields,
  }),
});

export const ConnectorsAccountRemoveRequestSchema = z.object({
  type: z.literal("connectors.account.remove.request"),
  requestId: z.string(),
  accountId: z.string(),
});

export const ConnectorsAccountRemoveResponseSchema = z.object({
  type: z.literal("connectors.account.remove.response"),
  payload: z.object({
    requestId: z.string(),
    accountId: z.string(),
    removed: z.boolean(),
    ...ErrorFields,
  }),
});

/**
 * Adds or edits one MCP server. Secret values travel only on this request: a string sets
 * one, `null` deletes one, an absent name keeps what the Host stores.
 */
export const ConnectorsMcpServerSaveRequestSchema = z.object({
  type: z.literal("connectors.mcp_server.save.request"),
  requestId: z.string(),
  /** The name being edited, when the edit renames it. */
  previousName: z.string().optional(),
  server: ConnectorMcpServerSchema.omit({ headerKeys: true, envKeys: true }),
  headers: z.record(z.string(), z.string().nullable()).optional(),
  env: z.record(z.string(), z.string().nullable()).optional(),
});

export const ConnectorsMcpServerSaveResponseSchema = z.object({
  type: z.literal("connectors.mcp_server.save.response"),
  payload: z.object({
    requestId: z.string(),
    settings: ConnectorSettingsSchema.nullable(),
    ...ErrorFields,
  }),
});

export const ConnectorsMcpServerRemoveRequestSchema = z.object({
  type: z.literal("connectors.mcp_server.remove.request"),
  requestId: z.string(),
  name: z.string(),
});

export const ConnectorsMcpServerRemoveResponseSchema = z.object({
  type: z.literal("connectors.mcp_server.remove.response"),
  payload: z.object({
    requestId: z.string(),
    settings: ConnectorSettingsSchema.nullable(),
    ...ErrorFields,
  }),
});

/** The tools of one app or one MCP server, for the grant's tool picker and the detail page. */
export const ConnectorsToolsListRequestSchema = z.object({
  type: z.literal("connectors.tools.list.request"),
  requestId: z.string(),
  app: z.string().optional(),
  mcpServer: z.string().optional(),
});

export const ConnectorsToolsListResponseSchema = z.object({
  type: z.literal("connectors.tools.list.response"),
  payload: z.object({
    requestId: z.string(),
    tools: z.array(ConnectorToolSchema),
    ...ErrorFields,
  }),
});

/** Every Project's grant on this Host, for Bot settings, Project settings and "Used by". */
export const ConnectorsProjectGrantsListRequestSchema = z.object({
  type: z.literal("connectors.project_grants.list.request"),
  requestId: z.string(),
});

export const ConnectorsProjectGrantsListResponseSchema = z.object({
  type: z.literal("connectors.project_grants.list.response"),
  payload: z.object({
    requestId: z.string(),
    grants: z.array(ProjectConnectorGrantSchema),
    /** What a Project without its own choice gets: the Host's agent tool settings. */
    agentToolDefaults: z.object({ agentTools: z.boolean(), browserTools: z.boolean() }).optional(),
    /** Tools single sessions may use beyond their Project's grant, by agent id. */
    sessionAllows: z.record(z.string(), z.array(z.string())).optional(),
    ...ErrorFields,
  }),
});

/** `grant: null` removes every Connector from the Project. */
export const ConnectorsProjectGrantSetRequestSchema = z.object({
  type: z.literal("connectors.project_grant.set.request"),
  requestId: z.string(),
  projectId: z.string(),
  grant: ConnectorGrantSchema.nullable(),
});

export const ConnectorsProjectGrantSetResponseSchema = z.object({
  type: z.literal("connectors.project_grant.set.response"),
  payload: z.object({
    requestId: z.string(),
    grant: ConnectorGrantSchema.nullable(),
    ...ErrorFields,
  }),
});

/**
 * The tools one session, or every session of one Chat, may use beyond the Project's grant, as
 * off-list keys (`gmail/GMAIL_SEND`, `mcp:notes/send_note`, `tool:create_agent`). Kept by the
 * daemon, not in a label, so the agent cannot widen its own access. Name the agent or the Chat;
 * an empty list removes them. A Chat's are listed under `chat:<chatId>`.
 */
export const ConnectorsSessionAllowsSetRequestSchema = z.object({
  type: z.literal("connectors.session_allows.set.request"),
  requestId: z.string(),
  agentId: z.string().optional(),
  chatId: z.string().optional(),
  allow: z.array(z.string()),
});

/** The key a Chat's allows are kept under in `sessionAllows`. */
export function chatAllowsKey(chatId: string): string {
  return `chat:${chatId}`;
}

export const ConnectorsSessionAllowsSetResponseSchema = z.object({
  type: z.literal("connectors.session_allows.set.response"),
  payload: z.object({
    requestId: z.string(),
    allow: z.array(z.string()).nullable(),
    ...ErrorFields,
  }),
});

export type ConnectorsSettingsGetRequest = z.infer<typeof ConnectorsSettingsGetRequestSchema>;
export type ConnectorsSettingsGetResponse = z.infer<typeof ConnectorsSettingsGetResponseSchema>;
export type ConnectorsComposioKeySetRequest = z.infer<typeof ConnectorsComposioKeySetRequestSchema>;
export type ConnectorsComposioKeySetResponse = z.infer<
  typeof ConnectorsComposioKeySetResponseSchema
>;
export type ConnectorsCatalogListRequest = z.infer<typeof ConnectorsCatalogListRequestSchema>;
export type ConnectorsCatalogListResponse = z.infer<typeof ConnectorsCatalogListResponseSchema>;
export type ConnectorsAccountsListRequest = z.infer<typeof ConnectorsAccountsListRequestSchema>;
export type ConnectorsAccountsListResponse = z.infer<typeof ConnectorsAccountsListResponseSchema>;
export type ConnectorsAccountConnectRequest = z.infer<typeof ConnectorsAccountConnectRequestSchema>;
export type ConnectorsAccountConnectResponse = z.infer<
  typeof ConnectorsAccountConnectResponseSchema
>;
export type ConnectorsAccountRemoveRequest = z.infer<typeof ConnectorsAccountRemoveRequestSchema>;
export type ConnectorsAccountRemoveResponse = z.infer<typeof ConnectorsAccountRemoveResponseSchema>;
export type ConnectorsMcpServerSaveRequest = z.infer<typeof ConnectorsMcpServerSaveRequestSchema>;
export type ConnectorsMcpServerSaveResponse = z.infer<typeof ConnectorsMcpServerSaveResponseSchema>;
export type ConnectorsMcpServerRemoveRequest = z.infer<
  typeof ConnectorsMcpServerRemoveRequestSchema
>;
export type ConnectorsMcpServerRemoveResponse = z.infer<
  typeof ConnectorsMcpServerRemoveResponseSchema
>;
export type ConnectorsToolsListRequest = z.infer<typeof ConnectorsToolsListRequestSchema>;
export type ConnectorsToolsListResponse = z.infer<typeof ConnectorsToolsListResponseSchema>;
export type ConnectorsProjectGrantsListRequest = z.infer<
  typeof ConnectorsProjectGrantsListRequestSchema
>;
export type ConnectorsProjectGrantsListResponse = z.infer<
  typeof ConnectorsProjectGrantsListResponseSchema
>;
export type ConnectorsProjectGrantSetRequest = z.infer<
  typeof ConnectorsProjectGrantSetRequestSchema
>;
export type ConnectorsProjectGrantSetResponse = z.infer<
  typeof ConnectorsProjectGrantSetResponseSchema
>;

/** Every `connectors.*` request type, for the session dispatcher and the permission map. */
export const CONNECTOR_REQUEST_TYPES = [
  "connectors.settings.get.request",
  "connectors.composio.key.set.request",
  "connectors.catalog.list.request",
  "connectors.accounts.list.request",
  "connectors.account.connect.request",
  "connectors.account.remove.request",
  "connectors.mcp_server.save.request",
  "connectors.mcp_server.remove.request",
  "connectors.tools.list.request",
  "connectors.project_grants.list.request",
  "connectors.project_grant.set.request",
  "connectors.session_allows.set.request",
] as const;
export type ConnectorRequestType = (typeof CONNECTOR_REQUEST_TYPES)[number];
