import { createFileRoute } from "@tanstack/react-router";
import { ProjectOverviewPanel } from "../../../../../../projects/panels.js";
export const Route = createFileRoute("/_shell/o/$organizationSlug/projects/$projectSlug/overview")({
  component: ProjectOverviewPanel,
});
