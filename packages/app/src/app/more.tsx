import { Redirect } from "expo-router";
import { NAVIGATION_V2_ENABLED } from "@/clisbot/navigation/feature";
import { MoreScreen } from "@/clisbot/navigation/more-screen";

export default function MoreRoute() {
  return NAVIGATION_V2_ENABLED ? <MoreScreen /> : <Redirect href="/open-project" />;
}
