import { memo } from "react";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { AutomationsLandingScreen } from "@/clisbot/automations/screen";

export default function SchedulesRoute() {
  return <SchedulesTab />;
}

/** Memoized: a phone tab switch re-renders every tab's route, not its content. */
const SchedulesTab = memo(function SchedulesTab() {
  return (
    <HostRouteBootstrapBoundary>
      <AutomationsLandingScreen />
    </HostRouteBootstrapBoundary>
  );
});
