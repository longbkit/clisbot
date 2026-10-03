import Constants from "expo-constants";
import { Platform } from "react-native";
import { getDesktopHost } from "@/desktop/host";
export function suggestedDeviceLabel(): string {
  const desktop = getDesktopHost();
  if (desktop) return `Clisbot Desktop (${desktop.platform ?? "computer"})`;
  if (Platform.OS === "web") {
    const agent = typeof navigator === "undefined" ? "" : navigator.userAgent;
    if (/Edg\//.test(agent)) return "Edge";
    if (/Firefox\//.test(agent)) return "Firefox";
    if (/(?:Chrome|CriOS)\//.test(agent)) return "Chrome";
    if (/Safari\//.test(agent)) return "Safari";
    return "Web browser";
  }
  const name = Constants.deviceName?.trim();
  if (name) return name.slice(0, 80);
  if (Platform.OS === "ios") return "iPhone / iPad";
  if (Platform.OS === "android") return "Android device";
  return "Web browser";
}
