import { useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { createContext, useContext, type ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.js";
import { Skeleton } from "../components/ui/skeleton.js";
import { tenantContext } from "./functions.js";
import type { ProjectDashboard } from "./dashboard.js";

type TenantContextValue = Awaited<ReturnType<ProjectDashboard["tenantContext"]>>;

const ProjectTenantContext = createContext<TenantContextValue | null>(null);

export function RouteTenantProvider({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const scope = routeScope(pathname);
  const load = useServerFn(tenantContext);
  const snapshot = useQuery({
    queryKey: ["tenant", scope?.organizationSlug, scope?.projectSlug],
    queryFn: () => load({ data: scope! }),
    enabled: scope !== undefined,
  });
  if (scope === undefined) return children;
  if (snapshot.isPending) {
    return (
      <section aria-label="Loading tenant context" aria-busy="true" className="grid gap-6">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-64 w-full" />
      </section>
    );
  }
  if (snapshot.isError || snapshot.data.status === "error") {
    const unavailableMessage =
      scope.projectSlug === undefined ? "Organization unavailable." : "Project unavailable.";
    const message =
      snapshot.data?.status === "error" ? snapshot.data.error.message : unavailableMessage;
    return (
      <Alert variant="destructive">
        <AlertTitle>
          {scope.projectSlug === undefined ? "Organization unavailable" : "Project unavailable"}
        </AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    );
  }
  return (
    <ProjectTenantContext.Provider value={snapshot.data.data}>
      {children}
    </ProjectTenantContext.Provider>
  );
}

export function useRouteTenant(): TenantContextValue {
  const tenant = useContext(ProjectTenantContext);
  if (tenant === null) throw new Error("useRouteTenant used outside an organization route");
  return tenant;
}

export function useOptionalRouteTenant(): TenantContextValue | null {
  return useContext(ProjectTenantContext);
}

export function routeScope(
  pathname: string,
): { organizationSlug: string; projectSlug?: string } | undefined {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "o" || segments[1] === undefined) return undefined;
  const projectIndex = segments.indexOf("projects");
  const projectSlug = projectIndex >= 0 ? segments[projectIndex + 1] : undefined;
  return {
    organizationSlug: decodeURIComponent(segments[1]),
    ...(projectSlug === undefined ? {} : { projectSlug: decodeURIComponent(projectSlug) }),
  };
}
