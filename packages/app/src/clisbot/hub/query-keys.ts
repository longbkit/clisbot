interface HubResourceQueryScope {
  origin: string | null;
  organizationId: string | null;
  accountId: string | null;
}

/** Hub resource projections depend on the signed-in Member's authority. */
export function hubResourceQueryKey(scope: HubResourceQueryScope, resource: string) {
  return [
    "clisbot",
    "hub",
    scope.origin,
    scope.organizationId,
    "account",
    scope.accountId,
    resource,
  ] as const;
}
