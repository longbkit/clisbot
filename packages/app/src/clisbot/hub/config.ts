import Constants from "expo-constants";
import { Platform } from "react-native";
import { z } from "zod";

const HubConfigurationSchema = z.object({ origin: z.string().url() }).strict();

declare global {
  interface Window {
    __CLISBOT_HUB_ENABLED__?: boolean;
  }
}

export interface HubConfiguration {
  origin: string;
  deviceProfile?: import("@/device-access/hub-profiles").HubProfile;
}

export function getHubConfiguration(): HubConfiguration | null {
  const browserOrigin =
    Platform.OS === "web" && typeof window !== "undefined" && window.clisbotDesktop === undefined
      ? window.location.origin
      : undefined;
  return resolveHubConfiguration(
    Constants.expoConfig?.extra?.clisbotHub,
    browserOrigin,
    browserOrigin !== undefined && window.__CLISBOT_HUB_ENABLED__ === true,
  );
}

export function resolveHubConfiguration(
  input: unknown,
  browserOrigin?: string,
  runtimeEnabled = false,
): HubConfiguration | null {
  const configured = parseHubConfiguration(
    runtimeEnabled && browserOrigin ? { origin: browserOrigin } : input,
  );
  if (configured === null || browserOrigin === undefined) return configured;

  // Browser Hub access is deliberately same-origin so its HTTP-only session
  // cookie never crosses origins. Resolve the public reverse-proxy origin at
  // runtime instead of trusting a Metro-cached build-time hostname.
  return parseHubConfiguration({ origin: browserOrigin });
}

export function parseHubConfiguration(input: unknown): HubConfiguration | null {
  const parsed = HubConfigurationSchema.safeParse(input);
  if (!parsed.success) return null;
  try {
    const url = new URL(parsed.data.origin);
    const loopbackHttp =
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "localhost");
    if (
      (url.protocol !== "https:" && !loopbackHttp) ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return null;
    }
    return { origin: url.origin };
  } catch {
    return null;
  }
}
