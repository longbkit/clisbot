/* oxlint-disable typescript-eslint/no-unsafe-type-assertion -- the generated route type cannot express a server-resolved organization slug */
import { createFileRoute } from "@tanstack/react-router";
import { Navigate } from "@tanstack/react-router";
import { z } from "zod";
import { useActiveAccount } from "../../auth/active-account.js";

export const Route = createFileRoute("/_shell/")({
  validateSearch: z.object({ result: z.string().optional() }),
  component: DashboardLanding,
});

function DashboardLanding() {
  const account = useActiveAccount();
  const search = Route.useSearch();
  return (
    <Navigate
      to={`/o/${account.organization.slug}/projects` as never}
      search={search as never}
      replace
    />
  );
}
