import Constants from "expo-constants";
import { Platform } from "react-native";
import { getDesktopHost } from "@/desktop/host";

const SUFFIX_KEY = "clisbot.device-label-suffix";
let sessionSuffix: string | null = null;

// The default name a Host or Hub shows in its device list. It starts with
// "Clisbot" so the owner knows which app paired, and ends with a short random
// tag so two Chromes on two Macs do not look identical.
export function suggestedDeviceLabel(): string {
  const desktop = getDesktopHost();
  if (desktop) return `Clisbot Desktop on ${systemName(desktop.platform)} · ${deviceSuffix()}`;
  if (Platform.OS === "web") {
    const agent = typeof navigator === "undefined" ? "" : navigator.userAgent;
    return `Clisbot · ${browserName(agent)} on ${systemName(agent)} · ${deviceSuffix()}`;
  }
  const name = Constants.deviceName?.trim();
  if (name) return `Clisbot · ${name}`.slice(0, 80);
  const device = Platform.OS === "ios" ? "iPhone / iPad" : "Android";
  return `Clisbot · ${device} · ${deviceSuffix()}`;
}

function browserName(agent: string): string {
  if (/Edg\//.test(agent)) return "Edge";
  if (/Firefox\//.test(agent)) return "Firefox";
  if (/(?:Chrome|CriOS)\//.test(agent)) return "Chrome";
  if (/Safari\//.test(agent)) return "Safari";
  return "Browser";
}

// Accepts a user agent or a Node `process.platform` value from the desktop host.
function systemName(source: string | undefined): string {
  const value = source ?? "";
  if (/iPhone|iPad|iOS/.test(value)) return "iOS";
  if (/Android/.test(value)) return "Android";
  if (/CrOS/.test(value)) return "ChromeOS";
  if (/Mac OS X|Macintosh|^darwin$/.test(value)) return "macOS";
  if (/Windows|^win32$/.test(value)) return "Windows";
  if (/Linux|^linux$/.test(value)) return "Linux";
  return "computer";
}

// Stable per browser profile where storage exists, so re-pairing proposes the
// same name; otherwise stable for this app run.
function deviceSuffix(): string {
  const storage = readableStorage();
  const stored = storage?.getItem(SUFFIX_KEY);
  if (stored) return stored;
  sessionSuffix ??= Math.random().toString(36).slice(2, 6).padEnd(4, "0");
  storage?.setItem(SUFFIX_KEY, sessionSuffix);
  return sessionSuffix;
}

function readableStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
