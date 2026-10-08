import { Building2 } from "lucide-react-native";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";
import type { useHubAccount } from "../account-provider";
import type { HubAccountState } from "../contracts";
import { organizationRoleLabel } from "./labels";

type HubAccount = ReturnType<typeof useHubAccount>;
type HubRun = (operation: () => Promise<void>) => Promise<void>;
type OrganizationRequiredState = Extract<HubAccountState, { status: "organizationRequired" }>;
type Membership = OrganizationRequiredState["memberships"][number];

const ThemedBuilding = withUnistyles(Building2);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * A signed-in session without an active organization picks one (each a row with the Member's role
 * and an explicit Open action), or creates the first when it has none.
 */
export function OrganizationSelection({
  hub,
  pending,
  run,
  state,
  organizationName,
  setOrganizationName,
  canCreate,
}: {
  hub: HubAccount;
  pending: boolean;
  run: HubRun;
  state: OrganizationRequiredState;
  organizationName: string;
  setOrganizationName(name: string): void;
  canCreate: boolean;
}) {
  const { t } = useTranslation();
  const signOut = useCallback(() => void run(hub.signOut), [hub.signOut, run]);
  const hasMemberships = state.memberships.length > 0;
  const email = state.account.email;
  return (
    <SettingsSection
      title={
        hasMemberships
          ? t("hub.settings.organizationSelection.chooseTitle")
          : t("hub.settings.organizationSelection.createTitle")
      }
    >
      <Text style={settingsStyles.rowHint}>
        {hasMemberships
          ? t("hub.settings.organizationSelection.signedInChoose", { email })
          : t("hub.settings.organizationSelection.signedIn", { email })}
      </Text>
      {!hasMemberships && !state.canCreateOrganization ? (
        <Alert
          variant="info"
          title={t("hub.settings.organizationSelection.noneTitle")}
          description={t("hub.settings.organizationSelection.noneDescription")}
        />
      ) : null}
      {hasMemberships ? (
        <View style={settingsStyles.card}>
          {state.memberships.map((membership, index) => (
            <OrganizationChoice
              key={membership.id}
              membership={membership}
              first={index === 0}
              pending={pending}
              select={hub.selectOrganization}
              run={run}
            />
          ))}
        </View>
      ) : null}
      {state.canCreateOrganization ? (
        <CreateOrganizationForm
          hub={hub}
          pending={pending}
          run={run}
          organizationName={organizationName}
          setOrganizationName={setOrganizationName}
          canCreate={canCreate}
        />
      ) : null}
      <Button variant="ghost" disabled={pending} onPress={signOut}>
        {t("hub.settings.organizationSelection.signOut")}
      </Button>
      {hub.error ? <Alert variant="error" title={hub.error} /> : null}
    </SettingsSection>
  );
}

function OrganizationChoice({
  membership,
  first,
  pending,
  select,
  run,
}: {
  membership: Membership;
  first: boolean;
  pending: boolean;
  select(organizationId: string): Promise<void>;
  run: HubRun;
}) {
  const { t } = useTranslation();
  const choose = useCallback(
    () => void run(() => select(membership.id)),
    [membership.id, run, select],
  );
  return (
    <View style={[settingsStyles.row, first ? null : settingsStyles.rowBorder]}>
      <View style={styles.identity}>
        <ThemedBuilding size={18} uniProps={mutedMapping} />
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle} numberOfLines={1}>
            {membership.name}
          </Text>
          <Text style={settingsStyles.rowHint} numberOfLines={1}>
            {`${organizationRoleLabel(membership.role)} · ${membership.slug}`}
          </Text>
        </View>
      </View>
      <Button size="sm" disabled={pending} onPress={choose}>
        {t("hub.settings.organizationSelection.open")}
      </Button>
    </View>
  );
}

function CreateOrganizationForm({
  hub,
  pending,
  run,
  organizationName,
  setOrganizationName,
  canCreate,
}: {
  hub: HubAccount;
  pending: boolean;
  run: HubRun;
  organizationName: string;
  setOrganizationName(name: string): void;
  canCreate: boolean;
}) {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const create = useCallback(
    () => void run(() => hub.createOrganization(organizationName.trim())),
    [hub, organizationName, run],
  );
  return (
    <View style={[settingsStyles.card, styles.form]}>
      <Field label={t("hub.settings.organizationSelection.newNameLabel")}>
        <FormTextInput
          size={compact ? "md" : "sm"}
          initialValue={organizationName}
          onChangeText={setOrganizationName}
          placeholder={t("hub.settings.organizationSelection.newNamePlaceholder")}
          editable={!pending}
        />
      </Field>
      <Button variant="outline" disabled={pending || !canCreate} onPress={create}>
        {t("hub.settings.organizationSelection.create")}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  identity: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  form: {
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
}));
