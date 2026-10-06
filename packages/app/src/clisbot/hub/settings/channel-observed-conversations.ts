import { type AudienceNames } from "./channel-route-rule-summary";
import { useMemo } from "react";
import type { z } from "zod";
import { useFetchQuery } from "@/data/query";
import { useHubAccount } from "../account-provider";
import { hubResourceQueryKey } from "../query-keys";
import { HubObservedChannelConversationsSchema } from "../contracts";
import { type HubTeam } from "./channel-settings-types";
import { channelLabel } from "./channel-settings-records";

/** The conversations the bot has seen on one account, for naming stored ids. */
export function useObservedConversations(
  channel: string | null,
  accountId: string | null,
  enabled: boolean,
) {
  const hub = useHubAccount();
  const organizationId = hub.signedIn?.organization.id ?? "";
  return useFetchQuery({
    queryKey: [
      ...hubResourceQueryKey(
        {
          origin: hub.origin,
          organizationId,
          accountId: hub.signedIn?.account.id ?? null,
        },
        "channel-conversations",
      ),
      channel,
      accountId,
    ],
    queryFn: () =>
      hub
        .api()
        .get(
          `channel-accounts/${encodeURIComponent(channel!)}/${encodeURIComponent(accountId!)}/conversations`,
          HubObservedChannelConversationsSchema,
        ),
    enabled: enabled && organizationId.length > 0 && channel !== null && accountId !== null,
    retry: false,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
}

/** Names for the ids audience rules store: Teams, Members and observed conversations. */
export function useAudienceNames(
  metadata: z.infer<typeof HubObservedChannelConversationsSchema> | undefined,
  teams: readonly HubTeam[] = [],
): AudienceNames {
  const hub = useHubAccount();
  const members = hub.signedIn?.team?.members;
  return useMemo(
    () => ({
      teamName: (id) => teams.find((team) => team.id === id)?.name ?? id,
      memberName: (id) => members?.find((member) => member.id === id)?.name ?? id,
      conversationLabel: (id) => channelDestinationLabel(id, metadata),
    }),
    [members, metadata, teams],
  );
}

/** A conversation id as the observed directory names it; a private room carries a lock. */
export function channelDestinationLabel(
  id: string,
  metadata: z.infer<typeof HubObservedChannelConversationsSchema> | undefined,
): string {
  const candidates = [...(metadata?.destinations ?? []), ...(metadata?.conversations ?? [])];
  const named = candidates.find((item) => item.id === id && item.label);
  if (!named?.label || named.label === id) return id;
  const lock = named.visibility === "private" ? "🔒 " : "";
  if (named.threadId !== null) return `${lock}${named.label} · ${channelLabel(named.kind)} ${id}`;
  return `${lock}${named.label} (${id})`;
}
