import { useCallback } from "react";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { i18n } from "@/i18n/i18next";
import { SettingsCard, SettingsSection } from "@/components/settings";
import { useHubAccount } from "../account-provider";
import {
  HubAutomationsSchema,
  HubChannelRuntimeStatusSchema,
  HubMembersSchema,
} from "../contracts";
import { buildHubSettingsRoute, type HubSectionSlug } from "../navigation";
import { useHubResource } from "./hub-resource";
import { SettingsLinkRow, type LinkRowTone } from "./settings-link-row";

interface ChannelAccount {
  channel: string;
  account: string;
  transport: string;
}

/**
 * The Hub's Overview names what the Hub runs — Channels, Automations, People — with a one-line
 * brief each and the way to its settings. Counts need the management role; without it a row
 * still links to the page, which shows the viewer what they may see.
 */
export function HubOverviewDestinations() {
  const { t } = useTranslation();
  const hub = useHubAccount();
  const canManage = hub.signedIn?.capabilities.manageResources === true;
  const status = useHubResource(
    "channel-accounts/status",
    HubChannelRuntimeStatusSchema,
    canManage,
  );
  const automations = useHubResource("automations", HubAutomationsSchema, canManage);
  const members = useHubResource("members", HubMembersSchema, hub.signedIn !== null);
  const router = useRouter();
  const open = useCallback(
    (section: HubSectionSlug) => () => router.push(buildHubSettingsRoute(section)),
    [router],
  );
  if (!hub.signedIn) return null;
  const channels = canManage ? channelsBrief(status.data?.accounts, status.isLoading) : null;
  const automationCount = automations.data?.automations;
  return (
    <SettingsSection title={t("hub.settings.overviewDestinations.title")}>
      <SettingsCard>
        <SettingsLinkRow
          label={t("hub.settings.overviewDestinations.channels")}
          hint={channels?.names}
          value={channels?.value}
          tone={channels?.tone}
          onPress={open("channels")}
        />
        <SettingsLinkRow
          label={t("hub.settings.overviewDestinations.automations")}
          value={canManage ? automationsBrief(automationCount, automations.isLoading) : undefined}
          onPress={open("automations")}
        />
        <SettingsLinkRow
          label={t("hub.settings.overviewDestinations.peopleAndAccess")}
          value={peopleBrief(members.data?.members.length)}
          onPress={open("team")}
        />
      </SettingsCard>
    </SettingsSection>
  );
}

const ATTENTION = new Set(["failed", "needs-login", "stopped"]);

/** Which accounts run, and one value with a tone: "All running", "1 needs attention", "None yet". */
export function channelsBrief(
  accounts: readonly ChannelAccount[] | undefined,
  loading: boolean,
): { names?: string; value: string; tone: LinkRowTone } {
  if (!accounts) return { value: checkingOrUnavailable(loading), tone: "neutral" };
  const live = accounts.filter((account) => account.transport !== "disabled");
  if (live.length === 0) {
    return { value: i18n.t("hub.settings.overviewDestinations.noneYet"), tone: "neutral" };
  }
  const shown = live
    .slice(0, 3)
    .map((account) => `${capitalize(account.channel)} · ${account.account}`);
  const names = shown.join(", ") + (live.length > 3 ? ` +${live.length - 3}` : "");
  const attention = live.filter((account) => ATTENTION.has(account.transport)).length;
  return attention
    ? {
        names,
        value: i18n.t("hub.settings.overviewDestinations.needsAttention", { count: attention }),
        tone: "warning",
      }
    : { names, value: i18n.t("hub.settings.overviewDestinations.allRunning"), tone: "success" };
}

function checkingOrUnavailable(loading: boolean): string {
  return loading
    ? i18n.t("hub.settings.overviewDestinations.checking")
    : i18n.t("hub.settings.overviewDestinations.unavailable");
}

export function automationsBrief(
  automations: readonly { enabled: boolean }[] | undefined,
  loading: boolean,
): string {
  if (!automations) return checkingOrUnavailable(loading);
  if (automations.length === 0) return i18n.t("hub.settings.overviewDestinations.noneYet");
  const enabled = automations.filter((automation) => automation.enabled).length;
  return i18n.t("hub.settings.overviewDestinations.enabledOf", {
    enabled,
    total: automations.length,
  });
}

function peopleBrief(count: number | undefined): string | undefined {
  if (count === undefined) return undefined;
  return i18n.t("hub.settings.overviewDestinations.people", { count });
}

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
