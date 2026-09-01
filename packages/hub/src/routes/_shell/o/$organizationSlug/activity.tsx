import { createFileRoute } from "@tanstack/react-router";
import { TriggerActivityPanel } from "../../../../triggers/activity-panel.js";

export const Route = createFileRoute("/_shell/o/$organizationSlug/activity")({
  component: TriggerActivityPanel,
});
