import { useCallback, useContext, useEffect, useMemo } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import type { z } from "zod";
import { useFetchQuery } from "@/data/query";
import { useHubAccount } from "../account-provider";
import {
  HubAccessAssignmentsSchema,
  HubAutomationsSchema,
  HubChannelConfigurationSchema,
  HubChannelRevisionsSchema,
  HubChannelRuntimeStatusSchema,
  HubChannelValidationSchema,
  HubConnectionsSchema,
  HubDaemonsSchema,
  HubTeamsSchema,
} from "../contracts";
import { hubResourceQueryKey } from "../query-keys";
import { AutomationInputDraftContext, type AutomationChannelDraft } from "./automation-input-draft";
import { useHubSettingsDetailScroll } from "./detail-scroll";

type HubChannelConfiguration = z.infer<typeof HubChannelConfigurationSchema>;
/** The signed-in organization; empty until sign-in resolves, which keeps the queries idle. */
type HubResourceQueryScope = Parameters<typeof hubResourceQueryKey>[0] & { organizationId: string };

/** Everything the Channels screen reads from the Hub, for the signed-in organization. */
export function useChannelSettingsQueries() {
  const hub = useHubAccount();
  const scope = hubQueryScope(hub);
  const inputDraft = useContext(AutomationInputDraftContext);
  const channelQuery = useHubResource(
    scope,
    "channel-configuration",
    HubChannelConfigurationSchema,
  );
  const channels = useMemo(
    () => ({ ...channelQuery, data: withInputDraft(channelQuery.data, inputDraft?.draft) }),
    [channelQuery, inputDraft?.draft],
  );
  const connections = useHubResource(scope, "connections", HubConnectionsSchema);
  const runtimeStatus = useHubResource(
    scope,
    "channel-accounts/status",
    HubChannelRuntimeStatusSchema,
    [...hubResourceQueryKey(scope, "channel-accounts"), "status"],
  );
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
    automations: useHubResource(scope, "automations", HubAutomationsSchema),
    daemons: useHubResource(scope, "daemons", HubDaemonsSchema),
    history: useHubResource(scope, "channel-configuration/revisions", HubChannelRevisionsSchema, [
      ...hubResourceQueryKey(scope, "channel-configuration"),
      "revisions",
    ]),
    runtimeStatus,
    teams: useHubResource(scope, "teams", HubTeamsSchema),
    assignments: useHubResource(scope, "access-assignments", HubAccessAssignmentsSchema),
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

/** The Hub's warnings for one Route, read from the shared Channel configuration query. */
export function useChannelRouteWarnings(
  channel: string | null,
  accountId: string | null,
  routeIndex: number,
): string[] {
  const scope = hubQueryScope(useHubAccount());
  const configuration = useHubResource(
    scope,
    "channel-configuration",
    HubChannelConfigurationSchema,
  );
  return useMemo(
    () =>
      (configuration.data?.warnings ?? [])
        .filter(
          (warning) =>
            warning.channel === channel &&
            warning.accountId === accountId &&
            warning.route === routeIndex,
        )
        .map(({ message }) => message),
    [accountId, channel, configuration.data?.warnings, routeIndex],
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
) {
  const hub = useHubAccount();
  return useFetchQuery({
    queryKey,
    queryFn: () => hub.api().get(path, schema),
    enabled: scope.organizationId.length > 0,
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
