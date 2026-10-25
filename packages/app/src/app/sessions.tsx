import { Redirect } from "expo-router";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { NAVIGATION_V2_ENABLED } from "@/clisbot/navigation/feature";
import { SessionsScreen } from "@/screens/sessions-screen";

export default function SessionsRoute() {
  // Navigation V2: Home absorbed Inbox (brief C6); old links land on Home.
  if (NAVIGATION_V2_ENABLED) return <Redirect href="/open-project" />;
  return (
    <HostRouteBootstrapBoundary>
      <SessionsScreen />
    </HostRouteBootstrapBoundary>
  );
}
