import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
import type {
  HubAccount,
  HubConnection,
  HubIdentity,
  HubMember,
  HubRun,
  TeamResources,
} from "./types";
import { useIdentityActions } from "./use-people-actions";

const NO_IDENTITIES: HubIdentity[] = [];
const NO_CONNECTIONS: HubConnection[] = [];

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
  const { t } = useTranslation();
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
  const identities = (resources.identities.data?.identities ?? NO_IDENTITIES).filter(
    ({ memberId }) => memberId === member.id,
  );
  const connections = resources.connections.data?.connections ?? NO_CONNECTIONS;
  const operator = hub.signedIn?.isInstanceOperator === true;
  const linkButton = useMemo(
    () =>
      operator ? (
        <Button size="sm" variant="outline" disabled={pending} onPress={open}>
          {t("hub.team.memberDetail.chat.linkAccount")}
        </Button>
      ) : null,
    [open, operator, pending, t],
  );
  const header = useMemo(
    () => ({ title: t("hub.team.memberDetail.chat.linkTitle", { name: member.name }) }),
    [member.name, t],
  );
  return (
    <SettingsSection
      title={t("hub.team.memberDetail.chat.title")}
      info={t("hub.team.memberDetail.chat.info")}
      trailing={linkButton}
    >
      <View style={settingsStyles.card}>
        {identities.length === 0 ? (
          <View style={[settingsStyles.row, tableStyles.body]}>
            <Text style={settingsStyles.rowHint}>{t("hub.team.memberDetail.chat.none")}</Text>
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
                    ? t("hub.team.memberDetail.chat.account", { id: identity.externalSubjectId })
                    : t("hub.team.memberDetail.chat.namedAccount", {
                        name: identity.displayName,
                        id: identity.externalSubjectId,
                      })}
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
  const { t } = useTranslation();
  const items = useMemo(
    () => [
      {
        label: t("hub.team.memberDetail.chat.unlink"),
        destructive: true,
        disabled: pending,
        onSelect: () => void unlink(identity.id),
      },
    ],
    [identity.id, pending, t, unlink],
  );
  return (
    <RowActionsMenu
      label={t("hub.team.actions.actionsFor", {
        name: identity.displayName ?? identity.externalSubjectId,
      })}
      actions={items}
      disabled={pending}
    />
  );
}
