import { createFileRoute } from "@tanstack/react-router";
import { ProjectGeneralSettingsPanel } from "../../../../../../../projects/panels.js";
export const Route = createFileRoute(
  "/_shell/o/$organizationSlug/projects/$projectSlug/settings/general",
)({ component: ProjectGeneralSettingsPanel });
