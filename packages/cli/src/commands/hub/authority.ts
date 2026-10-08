import type { HubCredentialStore } from "./credentials.js";
import { HubCommandError } from "./error.js";
import { normalizeHubOrigin } from "./origin.js";

export interface HubAuthorityOptions {
  origin?: string;
  apiKey?: string;
}

interface ResolveHubInput {
  options: HubAuthorityOptions;
  env: Readonly<Record<string, string | undefined>>;
  credentials: HubCredentialStore;
}

// Clisbot has no hosted Hub, so an unresolved origin is an error rather than a fallback host.
export function resolveHubOrigin(input: ResolveHubInput): string {
  const configuredOrigin = input.options.origin ?? input.env.CLISBOT_HUB_URL;
  const selectedOrigin = configuredOrigin ?? input.credentials.active()?.origin;
  if (selectedOrigin === undefined) {
    throw new HubCommandError(
      "HUB_ORIGIN_REQUIRED",
      "No Hub selected. Pass the Hub URL (for example `clisbot hub login https://hub.example.com`) or set CLISBOT_HUB_URL.",
    );
  }
  return normalizeHubOrigin(selectedOrigin);
}

export function resolveHubCredential(input: ResolveHubInput & { origin: string }): string {
  const explicitCredential = input.options.apiKey ?? input.env.CLISBOT_HUB_API_KEY;
  if (explicitCredential !== undefined) return explicitCredential;
  const stored = input.credentials.get(input.origin);
  if (stored !== null) return stored.credential;
  throw new HubCommandError(
    "HUB_API_KEY_REQUIRED",
    `No stored Hub login matches ${input.origin}. Run \`clisbot hub login ${input.origin}\`, pass --api-key <secret>, or set CLISBOT_HUB_API_KEY.`,
  );
}
