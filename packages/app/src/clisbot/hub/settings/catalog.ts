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

const SIGNED_IN_ITEMS: readonly HubSettingsNavigationItem[] = [
  { section: "channels", label: "Channels", icon: MessageSquare },
  { section: "automations", label: "Automations", icon: Workflow },
  { section: "team", label: "Team", icon: UsersRound },
  { section: "access", label: "Access", icon: ShieldCheck },
  { section: "configuration", label: "Configuration", icon: Settings2 },
];

const MEMBER_ITEMS: readonly HubSettingsNavigationItem[] = [
  { section: "access", label: "Access", icon: ShieldCheck },
];

export function hubSettingsNavigationItems(input: {
  signedIn: boolean;
  canManage?: boolean;
  canRunAutomations?: boolean;
}): readonly HubSettingsNavigationItem[] {
  if (!input.signedIn) {
    return [{ section: "account", label: "Sign in to Hub", icon: KeyRound }];
  }
  let destinations = MEMBER_ITEMS;
  if (input.canManage) destinations = SIGNED_IN_ITEMS;
  else if (input.canRunAutomations) {
    destinations = [
      { section: "automations", label: "Automations", icon: Workflow },
      ...MEMBER_ITEMS,
    ];
  }
  return destinations;
}

export function hubSettingsSection(section: HubSectionSlug): HubSettingsNavigationItem {
  const item = [
    { section: "account" as const, label: "Account", icon: UserRound },
    ...SIGNED_IN_ITEMS,
  ].find((candidate) => candidate.section === section);
  return item ?? { section: "configuration", label: "Configuration", icon: Cable };
}
