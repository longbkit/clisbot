import { memo } from "react";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { ClisbotHomeScreen } from "@/clisbot/home/home-screen";
import { HeldNavigationActivity } from "@/clisbot/navigation/activity";
import { profileNativeRegion } from "@/utils/render-profiler";

export default function OpenProjectRoute() {
  return <HomeTab />;
}

/** Memoized: a phone tab switch re-renders every tab's route, not its content. */
const HomeTab = memo(function HomeTab() {
  return (
    <HostRouteBootstrapBoundary>
      <HeldNavigationActivity>
        {profileNativeRegion("Home", <ClisbotHomeScreen />)}
      </HeldNavigationActivity>
    </HostRouteBootstrapBoundary>
  );
});
