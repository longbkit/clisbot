import { Redirect } from "expo-router";
import { ListTabPage } from "@/clisbot/home/list-tab-page";
import { NAVIGATION_V2_ENABLED } from "@/clisbot/navigation/feature";

/** Navigation V2's Work tab: the projects and work sessions list. */
export default function WorkTab() {
  return NAVIGATION_V2_ENABLED ? <ListTabPage path="/work" /> : <Redirect href="/chat" />;
}
