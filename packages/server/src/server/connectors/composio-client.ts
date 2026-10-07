import { z } from "zod";
import type { ConnectorAccount, ConnectorCatalogItem } from "@clisbot/protocol/connectors/types";
import { errorTextOf } from "./connector-json.js";

/**
 * Composio's REST API, called with `fetch` (no SDK: `@composio/core` is still 0.x). One
 * project key authenticates every call as `x-api-key`. One Tool Router session per Host
 * carries every connected account of the Host's Composio user; Bots are told apart by the
 * relay, not by Composio. Shapes are parsed loosely so a new field never breaks the Host.
 */

const SessionSchema = z.object({
  session_id: z.string().min(1),
  mcp: z.object({ type: z.string().optional(), url: z.string().min(1) }),
  config: z
    .object({
      user_id: z.string().optional(),
      auth_configs: z.record(z.string(), z.string()).nullable().optional(),
    })
    .passthrough()
    .optional(),
});
export type ComposioSession = z.infer<typeof SessionSchema>;

const AuthConfigPageSchema = z.object({
  items: z
    .array(
      z
        .object({
          id: z.string().optional(),
          status: z.string().nullable().optional(),
          is_composio_managed: z.boolean().optional(),
          is_enabled_for_tool_router: z.boolean().nullable().optional(),
          last_updated_at: z.string().nullable().optional(),
          toolkit: z.object({ slug: z.string().optional() }).passthrough().optional(),
        })
        .passthrough(),
    )
    .optional(),
  next_cursor: z.string().nullable().optional(),
});

/** App slug → the project's own auth config the session signs in with. */
export type AuthConfigMap = Record<string, string>;

/**
 * Whether a session already signs in with every wanted auth config. A session names its auth
 * configs when it is created and cannot change them, so a config made later needs a new session.
 */
export function sessionCoversAuthConfigs(session: ComposioSession, wanted: AuthConfigMap): boolean {
  const have = new Map(
    Object.entries(session.config?.auth_configs ?? {}).map(([slug, id]) => [
      slug.toLowerCase(),
      id,
    ]),
  );
  return Object.entries(wanted).every(([slug, id]) => have.get(slug) === id);
}

const CategorySchema = z.union([
  z.string(),
  z.object({ name: z.string().optional() }).passthrough(),
]);
const ToolkitSchema = z
  .object({
    slug: z.string().optional(),
    name: z.string().optional(),
    description: z.string().nullable().optional(),
    logo: z.string().nullable().optional(),
    no_auth: z.boolean().optional(),
    is_no_auth: z.boolean().optional(),
    tools_count: z.number().optional(),
    categories: z.array(CategorySchema).optional(),
    meta: z
      .object({
        description: z.string().nullable().optional(),
        logo: z.string().nullable().optional(),
        tools_count: z.number().optional(),
        categories: z.array(CategorySchema).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
const ToolkitPageSchema = z.object({
  items: z.array(ToolkitSchema).optional(),
  next_cursor: z.string().nullable().optional(),
  total_items: z.number().optional(),
});

const AccountSchema = z
  .object({
    id: z.string().optional(),
    alias: z.string().nullable().optional(),
    status: z.string().optional(),
    updated_at: z.string().optional(),
    toolkit: z.object({ slug: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();
const AccountPageSchema = z.object({
  items: z.array(AccountSchema),
  next_cursor: z.string().nullable().optional(),
});

const ToolSchema = z
  .object({
    slug: z.string().optional(),
    name: z.string().optional(),
    description: z.string().nullable().optional(),
    /** MCP-style hints such as `readOnlyHint`, mixed with Composio's own categories. */
    tags: z.array(z.string()).nullable().optional(),
  })
  .passthrough();
const ToolPageSchema = z.object({
  items: z.array(ToolSchema).optional(),
  next_cursor: z.string().nullable().optional(),
});

const LinkSchema = z.object({ redirect_url: z.string().optional() }).passthrough();

const MAX_PAGES = 50;
const ACCOUNT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const REQUEST_TIMEOUT_MS = 30_000;

export interface ComposioToolInfo {
  name: string;
  title?: string;
  description?: string;
  readOnly?: boolean;
}

export class ComposioError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ComposioError";
  }
}

export type ComposioFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface ComposioCatalogPage {
  items: ConnectorCatalogItem[];
  nextCursor: string | null;
  totalItems?: number;
}

export interface ComposioAccount extends ConnectorAccount {
  slug: string;
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body: unknown = await response.json().catch(() => undefined);
  return errorTextOf(body) ?? fallback;
}

function categoryNames(values: z.infer<typeof CategorySchema>[] | undefined): string[] | undefined {
  const names = (values ?? [])
    .map((value) => (typeof value === "string" ? value : value.name))
    .filter((name): name is string => Boolean(name));
  return names.length ? names : undefined;
}

function httpsLogo(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Composio's own toolkit: its meta-tools (search, connections) are the relay's plumbing, which the
 * relay already offers every session, not an app a person connects or grants.
 */
const COMPOSIO_TOOLKIT = "composio";

function toCatalogItem(toolkit: z.infer<typeof ToolkitSchema>): ConnectorCatalogItem | null {
  const slug = toolkit.slug?.trim().toLowerCase();
  if (!slug) return null;
  const description = toolkit.meta?.description ?? toolkit.description ?? undefined;
  const logo = httpsLogo(toolkit.meta?.logo ?? toolkit.logo);
  const categories = categoryNames(toolkit.meta?.categories ?? toolkit.categories);
  const toolsCount = toolkit.meta?.tools_count ?? toolkit.tools_count;
  return {
    slug,
    name: toolkit.name?.trim() || slug,
    ...(description ? { description: description.slice(0, 200) } : {}),
    ...(logo ? { logo } : {}),
    ...(categories ? { categories } : {}),
    ...(toolsCount !== undefined ? { toolsCount } : {}),
    ...(toolkit.no_auth === true || toolkit.is_no_auth === true ? { noAuth: true } : {}),
  };
}

export class ComposioClient {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: ComposioFetch;

  constructor(options: { apiUrl: string; apiKey: string; fetch?: ComposioFetch }) {
    this.apiUrl = options.apiUrl;
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  }

  private async request(
    pathAndQuery: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "x-api-key": this.apiKey,
      accept: "application/json",
    };
    if (init.body !== undefined) headers["content-type"] = "application/json";
    const response = await this.fetchImpl(`${this.apiUrl}${pathAndQuery}`, {
      method: init.method ?? "GET",
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new ComposioError(
        response.status,
        await errorMessage(response, `Composio answered HTTP ${response.status}`),
      );
    }
    return response;
  }

  /**
   * A session for this Host's Composio user. Several accounts per app; Composio's own
   * connect flow stays on so it can list accounts, but the relay refuses connect/remove.
   */
  async createSession(userId: string, authConfigs: AuthConfigMap = {}): Promise<ComposioSession> {
    const response = await this.request("/tool_router/session", {
      method: "POST",
      body: {
        user_id: userId,
        ...(Object.keys(authConfigs).length ? { auth_configs: authConfigs } : {}),
        manage_connections: {
          enable: true,
          enable_wait_for_connections: false,
          enable_connection_removal: false,
        },
        multi_account: {
          enable: true,
          max_accounts_per_toolkit: 5,
          require_explicit_selection: true,
        },
      },
    });
    return SessionSchema.parse(await response.json());
  }

  /**
   * The project's own auth configs (its own OAuth app, or an app Composio has no managed sign-in
   * for), one per app; the newest wins. Disabled ones and ones kept out of sessions are skipped.
   */
  async listCustomAuthConfigs(): Promise<AuthConfigMap> {
    const chosen = new Map<string, { id: string; updated: string }>();
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const params = new URLSearchParams({ is_composio_managed: "false", limit: "100" });
      if (cursor) params.set("cursor", cursor);
      const response = await this.request(`/auth_configs?${params}`);
      const body = AuthConfigPageSchema.parse(await response.json());
      for (const item of body.items ?? []) {
        const slug = item.toolkit?.slug?.toLowerCase();
        if (!slug || !item.id || item.is_composio_managed === true) continue;
        if (item.is_enabled_for_tool_router === false) continue;
        if (item.status && /^(disabled|inactive|expired|deleted)$/i.test(item.status)) continue;
        const updated = item.last_updated_at ?? "";
        const current = chosen.get(slug);
        if (!current || updated > current.updated) chosen.set(slug, { id: item.id, updated });
      }
      const next = body.next_cursor || undefined;
      if (!next || next === cursor) break;
      cursor = next;
    }
    return Object.fromEntries([...chosen].sort().map(([slug, { id }]) => [slug, id]));
  }

  async getSession(sessionId: string): Promise<ComposioSession | null> {
    try {
      const response = await this.request(`/tool_router/session/${encodeURIComponent(sessionId)}`);
      return SessionSchema.parse(await response.json());
    } catch (error) {
      if (error instanceof ComposioError && error.status === 404) return null;
      throw error;
    }
  }

  async listToolkits(options: {
    cursor?: string;
    search?: string;
    category?: string;
    limit: number;
  }): Promise<ComposioCatalogPage> {
    const params = new URLSearchParams({ limit: String(options.limit), sort_by: "usage" });
    if (options.cursor) params.set("cursor", options.cursor);
    if (options.search) params.set("search", options.search);
    if (options.category) params.set("category", options.category);
    const response = await this.request(`/toolkits?${params}`);
    const page = ToolkitPageSchema.parse(await response.json());
    return {
      items: (page.items ?? [])
        .map(toCatalogItem)
        .filter((item): item is ConnectorCatalogItem => item !== null)
        .filter((item) => item.slug !== COMPOSIO_TOOLKIT),
      nextCursor: page.next_cursor?.trim() || null,
      ...(page.total_items !== undefined ? { totalItems: page.total_items } : {}),
    };
  }

  /** Every account of one Composio user, newest first, following the cursor. */
  async listAccounts(userId: string, slugs?: readonly string[]): Promise<ComposioAccount[]> {
    const accounts: ComposioAccount[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const params = new URLSearchParams({
        user_ids: userId,
        limit: "100",
        order_by: "updated_at",
        order_direction: "desc",
      });
      if (slugs?.length) params.set("toolkit_slugs", slugs.join(","));
      if (cursor) params.set("cursor", cursor);
      const response = await this.request(`/connected_accounts?${params}`);
      const body = AccountPageSchema.parse(await response.json());
      for (const item of body.items) {
        const slug = item.toolkit?.slug?.toLowerCase();
        if (!slug || !item.id || !ACCOUNT_ID.test(item.id)) continue;
        const alias = item.alias?.trim();
        accounts.push({
          slug,
          id: item.id,
          status: item.status?.toUpperCase() || "UNKNOWN",
          ...(alias ? { alias } : {}),
          ...(item.updated_at ? { updatedAt: item.updated_at } : {}),
        });
      }
      const next = body.next_cursor || undefined;
      if (!next || seen.has(next)) return accounts;
      seen.add(next);
      cursor = next;
    }
    return accounts;
  }

  /** Starts a sign-in for one app; the URL opens in the person's browser. */
  async link(sessionId: string, toolkit: string, alias?: string): Promise<string> {
    const response = await this.request(
      `/tool_router/session/${encodeURIComponent(sessionId)}/link`,
      { method: "POST", body: { toolkit, ...(alias ? { alias } : {}) } },
    );
    const url = LinkSchema.parse(await response.json()).redirect_url;
    if (!url) throw new ComposioError(502, "Composio returned no sign-in link.");
    return url;
  }

  async removeAccount(accountId: string): Promise<void> {
    if (!ACCOUNT_ID.test(accountId)) throw new ComposioError(400, "That is not an account id.");
    await this.request(
      `/connected_accounts/${encodeURIComponent(accountId)}?revoke_on_delete=true`,
      { method: "DELETE" },
    );
  }

  async listTools(toolkit: string): Promise<ComposioToolInfo[]> {
    const tools: ComposioToolInfo[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const params = new URLSearchParams({ toolkit_slug: toolkit, limit: "1000" });
      if (cursor) params.set("cursor", cursor);
      const response = await this.request(`/tools?${params}`);
      const body = ToolPageSchema.parse(await response.json());
      for (const item of body.items ?? []) {
        const name = item.slug ?? item.name;
        if (!name) continue;
        const title = item.slug && item.name && item.name !== item.slug ? item.name : undefined;
        tools.push({
          name,
          ...(title ? { title } : {}),
          ...(item.description ? { description: item.description } : {}),
          // Tags present without `readOnlyHint`: Composio says the tool changes data.
          ...(item.tags ? { readOnly: item.tags.includes("readOnlyHint") } : {}),
        });
      }
      const next = body.next_cursor || undefined;
      if (!next || next === cursor) break;
      cursor = next;
    }
    return tools.sort((left, right) => left.name.localeCompare(right.name));
  }

  /** Forwards one MCP frame to the session; the caller relays the raw answer. */
  postMcp(params: {
    url: string;
    body: string;
    headers: Record<string, string>;
    signal?: AbortSignal;
  }): Promise<Response> {
    return this.fetchImpl(params.url, {
      method: "POST",
      headers: { ...params.headers, "x-api-key": this.apiKey },
      body: params.body,
      ...(params.signal ? { signal: params.signal } : {}),
    });
  }
}

/**
 * A Composio address Clisbot trusts: https on Composio's own hosts, or the configured API's host
 * (a local stand-in). Clisbot sends the project key only to a session URL that passes, and opens
 * only a sign-in link that passes; a link elsewhere could be a look-alike sign-in page.
 */
export function isComposioUrl(value: string, apiUrl: string): boolean {
  try {
    const url = new URL(value);
    const api = new URL(apiUrl);
    // The configured API host (a local stand-in in tests) only over the API's own protocol.
    if (url.host === api.host) return url.protocol === api.protocol;
    return (
      url.protocol === "https:" &&
      (url.hostname === "composio.dev" || url.hostname.endsWith(".composio.dev"))
    );
  } catch {
    return false;
  }
}
