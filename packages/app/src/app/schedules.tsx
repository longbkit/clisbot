import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { AutomationsLandingScreen } from "@/clisbot/automations/screen";

export default function SchedulesRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <AutomationsLandingScreen />
    </HostRouteBootstrapBoundary>
  );
}
