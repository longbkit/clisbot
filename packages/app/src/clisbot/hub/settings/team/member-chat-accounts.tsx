import { useCallback } from "react";
import { Text, View } from "react-native";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { channelIdentityLine } from "../../channel-identity-directory";
import { useChannelCatalog } from "../channel-catalog-queries";
import { ChannelIdentityLinkForm } from "../channel-identity-link-form";
import { EmptyRow } from "../resource-rows";
import type { HubAccount, HubIdentity, HubMember, HubRun, TeamResources } from "./types";
import { useIdentityActions } from "./use-people-actions";

/** The chat accounts the Member is recognized from, and the operator's way to link one by hand. */
export function MemberChatAccounts({
  hub,
  member,
  resources,
  run,
  pending,
}: {
  hub: HubAccount;
  member: HubMember;
  resources: TeamResources;
  run: HubRun;
  pending: boolean;
}) {
  const catalog = useChannelCatalog();
  const { unlink, link } = useIdentityActions(hub, resources, run);
  const identities = (resources.identities.data?.identities ?? []).filter(
    ({ memberId }) => memberId === member.id,
  );
  const connections = resources.connections.data?.connections ?? [];
  return (
    <SettingsSection
      title="Chat accounts"
      info="One Member can link several chat accounts. A link covers its identity realm: every Telegram, Discord, or Google Chat bot; one Slack workspace; or one Feishu or Zalo bot."
    >
      <View style={settingsStyles.card}>
        {identities.length === 0 ? (
          <EmptyRow message="No chat accounts linked" />
        ) : (
          identities.map((identity, index) => (
            <View
              key={identity.id}
              style={[settingsStyles.row, index > 0 ? settingsStyles.rowBorder : null]}
            >
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>
                  {identity.displayName ?? identity.externalSubjectId}
                </Text>
                <Text style={settingsStyles.rowHint}>
                  {`${channelIdentityLine(catalog.entries, identity, connections)} · ${identity.externalSubjectId}`}
                </Text>
              </View>
              <UnlinkButton identity={identity} pending={pending} unlink={unlink} />
            </View>
          ))
        )}
      </View>
      {hub.signedIn?.isInstanceOperator === true ? (
        <ChannelIdentityLinkForm
          memberId={member.id}
          connections={connections}
          catalog={catalog.entries}
          pending={pending}
          link={link}
        />
      ) : (
        <Alert
          variant="info"
          title="Members link their own chat accounts"
          description="Ask the Member to link from Account → Chat accounts. Only an instance operator links an account by its raw provider id."
        />
      )}
    </SettingsSection>
  );
}

function UnlinkButton({
  identity,
  pending,
  unlink,
}: {
  identity: HubIdentity;
  pending: boolean;
  unlink(id: string): Promise<void>;
}) {
  const press = useCallback(() => void unlink(identity.id), [identity.id, unlink]);
  return (
    <Button size="xs" variant="ghost" disabled={pending} onPress={press}>
      Unlink
    </Button>
  );
}
