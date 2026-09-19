import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { channelIdentityLine } from "../../channel-identity-directory";
import { useChannelCatalog } from "../channel-catalog-queries";
import { ChannelIdentityLinkForm } from "../channel-identity-link-form";
import { tableStyles } from "../table-styles";
import { RowActionsMenu } from "./row-actions-menu";
import type { HubAccount, HubIdentity, HubMember, HubRun, TeamResources } from "./types";
import { useIdentityActions } from "./use-people-actions";

const INFO =
  "One Member can link several chat accounts. A link covers its identity realm: every Telegram, Discord, or Google Chat bot; one Slack workspace; or one Feishu or Zalo bot. Members link their own from Account; only an instance operator links one by its raw provider id.";

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
  const [linking, setLinking] = useState(false);
  const open = useCallback(() => setLinking(true), []);
  const close = useCallback(() => setLinking(false), []);
  const linkThenClose = useCallback(
    async (body: Parameters<typeof link>[0]) => {
      const linked = await link(body);
      if (linked) close();
      return linked;
    },
    [close, link],
  );
  const identities = (resources.identities.data?.identities ?? []).filter(
    ({ memberId }) => memberId === member.id,
  );
  const connections = resources.connections.data?.connections ?? [];
  const operator = hub.signedIn?.isInstanceOperator === true;
  const linkButton = useMemo(
    () =>
      operator ? (
        <Button size="sm" variant="outline" disabled={pending} onPress={open}>
          Link account…
        </Button>
      ) : null,
    [open, operator, pending],
  );
  const header = useMemo(() => ({ title: `Link a chat account to ${member.name}` }), [member.name]);
  return (
    <SettingsSection title="Chat accounts" info={INFO} trailing={linkButton}>
      <View style={settingsStyles.card}>
        {identities.length === 0 ? (
          <View style={[settingsStyles.row, tableStyles.body]}>
            <Text style={settingsStyles.rowHint}>No chat accounts linked yet.</Text>
          </View>
        ) : (
          identities.map((identity, index) => (
            // Where they chat reads first; the account on that platform is the detail under it.
            <View
              key={identity.id}
              style={[
                settingsStyles.row,
                index > 0 ? settingsStyles.rowBorder : null,
                tableStyles.body,
              ]}
            >
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>
                  {channelIdentityLine(catalog.entries, identity, connections)}
                </Text>
                <Text style={settingsStyles.rowHint}>
                  {identity.displayName === null || identity.displayName === undefined
                    ? `Account ${identity.externalSubjectId}`
                    : `${identity.displayName} · ${identity.externalSubjectId}`}
                </Text>
              </View>
              <IdentityMenu identity={identity} pending={pending} unlink={unlink} />
            </View>
          ))
        )}
      </View>
      {linking ? (
        <AdaptiveModalSheet visible header={header} onClose={close} desktopMaxWidth={520}>
          <ChannelIdentityLinkForm
            memberId={member.id}
            connections={connections}
            catalog={catalog.entries}
            pending={pending}
            link={linkThenClose}
          />
        </AdaptiveModalSheet>
      ) : null}
    </SettingsSection>
  );
}

function IdentityMenu({
  identity,
  pending,
  unlink,
}: {
  identity: HubIdentity;
  pending: boolean;
  unlink(id: string): Promise<void>;
}) {
  const items = useMemo(
    () => [
      {
        label: "Unlink",
        destructive: true,
        disabled: pending,
        onSelect: () => void unlink(identity.id),
      },
    ],
    [identity.id, pending, unlink],
  );
  return (
    <RowActionsMenu
      label={`Actions for ${identity.displayName ?? identity.externalSubjectId}`}
      actions={items}
      disabled={pending}
    />
  );
}
