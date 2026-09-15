import { Building2 } from "lucide-react-native";
import { useCallback } from "react";
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
import { roleLabel } from "../organization-identity";

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
  const signOut = useCallback(() => void run(hub.signOut), [hub.signOut, run]);
  const hasMemberships = state.memberships.length > 0;
  return (
    <SettingsSection title={hasMemberships ? "Choose an organization" : "Create an organization"}>
      <Text style={settingsStyles.rowHint}>
        {hasMemberships
          ? `Signed in as ${state.account.email}. Open the organization you want to work in; its Hosts, Projects, and settings follow that choice.`
          : `Signed in as ${state.account.email}.`}
      </Text>
      {!hasMemberships && !state.canCreateOrganization ? (
        <Alert
          variant="info"
          title="No organization available"
          description="Ask an organization owner or admin for an invitation, or sign in with another account."
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
        Sign out
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
            {`${roleLabel(membership.role)} · ${membership.slug}`}
          </Text>
        </View>
      </View>
      <Button size="sm" disabled={pending} onPress={choose}>
        Open
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
  const compact = useIsCompactFormFactor();
  const create = useCallback(
    () => void run(() => hub.createOrganization(organizationName.trim())),
    [hub, organizationName, run],
  );
  return (
    <View style={[settingsStyles.card, styles.form]}>
      <Field label="New organization name">
        <FormTextInput
          size={compact ? "md" : "sm"}
          initialValue={organizationName}
          onChangeText={setOrganizationName}
          placeholder="Acme"
          editable={!pending}
        />
      </Field>
      <Button variant="outline" disabled={pending || !canCreate} onPress={create}>
        Create organization
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
