/* oxlint-disable typescript-eslint/no-unsafe-type-assertion -- the generated route type cannot express a server-resolved organization slug */
import { createFileRoute, Navigate } from "@tanstack/react-router";

// Team is the section every role can read, so it is the settings landing.
export const Route = createFileRoute("/_shell/o/$organizationSlug/settings/")({
  component: SettingsLanding,
});

function SettingsLanding() {
  const { organizationSlug } = Route.useParams();
  return <Navigate to={`/o/${organizationSlug}/settings/team` as never} replace />;
}
