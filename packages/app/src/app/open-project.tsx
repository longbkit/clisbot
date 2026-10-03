import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { ClisbotHomeScreen } from "@/clisbot/home/home-screen";

export default function OpenProjectRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <ClisbotHomeScreen />
    </HostRouteBootstrapBoundary>
  );
}
