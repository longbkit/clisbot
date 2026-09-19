import { useCallback, useContext, useEffect, useMemo } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import type { z } from "zod";
import { useFetchQuery } from "@/data/query";
import { useHubAccount } from "../account-provider";
import {
  HUB_ACCESS_INCLUDE,
  HubAccessAssignmentsSchema,
  HubAutomationsSchema,
  HubChannelAccountConfigurationSchema,
  HubChannelConfigurationSchema,
  HubChannelRevisionsSchema,
  HubChannelRuntimeStatusSchema,
  HubChannelValidationSchema,
  HubConnectionsSchema,
  HubDaemonsSchema,
  HubEffectiveAccessSchema,
  HubTeamsSchema,
  type HubChannelAccountConfiguration,
} from "../contracts";
import { channelAccountResource, type ChannelAccountRef } from "../channel-account-requests";
import { hubResourceQueryKey } from "../query-keys";
import { AutomationInputDraftContext, type AutomationChannelDraft } from "./automation-input-draft";
import { useHubSettingsDetailScroll } from "./detail-scroll";

type HubChannelConfiguration = z.infer<typeof HubChannelConfigurationSchema>;
type HubRuntimeStatus = z.infer<typeof HubChannelRuntimeStatusSchema>;
type HubEffectiveAccess = z.infer<typeof HubEffectiveAccessSchema>;
/** The signed-in organization; empty until sign-in resolves, which keeps the queries idle. */
type HubResourceQueryScope = Parameters<typeof hubResourceQueryKey>[0] & { organizationId: string };

/**
 * Who the Channels screen serves: the organization capability sees and saves
 * the whole configuration; a Member who is Channel Route Admin of some
 * accounts (`channel.manage` on `channel_account`, direct or via a Team) sees
 * only those, through the per-account endpoints
 * (docs/features/access/scoped-admins.md).
 */
export type ChannelRouteAdminScope =
  | { status: "loading" }
  | { status: "organization" }
  | { status: "none" }
  | { status: "accounts"; accounts: readonly ChannelAccountRef[] };

export function useChannelRouteAdminScope(): ChannelRouteAdminScope {
  const hub = useHubAccount();
  const scope = hubQueryScope(hub);
  const canManage = hub.signedIn?.capabilities.manageResources === true;
  const effective = useHubResource(
    scope,
    `access-assignments/effective${HUB_ACCESS_INCLUDE}`,
    HubEffectiveAccessSchema,
    hubResourceQueryKey(scope, "access-assignments/effective"),
    !canManage,
  );
  return useMemo<ChannelRouteAdminScope>(() => {
    if (canManage) return { status: "organization" };
    if (effective.data === undefined) return { status: effective.error ? "none" : "loading" };
    const accounts = channelAccountsAdministered(effective.data);
    return accounts.length === 0 ? { status: "none" } : { status: "accounts", accounts };
  }, [canManage, effective.data, effective.error]);
}

/** The Channel accounts a viewer's effective grants let them administer. */
export function channelAccountsAdministered(access: HubEffectiveAccess): ChannelAccountRef[] {
  const refs = new Map<string, ChannelAccountRef>();
  for (const grant of access.grants) {
    if (grant.resource.kind !== "channel_account") continue;
    if (!grant.privileges.includes("channel.manage")) continue;
    const ref = parseChannelAccountRef(grant.resource.id);
    if (ref !== null) refs.set(grant.resource.id, ref);
  }
  return [...refs.values()];
}

/** The inverse of the Hub's `formatChannelAccountResourceId`: `<channel>/<accountId>`, URL-encoded. */
function parseChannelAccountRef(resourceId: string): ChannelAccountRef | null {
  const separator = resourceId.indexOf("/");
  if (separator <= 0) return null;
  try {
    const channel = decodeURIComponent(resourceId.slice(0, separator));
    const accountId = decodeURIComponent(resourceId.slice(separator + 1));
    return accountId.length === 0 ? null : { channel, accountId };
  } catch {
    return null;
  }
}

/**
 * Everything the Channels screen reads from the Hub. With `adminAccounts` the
 * reads narrow to those accounts' endpoints and the organization-wide
 * resources (Connections, Automations, Hosts, revisions) stay unread.
 */
export function useChannelSettingsQueries(adminAccounts: readonly ChannelAccountRef[] | null) {
  const hub = useHubAccount();
  const scope = hubQueryScope(hub);
  const inputDraft = useContext(AutomationInputDraftContext);
  const organizationWide = adminAccounts === null;
  const organizationQuery = useHubResource(
    scope,
    "channel-configuration",
    HubChannelConfigurationSchema,
    undefined,
    organizationWide,
  );
  const accountsQuery = useAdministeredAccounts(scope, adminAccounts);
  const channelQuery = organizationWide ? organizationQuery : accountsQuery.configuration;
  const channels = useMemo(
    () => ({ ...channelQuery, data: withInputDraft(channelQuery.data, inputDraft?.draft) }),
    [channelQuery, inputDraft?.draft],
  );
  const connections = useHubResource(
    scope,
    "connections",
    HubConnectionsSchema,
    undefined,
    organizationWide,
  );
  const organizationStatus = useHubResource(
    scope,
    "channel-accounts/status",
    HubChannelRuntimeStatusSchema,
    [...hubResourceQueryKey(scope, "channel-accounts"), "status"],
    organizationWide,
  );
  const runtimeStatus = organizationWide ? organizationStatus : accountsQuery.status;
  return {
    hub,
    scope,
    canManage: hub.signedIn?.capabilities.manageResources === true,
    isInstanceOperator: hub.signedIn?.isInstanceOperator === true,
    inputDraft,
    draftPending: inputDraft?.pending === true,
    channels,
    connections,
    channelConnections: useChannelConnections(connections.data, inputDraft?.provider),
    statusRefreshing: connections.isFetching || runtimeStatus.isFetching,
    automations: useHubResource(
      scope,
      "automations",
      HubAutomationsSchema,
      undefined,
      organizationWide,
    ),
    daemons: useHubResource(scope, "daemons", HubDaemonsSchema, undefined, organizationWide),
    history: useHubResource(
      scope,
      "channel-configuration/revisions",
      HubChannelRevisionsSchema,
      [...hubResourceQueryKey(scope, "channel-configuration"), "revisions"],
      organizationWide,
    ),
    runtimeStatus,
    teams: useHubResource(scope, "teams", HubTeamsSchema),
    assignments: useHubResource(scope, "access-assignments", HubAccessAssignmentsSchema),
  };
}

/** The administered accounts' files and status, read per account and merged. */
function useAdministeredAccounts(
  scope: HubResourceQueryScope,
  accounts: readonly ChannelAccountRef[] | null,
) {
  const hub = useHubAccount();
  const refs = accounts ?? [];
  const keys = refs.map(channelAccountResource);
  const enabled = scope.organizationId.length > 0 && refs.length > 0;
  const configuration = useFetchQuery({
    queryKey: [...hubResourceQueryKey(scope, "channel-configuration"), "accounts", ...keys],
    queryFn: async (): Promise<HubChannelConfiguration> => {
      const files = await Promise.all(
        refs.map((ref) =>
          hub
            .api()
            .get(
              `channel-configuration/accounts/${channelAccountResource(ref)}`,
              HubChannelAccountConfigurationSchema,
            ),
        ),
      );
      return administeredConfiguration(files);
    },
    enabled,
    retry: false,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
  const status = useFetchQuery({
    queryKey: [...hubResourceQueryKey(scope, "channel-accounts"), "status", ...keys],
    queryFn: async (): Promise<HubRuntimeStatus> => {
      const pages = await Promise.all(
        refs.map((ref) =>
          hub
            .api()
            .get(
              `channel-accounts/${channelAccountResource(ref)}/status`,
              HubChannelRuntimeStatusSchema,
            ),
        ),
      );
      return {
        runtimeAvailable: pages.every((page) => page.runtimeAvailable),
        accounts: pages.flatMap((page) => page.accounts),
      };
    },
    enabled,
    retry: false,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
  return { configuration, status };
}

/** One configuration view out of per-account reads: the same revision, no shared files. */
function administeredConfiguration(
  files: readonly HubChannelAccountConfiguration[],
): HubChannelConfiguration {
  const revision = files.find((file) => file.revision !== null)?.revision ?? null;
  return {
    revision: revision === null ? null : { ...revision, createdAt: "" },
    policy: {},
    accounts: files.flatMap((file) => (file.account === null ? [] : [file.account])),
    resource: {},
    effective: files.map((file) => file.effective),
    warnings: files.flatMap((file) => file.warnings),
  };
}

/**
 * Validate a candidate without saving it and return the Hub's warnings, so a
 * confirmation can show them before anything changes. A candidate the Hub
 * refuses returns no warnings: saving it reports the refusal.
 */
export function useChannelConfigurationPreview(): (
  accounts: Record<string, unknown>[],
  resource: Record<string, unknown>,
) => Promise<z.infer<typeof HubChannelValidationSchema>["warnings"]> {
  const hub = useHubAccount();
  const queryClient = useQueryClient();
  const scope = hubQueryScope(hub);
  return useCallback(
    async (accounts, resource) => {
      // Read at call time, without subscribing: the editor already owns the query.
      const policy = queryClient.getQueryData<HubChannelConfiguration>(
        hubResourceQueryKey(scope, "channel-configuration"),
      )?.policy;
      try {
        const candidate = { policy: policy ?? {}, accounts, resource };
        return (
          await hub
            .api()
            .post("channel-configuration/validate", candidate, HubChannelValidationSchema)
        ).warnings;
      } catch {
        return [];
      }
    },
    [hub, queryClient, scope],
  );
}

/** The Hub's warnings for one Route, out of the loaded configuration's list. */
export function useChannelRouteWarnings(
  warnings: HubChannelConfiguration["warnings"],
  channel: string | null,
  accountId: string | null,
  routeIndex: number,
): string[] {
  return useMemo(
    () =>
      (warnings ?? [])
        .filter(
          (warning) =>
            warning.channel === channel &&
            warning.accountId === accountId &&
            warning.route === routeIndex,
        )
        .map(({ message }) => message),
    [accountId, channel, warnings, routeIndex],
  );
}

/**
 * The Slack and Telegram Connections a Route can use; an Automation input
 * keeps only its own provider's.
 */
function useChannelConnections(
  connections: z.infer<typeof HubConnectionsSchema> | undefined,
  provider: string | undefined,
) {
  return useMemo(
    () =>
      (connections?.connections ?? []).filter((connection) =>
        provider === undefined
          ? ["slack", "telegram"].includes(connection.provider)
          : connection.provider === provider,
      ),
    [connections?.connections, provider],
  );
}

/** Tell the Automation input draft whether a Route editor is open, while this screen is mounted. */
export function useReportDraftEditing(editing: boolean) {
  const setEditing = useContext(AutomationInputDraftContext)?.setEditing;
  useEffect(() => {
    setEditing?.(editing);
    return () => setEditing?.(false);
  }, [editing, setEditing]);
}

/** Scroll the settings detail pane back to the top whenever `key` changes. */
export function useScrollToTopOn(enabled: boolean, key: unknown) {
  const scrollToTop = useHubSettingsDetailScroll();
  useEffect(() => {
    if (enabled) scrollToTop?.();
  }, [key, scrollToTop, enabled]);
}

function hubQueryScope(hub: ReturnType<typeof useHubAccount>): HubResourceQueryScope {
  return {
    origin: hub.origin,
    organizationId: hub.signedIn?.organization.id ?? "",
    accountId: hub.signedIn?.account.id ?? null,
  };
}

/** One Hub resource, keyed by its path unless the screen shares a key family. */
function useHubResource<Schema extends z.ZodType>(
  scope: HubResourceQueryScope,
  path: string,
  schema: Schema,
  queryKey: QueryKey = hubResourceQueryKey(scope, path),
  enabled = true,
) {
  const hub = useHubAccount();
  return useFetchQuery({
    queryKey,
    queryFn: () => hub.api().get(path, schema),
    enabled: enabled && scope.organizationId.length > 0,
    retry: false,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
}

/** An Automation input edits a staged draft, so the draft replaces the saved Routes. */
function withInputDraft(
  saved: HubChannelConfiguration | undefined,
  draft: AutomationChannelDraft | null | undefined,
): HubChannelConfiguration | undefined {
  if (saved === undefined || !draft) return saved;
  const revision =
    draft.expectedRevisionId !== null && saved.revision
      ? { ...saved.revision, id: draft.expectedRevisionId }
      : null;
  return {
    ...saved,
    accounts: draft.accounts,
    resource: draft.resource,
    policy: draft.policy,
    revision,
  };
}
