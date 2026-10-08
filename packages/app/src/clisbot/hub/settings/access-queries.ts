// What the Access screen and a grant sheet opened elsewhere (a Member's page)
// both load and how both save, so the two stay one flow.

import { useCallback, useState } from "react";
import { useFetchQuery } from "@/data/query";
import { i18n } from "@/i18n/i18next";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useHubAccount } from "../account-provider";
import { HubApiError } from "../api-client";
import { hubResourceQueryKey } from "../query-keys";
import {
  HUB_ACCESS_INCLUDE,
  HubAccessAssignmentSchema,
  HubAccessAssignmentsSchema,
  HubAccessCatalogSchema,
  HubEffectiveAccessSchema,
  HubMembersSchema,
  HubTeamsSchema,
} from "../contracts";

/** A Hub refusal the form shows in place; anything else shows at the top of the page. */
export const GRANTOR_ERROR_CODE = "access_exceeds_grantor";

export interface MutationError {
  code: string | null;
  message: string;
}

export function useHubScope() {
  const hub = useHubAccount();
  return hub.signedIn
    ? {
        origin: hub.origin,
        organizationId: hub.signedIn.organization.id,
        accountId: hub.signedIn.account.id,
      }
    : { origin: hub.origin, organizationId: null, accountId: null };
}

/** The viewer's own grants, Team resources included; also what the form may hand on. */
export function useEffectiveAccess() {
  const hub = useHubAccount();
  const scope = useHubScope();
  return useFetchQuery({
    queryKey: hubResourceQueryKey(scope, "access-assignments/effective"),
    queryFn: () =>
      hub.api().get(`access-assignments/effective${HUB_ACCESS_INCLUDE}`, HubEffectiveAccessSchema),
    dataShape: "value",
    enabled: scope.organizationId !== null,
    retry: false,
    staleTimeMs: 0,
  });
}

/** Everything the grant form reads. Query keys keep the bare resource name for invalidations. */
export function useManagedAccessQueries() {
  const hub = useHubAccount();
  const scope = useHubScope();
  const enabled = scope.organizationId !== null;
  const options = { dataShape: "value", enabled, retry: false, staleTimeMs: 0 } as const;
  const assignments = useFetchQuery({
    queryKey: hubResourceQueryKey(scope, "access-assignments"),
    queryFn: () =>
      hub.api().get(`access-assignments${HUB_ACCESS_INCLUDE}`, HubAccessAssignmentsSchema),
    ...options,
  });
  const catalog = useFetchQuery({
    queryKey: hubResourceQueryKey(scope, "access-catalog"),
    queryFn: () => hub.api().get(`access-catalog${HUB_ACCESS_INCLUDE}`, HubAccessCatalogSchema),
    ...options,
  });
  const members = useFetchQuery({
    queryKey: hubResourceQueryKey(scope, "members"),
    queryFn: () => hub.api().get("members", HubMembersSchema),
    ...options,
  });
  const teams = useFetchQuery({
    queryKey: hubResourceQueryKey(scope, "teams"),
    queryFn: () => hub.api().get("teams", HubTeamsSchema),
    ...options,
  });
  return { assignments, catalog, members, teams };
}

function describeMutationError(error: unknown): MutationError {
  if (error instanceof HubApiError) return { code: error.code, message: error.message };
  return {
    code: null,
    message: error instanceof Error ? error.message : i18n.t("hub.access.page.requestFailed"),
  };
}

/**
 * Runs one grant change at a time: on success it reloads the grants and calls `onDone`; on
 * failure it keeps the Hub's reason for the form or page to show.
 */
export function useAccessMutation(reload: () => Promise<unknown>, onDone: () => void) {
  const hub = useHubAccount();
  const [pending, setPending] = useState(false);
  const [mutationError, setMutationError] = useState<MutationError | null>(null);
  const runMutation = useCallback(
    async (operation: () => Promise<void>) => {
      setPending(true);
      setMutationError(null);
      try {
        await operation();
        await reload();
        onDone();
      } catch (error) {
        setMutationError(describeMutationError(error));
      } finally {
        setPending(false);
      }
    },
    [onDone, reload],
  );
  /** Creates one grant, or several at once with `batch`. */
  const post = useCallback(
    (body: unknown, batch?: boolean) =>
      runMutation(async () => {
        await hub
          .api()
          .post(
            batch ? "access-assignments/batch" : "access-assignments",
            body,
            batch ? HubAccessAssignmentsSchema : HubAccessAssignmentSchema,
          );
      }),
    [hub, runMutation],
  );
  return { pending, mutationError, runMutation, post };
}

/** Asks before a grant is removed; both the Access page and a grant sheet ask the same. */
export function confirmRemoveAccess(): Promise<boolean> {
  return confirmDialog({
    title: i18n.t("hub.access.remove.title"),
    message: i18n.t("hub.access.remove.message"),
    confirmLabel: i18n.t("hub.access.remove.confirm"),
    destructive: true,
  });
}

/**
 * Removes one grant after a confirmation, then reloads the page's own copy of the grants. `run`
 * is the page's mutation runner, so a refusal shows where that page shows its errors.
 */
export function useRemoveGrant(
  run: (operation: () => Promise<void>) => Promise<unknown>,
  reload: () => Promise<unknown>,
) {
  const hub = useHubAccount();
  return useCallback(
    async (assignmentId: string) => {
      const confirmed = await confirmRemoveAccess();
      if (!confirmed) return;
      await run(async () => {
        await hub.api().delete(`access-assignments/${encodeURIComponent(assignmentId)}`);
        await reload();
      });
    },
    [hub, reload, run],
  );
}
