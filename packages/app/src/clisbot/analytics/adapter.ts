import type { AnalyticsAdapter } from "./model";

// Safe fallback for unsupported platforms and unit tooling.
export function createAnalyticsAdapter(): AnalyticsAdapter {
  return {
    async setEnabled(enabled) {
      if (enabled) throw new Error("Analytics unavailable");
    },
    async send() {},
  };
}
