import Constants from "expo-constants";
import { Platform } from "react-native";

/** F-Droid build without proprietary camera or notification dependencies. */
export const isFdroidBuild = Constants.expoConfig?.extra?.fdroidBuild === true;

/** Production-like Android build with local profiling enabled. */
export const isProfileBuild = Constants.expoConfig?.extra?.profileBuild === true;

/** Explicit disposable Android renderer diagnostic; never ordinary web/desktop/production. */
export const isSyntheticReactProfileBuild =
  Platform.OS === "android" &&
  isProfileBuild &&
  Constants.expoConfig?.extra?.reactProfile === true &&
  Constants.expoConfig?.android?.package === "com.clisbot.app.dev";
