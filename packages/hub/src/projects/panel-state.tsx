/* oxlint-disable typescript-eslint/no-unsafe-type-assertion -- server functions are erased to a generic call signature at the boundary */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.js";
import { Skeleton } from "../components/ui/skeleton.js";
import type { Result } from "../contract/respond.js";
import { useRouteTenant } from "./context.js";
import type { ProjectDashboard } from "./dashboard.js";
import { organizationSnapshot, projectSnapshot } from "./functions.js";

/**
 * The load/command plumbing every dashboard panel shares: one snapshot query per
 * scope, one mutation shape, and the two states — pending and failed — a panel
 * renders instead of its content.
 */

export type OrganizationSnapshot = Awaited<ReturnType<ProjectDashboard["organizationSnapshot"]>>;
export type ProjectSnapshot = Awaited<ReturnType<ProjectDashboard["projectSnapshot"]>>;

export function useOrganizationSnapshot() {
  const tenant = useRouteTenant();
  const load = useServerFn(organizationSnapshot);
  const query = useQuery({
    queryKey: ["organization", tenant.account.id, tenant.organization.id],
    queryFn: () => load({ data: { organizationSlug: tenant.organization.slug } }),
  });
  return queryState<OrganizationSnapshot>(query, "Organization unavailable");
}

export function useProjectSnapshot() {
  const tenant = useRouteTenant();
  const load = useServerFn(projectSnapshot);
  const scope = projectScope(tenant);
  const query = useQuery({
    queryKey: ["project", tenant.account.id, tenant.organization.id, tenant.project?.id],
    queryFn: () => load({ data: scope }),
  });
  return queryState<ProjectSnapshot>(query, "Project unavailable");
}

export function queryState<T>(
  query: { isPending: boolean; isError: boolean; data: Result<T> | undefined },
  title: string,
): { ok: true; data: T } | { ok: false; element: ReactNode } {
  if (query.isPending)
    return {
      ok: false,
      element: (
        <section
          aria-label={`Loading ${title.toLowerCase()}`}
          aria-busy="true"
          className="grid gap-5"
        >
          <Skeleton className="h-12 w-64" />
          <Skeleton className="h-72 w-full" />
        </section>
      ),
    };
  if (query.isError || query.data?.status !== "ok")
    return {
      ok: false,
      element: (
        <Alert variant="destructive">
          <AlertTitle>{title}</AlertTitle>
          <AlertDescription>
            {query.data?.status === "error" ? query.data.error.message : `${title}.`}
          </AlertDescription>
        </Alert>
      ),
    };
  return { ok: true, data: query.data.data };
}

export function useProjectCommand<TInput, TOutput = { state: "complete" }>(
  command: (input: TInput) => Promise<Result<TOutput>>,
  queryClient: ReturnType<typeof useQueryClient>,
  scope: { organizationSlug: string; projectSlug?: string },
) {
  return useMutation({
    mutationFn: useServerFn(command as never) as unknown as (
      input: TInput,
    ) => Promise<Result<TOutput>>,
    onSuccess: async (result) => {
      if (result.status === "ok") await invalidateScope(queryClient, scope);
    },
  });
}

export function CommandError({
  mutations,
}: {
  mutations: Array<{ data: Result<unknown> | undefined; isError: boolean }>;
}) {
  const failed = mutations.find(
    (mutation) => mutation.isError || mutation.data?.status === "error",
  );
  if (failed === undefined) return null;
  return (
    <Alert variant="destructive" className="mb-5">
      <AlertDescription>
        {failed.data?.status === "error"
          ? failed.data.error.message
          : "Hub did not receive the project action result. Check your connection and reload the current project state."}
      </AlertDescription>
    </Alert>
  );
}

export async function invalidateScope(
  queryClient: ReturnType<typeof useQueryClient>,
  scope: { organizationSlug: string; projectSlug?: string },
) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["organization"] }),
    queryClient.invalidateQueries({ queryKey: ["project"] }),
    queryClient.invalidateQueries({ queryKey: ["tenant", scope.organizationSlug] }),
  ]);
}

export async function invalidateOrganization(
  queryClient: ReturnType<typeof useQueryClient>,
  organizationSlug: string,
) {
  await invalidateScope(queryClient, { organizationSlug });
}

export function projectScope(tenant: ReturnType<typeof useRouteTenant>) {
  if (tenant.project === null) throw new Error("project route has no project context");
  return { organizationSlug: tenant.organization.slug, projectSlug: tenant.project.slug };
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}
