import { z } from "zod";
import { parseHubConfiguration } from "./config";
import { readPublicHubIdentityResponse } from "@/device-access/hub-identity-check";
import type { HubProfile } from "@/device-access/hub-profiles";

const AccountConnectionSchema = z.object({
  authentication: z.literal("oauth"),
  issuer: z.string().url(),
});

/** Discover account entry without cookies. Never accept an issuer on another origin. */
export async function discoverAccountHub(origin: string): Promise<HubProfile | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(new URL("/api/auth/clisbot/connection", origin), {
      credentials: "omit",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const value = AccountConnectionSchema.safeParse(
      await readPublicHubIdentityResponse(response, controller),
    );
    if (!value.success || value.data.issuer !== origin || !parseHubConfiguration({ origin }))
      return null;
    return {
      authentication: "oauth",
      hubId: origin,
      origin,
      label: new URL(origin).hostname.slice(0, 80),
      entry: "account",
    };
  } catch {
    // Older and protected Hubs are discovered through their existing device endpoint.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
