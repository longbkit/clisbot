import { createFileRoute } from "@tanstack/react-router";
import { OrganizationUsagePanel } from "../../../../usage/panel.js";
export const Route = createFileRoute("/_shell/o/$organizationSlug/usage")({
  component: OrganizationUsagePanel,
});
