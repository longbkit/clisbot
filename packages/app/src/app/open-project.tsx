import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { ClisbotHomeScreen } from "@/clisbot/home/home-screen";
import { profileNativeRegion } from "@/utils/render-profiler";

export default function OpenProjectRoute() {
  return (
    <HostRouteBootstrapBoundary>
      {profileNativeRegion("Home", <ClisbotHomeScreen />)}
    </HostRouteBootstrapBoundary>
  );
}
