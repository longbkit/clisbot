import type { UseQueryResult } from "@tanstack/react-query";
import type { z } from "zod";
import { useFetchQuery } from "@/data/query";
import { useHubAccount } from "../account-provider";
import { hubResourceQueryKey } from "../query-keys";

/** One management API collection of the signed-in organization, e.g. `members` or `teams`. */
export function useHubResource<Schema extends z.ZodType>(
  resource: string,
  schema: Schema,
  /** False skips the request, e.g. for a resource the viewer's role cannot read. */
  enabled = true,
): UseQueryResult<z.infer<Schema>, Error> {
  const hub = useHubAccount();
  const organizationId = hub.signedIn?.organization.id ?? null;
  return useFetchQuery({
    queryKey: hubResourceQueryKey(
      { origin: hub.origin, organizationId, accountId: hub.signedIn?.account.id ?? null },
      resource,
    ),
    queryFn: () => hub.api().get(resource, schema),
    dataShape: "value",
    enabled: enabled && organizationId !== null,
    retry: false,
    staleTimeMs: 0,
  });
}
