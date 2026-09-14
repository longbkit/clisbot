import { deriveIdentityColorName, identityColor } from "@/styles/identity-colors";
import { nameInitials } from "@/utils/name-initials";

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
  const initials = nameInitials(name, email.at(0));
  const tooltip = name || email || "Hub account";

  return {
    accessibilityLabel: `Hub account: ${tooltip}`,
    color: identityColor(deriveIdentityColorName(account.id || email || name)),
    initials,
    tooltip,
  };
}
