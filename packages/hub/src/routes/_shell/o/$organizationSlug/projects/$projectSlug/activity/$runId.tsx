import { createFileRoute } from "@tanstack/react-router";
import { ProjectActivityRunPanel } from "../../../../../../../projects/panels.js";

export const Route = createFileRoute(
  "/_shell/o/$organizationSlug/projects/$projectSlug/activity/$runId",
)({ component: ActivityRunRoute });

function ActivityRunRoute() {
  const { runId } = Route.useParams();
  return <ProjectActivityRunPanel runId={runId} />;
}
