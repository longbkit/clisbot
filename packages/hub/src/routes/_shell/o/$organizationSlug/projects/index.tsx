import { createFileRoute } from "@tanstack/react-router";
import { ProjectsPanel } from "../../../../../projects/panels.js";

export const Route = createFileRoute("/_shell/o/$organizationSlug/projects/")({
  component: ProjectsPanel,
});
