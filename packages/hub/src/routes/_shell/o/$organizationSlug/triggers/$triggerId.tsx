import { createFileRoute } from "@tanstack/react-router";
import { TriggerEditorPanel } from "../../../../../triggers/panel.js";

export const Route = createFileRoute("/_shell/o/$organizationSlug/triggers/$triggerId")({
  component: TriggerEditorRoute,
});

function TriggerEditorRoute() {
  const { triggerId } = Route.useParams();
  return <TriggerEditorPanel triggerId={triggerId} />;
}
