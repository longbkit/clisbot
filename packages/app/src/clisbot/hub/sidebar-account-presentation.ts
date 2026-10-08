import { deriveIdentityColorName, identityColor } from "@/styles/identity-colors";
import { nameInitials } from "@/utils/name-initials";
import { i18n } from "@/i18n/i18next";

export interface HubSidebarAccountPresentation {
  accessibilityLabel: string;
  color: string;
  initials: string;
  tooltip: string;
}

export function resolveHubSidebarAccountPresentation(input: {
  enabled: boolean;
  account: { id: string; name: string; email: string } | null;
  organizationName?: string;
}): HubSidebarAccountPresentation | null {
  if (!input.enabled || input.account === null) return null;

  const { account } = input;
  const name = account.name.trim();
  const email = account.email.trim();
  const initials = nameInitials(name, email.at(0));
  const accountLabel = name || email || i18n.t("hub.account.sidebar.hubAccount");
  const tooltip = input.organizationName
    ? `${accountLabel} · ${input.organizationName}`
    : accountLabel;

  return {
    accessibilityLabel: i18n.t("hub.account.sidebar.accountLabel", { label: tooltip }),
    color: identityColor(deriveIdentityColorName(account.id || email || name)),
    initials,
    tooltip,
  };
}
