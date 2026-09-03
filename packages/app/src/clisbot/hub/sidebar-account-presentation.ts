import { deriveIdentityColorName, identityColor } from "@/styles/identity-colors";

export interface HubSidebarAccountPresentation {
  accessibilityLabel: string;
  color: string;
  initials: string;
  tooltip: string;
}

export function resolveHubSidebarAccountPresentation(input: {
  enabled: boolean;
  account: { id: string; name: string; email: string } | null;
}): HubSidebarAccountPresentation | null {
  if (!input.enabled || input.account === null) return null;

  const { account } = input;
  const name = account.name.trim();
  const email = account.email.trim();
  const words = name.split(/\s+/u).filter(Boolean);
  const first = words.at(0)?.at(0);
  const last = words.length > 1 ? words.at(-1)?.at(0) : undefined;
  const fallback = email.at(0);
  const initials = `${first ?? fallback ?? "?"}${last ?? ""}`.toUpperCase();
  const tooltip = name || email || "Hub account";

  return {
    accessibilityLabel: `Hub account: ${tooltip}`,
    color: identityColor(deriveIdentityColorName(account.id || email || name)),
    initials,
    tooltip,
  };
}
