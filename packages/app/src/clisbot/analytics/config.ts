import Constants from "expo-constants";
import { isDev, isWeb } from "@/constants/platform";

const configuration = Constants.expoConfig?.extra?.productAnalytics;
// Static Expo web exports do not carry expoConfig.extra; use an inlined public
// build flag there. Native builds still require the configured SDK and files.
export const analyticsAvailable =
  !isDev &&
  (isWeb ? process.env.EXPO_PUBLIC_CLISBOT_ANALYTICS !== "0" : configuration?.enabled === true);
export const analyticsNativeConfigured = configuration?.nativeConfigured === true;
export const WEB_MEASUREMENT_ID = "G-YB48G0QD0C";
export const DESKTOP_COLLECTOR = "https://clisbot.com/api/analytics/desktop";
