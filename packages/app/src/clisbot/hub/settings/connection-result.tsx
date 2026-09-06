import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useHubAccount } from "../account-provider";
import { hubResourceQueryKey } from "../query-keys";
import { hubConnectionResult } from "../connection-result";

export function HubConnectionResultNotice() {
  const hub = useHubAccount();
  const organizationId = hub.signedIn?.organization.id;
  const accountId = hub.signedIn?.account.id ?? null;
  const queryClient = useQueryClient();
  const router = useRouter();
  const params = useLocalSearchParams<{ app?: string | string[]; result?: string | string[] }>();
  const result = hubConnectionResult(params);
  const resultCode = result === null ? null : params.result;
  const {
    mutate: refresh,
    isPending: pending,
    isError: refreshFailed,
  } = useMutation({
    mutationFn: async () => {
      if (!hub.enabled || organizationId === undefined) return;
      await Promise.all(
        ["provider-applications", "connections"].map((resource) =>
          queryClient.invalidateQueries(
            {
              queryKey: hubResourceQueryKey(
                { origin: hub.origin, organizationId, accountId },
                resource,
              ),
            },
            { throwOnError: true },
          ),
        ),
      );
    },
    retry: false,
  });
  useEffect(() => {
    if (resultCode !== null && hub.enabled && organizationId !== undefined) refresh();
  }, [accountId, hub.enabled, hub.origin, organizationId, refresh, resultCode]);
  const retry = useCallback(() => refresh(), [refresh]);
  const dismiss = useCallback(
    () => router.setParams({ app: undefined, result: undefined }),
    [router],
  );
  if (result === null || !hub.enabled || organizationId === undefined) return null;
  return (
    <>
      <Alert variant={result.variant} title={result.title} description={result.description}>
        <Button size="sm" variant="ghost" onPress={dismiss}>
          Dismiss
        </Button>
      </Alert>
      {refreshFailed || pending ? (
        <Alert
          variant={pending ? "info" : "warning"}
          title={pending ? "Refreshing Connection status" : "Connection status could not refresh"}
          description={
            pending
              ? "Loading current provider status from Hub."
              : "Check your connection and retry to load the current provider status."
          }
        >
          <Button size="sm" variant="outline" loading={pending} onPress={retry}>
            Retry refresh
          </Button>
        </Alert>
      ) : null}
    </>
  );
}
