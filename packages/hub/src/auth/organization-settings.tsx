/* oxlint-disable typescript-eslint/no-unsafe-type-assertion -- dynamic tenant URLs are assembled from server-resolved route metadata */
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { billingConfigured } from "../server/capabilities.js";
import { cn } from "../lib/utils.js";
import { useRouteTenant } from "../projects/context.js";

/**
 * Organization administration. Each section keeps its own `<h1>` and actions, so this contributes
 * only the strip that says which sections exist — the sidebar stops at "Settings" and this is
 * where the choice between Team, API keys, Usage, and Billing is made.
 */
export function OrganizationSettingsLayout() {
  const tenant = useRouteTenant();
  const base = `/o/${tenant.organization.slug}/settings`;
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  // Billing is hosted-only: the tab appears solely when the instance is billing-configured, so a
  // self-hosted deployment shows no billing surface at all (the route also 404s there).
  const loadBillingConfigured = useServerFn(billingConfigured);
  const billing = useQuery({
    queryKey: ["billing-configured"],
    queryFn: () => loadBillingConfigured(),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const sections = [
    { segment: "team", label: "Team", shown: true },
    { segment: "api-keys", label: "API keys", shown: tenant.capabilities.manageResources },
    { segment: "usage", label: "Usage", shown: true },
    { segment: "billing", label: "Billing", shown: billing.data?.configured === true },
  ].filter((section) => section.shown);
  return (
    <>
      <nav
        aria-label="Organization settings"
        className="mb-6 flex flex-wrap gap-1 border-b pb-3 text-sm"
      >
        {sections.map((section) => {
          const to = `${base}/${section.segment}`;
          const active = pathname === to;
          return (
            <Link
              key={section.segment}
              to={to as never}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-md px-2.5 py-1.5 hover:bg-accent hover:text-accent-foreground",
                active ? "bg-accent text-accent-foreground" : "text-muted-foreground",
              )}
            >
              {section.label}
            </Link>
          );
        })}
      </nav>
      <Outlet />
    </>
  );
}
