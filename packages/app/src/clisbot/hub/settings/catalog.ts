import type { ComponentType } from "react";
import {
  Blocks,
  KeyRound,
  MessageSquare,
  Server,
  ServerCog,
  UserRound,
  UsersRound,
  Workflow,
} from "lucide-react-native";
import type { HubSectionSlug } from "../navigation";

export interface HubSettingsNavigationItem {
  section: HubSectionSlug;
  label: string;
  icon: ComponentType<{ size: number; color: string }>;
}

const ACCOUNT_ITEM: HubSettingsNavigationItem = {
  section: "account",
  label: "Account",
  icon: UserRound,
};

const CHANNELS_ITEM: HubSettingsNavigationItem = {
  section: "channels",
  label: "Channels",
  icon: MessageSquare,
};
const AUTOMATIONS_ITEM: HubSettingsNavigationItem = {
  section: "automations",
  label: "Automations",
  icon: Workflow,
};
const PEOPLE_ITEM: HubSettingsNavigationItem = {
  section: "team",
  label: "People & access",
  icon: UsersRound,
};
const HOSTS_ITEM: HubSettingsNavigationItem = { section: "hosts", label: "Hosts", icon: Server };
const INTEGRATIONS_ITEM: HubSettingsNavigationItem = {
  section: "integrations",
  label: "Integrations",
  icon: Blocks,
};
const INSTANCE_ITEM: HubSettingsNavigationItem = {
  section: "instance",
  label: "Instance settings",
  icon: ServerCog,
};

/** People holds Access as a tab: managing people and what they may use is one job. */
const SIGNED_IN_ITEMS: readonly HubSettingsNavigationItem[] = [
  CHANNELS_ITEM,
  AUTOMATIONS_ITEM,
  PEOPLE_ITEM,
  HOSTS_ITEM,
  INTEGRATIONS_ITEM,
];

/** One effective grant of the viewer, enough to decide which destinations they can use. */
export interface HubNavigationGrant {
  resourceKind: string;
  privileges: readonly string[];
}

/**
 * Which Hub destinations a Member reaches without the organization's management role:
 * Channels when they administer a Connection, Automations when they may run or create one,
 * and People and Hosts always (their own access, and the Hosts they may use and open).
 * Instance settings are the Hub operator's alone.
 */
export function hubSettingsNavigationItems(input: {
  signedIn: boolean;
  canManage?: boolean;
  isInstanceOperator?: boolean;
  grants?: readonly HubNavigationGrant[];
}): readonly HubSettingsNavigationItem[] {
  if (!input.signedIn) {
    return [{ section: "account", label: "Sign in to Hub", icon: KeyRound }];
  }
  const instance = input.isInstanceOperator ? [INSTANCE_ITEM] : [];
  if (input.canManage) return [ACCOUNT_ITEM, ...SIGNED_IN_ITEMS, ...instance];
  const holds = (kind: string, privilege: string) =>
    input.grants?.some(
      (grant) => grant.resourceKind === kind && grant.privileges.includes(privilege),
    ) === true;
  const destinations = [
    ...(holds("channel_account", "channel.manage") ? [CHANNELS_ITEM] : []),
    ...(holds("automation", "automation.run") ||
    holds("project", "project.use") ||
    holds("daemon", "project.use")
      ? [AUTOMATIONS_ITEM]
      : []),
    PEOPLE_ITEM,
    HOSTS_ITEM,
  ];
  return [ACCOUNT_ITEM, ...destinations, ...instance];
}

export function hubSettingsSection(section: HubSectionSlug): HubSettingsNavigationItem {
  const item = [ACCOUNT_ITEM, ...SIGNED_IN_ITEMS, INSTANCE_ITEM].find(
    (candidate) => candidate.section === section,
  );
  return item ?? ACCOUNT_ITEM;
}
