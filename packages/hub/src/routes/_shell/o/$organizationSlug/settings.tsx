import { createFileRoute } from "@tanstack/react-router";
import { OrganizationSettingsLayout } from "../../../../auth/organization-settings.js";

// Administration, not day-to-day work: the sections behind it are configured once and checked
// occasionally, so they sit under one sidebar entry instead of competing with Projects, Daemons,
// and Connections for attention.
export const Route = createFileRoute("/_shell/o/$organizationSlug/settings")({
  component: OrganizationSettingsLayout,
});
