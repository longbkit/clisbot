import Constants from "expo-constants";
import { z } from "zod";

const HubConfigurationSchema = z.object({ origin: z.string().url() }).strict();

export interface HubConfiguration {
  origin: string;
}

export function getHubConfiguration(): HubConfiguration | null {
  return parseHubConfiguration(Constants.expoConfig?.extra?.clisbotHub);
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
