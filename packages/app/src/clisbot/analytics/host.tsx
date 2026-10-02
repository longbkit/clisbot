import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useSegments } from "expo-router";
import { getIsElectron } from "@/constants/platform";
import { analyticsScreen } from "./model";
import { productAnalytics, useProductAnalytics } from "./runtime";

export function ProductAnalyticsHost() {
  const segments = useSegments();
  const screen = analyticsScreen(segments);
  const currentScreen = useRef(screen);
  currentScreen.current = screen;
  const { ready, enabled } = useProductAnalytics();
  useEffect(() => {
    void productAnalytics.initialize();
  }, []);
  useEffect(() => {
    if (!ready || !enabled) return;
    productAnalytics.track({ name: "app_open" });
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        productAnalytics.track({ name: "app_open" });
        productAnalytics.track({
          name: "screen_view",
          screen: currentScreen.current,
        });
      }
    });
    return () => subscription.remove();
  }, [ready, enabled]);
  useEffect(() => {
    if (ready && enabled) productAnalytics.track({ name: "screen_view", screen });
  }, [ready, enabled, screen]);
  useEffect(() => {
    if (!ready || !enabled || !getIsElectron()) return;
    let since = Date.now();
    const subscription = AppState.addEventListener("change", () => {
      since = Date.now();
    });
    const interval = setInterval(() => {
      const now = Date.now();
      if (AppState.currentState === "active" && now > since)
        productAnalytics.track({
          name: "engagement",
          milliseconds: Math.min(now - since, 30_000),
        });
      since = now;
    }, 30_000);
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [ready, enabled]);
  return null;
}
