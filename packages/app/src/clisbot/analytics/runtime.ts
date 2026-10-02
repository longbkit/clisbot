import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import { analyticsPreference, ProductAnalytics } from "./model";
import { createAnalyticsAdapter } from "./adapter";
import { analyticsAvailable } from "./config";

export const CONSENT_KEY = "clisbot:product-analytics-consent:v1";
export const productAnalytics = new ProductAnalytics(
  {
    read: async () =>
      analyticsAvailable && analyticsPreference(await AsyncStorage.getItem(CONSENT_KEY)),
    write: async (enabled) => {
      await AsyncStorage.setItem(CONSENT_KEY, enabled ? "accepted" : "declined");
    },
  },
  createAnalyticsAdapter(),
);

export function useProductAnalytics() {
  return useSyncExternalStore(
    productAnalytics.subscribe,
    productAnalytics.getSnapshot,
    productAnalytics.getSnapshot,
  );
}
