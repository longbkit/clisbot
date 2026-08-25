import { createFileRoute } from "@tanstack/react-router";
import { ProjectActivityPanel } from "../../../../../../../projects/panels.js";

export const Route = createFileRoute("/_shell/o/$organizationSlug/projects/$projectSlug/activity/")(
  {
    component: ProjectActivityPanel,
  },
);
