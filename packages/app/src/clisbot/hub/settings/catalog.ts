import type { ComponentType } from "react";
import {
  Cable,
  KeyRound,
  MessageSquare,
  Settings2,
  ShieldCheck,
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
  label: "People",
  icon: UsersRound,
};
const ACCESS_ITEM: HubSettingsNavigationItem = {
  section: "access",
  label: "Access",
  icon: ShieldCheck,
};

const SIGNED_IN_ITEMS: readonly HubSettingsNavigationItem[] = [
  CHANNELS_ITEM,
  AUTOMATIONS_ITEM,
  PEOPLE_ITEM,
  ACCESS_ITEM,
  { section: "configuration", label: "Configuration", icon: Settings2 },
];

/** One effective grant of the viewer, enough to decide which destinations they can use. */
export interface HubNavigationGrant {
  resourceKind: string;
  privileges: readonly string[];
}

/**
 * Which Hub destinations a Member reaches without the organization's management role:
 * Channels when they administer a Connection, Automations when they may run or create one,
 * People when they administer a Team, and Access always (their own effective access).
 */
export function hubSettingsNavigationItems(input: {
  signedIn: boolean;
  canManage?: boolean;
  grants?: readonly HubNavigationGrant[];
}): readonly HubSettingsNavigationItem[] {
  if (!input.signedIn) {
    return [{ section: "account", label: "Sign in to Hub", icon: KeyRound }];
  }
  if (input.canManage) return [ACCOUNT_ITEM, ...SIGNED_IN_ITEMS];
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
    ...(holds("team", "hub.access.manage") ? [PEOPLE_ITEM] : []),
    ACCESS_ITEM,
  ];
  return [ACCOUNT_ITEM, ...destinations];
}

export function hubSettingsSection(section: HubSectionSlug): HubSettingsNavigationItem {
  const item = [ACCOUNT_ITEM, ...SIGNED_IN_ITEMS].find(
    (candidate) => candidate.section === section,
  );
  return item ?? { section: "configuration", label: "Configuration", icon: Cable };
}
