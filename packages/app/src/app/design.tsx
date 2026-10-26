import { Redirect } from "expo-router";
import { NAVIGATION_V2_ENABLED } from "@/clisbot/navigation/feature";
import { PreviewSectionScreen } from "@/clisbot/navigation/preview-screen";

export default function DesignRoute() {
  return NAVIGATION_V2_ENABLED ? (
    <PreviewSectionScreen section="design" />
  ) : (
    <Redirect href="/open-project" />
  );
}
