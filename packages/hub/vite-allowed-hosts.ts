type Environment = Record<string, string | undefined>;

export function resolveAllowedHosts(environment: Environment = process.env): string[] {
  const appUrl = environment["PASEO_HUB_APP_URL"]?.trim();
  if (!appUrl) return [];

  try {
    const hostname = new URL(appUrl).hostname;
    return hostname ? [hostname] : [];
  } catch {
    // Runtime configuration reports the canonical invalid-URL error.
    return [];
  }
}
