/* oxlint-disable typescript-eslint/no-unsafe-type-assertion -- the generated route type cannot express a current-organization redirect */
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useActiveAccount } from "../../../../auth/active-account.js";

export const Route = createFileRoute("/_shell/projects/$projectSlug/activity")({
  component: LegacyProjectActivityRedirect,
});

function LegacyProjectActivityRedirect() {
  const account = useActiveAccount();
  const { projectSlug } = Route.useParams();
  return (
    <Navigate
      to={`/o/${account.organization.slug}/projects/${projectSlug}/activity` as never}
      replace
    />
  );
}
