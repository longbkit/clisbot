import { digest } from "@clisbot/device-access/proof";
import { z } from "zod";

const Credential = z.object({
  issuer: z.string(),
  refreshToken: z.string(),
  generation: z.string(),
});
export type OAuthCredential = z.infer<typeof Credential>;

export function oauthCredentialKey(origin: string): string {
  // Never reuse the old 32-bit native key: its owner cannot be recovered safely.
  return `clisbot.hub.oauth.v2.${digest(origin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

export function parseOAuthCredential(value: string | null, issuer: string): OAuthCredential | null {
  try {
    const parsed = Credential.safeParse(JSON.parse(value ?? "null"));
    return parsed.success && parsed.data.issuer === issuer ? parsed.data : null;
  } catch {
    return null;
  }
}
