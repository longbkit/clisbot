const fs = require("node:fs");
const path = require("node:path");

const configured = (key, fallback) =>
  fs.existsSync(process.env[key] || path.join(__dirname, fallback));
const nativeAnalytics =
  (process.env.APP_VARIANT ?? "production") === "production" &&
  process.env.CLISBOT_FDROID_BUILD !== "1" &&
  process.env.EXPO_PUBLIC_CLISBOT_ANALYTICS !== "0" &&
  configured("GOOGLE_SERVICES_FILE_PROD", ".secrets/google-services.prod.json") &&
  configured("GOOGLE_SERVICE_INFO_PLIST_PROD", ".secrets/GoogleService-Info.prod.plist");

module.exports = {
  dependencies: Object.fromEntries(
    ["@react-native-firebase/app", "@react-native-firebase/analytics"].map((name) => [
      name,
      { platforms: nativeAnalytics ? {} : { android: null, ios: null } },
    ]),
  ),
};
