import type { ComponentType } from "react";
import {
  Info,
  Network,
  Blocks,
  KeyRound,
  MessageSquare,
  Server,
  ServerCog,
  UserRound,
  UsersRound,
  Workflow,
} from "lucide-react-native";
import { i18n } from "@/i18n/i18next";
import type { HubSectionSlug } from "../navigation";

export interface HubSettingsNavigationItem {
  section: HubSectionSlug;
  label: string;
  icon: ComponentType<{ size: number; color: string }>;
}

// Labels resolve when the list is built, so a language change shows on the next render.
const HUBS_ITEM = (): HubSettingsNavigationItem => ({
  section: "hubs",
  label: i18n.t("hub.settings.navigation.hubs"),
  icon: Network,
});
const OVERVIEW_ITEM = (): HubSettingsNavigationItem => ({
  section: "overview",
  label: i18n.t("hub.settings.navigation.overview"),
  icon: Info,
});
const SIGN_IN_ITEM = (): HubSettingsNavigationItem => ({
  section: "sign-in",
  label: i18n.t("hub.settings.navigation.accountSignIn"),
  icon: KeyRound,
});
const ACCOUNT_ITEM = (): HubSettingsNavigationItem => ({
  section: "account",
  label: i18n.t("hub.settings.navigation.account"),
  icon: UserRound,
});
const CHANNELS_ITEM = (): HubSettingsNavigationItem => ({
  section: "channels",
  label: i18n.t("hub.settings.navigation.channels"),
  icon: MessageSquare,
});
const AUTOMATIONS_ITEM = (): HubSettingsNavigationItem => ({
  section: "automations",
  label: i18n.t("hub.settings.navigation.automations"),
  icon: Workflow,
});
const PEOPLE_ITEM = (): HubSettingsNavigationItem => ({
  section: "team",
  label: i18n.t("hub.settings.navigation.peopleAndAccess"),
  icon: UsersRound,
});
const HOSTS_ITEM = (): HubSettingsNavigationItem => ({
  section: "hosts",
  label: i18n.t("hub.settings.navigation.hosts"),
  icon: Server,
});
const INTEGRATIONS_ITEM = (): HubSettingsNavigationItem => ({
  section: "integrations",
  label: i18n.t("hub.settings.navigation.integrations"),
  icon: Blocks,
});
const INSTANCE_ITEM = (): HubSettingsNavigationItem => ({
  section: "instance",
  label: i18n.t("hub.settings.navigation.instanceSettings"),
  icon: ServerCog,
});

/** People holds Access as a tab: managing people and what they may use is one job. */
const SIGNED_IN_ITEMS = (): readonly HubSettingsNavigationItem[] => [
  CHANNELS_ITEM(),
  AUTOMATIONS_ITEM(),
  PEOPLE_ITEM(),
  INTEGRATIONS_ITEM(),
];

/** One effective grant of the viewer, enough to decide which destinations they can use. */
export interface HubNavigationGrant {
  resourceKind: string;
  privileges: readonly string[];
}

/**
 * Which Hub destinations a Member reaches without the organization's management role:
 * Channels when they administer a Connection, Automations when they may run or create one,
 * and People always (their own access). Hosts lives in the Host group for every account state.
 * Instance settings are the Hub operator's alone.
 */
export function hubSettingsNavigationItems(input: {
  signedIn: boolean;
  deviceAccess?: boolean;
  canManage?: boolean;
  isInstanceOperator?: boolean;
  grants?: readonly HubNavigationGrant[];
}): readonly HubSettingsNavigationItem[] {
  if (!input.signedIn) {
    return input.deviceAccess
      ? [OVERVIEW_ITEM(), { ...ACCOUNT_ITEM(), icon: KeyRound }]
      : [
          {
            section: "account",
            label: i18n.t("hub.settings.navigation.signInToHub"),
            icon: KeyRound,
          },
        ];
  }
  const overview = input.deviceAccess ? [OVERVIEW_ITEM()] : [];
  const instance = input.isInstanceOperator ? [INSTANCE_ITEM()] : [];
  if (input.canManage) return [...overview, ACCOUNT_ITEM(), ...SIGNED_IN_ITEMS(), ...instance];
  const holds = (kind: string, privilege: string) =>
    input.grants?.some(
      (grant) => grant.resourceKind === kind && grant.privileges.includes(privilege),
    ) === true;
  const destinations = [
    ...(holds("channel_account", "channel.manage") ? [CHANNELS_ITEM()] : []),
    ...(holds("automation", "automation.run") ||
    holds("project", "project.use") ||
    holds("daemon", "project.use")
      ? [AUTOMATIONS_ITEM()]
      : []),
    PEOPLE_ITEM(),
  ];
  return [...overview, ACCOUNT_ITEM(), ...destinations, ...instance];
}

export function hubSettingsSection(section: HubSectionSlug): HubSettingsNavigationItem {
  const item = [
    HUBS_ITEM(),
    OVERVIEW_ITEM(),
    ACCOUNT_ITEM(),
    SIGN_IN_ITEM(),
    ...SIGNED_IN_ITEMS(),
    HOSTS_ITEM(),
    INSTANCE_ITEM(),
  ].find((candidate) => candidate.section === section);
  return item ?? ACCOUNT_ITEM();
}
