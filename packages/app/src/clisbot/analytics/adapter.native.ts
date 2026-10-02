import { analyticsAvailable, analyticsNativeConfigured } from "./config";
import type { AnalyticsAdapter } from "./model";
import { Platform } from "react-native";

export function createAnalyticsAdapter(): AnalyticsAdapter {
  let enabled = false;
  const load = () => import("@react-native-firebase/analytics");
  return {
    async setEnabled(value) {
      enabled = false;
      if (!analyticsAvailable || !analyticsNativeConfigured) {
        if (value) throw new Error("Analytics unavailable in this build");
        return;
      }
      const sdk = await load();
      const analytics = sdk.getAnalytics();
      await sdk.setAnalyticsCollectionEnabled(analytics, false);
      await sdk.setConsent(analytics, {
        analytics_storage: value,
        ad_storage: false,
        ad_user_data: false,
        ad_personalization: false,
      });
      if (value) {
        await sdk.setDefaultEventParameters(analytics, {
          surface: "app",
          client_platform: Platform.OS,
        });
        await sdk.setAnalyticsCollectionEnabled(analytics, true);
      } else {
        await sdk.resetAnalyticsData(analytics);
      }
      enabled = value;
    },
    async send(event) {
      if (!enabled) return;
      const sdk = await load();
      if (!enabled || event.name === "engagement") return; // Native SDK owns engagement duration.
      if (event.name === "screen_view") {
        await sdk.logScreenView(sdk.getAnalytics(), {
          screen_name: event.screen,
          screen_class: event.screen,
        });
      } else {
        await sdk.logEvent(sdk.getAnalytics(), "app_open", {});
      }
    },
  };
}
