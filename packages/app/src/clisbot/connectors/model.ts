import { connectorAccessOf, connectorAppTitle } from "@clisbot/protocol/connectors/types";
import { i18n } from "@/i18n/i18next";
import type {
  ConnectorGrant,
  ProjectConnectorGrant,
  ConnectorAccess,
  ConnectorAccount,
  ConnectorAppState,
  ConnectorCatalogItem,
  ConnectorToolSelection,
} from "@clisbot/protocol/connectors/types";

/**
 * Pure rules behind the Connectors screen and the grant editor
 * (docs/features/connectors/README.md). No React, no client: everything here is unit-tested.
 * Labels resolve through `i18n` when they are read, so they follow the app's language.
 */

export type ConnectorFilter = "all" | "connected" | "mcp";

export type AppConnectionState = "connected" | "pending" | "attention" | "none";

const PENDING = /^(INITIATED|INITIALIZING|PENDING)$/;
const BROKEN = /^(FAILED|EXPIRED|INACTIVE)$/;

export function accountState(account: ConnectorAccount): AppConnectionState {
  if (account.status === "ACTIVE") return "connected";
  if (PENDING.test(account.status)) return "pending";
  if (BROKEN.test(account.status)) return "attention";
  return "none";
}

/** One app's state: any working account wins, then a sign-in in progress, then a broken one. */
export function appState(accounts: readonly ConnectorAccount[] | undefined): AppConnectionState {
  const states = new Set((accounts ?? []).map(accountState));
  if (states.has("connected")) return "connected";
  if (states.has("pending")) return "pending";
  if (states.has("attention")) return "attention";
  return "none";
}

export const APP_STATE_LABELS: Record<AppConnectionState, string> = {
  get connected() {
    return i18n.t("connectors.screen.common.connected");
  },
  get pending() {
    return i18n.t("connectors.screen.common.waitingForSignIn");
  },
  get attention() {
    return i18n.t("connectors.screen.common.signInAgain");
  },
  none: "",
};

export const APP_STATE_VARIANTS: Record<
  AppConnectionState,
  "success" | "warning" | "error" | "muted"
> = {
  connected: "success",
  pending: "warning",
  attention: "error",
  none: "muted",
};

export function accountLabel(account: ConnectorAccount): string {
  return account.alias ?? i18n.t("connectors.screen.model.defaultAccount");
}

export const ACCOUNT_STATUS_LABELS: Record<AppConnectionState, string> = {
  get connected() {
    return i18n.t("connectors.screen.common.connected");
  },
  get pending() {
    return i18n.t("connectors.screen.common.waitingForSignIn");
  },
  get attention() {
    return i18n.t("connectors.screen.model.expired");
  },
  get none() {
    return i18n.t("connectors.screen.model.unknown");
  },
};

/** "Read only" or "Read and write". */
export function accessLabel(access: ConnectorAccess): string {
  return access === "write"
    ? i18n.t("connectors.screen.common.readWrite")
    : i18n.t("connectors.screen.common.readOnly");
}

/** True while any account waits for its sign-in to finish, so the screen keeps polling. */
export function hasPendingAccount(apps: readonly ConnectorAppState[]): boolean {
  return apps.some((app) => app.accounts.some((account) => accountState(account) === "pending"));
}

/** Connected apps first (in catalog order), then the rest; a search keeps catalog order. */
export function orderCatalog(
  items: readonly ConnectorCatalogItem[],
  accounts: ReadonlyMap<string, ConnectorAppState>,
): { connected: ConnectorCatalogItem[]; others: ConnectorCatalogItem[] } {
  const connected: ConnectorCatalogItem[] = [];
  const others: ConnectorCatalogItem[] = [];
  for (const item of items) {
    if (appState(accounts.get(item.slug)?.accounts) === "none") others.push(item);
    else connected.push(item);
  }
  return { connected, others };
}

/**
 * Apps with an account that the catalog page does not contain (a long-tail app connected
 * earlier), so the Connected filter never hides an app the person has signed in to.
 */
export function connectedOutsideCatalog(
  items: readonly ConnectorCatalogItem[],
  accounts: readonly ConnectorAppState[],
): ConnectorCatalogItem[] {
  const known = new Set(items.map((item) => item.slug));
  return accounts
    .filter((app) => !known.has(app.slug) && appState(app.accounts) !== "none")
    .map((app) => ({ slug: app.slug, name: connectorAppTitle(app.slug) }));
}

export function matchesSearch(item: { name: string; slug?: string }, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return item.name.toLowerCase().includes(needle) || (item.slug ?? "").includes(needle);
}

/** "All 38 tools", "6 of 412 tools", "No tools". */
export function toolSelectionLabel(selection: ConnectorToolSelection, total?: number): string {
  if (selection === "all") {
    return total === undefined
      ? i18n.t("connectors.screen.model.allTools")
      : i18n.t("connectors.screen.model.allToolsCount", { count: total });
  }
  if (selection.length === 0) return i18n.t("connectors.screen.model.noTools");
  return total === undefined
    ? i18n.t("connectors.screen.model.selectedTools", { count: selection.length })
    : i18n.t("connectors.screen.model.selectedOf", { count: total, selected: selection.length });
}

/**
 * A tool's readable name: the title the app gives, else the name with the app prefix
 * dropped and the words spaced ("GMAIL_SEND_EMAIL" → "Send email", "listIssues" → "List issues").
 */
export function toolTitle(tool: { name: string; title?: string }, toolkit?: string): string {
  if (tool.title?.trim()) return tool.title.trim();
  let action = tool.name;
  if (toolkit && action.toUpperCase().startsWith(`${toolkit.toUpperCase()}_`)) {
    action = action.slice(toolkit.length + 1);
  }
  const words = action
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  if (words.length === 0) return tool.name;
  const sentence = words.join(" ");
  return sentence[0]!.toUpperCase() + sentence.slice(1);
}

// ── Grants ──────────────────────────────────────────────────────────────

/** One Project granted an app or server; a Bot's Project carries the Bot's id and name. */
export interface ConnectorUse {
  projectId: string;
  name: string;
  /** Set when the Project is a Bot's home: Edit opens the Bot's settings. */
  botId?: string;
  /** False while the Project has this app or server turned off. */
  enabled: boolean;
  access?: ConnectorAccess;
  tools: ConnectorToolSelection;
}

export interface ConnectorOwner {
  name: string;
  botId?: string;
}

/** The Projects granted one app (or MCP server) and how, for the detail page's Used by. */
export function connectorUses(
  grants: readonly ProjectConnectorGrant[],
  owners: ReadonlyMap<string, ConnectorOwner>,
  target: { app: string } | { mcpServer: string },
): ConnectorUse[] {
  const uses: ConnectorUse[] = [];
  for (const { projectId, grant } of grants) {
    const app = "app" in target ? grant.apps?.[target.app] : undefined;
    const entry = "app" in target ? app : grant.mcpServers?.[target.mcpServer];
    if (!entry) continue;
    const owner = owners.get(projectId);
    uses.push({
      projectId,
      name: owner?.name ?? i18n.t("connectors.screen.model.unknownProject"),
      ...(owner?.botId ? { botId: owner.botId } : {}),
      enabled: entry.enabled !== false,
      ...(app ? { access: connectorAccessOf(app.access) } : {}),
      tools: entry.tools,
    });
  }
  return uses.sort((left, right) => left.name.localeCompare(right.name));
}

/** New app grants start read-only with every tool: the safe default, widened on purpose. */
type AppGrant = NonNullable<ConnectorGrant["apps"]>[string];
type ServerGrant = NonNullable<ConnectorGrant["mcpServers"]>[string];

/*
 * Each edit changes only what it names, so it can be applied to the Host's grant as it is when
 * saved (`editProjectGrant`): adding keeps an entry another device already set up, and changing
 * an entry another device removed leaves it removed.
 */

export function grantApp(grant: ConnectorGrant | undefined, slug: string): ConnectorGrant {
  const app = grant?.apps?.[slug] ?? { tools: "all" as const, access: "read" as const };
  return { ...grant, apps: { ...grant?.apps, [slug]: app } };
}

export function grantMcpServer(grant: ConnectorGrant | undefined, name: string): ConnectorGrant {
  const server = grant?.mcpServers?.[name] ?? { tools: "all" as const };
  return { ...grant, mcpServers: { ...grant?.mcpServers, [name]: server } };
}

export function revokeApp(grant: ConnectorGrant | undefined, slug: string): ConnectorGrant {
  const apps = { ...grant?.apps };
  delete apps[slug];
  return { ...grant, apps };
}

export function revokeMcpServer(grant: ConnectorGrant | undefined, name: string): ConnectorGrant {
  const mcpServers = { ...grant?.mcpServers };
  delete mcpServers[name];
  return { ...grant, mcpServers };
}

function editApp(
  grant: ConnectorGrant | undefined,
  slug: string,
  change: (app: AppGrant) => AppGrant,
): ConnectorGrant {
  const current = grant?.apps?.[slug];
  if (!current) return { ...grant };
  return { ...grant, apps: { ...grant?.apps, [slug]: change(current) } };
}

function editServer(
  grant: ConnectorGrant | undefined,
  name: string,
  change: (server: ServerGrant) => ServerGrant,
): ConnectorGrant {
  const current = grant?.mcpServers?.[name];
  if (!current) return { ...grant };
  return { ...grant, mcpServers: { ...grant?.mcpServers, [name]: change(current) } };
}

export function setAppAccess(
  grant: ConnectorGrant | undefined,
  slug: string,
  access: ConnectorAccess,
): ConnectorGrant {
  return editApp(grant, slug, (app) => ({ ...app, access }));
}

/** Pause or resume one app for a Project; its access and tools stay as they were. */
export function setAppEnabled(
  grant: ConnectorGrant | undefined,
  slug: string,
  enabled: boolean,
): ConnectorGrant {
  return editApp(grant, slug, ({ enabled: _previous, ...rest }) =>
    enabled ? rest : { ...rest, enabled: false },
  );
}

export function setMcpServerEnabled(
  grant: ConnectorGrant | undefined,
  name: string,
  enabled: boolean,
): ConnectorGrant {
  return editServer(grant, name, ({ enabled: _previous, ...rest }) =>
    enabled ? rest : { ...rest, enabled: false },
  );
}

/** "All accounts", "work", "2 accounts". */
export function accountSelectionLabel(
  selection: "all" | string[] | undefined,
  accounts: readonly ConnectorAccount[],
): string {
  if (selection === undefined || selection === "all") {
    return i18n.t("connectors.screen.model.allAccounts");
  }
  if (selection.length === 0) return i18n.t("connectors.screen.model.noAccount");
  const only =
    selection.length === 1 ? accounts.find((candidate) => candidate.id === selection[0]) : null;
  return only
    ? accountLabel(only)
    : i18n.t("connectors.screen.model.accountCount", { count: selection.length });
}

/** Limit an app to some accounts, or `all`; an app keeps its access and tools. */
export function setAppAccounts(
  grant: ConnectorGrant | undefined,
  slug: string,
  accounts: "all" | string[],
): ConnectorGrant {
  return editApp(grant, slug, ({ accounts: _previous, ...rest }) =>
    accounts === "all" ? rest : { ...rest, accounts },
  );
}

export function setAppTools(
  grant: ConnectorGrant | undefined,
  slug: string,
  tools: ConnectorToolSelection,
): ConnectorGrant {
  return editApp(grant, slug, (app) => ({ ...app, tools }));
}

export function setMcpServerTools(
  grant: ConnectorGrant | undefined,
  name: string,
  tools: ConnectorToolSelection,
): ConnectorGrant {
  return editServer(grant, name, (server) => ({ ...server, tools }));
}

/** Flip one tool in a selection; `all` expands to the full list first. */
export function toggleTool(
  selection: ConnectorToolSelection,
  tool: string,
  allTools: readonly string[],
): ConnectorToolSelection {
  const current = selection === "all" ? [...allTools] : [...selection];
  const next = current.includes(tool)
    ? current.filter((name) => name !== tool)
    : [...current, tool];
  return next.length === allTools.length && allTools.every((name) => next.includes(name))
    ? "all"
    : next.sort();
}

/** A server's address in a list: a remote server's host, a local command's program. */
export function mcpServerSummary(server: {
  transport: string;
  url?: string;
  command?: string;
}): string {
  if (server.transport === "http") {
    try {
      return new URL(server.url ?? "").host;
    } catch {
      return server.url ?? i18n.t("connectors.screen.model.remoteServer");
    }
  }
  const program = (server.command ?? "").split(/[\\/]/).pop();
  const local = i18n.t("connectors.screen.common.localCommand");
  return program ? `${local} · ${program}` : local;
}
