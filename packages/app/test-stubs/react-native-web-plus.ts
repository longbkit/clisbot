// Alias target for `react-native`: everything the web build provides, plus the
// native-module seams that prebundled native packages (react-native-gesture-handler,
// expo-modules-core) still import even on web. Their values stay inert: the web
// renderer never resolves native modules.
//
// Re-export through the bare `react-native-web` specifier (not a relative path):
// a relative path into node_modules makes Vite serve the file via /@fs/ and skip
// dependency pre-bundling, which breaks its nested CJS deps (e.g.
// @react-native/normalize-colors) in the browser.
import * as RN from "react-native-web";

export * from "react-native-web";
export default RN;

export const TurboModuleRegistry = {
  get: () => null,
  getEnforcing: () => null,
  set: () => undefined,
};
export const TurboModule = null;
export const DrawerLayoutAndroid = RN.View;

export const ToastAndroid = {
  SHOW_LONG: 0,
  SHOW_SHORT: 1,
  show: () => undefined,
  showWithGravity: () => undefined,
  showWithGravityAndOffset: () => undefined,
};
