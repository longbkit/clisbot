import { memo } from "react";
import { Redirect } from "expo-router";
import { NAVIGATION_V2_ENABLED } from "@/clisbot/navigation/feature";
import { MoreScreen } from "@/clisbot/navigation/more-screen";

export default function MoreRoute() {
  return NAVIGATION_V2_ENABLED ? <MoreTab /> : <Redirect href="/open-project" />;
}

/** Memoized: a phone tab switch re-renders every tab's route, not its content. */
const MoreTab = memo(function MoreTab() {
  return <MoreScreen />;
});
