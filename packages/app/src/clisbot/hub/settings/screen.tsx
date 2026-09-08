import type { UseQueryResult } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useFetchQuery } from "@/data/query";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { useHubAccount } from "../account-provider";
import { openHubAccountEntryForm, type HubAccountEntryMode } from "../account-entry-form";
import {
  HubChannelIdentitiesSchema,
  HubAccessAssignmentsSchema,
  HubAccessCatalogSchema,
  HubConnectionContinuationSchema,
  HubConnectionSchema,
  HubConnectionsSchema,
  HubDaemonsSchema,
  HubMembersSchema,
  HubTeamMembershipSchema,
  HubTeamSchema,
  HubTeamsSchema,
  type HubAccountState,
} from "../contracts";
import { type HubSectionSlug } from "../navigation";
import { confirmDialog } from "@/utils/confirm-dialog";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { ChannelSettings } from "./channel-settings";
import { AddChannelConnection } from "./channel-connection-add";
import { ManagedHostRow } from "./managed-host-row";
import { AutomationSettings } from "./automation-settings";
import { AccessSettings } from "./access-settings";
import { ApiKeySettings } from "./api-key-settings";
import {
  ChannelIdentitySelfLinkSettings,
  ChannelIdentitySettings,
} from "./channel-identity-settings";
import { ProviderApplicationSettings } from "./provider-application-settings";
import { HubHostOnboardingSection } from "../host-onboarding-section";
import { hubResourceQueryKey } from "../query-keys";
import { useHubSettingsDetailScroll } from "./detail-scroll";
import { HubConnectionResultNotice } from "./connection-result";
import { HubConnectionContinuationNotice } from "./connection-continuation";
import { useHubConnectionContinuation } from "../use-connection-continuation";

export function HubSettingsContent({ section }: { section: HubSectionSlug }) {
  const hub = useHubAccount();
  if (section === "account") return <HubAccountSettings />;
  return (
    <SignedInHubSettings
      key={JSON.stringify([hub.origin, hub.signedIn?.account.id, hub.signedIn?.organization.id])}
      section={section}
    />
  );
}

function SignedInHubSettings({ section }: { section: Exclude<HubSectionSlug, "account"> }) {
  const account = useHubAccount();
  if (!account.enabled) return null;
  if (account.loading) return <StateMessage message="Loading Hub account…" />;
  if (!account.signedIn) {
    return (
      <SettingsSection title="Hub">
        <Alert
          variant="info"
          title="Sign in required"
          description="Sign in before managing Channels, Automations, Team, or Access."
        />
      </SettingsSection>
    );
  }

  switch (section) {
    case "channels":
      return <ChannelSettings />;
    case "automations":
      return <AutomationSettings ChannelInputs={ChannelSettings} />;
    case "team":
      return <TeamSettings />;
    case "access":
      return <AccessSettings />;
    case "configuration":
      return <HubConfigurationSettings />;
  }
}

function HubAccountSettings() {
  const hub = useHubAccount();
  if (!hub.enabled) return null;
  if (hub.loading) return <StateMessage message="Loading Hub account..." />;
  const state = hub.state;
  const invitation = getAccountInvitation(state);
  const accountId = state !== null && "account" in state ? state.account.id : null;
  return (
    <HubAccountSettingsForm
      key={JSON.stringify([hub.origin, state?.status, accountId, invitation?.id])}
      hub={hub}
      invitation={invitation}
    />
  );
}

function HubAccountSettingsForm({
  hub,
  invitation,
}: {
  hub: HubAccount;
  invitation: HubInvitation | undefined;
}) {
  const [form] = useState(() =>
    openHubAccountEntryForm({
      mode: accountEntryMode(hub.state, invitation),
      invitedEmail: invitation?.email,
    }),
  );
  const fields = useSyncExternalStore(form.subscribe, form.getState, form.getState);
  useEffect(() => form.close, [form]);
  const entryMode = fields.mode === "signUp" ? "signUp" : "signIn";
  const [pending, setPending] = useState(false);
  const run = useCallback(async (operation: () => Promise<void>) => {
    setPending(true);
    try {
      await operation();
    } catch {
      // HubAccountProvider exposes the mutation error in this screen.
    } finally {
      setPending(false);
    }
  }, []);

  const retryAccount = useCallback(() => void run(hub.refresh), [hub.refresh, run]);
  const state = hub.state;

  if (hasUnavailableSignedInInvitation(state)) {
    return (
      <UnavailableAccountInvitation
        hub={hub}
        accountEmail={state.account.email}
        pending={pending}
        run={run}
      />
    );
  }

  if (invitation !== undefined && isInvitationAcceptanceState(state)) {
    return (
      <InvitationAcceptance
        hub={hub}
        invitation={invitation}
        accountEmail={state.account.email}
        pending={pending}
        run={run}
      />
    );
  }

  if (state?.status === "active" || state?.status === "appSetupRequired") {
    return <ActiveHubAccount hub={hub} state={state} pending={pending} run={run} />;
  }

  if (state?.status === "organizationRequired") {
    return (
      <OrganizationSelection
        form={form}
        fields={fields}
        hub={hub}
        state={state}
        pending={pending}
        run={run}
      />
    );
  }

  const inlineAuthentication = hub.signInKind === "password";
  if (!inlineAuthentication) {
    return <BrowserHubAuthentication hub={hub} state={state} pending={pending} run={run} />;
  }

  if (state?.status === "instanceSetupRequired") {
    return <InstanceSetup form={form} fields={fields} hub={hub} pending={pending} run={run} />;
  }

  if (state?.status === "passwordChangeRequired") {
    return (
      <PasswordChange
        form={form}
        fields={fields}
        hub={hub}
        state={state}
        pending={pending}
        run={run}
      />
    );
  }

  if (state?.status !== "signedOut") {
    return (
      <SettingsSection title="Hub account">
        <Alert
          variant="error"
          title="Hub account state is unavailable"
          description={hub.error ?? "Check the Hub connection and try again."}
        >
          <Button size="sm" variant="outline" disabled={pending} onPress={retryAccount}>
            Retry
          </Button>
        </Alert>
      </SettingsSection>
    );
  }

  return (
    <SignedOutHubAccount
      key={entryMode}
      form={form}
      fields={fields}
      hub={hub}
      state={state}
      invitation={invitation}
      pending={pending}
      run={run}
    />
  );
}

function accountEntryMode(
  state: HubAccountState | null,
  invitation: HubInvitation | undefined,
): HubAccountEntryMode {
  if (state?.status === "signedOut") return invitation === undefined ? "signIn" : "signUp";
  if (state?.status === "instanceSetupRequired") return "instanceSetup";
  if (state?.status === "passwordChangeRequired") return "passwordChange";
  if (state?.status === "organizationRequired") return "organization";
  return "account";
}

function hasUnavailableSignedInInvitation(state: HubAccountState | null): state is Extract<
  HubAccountState,
  { status: "active" | "appSetupRequired" | "organizationRequired" }
> & {
  invitationUnavailable: true;
} {
  return (
    (state?.status === "active" ||
      state?.status === "appSetupRequired" ||
      state?.status === "organizationRequired") &&
    state.invitationUnavailable === true
  );
}

function getAccountInvitation(state: HubAccountState | null) {
  return state !== null && "invitation" in state ? state.invitation : undefined;
}

function isInvitationAcceptanceState(
  state: HubAccountState | null,
): state is Extract<
  HubAccountState,
  { status: "organizationRequired" | "active" | "appSetupRequired" }
> {
  return (
    state?.status === "organizationRequired" ||
    state?.status === "active" ||
    state?.status === "appSetupRequired"
  );
}

type HubAccount = ReturnType<typeof useHubAccount>;
type HubRun = (operation: () => Promise<void>) => Promise<void>;
type HubInvitation = NonNullable<Extract<HubAccountState, { status: "signedOut" }>["invitation"]>;

type AccountEntryFormModel = ReturnType<typeof openHubAccountEntryForm>;
interface AccountEntryFormProps {
  hub: HubAccount;
  pending: boolean;
  run: HubRun;
  form: AccountEntryFormModel;
  fields: ReturnType<AccountEntryFormModel["getState"]>;
}

function UnavailableAccountInvitation({
  hub,
  accountEmail,
  pending,
  run,
}: {
  hub: HubAccount;
  accountEmail: string;
  pending: boolean;
  run: HubRun;
}) {
  const signOut = useCallback(() => void run(hub.signOut), [hub.signOut, run]);
  const retry = useCallback(() => void run(hub.refresh), [hub.refresh, run]);
  return (
    <SettingsSection title="Invitation">
      <Alert
        variant="warning"
        title="This invitation is unavailable"
        description="It may have expired, already been used, or belong to another account. Sign in with the invited account or ask an organization owner for a new invitation."
      />
      <View style={settingsStyles.card}>
        <InfoRow title="Signed in as" hint={accountEmail} />
      </View>
      <View style={styles.actions}>
        <Button variant="outline" disabled={pending} onPress={retry}>
          Retry
        </Button>
        <Button variant="outline" disabled={pending} onPress={signOut}>
          Sign out
        </Button>
      </View>
      {hub.error ? <Alert variant="error" title={hub.error} /> : null}
    </SettingsSection>
  );
}

function InvitationAcceptance({
  hub,
  invitation,
  accountEmail,
  pending,
  run,
}: {
  hub: HubAccount;
  invitation: HubInvitation;
  accountEmail: string;
  pending: boolean;
  run: HubRun;
}) {
  const accept = useCallback(
    () => void run(() => hub.acceptInvitation(invitation.id)),
    [hub, invitation.id, run],
  );
  const signOut = useCallback(() => void run(hub.signOut), [hub.signOut, run]);
  const description =
    invitation.team === undefined
      ? "Joining the organization does not grant access to any Host, Project, Channel, or Automation. An owner or admin assigns that separately."
      : `You will join ${invitation.team.name} and receive the Team's current access after accepting.`;
  return (
    <SettingsSection title={`Join ${invitation.organization.name}`}>
      <Alert
        variant="info"
        title={`${invitation.inviterName} invited you as ${channelLabel(invitation.role)}`}
        description={description}
      />
      <View style={settingsStyles.card}>
        <InfoRow title="Organization" hint={invitation.organization.name} />
        <InfoRow title="Account" hint={accountEmail} bordered />
        <InfoRow title="Organization role" hint={channelLabel(invitation.role)} bordered />
        {invitation.team === undefined ? null : (
          <InfoRow title="Team" hint={invitation.team.name} bordered />
        )}
      </View>
      <View style={styles.actions}>
        <Button disabled={pending} loading={pending} onPress={accept}>
          Accept invitation
        </Button>
        <Button variant="outline" disabled={pending} onPress={signOut}>
          Sign out
        </Button>
      </View>
      {hub.error ? <Alert variant="error" title={hub.error} /> : null}
    </SettingsSection>
  );
}

function ActiveHubAccount({
  hub,
  state,
  pending,
  run,
}: {
  hub: HubAccount;
  state: Extract<HubAccountState, { status: "active" | "appSetupRequired" }>;
  pending: boolean;
  run: HubRun;
}) {
  const router = useRouter();
  const [showIdentity, setShowIdentity] = useState(false);
  const openIdentity = useCallback(() => setShowIdentity(true), []);
  const params = useLocalSearchParams<{ channelConnectionId?: string }>();
  const backToAccount = useCallback(() => {
    setShowIdentity(false);
    router.setParams({ channelConnectionId: undefined });
  }, [router]);
  const role = channelLabel(state.membership.role);
  const signOut = useCallback(() => void run(hub.signOut), [hub.signOut, run]);
  const identityVisible =
    showIdentity ||
    (typeof params.channelConnectionId === "string" && params.channelConnectionId.length > 0);
  const scrollToTop = useHubSettingsDetailScroll();
  useEffect(() => {
    scrollToTop?.();
  }, [identityVisible, scrollToTop]);
  if (identityVisible)
    return (
      <View>
        <Button size="sm" variant="outline" onPress={backToAccount}>
          Back to Account
        </Button>
        <ChannelIdentitySelfLinkSettings />
      </View>
    );
  return (
    <View>
      <SettingsSection title="Account">
        {state.membership.role === "owner" ? (
          <Alert
            variant="success"
            title="Full organization access"
            description="Owners automatically have access to every current and future Host, Project, Channel, and Automation. No assignment is required."
          />
        ) : null}
        <View style={settingsStyles.card}>
          <InfoRow title={state.account.name} hint={state.account.email} />
          <InfoRow title={state.organization.name} hint={`Organization role: ${role}`} bordered />
          {state.isInstanceOperator ? (
            <InfoRow title="Hub instance" hint="Instance role: Operator" bordered />
          ) : null}
        </View>
        <Button variant="outline" disabled={pending} onPress={openIdentity}>
          Your Channel identities
        </Button>
        <Button variant="outline" disabled={pending} onPress={signOut}>
          Sign out
        </Button>
        {hub.error ? <Alert variant="error" title={hub.error} /> : null}
      </SettingsSection>
      <HubHostOnboardingSection />
    </View>
  );
}

function OrganizationSelection({
  hub,
  pending,
  run,
  form,
  fields,
  state,
}: AccountEntryFormProps & {
  state: Extract<HubAccountState, { status: "organizationRequired" }>;
}) {
  const { organizationName } = fields;
  const { setOrganizationName } = form;
  const compact = useIsCompactFormFactor();
  const fieldSize = compact ? "md" : "sm";
  const createOrganization = useCallback(
    () => void run(() => hub.createOrganization(organizationName.trim())),
    [hub, organizationName, run],
  );
  const signOut = useCallback(() => void run(hub.signOut), [hub.signOut, run]);
  return (
    <SettingsSection title="Choose an organization">
      {state.memberships.length === 0 && !state.canCreateOrganization ? (
        <Alert
          variant="info"
          title="No organization available"
          description="Ask an organization owner or admin for an invitation, or sign in with another account."
        />
      ) : null}
      {state.memberships.map((membership) => (
        <OrganizationChoice
          key={membership.id}
          id={membership.id}
          name={membership.name}
          pending={pending}
          select={hub.selectOrganization}
          run={run}
        />
      ))}
      {state.canCreateOrganization ? (
        <View style={[settingsStyles.card, styles.form]}>
          <Field label="Organization name">
            <FormTextInput
              size={fieldSize}
              initialValue={organizationName}
              onChangeText={setOrganizationName}
              placeholder="Acme"
              editable={!pending}
            />
          </Field>
          <Button disabled={pending || !fields.canSubmit} onPress={createOrganization}>
            Create organization
          </Button>
        </View>
      ) : null}
      <Button variant="outline" disabled={pending} onPress={signOut}>
        Sign out
      </Button>
      {hub.error ? <Alert variant="error" title={hub.error} /> : null}
    </SettingsSection>
  );
}

function OrganizationChoice({
  id,
  name,
  pending,
  select,
  run,
}: {
  id: string;
  name: string;
  pending: boolean;
  select(organizationId: string): Promise<void>;
  run: HubRun;
}) {
  const choose = useCallback(() => void run(() => select(id)), [id, run, select]);
  return (
    <Button variant="outline" disabled={pending} onPress={choose}>
      {name}
    </Button>
  );
}

function BrowserHubAuthentication({
  hub,
  state,
  pending,
  run,
}: {
  hub: HubAccount;
  state: HubAccountState | null;
  pending: boolean;
  run: HubRun;
}) {
  const signIn = useCallback(() => void run(() => hub.signIn()), [hub, run]);
  return (
    <SettingsSection title="Hub account">
      <Alert
        variant="info"
        title={browserAuthenticationTitle(state)}
        description="Authentication opens securely in your system browser and returns to Paseo when complete."
      />
      <Button disabled={pending} loading={pending} onPress={signIn}>
        Continue in browser
      </Button>
      {hub.error ? <Alert variant="error" title={hub.error} /> : null}
    </SettingsSection>
  );
}

function browserAuthenticationTitle(state: HubAccountState | null): string {
  if (state?.status === "instanceSetupRequired") return "Set up your Hub";
  if (state?.status === "passwordChangeRequired") return "Password change required";
  if (state?.status === "signedOut" && state.invitation !== undefined) {
    return `Join ${state.invitation.organization.name}`;
  }
  return "Sign in to Hub";
}

function InstanceSetup({ hub, pending, run, form, fields }: AccountEntryFormProps) {
  const { email, password, confirmPassword, passwordsMatch } = fields;
  const { setEmail, setPassword, setConfirmPassword } = form;
  const compact = useIsCompactFormFactor();
  const fieldSize = compact ? "md" : "sm";
  const createOwner = useCallback(
    () => void run(() => hub.claimInstance({ email: email.trim().toLowerCase(), password })),
    [email, hub, password, run],
  );
  return (
    <SettingsSection title="Set up Hub">
      <Alert
        variant="info"
        title="Create the first account"
        description="The first account becomes Owner and receives full access to every current and future organization resource."
      />
      <View style={[settingsStyles.card, styles.form]}>
        <Field label="Email">
          <FormTextInput
            size={fieldSize}
            initialValue={email}
            onChangeText={setEmail}
            placeholder="owner@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!pending}
          />
        </Field>
        <Field label="Password" hint="Use at least 12 characters.">
          <FormTextInput
            size={fieldSize}
            initialValue={password}
            onChangeText={setPassword}
            secureTextEntry
            editable={!pending}
          />
        </Field>
        <Field label="Confirm password" error={passwordMismatch(confirmPassword, passwordsMatch)}>
          <FormTextInput
            size={fieldSize}
            initialValue={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            editable={!pending}
          />
        </Field>
        <Button disabled={pending || !fields.canSubmit} loading={pending} onPress={createOwner}>
          Create owner account
        </Button>
      </View>
      {hub.error ? <Alert variant="error" title={hub.error} /> : null}
    </SettingsSection>
  );
}

function PasswordChange({
  hub,
  pending,
  run,
  form,
  fields,
  state,
}: AccountEntryFormProps & {
  state: Extract<HubAccountState, { status: "passwordChangeRequired" }>;
}) {
  const { currentPassword, password, confirmPassword, passwordsMatch } = fields;
  const { setCurrentPassword, setPassword, setConfirmPassword } = form;
  const compact = useIsCompactFormFactor();
  const fieldSize = compact ? "md" : "sm";
  const savePassword = useCallback(
    () => void run(() => hub.changePassword({ currentPassword, newPassword: password })),
    [currentPassword, hub, password, run],
  );
  return (
    <SettingsSection title="Choose a new password">
      <Alert
        variant="info"
        title={`Signed in as ${state.account.email}`}
        description="Replace the temporary password before continuing. Other sessions will be signed out."
      />
      <View style={[settingsStyles.card, styles.form]}>
        <Field label="Current password">
          <FormTextInput
            size={fieldSize}
            initialValue={currentPassword}
            onChangeText={setCurrentPassword}
            secureTextEntry
            editable={!pending}
          />
        </Field>
        <Field label="New password" hint="Use at least 12 characters.">
          <FormTextInput
            size={fieldSize}
            initialValue={password}
            onChangeText={setPassword}
            secureTextEntry
            editable={!pending}
          />
        </Field>
        <Field
          label="Confirm new password"
          error={passwordMismatch(confirmPassword, passwordsMatch)}
        >
          <FormTextInput
            size={fieldSize}
            initialValue={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            editable={!pending}
          />
        </Field>
        <Button disabled={pending || !fields.canSubmit} loading={pending} onPress={savePassword}>
          Save password
        </Button>
      </View>
      {hub.error ? <Alert variant="error" title={hub.error} /> : null}
    </SettingsSection>
  );
}

function passwordMismatch(confirmPassword: string, passwordsMatch: boolean): string | null {
  return !passwordsMatch && confirmPassword.length > 0 ? "Passwords do not match." : null;
}

function SignedOutHubAccount({
  hub,
  pending,
  run,
  form,
  fields,
  state,
  invitation,
}: AccountEntryFormProps & {
  state: Extract<HubAccountState, { status: "signedOut" }>;
  invitation: HubInvitation | undefined;
}) {
  const { name, email, password, confirmPassword, passwordsMatch } = fields;
  const { setName, setEmail, setPassword, setConfirmPassword, setEntryMode } = form;
  const compact = useIsCompactFormFactor();
  const fieldSize = compact ? "md" : "sm";
  const maySignUp = invitation !== undefined || state.registration === "open";
  const signingUp = fields.mode === "signUp" && maySignUp;
  const invitedEmail = invitation?.email;
  const submit = useCallback(() => {
    void run(async () => {
      if (signingUp) {
        await hub.signUp({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          password,
          ...(invitation === undefined ? {} : { invitationId: invitation.id }),
        });
        return;
      }
      await hub.signIn({ email: email.trim().toLowerCase(), password });
    });
  }, [email, hub, invitation, name, password, run, signingUp]);
  const toggleEntryMode = useCallback(
    () => setEntryMode(signingUp ? "signIn" : "signUp"),
    [setEntryMode, signingUp],
  );
  const title = signedOutTitle(invitation, signingUp);
  const description = signedOutDescription(invitation);
  const submitDisabled = pending || !fields.canSubmit;
  return (
    <SettingsSection title="Hub account">
      <Alert variant="info" title={title} description={description} />
      {state.invitationUnavailable === true ? (
        <Alert
          variant="warning"
          title="This invitation is unavailable"
          description="It may have expired or already been used. Ask an organization owner for a new invitation."
        />
      ) : null}
      <View style={[settingsStyles.card, styles.form]}>
        {signingUp ? (
          <Field label="Name">
            <FormTextInput
              size={fieldSize}
              initialValue={name}
              onChangeText={setName}
              placeholder="Your name"
              editable={!pending}
            />
          </Field>
        ) : null}
        <Field label="Email">
          <FormTextInput
            size={fieldSize}
            key={invitedEmail ?? "email"}
            initialValue={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!pending && invitedEmail === undefined}
          />
        </Field>
        <Field label="Password" hint={signingUp ? "Use at least 12 characters." : undefined}>
          <FormTextInput
            size={fieldSize}
            initialValue={password}
            onChangeText={setPassword}
            secureTextEntry
            editable={!pending}
          />
        </Field>
        {signingUp ? (
          <Field label="Confirm password" error={passwordMismatch(confirmPassword, passwordsMatch)}>
            <FormTextInput
              size={fieldSize}
              initialValue={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              editable={!pending}
            />
          </Field>
        ) : null}
        <Button disabled={submitDisabled} loading={pending} onPress={submit}>
          {signingUp ? "Create account" : "Sign in"}
        </Button>
        {maySignUp ? (
          <Button variant="ghost" disabled={pending} onPress={toggleEntryMode}>
            {signingUp ? "Already have an account? Sign in" : "Create an account"}
          </Button>
        ) : null}
      </View>
      {maySignUp ? null : <Text style={settingsStyles.rowHint}>{registrationMessage(state)}</Text>}
      {hub.error ? <Alert variant="error" title={hub.error} /> : null}
    </SettingsSection>
  );
}

function signedOutTitle(invitation: HubInvitation | undefined, signingUp: boolean): string {
  if (invitation !== undefined) return `Join ${invitation.organization.name}`;
  return signingUp ? "Create a Hub account" : "Sign in to Hub";
}

function signedOutDescription(invitation: HubInvitation | undefined): string {
  if (invitation === undefined) {
    return "Use one Hub account to manage Channels and connect to the Hosts you can access.";
  }
  const team = invitation.team === undefined ? "" : ` in ${invitation.team.name}`;
  return `${invitation.inviterName} invited you as ${channelLabel(invitation.role)}${team}. The invitation is bound to the invited email.`;
}

function registrationMessage(state: Extract<HubAccountState, { status: "signedOut" }>): string {
  return state.registration === "invite_only"
    ? "Accounts are created by invitation. Ask an organization owner to invite you."
    : "This Hub is not accepting new accounts.";
}

function TeamSettings() {
  const hub = useHubAccount();
  const router = useRouter();
  const members = useHubResource("members", HubMembersSchema);
  const teams = useHubResource("teams", HubTeamsSchema);
  const identities = useHubResource("channel-identities", HubChannelIdentitiesSchema);
  const assignments = useHubResource("access-assignments", HubAccessAssignmentsSchema);
  const catalog = useHubResource("access-catalog", HubAccessCatalogSchema);
  const connections = useHubResource("connections", HubConnectionsSchema);
  const [teamName, setTeamName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [inviteTeamId, setInviteTeamId] = useState("");
  const [inviteResetKey, setInviteResetKey] = useState(0);
  const [selection, setSelection] = useState<{ kind: "member" | "team"; id: string } | undefined>();
  const [copiedInvitationId, setCopiedInvitationId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const signedInAccount = hub.signedIn;
  const canManageMembers = hub.signedIn?.capabilities.manageMembers === true;
  const canManageTeams = hub.signedIn?.capabilities.manageResources === true;
  const teamOptions = useMemo<SelectFieldOption<string>[]>(
    () => [
      { id: "none", value: "", label: "No Team" },
      ...(teams.data?.teams ?? []).map((team) => ({
        id: team.id,
        value: team.id,
        label: team.name,
        description: `${String(team.userIds.length)} ${plural(team.userIds.length, "Member")}`,
      })),
    ],
    [teams.data?.teams],
  );
  const selectedInviteTeam = teams.data?.teams.find(({ id }) => id === inviteTeamId);
  const run = useCallback(async (operation: () => Promise<void>) => {
    setMutationError(null);
    setPending(true);
    try {
      await operation();
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Hub request failed.");
    } finally {
      setPending(false);
    }
  }, []);
  const createTeam = useCallback(() => {
    const name = teamName.trim();
    if (!name) return;
    void run(async () => {
      await hub.api().post("teams", { name }, HubTeamSchema);
      setTeamName("");
      await teams.refetch();
    });
  }, [hub, run, teamName, teams]);
  const setTeamMembership = useCallback(
    (teamId: string, userId: string, included: boolean) => {
      void run(async () => {
        if (included) {
          await hub
            .api()
            .delete(`teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`);
        } else {
          await hub
            .api()
            .post(
              `teams/${encodeURIComponent(teamId)}/members`,
              { userId },
              HubTeamMembershipSchema,
            );
        }
        await Promise.all([teams.refetch(), assignments.refetch()]);
      });
    },
    [assignments, hub, run, teams],
  );
  const renameTeam = useCallback(
    (teamId: string, name: string) =>
      run(async () => {
        await hub.api().put(`teams/${encodeURIComponent(teamId)}`, { name }, HubTeamSchema);
        await teams.refetch();
      }),
    [hub, run, teams],
  );
  const removeTeam = useCallback(
    async (teamId: string, name: string) => {
      const confirmed = await confirmDialog({
        title: `Delete ${name}?`,
        message: "The Team and its access assignments will be removed.",
        confirmLabel: "Delete Team",
        destructive: true,
      });
      if (!confirmed) return;
      await run(async () => {
        await hub.api().delete(`teams/${encodeURIComponent(teamId)}`);
        setSelection(undefined);
        await Promise.all([teams.refetch(), assignments.refetch()]);
      });
    },
    [assignments, hub, run, teams],
  );
  const removeMember = useCallback(
    async (memberId: string, name: string) => {
      const confirmed = await confirmDialog({
        title: `Remove ${name}?`,
        message:
          "This removes the Member from the organization, every Team, and all direct resource access.",
        confirmLabel: "Remove Member",
        destructive: true,
      });
      if (!confirmed) return;
      await run(async () => {
        await hub.removeMember(memberId);
        setSelection(undefined);
        await Promise.all([
          members.refetch(),
          teams.refetch(),
          identities.refetch(),
          assignments.refetch(),
        ]);
      });
    },
    [assignments, hub, identities, members, run, teams],
  );
  const clearSelection = useCallback(() => setSelection(undefined), []);
  const manageAccess = useCallback(() => {
    if (selection === undefined) return;
    router.push({
      pathname: "/settings/hub/[hubSection]",
      params: { hubSection: "access", subjectKind: selection.kind, subjectId: selection.id },
    });
  }, [router, selection]);

  return (
    <TeamSettingsView
      hub={hub}
      selection={selection}
      members={members}
      teams={teams}
      identities={identities}
      connections={connections}
      assignments={assignments}
      catalog={catalog}
      signedInAccount={signedInAccount}
      canManageMembers={canManageMembers}
      canManageTeams={canManageTeams}
      teamName={teamName}
      setTeamName={setTeamName}
      inviteEmail={inviteEmail}
      setInviteEmail={setInviteEmail}
      inviteRole={inviteRole}
      setInviteRole={setInviteRole}
      inviteTeamId={inviteTeamId}
      setInviteTeamId={setInviteTeamId}
      inviteResetKey={inviteResetKey}
      setInviteResetKey={setInviteResetKey}
      selectedInviteTeam={selectedInviteTeam}
      teamOptions={teamOptions}
      copiedInvitationId={copiedInvitationId}
      setCopiedInvitationId={setCopiedInvitationId}
      pending={pending}
      mutationError={mutationError}
      setMutationError={setMutationError}
      run={run}
      createTeam={createTeam}
      select={setSelection}
      clearSelection={clearSelection}
      setTeamMembership={setTeamMembership}
      renameTeam={renameTeam}
      removeTeam={removeTeam}
      removeMember={removeMember}
      manageAccess={manageAccess}
    />
  );
}

type HubMember = z.infer<typeof HubMembersSchema>["members"][number];
type HubTeam = z.infer<typeof HubTeamsSchema>["teams"][number];
type HubIdentity = z.infer<typeof HubChannelIdentitiesSchema>["identities"][number];
type HubConnection = z.infer<typeof HubConnectionsSchema>["connections"][number];
type HubAssignment = z.infer<typeof HubAccessAssignmentsSchema>["assignments"][number];
type HubAccessResource = z.infer<typeof HubAccessCatalogSchema>["resources"][number];
type HubAccessLevels = z.infer<typeof HubAccessCatalogSchema>["accessLevels"];
type HubManagedInvitation = NonNullable<
  Extract<HubAccountState, { status: "active" }>["team"]["invitations"]
>[number];
type TeamSelection = { kind: "member" | "team"; id: string } | undefined;

const INVITATION_ROLE_OPTIONS: SelectFieldOption<"admin" | "member">[] = [
  { id: "member", value: "member", label: "Member" },
  { id: "admin", value: "admin", label: "Admin" },
];
const EMPTY_HUB_ACCESS_LEVELS: HubAccessLevels = {};

function SelectedMemberDetail({
  hub,
  member,
  teams,
  identities,
  connections,
  assignments,
  resources,
  accessLevels,
  pending,
  canManageMembers,
  canManageTeams,
  mutationError,
  back,
  setTeamMembership,
  run,
  refetchMembers,
  removeMember,
  manageAccess,
}: {
  hub: HubAccount;
  member: HubMember;
  teams: HubTeam[];
  identities: HubIdentity[];
  connections: HubConnection[];
  assignments: HubAssignment[];
  resources: HubAccessResource[];
  accessLevels: HubAccessLevels;
  pending: boolean;
  canManageMembers: boolean;
  canManageTeams: boolean;
  mutationError: string | null;
  back(): void;
  setTeamMembership(teamId: string, userId: string, included: boolean): void;
  run: HubRun;
  refetchMembers(): Promise<unknown>;
  removeMember(memberId: string, name: string): Promise<void>;
  manageAccess(): void;
}) {
  const setRole = useCallback(
    (role: "owner" | "admin" | "member") =>
      run(async () => {
        await hub.changeMemberRole({ memberId: member.id, role });
        await refetchMembers();
      }),
    [hub, member.id, refetchMembers, run],
  );
  const remove = useCallback(
    () => removeMember(member.id, member.name),
    [member.id, member.name, removeMember],
  );
  return (
    <MemberDetail
      member={member}
      teams={teams}
      identities={identities}
      connections={connections}
      assignments={assignments}
      resources={resources}
      accessLevels={accessLevels}
      pending={pending}
      canManageMembers={canManageMembers}
      canManageTeams={canManageTeams}
      mutationError={mutationError}
      back={back}
      setTeamMembership={setTeamMembership}
      setRole={setRole}
      remove={remove}
      manageAccess={manageAccess}
    />
  );
}

function SelectedTeamDetail({
  team,
  members,
  assignments,
  resources,
  accessLevels,
  pending,
  canManage,
  mutationError,
  back,
  setMembership,
  renameTeam,
  removeTeam,
  manageAccess,
}: {
  team: HubTeam;
  members: HubMember[];
  assignments: HubAssignment[];
  resources: HubAccessResource[];
  accessLevels: HubAccessLevels;
  pending: boolean;
  canManage: boolean;
  mutationError: string | null;
  back(): void;
  setMembership(teamId: string, userId: string, included: boolean): void;
  renameTeam(teamId: string, name: string): Promise<void>;
  removeTeam(teamId: string, name: string): Promise<void>;
  manageAccess(): void;
}) {
  const rename = useCallback((name: string) => renameTeam(team.id, name), [renameTeam, team.id]);
  const remove = useCallback(
    () => removeTeam(team.id, team.name),
    [removeTeam, team.id, team.name],
  );
  return (
    <TeamDetail
      team={team}
      members={members}
      assignments={assignments}
      resources={resources}
      accessLevels={accessLevels}
      pending={pending}
      canManage={canManage}
      mutationError={mutationError}
      back={back}
      setMembership={setMembership}
      rename={rename}
      remove={remove}
      manageAccess={manageAccess}
    />
  );
}

function TeamSettingsView({
  hub,
  selection,
  members,
  teams,
  identities,
  connections,
  assignments,
  catalog,
  signedInAccount,
  canManageMembers,
  canManageTeams,
  teamName,
  setTeamName,
  inviteEmail,
  setInviteEmail,
  inviteRole,
  setInviteRole,
  inviteTeamId,
  setInviteTeamId,
  inviteResetKey,
  setInviteResetKey,
  selectedInviteTeam,
  teamOptions,
  copiedInvitationId,
  setCopiedInvitationId,
  pending,
  mutationError,
  setMutationError,
  run,
  createTeam,
  select,
  clearSelection,
  setTeamMembership,
  renameTeam,
  removeTeam,
  removeMember,
  manageAccess,
}: {
  hub: HubAccount;
  selection: TeamSelection;
  members: UseQueryResult<z.infer<typeof HubMembersSchema>, Error>;
  teams: UseQueryResult<z.infer<typeof HubTeamsSchema>, Error>;
  identities: UseQueryResult<z.infer<typeof HubChannelIdentitiesSchema>, Error>;
  connections: UseQueryResult<z.infer<typeof HubConnectionsSchema>, Error>;
  assignments: UseQueryResult<z.infer<typeof HubAccessAssignmentsSchema>, Error>;
  catalog: UseQueryResult<z.infer<typeof HubAccessCatalogSchema>, Error>;
  signedInAccount: HubAccount["signedIn"];
  canManageMembers: boolean;
  canManageTeams: boolean;
  teamName: string;
  setTeamName(value: string): void;
  inviteEmail: string;
  setInviteEmail(value: string): void;
  inviteRole: "admin" | "member";
  setInviteRole(value: "admin" | "member"): void;
  inviteTeamId: string;
  setInviteTeamId(value: string): void;
  inviteResetKey: number;
  setInviteResetKey(update: (value: number) => number): void;
  selectedInviteTeam: HubTeam | undefined;
  teamOptions: SelectFieldOption<string>[];
  copiedInvitationId: string | null;
  setCopiedInvitationId(value: string): void;
  pending: boolean;
  mutationError: string | null;
  setMutationError(value: string | null): void;
  run: HubRun;
  createTeam(): void;
  select(value: TeamSelection): void;
  clearSelection(): void;
  setTeamMembership(teamId: string, userId: string, included: boolean): void;
  renameTeam(teamId: string, name: string): Promise<void>;
  removeTeam(teamId: string, name: string): Promise<void>;
  removeMember(memberId: string, name: string): Promise<void>;
  manageAccess(): void;
}) {
  const selectedMember =
    selection?.kind === "member"
      ? members.data?.members.find(({ id }) => id === selection.id)
      : undefined;
  if (selectedMember !== undefined) {
    return (
      <SelectedMemberFromQueries
        hub={hub}
        member={selectedMember}
        teams={teams}
        identities={identities}
        connections={connections}
        assignments={assignments}
        catalog={catalog}
        pending={pending}
        canManageMembers={canManageMembers}
        canManageTeams={canManageTeams}
        mutationError={mutationError}
        back={clearSelection}
        setTeamMembership={setTeamMembership}
        run={run}
        refetchMembers={members.refetch}
        removeMember={removeMember}
        manageAccess={manageAccess}
      />
    );
  }
  const selectedTeam =
    selection?.kind === "team"
      ? teams.data?.teams.find(({ id }) => id === selection.id)
      : undefined;
  if (selectedTeam !== undefined) {
    return (
      <SelectedTeamFromQueries
        team={selectedTeam}
        members={members}
        assignments={assignments}
        catalog={catalog}
        pending={pending}
        canManage={canManageTeams}
        mutationError={mutationError}
        back={clearSelection}
        setMembership={setTeamMembership}
        renameTeam={renameTeam}
        removeTeam={removeTeam}
        manageAccess={manageAccess}
      />
    );
  }
  return (
    <View>
      <MemberOverviewSection
        hub={hub}
        members={members}
        teams={teams}
        identities={identities}
        connections={connections}
        assignments={assignments}
        catalog={catalog}
        invitations={signedInAccount?.team?.invitations ?? []}
        canManageMembers={canManageMembers}
        inviteEmail={inviteEmail}
        setInviteEmail={setInviteEmail}
        inviteRole={inviteRole}
        setInviteRole={setInviteRole}
        inviteTeamId={inviteTeamId}
        setInviteTeamId={setInviteTeamId}
        inviteResetKey={inviteResetKey}
        setInviteResetKey={setInviteResetKey}
        selectedInviteTeam={selectedInviteTeam}
        teamOptions={teamOptions}
        copiedInvitationId={copiedInvitationId}
        setCopiedInvitationId={setCopiedInvitationId}
        pending={pending}
        mutationError={mutationError}
        setMutationError={setMutationError}
        run={run}
        select={select}
      />
      <TeamOverviewSection
        teams={teams}
        assignments={assignments}
        catalog={catalog}
        canManage={canManageTeams}
        teamName={teamName}
        setTeamName={setTeamName}
        pending={pending}
        createTeam={createTeam}
        select={select}
      />
      <ChannelIdentitySettings />
    </View>
  );
}

function SelectedMemberFromQueries({
  hub,
  member,
  teams,
  identities,
  connections,
  assignments,
  catalog,
  pending,
  canManageMembers,
  canManageTeams,
  mutationError,
  back,
  setTeamMembership,
  run,
  refetchMembers,
  removeMember,
  manageAccess,
}: {
  hub: HubAccount;
  member: HubMember;
  teams: UseQueryResult<z.infer<typeof HubTeamsSchema>, Error>;
  identities: UseQueryResult<z.infer<typeof HubChannelIdentitiesSchema>, Error>;
  connections: UseQueryResult<z.infer<typeof HubConnectionsSchema>, Error>;
  assignments: UseQueryResult<z.infer<typeof HubAccessAssignmentsSchema>, Error>;
  catalog: UseQueryResult<z.infer<typeof HubAccessCatalogSchema>, Error>;
  pending: boolean;
  canManageMembers: boolean;
  canManageTeams: boolean;
  mutationError: string | null;
  back(): void;
  setTeamMembership(teamId: string, userId: string, included: boolean): void;
  run: HubRun;
  refetchMembers(): Promise<unknown>;
  removeMember(memberId: string, name: string): Promise<void>;
  manageAccess(): void;
}) {
  return (
    <SelectedMemberDetail
      hub={hub}
      member={member}
      teams={teams.data?.teams ?? []}
      identities={identities.data?.identities ?? []}
      connections={connections.data?.connections ?? []}
      assignments={assignments.data?.assignments ?? []}
      resources={catalog.data?.resources ?? []}
      accessLevels={catalog.data?.accessLevels ?? EMPTY_HUB_ACCESS_LEVELS}
      pending={pending}
      canManageMembers={canManageMembers}
      canManageTeams={canManageTeams}
      mutationError={mutationError}
      back={back}
      setTeamMembership={setTeamMembership}
      run={run}
      refetchMembers={refetchMembers}
      removeMember={removeMember}
      manageAccess={manageAccess}
    />
  );
}

function SelectedTeamFromQueries({
  team,
  members,
  assignments,
  catalog,
  pending,
  canManage,
  mutationError,
  back,
  setMembership,
  renameTeam,
  removeTeam,
  manageAccess,
}: {
  team: HubTeam;
  members: UseQueryResult<z.infer<typeof HubMembersSchema>, Error>;
  assignments: UseQueryResult<z.infer<typeof HubAccessAssignmentsSchema>, Error>;
  catalog: UseQueryResult<z.infer<typeof HubAccessCatalogSchema>, Error>;
  pending: boolean;
  canManage: boolean;
  mutationError: string | null;
  back(): void;
  setMembership(teamId: string, userId: string, included: boolean): void;
  renameTeam(teamId: string, name: string): Promise<void>;
  removeTeam(teamId: string, name: string): Promise<void>;
  manageAccess(): void;
}) {
  return (
    <SelectedTeamDetail
      team={team}
      members={members.data?.members ?? []}
      assignments={assignments.data?.assignments ?? []}
      resources={catalog.data?.resources ?? []}
      accessLevels={catalog.data?.accessLevels ?? EMPTY_HUB_ACCESS_LEVELS}
      pending={pending}
      canManage={canManage}
      mutationError={mutationError}
      back={back}
      setMembership={setMembership}
      renameTeam={renameTeam}
      removeTeam={removeTeam}
      manageAccess={manageAccess}
    />
  );
}

function MemberOverviewSection({
  hub,
  members,
  teams,
  identities,
  connections,
  assignments,
  catalog,
  invitations,
  canManageMembers,
  inviteEmail,
  setInviteEmail,
  inviteRole,
  setInviteRole,
  inviteTeamId,
  setInviteTeamId,
  inviteResetKey,
  setInviteResetKey,
  selectedInviteTeam,
  teamOptions,
  copiedInvitationId,
  setCopiedInvitationId,
  pending,
  mutationError,
  setMutationError,
  run,
  select,
}: {
  hub: HubAccount;
  members: UseQueryResult<z.infer<typeof HubMembersSchema>, Error>;
  teams: UseQueryResult<z.infer<typeof HubTeamsSchema>, Error>;
  identities: UseQueryResult<z.infer<typeof HubChannelIdentitiesSchema>, Error>;
  connections: UseQueryResult<z.infer<typeof HubConnectionsSchema>, Error>;
  assignments: UseQueryResult<z.infer<typeof HubAccessAssignmentsSchema>, Error>;
  catalog: UseQueryResult<z.infer<typeof HubAccessCatalogSchema>, Error>;
  invitations: HubManagedInvitation[];
  canManageMembers: boolean;
  inviteEmail: string;
  setInviteEmail(value: string): void;
  inviteRole: "admin" | "member";
  setInviteRole(value: "admin" | "member"): void;
  inviteTeamId: string;
  setInviteTeamId(value: string): void;
  inviteResetKey: number;
  setInviteResetKey(update: (value: number) => number): void;
  selectedInviteTeam: HubTeam | undefined;
  teamOptions: SelectFieldOption<string>[];
  copiedInvitationId: string | null;
  setCopiedInvitationId(value: string): void;
  pending: boolean;
  mutationError: string | null;
  setMutationError(value: string | null): void;
  run: HubRun;
  select(value: TeamSelection): void;
}) {
  return (
    <SettingsSection title="Members">
      {mutationError ? <Alert variant="error" title={mutationError} /> : null}
      <ResourceFeedbackGroup queries={[members, teams, identities, connections]} />
      <MemberRows
        members={members.data?.members ?? []}
        teams={teams.data?.teams ?? []}
        identities={identities.data?.identities ?? []}
        pending={pending}
        select={select}
      />
      {canManageMembers ? (
        <InviteMemberForm
          hub={hub}
          assignments={assignments}
          catalog={catalog}
          inviteEmail={inviteEmail}
          setInviteEmail={setInviteEmail}
          inviteRole={inviteRole}
          setInviteRole={setInviteRole}
          inviteTeamId={inviteTeamId}
          setInviteTeamId={setInviteTeamId}
          inviteResetKey={inviteResetKey}
          setInviteResetKey={setInviteResetKey}
          selectedInviteTeam={selectedInviteTeam}
          teamOptions={teamOptions}
          pending={pending}
          run={run}
        />
      ) : null}
      {invitations.length > 0 ? (
        <View style={settingsStyles.card}>
          {invitations.map((invitation, index) => (
            <PendingInvitationRow
              key={invitation.id}
              hub={hub}
              invitation={invitation}
              bordered={index > 0}
              copied={copiedInvitationId === invitation.id}
              setCopiedInvitationId={setCopiedInvitationId}
              setMutationError={setMutationError}
              pending={pending}
              run={run}
            />
          ))}
        </View>
      ) : null}
    </SettingsSection>
  );
}

function MemberRows({
  members,
  teams,
  identities,
  pending,
  select,
}: {
  members: HubMember[];
  teams: HubTeam[];
  identities: HubIdentity[];
  pending: boolean;
  select(value: TeamSelection): void;
}) {
  if (members.length === 0) {
    return (
      <View style={settingsStyles.card}>
        <EmptyRow message="No Members are available." />
      </View>
    );
  }
  return (
    <View style={settingsStyles.card}>
      {members.map((member, index) => (
        <MemberOverviewRow
          key={member.id}
          member={member}
          teamCount={teams.filter((team) => team.userIds.includes(member.userId)).length}
          identityCount={identities.filter((identity) => identity.memberId === member.id).length}
          bordered={index > 0}
          pending={pending}
          select={select}
        />
      ))}
    </View>
  );
}

function MemberOverviewRow({
  member,
  teamCount,
  identityCount,
  bordered,
  pending,
  select,
}: {
  member: HubMember;
  teamCount: number;
  identityCount: number;
  bordered: boolean;
  pending: boolean;
  select(value: TeamSelection): void;
}) {
  const view = useCallback(() => select({ kind: "member", id: member.id }), [member.id, select]);
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{member.name}</Text>
        <Text style={settingsStyles.rowHint}>
          {`${channelLabel(member.role)} · ${String(teamCount)} ${plural(teamCount, "Team")} · ${String(identityCount)} Channel ${plural(identityCount, "identity", "identities")}`}
        </Text>
      </View>
      <Button size="xs" variant="ghost" disabled={pending} onPress={view}>
        View
      </Button>
    </View>
  );
}

function InviteMemberForm({
  hub,
  assignments,
  catalog,
  inviteEmail,
  setInviteEmail,
  inviteRole,
  setInviteRole,
  inviteTeamId,
  setInviteTeamId,
  inviteResetKey,
  setInviteResetKey,
  selectedInviteTeam,
  teamOptions,
  pending,
  run,
}: {
  hub: HubAccount;
  assignments: UseQueryResult<z.infer<typeof HubAccessAssignmentsSchema>, Error>;
  catalog: UseQueryResult<z.infer<typeof HubAccessCatalogSchema>, Error>;
  inviteEmail: string;
  setInviteEmail(value: string): void;
  inviteRole: "admin" | "member";
  setInviteRole(value: "admin" | "member"): void;
  inviteTeamId: string;
  setInviteTeamId(value: string): void;
  inviteResetKey: number;
  setInviteResetKey(update: (value: number) => number): void;
  selectedInviteTeam: HubTeam | undefined;
  teamOptions: SelectFieldOption<string>[];
  pending: boolean;
  run: HubRun;
}) {
  const compact = useIsCompactFormFactor();
  const fieldSize = compact ? "md" : "sm";
  const reviewReady =
    inviteTeamId.length === 0 ||
    (selectedInviteTeam !== undefined &&
      assignments.data !== undefined &&
      catalog.data !== undefined &&
      !assignments.isError &&
      !catalog.isError);
  const retryPreview = useCallback(() => {
    void Promise.all([assignments.refetch(), catalog.refetch()]);
  }, [assignments, catalog]);
  const roleDisplay = useMemo(() => ({ label: channelLabel(inviteRole) }), [inviteRole]);
  const teamDisplay = useMemo(
    () => ({ label: selectedInviteTeam?.name ?? "No Team" }),
    [selectedInviteTeam?.name],
  );
  const sendInvitation = useCallback(() => {
    if (!reviewReady) return;
    void run(async () => {
      await hub.inviteMember({
        email: inviteEmail.trim().toLowerCase(),
        role: inviteRole,
        ...(selectedInviteTeam === undefined ? {} : { teamId: selectedInviteTeam.id }),
      });
      setInviteEmail("");
      setInviteRole("member");
      setInviteTeamId("");
      setInviteResetKey((value) => value + 1);
    });
  }, [
    hub,
    inviteEmail,
    inviteRole,
    run,
    reviewReady,
    selectedInviteTeam,
    setInviteEmail,
    setInviteResetKey,
    setInviteRole,
    setInviteTeamId,
  ]);
  const reviewTitle =
    selectedInviteTeam === undefined ? "No resource access" : `Join ${selectedInviteTeam.name}`;
  const reviewDescription =
    selectedInviteTeam === undefined
      ? "The account joins the organization only. Assign access later if needed."
      : "After accepting, the Member receives the Team access shown below.";
  return (
    <View style={[settingsStyles.card, styles.form]}>
      <Field label="Email">
        <FormTextInput
          size={fieldSize}
          initialValue=""
          resetKey={inviteResetKey}
          onChangeText={setInviteEmail}
          placeholder="teammate@example.com"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!pending}
        />
      </Field>
      <SelectField
        size={fieldSize}
        label="Organization role"
        value={inviteRole}
        selectedDisplay={roleDisplay}
        options={INVITATION_ROLE_OPTIONS}
        onChange={setInviteRole}
        placeholder="Choose a role"
        emptyText="No organization roles are available."
        title="Organization role"
        disabled={pending}
      />
      <SelectField
        size={fieldSize}
        label="Team"
        value={inviteTeamId}
        selectedDisplay={teamDisplay}
        options={teamOptions}
        onChange={setInviteTeamId}
        placeholder="No Team"
        emptyText="Create a Team first."
        searchable={teamOptions.length > 7}
        title="Team"
        disabled={pending}
      />
      <Alert variant="info" title={reviewTitle} description={reviewDescription} />
      {inviteTeamId.length > 0 ? (
        <InvitationTeamAccessPreview
          team={selectedInviteTeam}
          assignments={assignments}
          catalog={catalog}
          retry={retryPreview}
        />
      ) : null}
      <Button
        disabled={pending || inviteEmail.trim().length === 0 || !reviewReady}
        loading={pending}
        onPress={sendInvitation}
      >
        Send invitation
      </Button>
    </View>
  );
}

function InvitationTeamAccessPreview({
  team,
  assignments,
  catalog,
  retry,
}: {
  team: HubTeam | undefined;
  assignments: UseQueryResult<z.infer<typeof HubAccessAssignmentsSchema>, Error>;
  catalog: UseQueryResult<z.infer<typeof HubAccessCatalogSchema>, Error>;
  retry(): void;
}) {
  if (assignments.isPending || catalog.isPending)
    return <Text style={settingsStyles.rowHint}>Loading Team access...</Text>;
  if (
    team === undefined ||
    assignments.isError ||
    catalog.isError ||
    assignments.data === undefined ||
    catalog.data === undefined
  ) {
    return (
      <Alert
        variant="error"
        title="Team access unavailable"
        description="Refresh the access preview before sending the invitation."
      >
        <Button size="sm" variant="outline" onPress={retry}>
          Retry
        </Button>
      </Alert>
    );
  }
  const entries = assignments.data.assignments
    .filter((assignment) => assignment.subjectKind === "team" && assignment.subjectId === team.id)
    .map((assignment) => ({ assignment, source: `Via ${team.name}` }));
  return (
    <View>
      <Text
        style={settingsStyles.rowHint}
      >{`${entries.length} current ${plural(entries.length, "assignment")}`}</Text>
      <AccessSummary
        entries={entries}
        resources={catalog.data.resources}
        accessLevels={catalog.data.accessLevels}
        emptyMessage="This Team has no resource access"
      />
    </View>
  );
}

function PendingInvitationRow({
  hub,
  invitation,
  bordered,
  copied,
  setCopiedInvitationId,
  setMutationError,
  pending,
  run,
}: {
  hub: HubAccount;
  invitation: HubManagedInvitation;
  bordered: boolean;
  copied: boolean;
  setCopiedInvitationId(value: string): void;
  setMutationError(value: string): void;
  pending: boolean;
  run: HubRun;
}) {
  const copy = useCallback(() => {
    void copyToClipboard(invitation.link)
      .then(() => setCopiedInvitationId(invitation.id))
      .catch((error: unknown) =>
        setMutationError(
          error instanceof Error ? error.message : "Unable to copy invitation link.",
        ),
      );
  }, [invitation.id, invitation.link, setCopiedInvitationId, setMutationError]);
  const cancel = useCallback(
    () => void run(() => hub.cancelInvitation(invitation.id)),
    [hub, invitation.id, run],
  );
  const team = invitation.team === undefined ? " · No Team" : ` · ${invitation.team.name}`;
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{invitation.email}</Text>
        <Text style={settingsStyles.rowHint}>
          {`Pending · ${channelLabel(invitation.role)}${team}`}
        </Text>
      </View>
      <View style={styles.actions}>
        <Button size="xs" variant="outline" disabled={pending} onPress={copy}>
          {copied ? "Copied" : "Copy link"}
        </Button>
        <Button size="xs" variant="ghost" disabled={pending} onPress={cancel}>
          Cancel
        </Button>
      </View>
    </View>
  );
}

function TeamOverviewSection({
  teams,
  assignments,
  catalog,
  canManage,
  teamName,
  setTeamName,
  pending,
  createTeam,
  select,
}: {
  teams: UseQueryResult<z.infer<typeof HubTeamsSchema>, Error>;
  assignments: UseQueryResult<z.infer<typeof HubAccessAssignmentsSchema>, Error>;
  catalog: UseQueryResult<z.infer<typeof HubAccessCatalogSchema>, Error>;
  canManage: boolean;
  teamName: string;
  setTeamName(value: string): void;
  pending: boolean;
  createTeam(): void;
  select(value: TeamSelection): void;
}) {
  const values = teams.data?.teams ?? [];
  return (
    <SettingsSection title="Teams">
      <ResourceFeedbackGroup queries={[assignments, catalog]} />
      <View style={settingsStyles.card}>
        {values.length === 0 ? (
          <EmptyRow message="No Teams. The owner already has full access." />
        ) : (
          values.map((team, index) => (
            <TeamOverviewRow
              key={team.id}
              team={team}
              assignmentCount={teamAssignmentCount(assignments.data?.assignments ?? [], team.id)}
              bordered={index > 0}
              pending={pending}
              select={select}
            />
          ))
        )}
      </View>
      {canManage ? (
        <View style={[settingsStyles.card, styles.form]}>
          <Field label="Team name">
            <FormTextInput
              initialValue=""
              resetKey={values.length}
              onChangeText={setTeamName}
              placeholder="Customer support"
              editable={!pending}
            />
          </Field>
          <Button disabled={pending || teamName.trim().length === 0} onPress={createTeam}>
            Create Team
          </Button>
        </View>
      ) : null}
    </SettingsSection>
  );
}

function TeamOverviewRow({
  team,
  assignmentCount,
  bordered,
  pending,
  select,
}: {
  team: HubTeam;
  assignmentCount: number;
  bordered: boolean;
  pending: boolean;
  select(value: TeamSelection): void;
}) {
  const view = useCallback(() => select({ kind: "team", id: team.id }), [select, team.id]);
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{team.name}</Text>
        <Text style={settingsStyles.rowHint}>
          {`${String(team.userIds.length)} ${plural(team.userIds.length, "Member")} · ${String(assignmentCount)} ${plural(assignmentCount, "assignment")}`}
        </Text>
      </View>
      <Button size="xs" variant="ghost" disabled={pending} onPress={view}>
        View
      </Button>
    </View>
  );
}

function MemberDetail({
  member,
  teams,
  identities,
  connections,
  assignments,
  resources,
  accessLevels,
  pending,
  canManageMembers,
  canManageTeams,
  mutationError,
  back,
  setTeamMembership,
  setRole,
  remove,
  manageAccess,
}: {
  member: HubMember;
  teams: HubTeam[];
  identities: HubIdentity[];
  connections: HubConnection[];
  assignments: HubAssignment[];
  resources: HubAccessResource[];
  accessLevels: HubAccessLevels;
  pending: boolean;
  canManageMembers: boolean;
  canManageTeams: boolean;
  mutationError: string | null;
  back(): void;
  setTeamMembership(teamId: string, userId: string, included: boolean): void;
  setRole(role: "admin" | "member"): Promise<void>;
  remove(): Promise<void>;
  manageAccess(): void;
}) {
  const memberTeams = teams.filter(({ userIds }) => userIds.includes(member.userId));
  const memberTeamIds = new Set(memberTeams.map(({ id }) => id));
  const memberIdentities = identities.filter(({ memberId }) => memberId === member.id);
  const directAssignments = assignments.filter(
    ({ subjectKind, subjectId }) => subjectKind === "member" && subjectId === member.id,
  );
  const effectiveAssignments = assignments.flatMap((assignment) => {
    if (assignment.subjectKind === "member" && assignment.subjectId === member.id) {
      return [{ assignment, source: "Direct" }];
    }
    if (assignment.subjectKind === "team" && memberTeamIds.has(assignment.subjectId)) {
      return [
        {
          assignment,
          source: `Via ${teams.find(({ id }) => id === assignment.subjectId)?.name ?? "Team"}`,
        },
      ];
    }
    return [];
  });
  const connectionById = new Map(connections.map((connection) => [connection.id, connection]));
  const setMemberRole = useCallback(() => void setRole("member"), [setRole]);
  const setAdminRole = useCallback(() => void setRole("admin"), [setRole]);
  const removeSelectedMember = useCallback(() => void remove(), [remove]);
  return (
    <View>
      <SettingsSection title={member.name}>
        <View style={styles.actions}>
          <Button size="xs" variant="outline" disabled={pending} onPress={back}>
            Back to Team
          </Button>
        </View>
        {mutationError ? <Alert variant="error" title={mutationError} /> : null}
        {member.role === "owner" ? (
          <Alert
            variant="success"
            title="Full organization access"
            description="Owner access is automatic and does not depend on Team or direct assignments."
          />
        ) : null}
        <View style={settingsStyles.card}>
          <InfoRow title="Email" hint={member.email} />
          <InfoRow title="Organization role" hint={channelLabel(member.role)} bordered />
          <InfoRow title="Status" hint="Active" bordered />
        </View>
        {canManageMembers && member.role !== "owner" ? (
          <View style={styles.actions}>
            <Button
              size="xs"
              variant={member.role === "member" ? "secondary" : "outline"}
              disabled={pending || member.role === "member"}
              onPress={setMemberRole}
            >
              Member
            </Button>
            <Button
              size="xs"
              variant={member.role === "admin" ? "secondary" : "outline"}
              disabled={pending || member.role === "admin"}
              onPress={setAdminRole}
            >
              Admin
            </Button>
            <Button
              size="xs"
              variant="destructive"
              disabled={pending}
              onPress={removeSelectedMember}
            >
              Remove Member
            </Button>
          </View>
        ) : null}
      </SettingsSection>
      <SettingsSection title="Teams">
        <View style={settingsStyles.card}>
          {teams.length === 0 ? (
            <EmptyRow message="No Teams yet" />
          ) : (
            teams.map((team, index) => (
              <MemberTeamMembershipRow
                key={team.id}
                team={team}
                userId={member.userId}
                included={memberTeamIds.has(team.id)}
                bordered={index > 0}
                pending={pending}
                canManage={canManageTeams}
                setTeamMembership={setTeamMembership}
              />
            ))
          )}
        </View>
      </SettingsSection>
      <SettingsSection title="Channel identities">
        <View style={settingsStyles.card}>
          {memberIdentities.length === 0 ? (
            <EmptyRow message="No Channel identities linked" />
          ) : (
            memberIdentities.map((identity, index) => {
              const connection = connectionById.get(identity.connectionId);
              return (
                <InfoRow
                  key={identity.id}
                  title={identity.displayName ?? identity.externalSubjectId}
                  hint={
                    connection === undefined
                      ? "Connection unavailable"
                      : `${channelLabel(connection.provider)} · ${connection.name}`
                  }
                  bordered={index > 0}
                />
              );
            })
          )}
        </View>
        <Text style={settingsStyles.rowHint}>
          Members link verified identities from Account. Instance operators can manage trusted
          overrides from the Team overview.
        </Text>
      </SettingsSection>
      <SettingsSection title="Effective access">
        {member.role === "owner" ? (
          <InfoRow title="Full organization access" hint="Owner · No setup required" />
        ) : (
          <AccessSummary
            entries={effectiveAssignments}
            resources={resources}
            accessLevels={accessLevels}
            emptyMessage="No resource access granted"
          />
        )}
        {member.role !== "owner" ? (
          <Text style={settingsStyles.rowHint}>
            {`${String(directAssignments.length)} direct ${plural(directAssignments.length, "assignment")}; Team access is listed with its source.`}
          </Text>
        ) : null}
        {canManageTeams ? (
          <Button variant="outline" disabled={pending} onPress={manageAccess}>
            Manage access
          </Button>
        ) : null}
      </SettingsSection>
    </View>
  );
}

function MemberTeamMembershipRow({
  team,
  userId,
  included,
  bordered,
  pending,
  canManage,
  setTeamMembership,
}: {
  team: HubTeam;
  userId: string;
  included: boolean;
  bordered: boolean;
  pending: boolean;
  canManage: boolean;
  setTeamMembership(teamId: string, userId: string, included: boolean): void;
}) {
  const toggle = useCallback(
    () => setTeamMembership(team.id, userId, included),
    [included, setTeamMembership, team.id, userId],
  );
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{team.name}</Text>
        <Text style={settingsStyles.rowHint}>
          {included ? "Member of this Team" : "Not a member"}
        </Text>
      </View>
      {canManage ? (
        <Button
          size="xs"
          variant={included ? "ghost" : "outline"}
          disabled={pending}
          onPress={toggle}
        >
          {included ? "Remove" : "Add"}
        </Button>
      ) : null}
    </View>
  );
}

function TeamDetail({
  team,
  members,
  assignments,
  resources,
  accessLevels,
  pending,
  canManage,
  mutationError,
  back,
  setMembership,
  rename,
  remove,
  manageAccess,
}: {
  team: HubTeam;
  members: HubMember[];
  assignments: HubAssignment[];
  resources: HubAccessResource[];
  accessLevels: HubAccessLevels;
  pending: boolean;
  canManage: boolean;
  mutationError: string | null;
  back(): void;
  setMembership(teamId: string, userId: string, included: boolean): void;
  rename(name: string): Promise<void>;
  remove(): Promise<void>;
  manageAccess(): void;
}) {
  const [name, setName] = useState(team.name);
  const teamAssignments = assignments.filter(
    ({ subjectKind, subjectId }) => subjectKind === "team" && subjectId === team.id,
  );
  const renameSelectedTeam = useCallback(() => void rename(name.trim()), [name, rename]);
  const removeSelectedTeam = useCallback(() => void remove(), [remove]);
  return (
    <View>
      <SettingsSection title={team.name}>
        <View style={styles.actions}>
          <Button size="xs" variant="outline" disabled={pending} onPress={back}>
            Back to Team
          </Button>
        </View>
        {mutationError ? <Alert variant="error" title={mutationError} /> : null}
        <View style={settingsStyles.card}>
          <InfoRow
            title={`${String(team.userIds.length)} ${plural(team.userIds.length, "Member")}`}
            hint={`${String(teamAssignments.length)} ${plural(teamAssignments.length, "access assignment")}`}
          />
        </View>
        {canManage ? (
          <View style={[settingsStyles.card, styles.form]}>
            <Field label="Team name">
              <FormTextInput
                key={team.id}
                initialValue={team.name}
                onChangeText={setName}
                editable={!pending}
              />
            </Field>
            <Button
              variant="outline"
              disabled={pending || name.trim().length === 0 || name.trim() === team.name}
              onPress={renameSelectedTeam}
            >
              Rename Team
            </Button>
          </View>
        ) : null}
      </SettingsSection>
      <SettingsSection title="Members">
        <View style={settingsStyles.card}>
          {members.length === 0 ? (
            <EmptyRow message="No Members are available" />
          ) : (
            members.map((member, index) => (
              <TeamMemberMembershipRow
                key={member.id}
                teamId={team.id}
                member={member}
                included={team.userIds.includes(member.userId)}
                bordered={index > 0}
                pending={pending}
                canManage={canManage}
                setMembership={setMembership}
              />
            ))
          )}
        </View>
      </SettingsSection>
      <SettingsSection title="Access">
        <AccessSummary
          entries={teamAssignments.map((assignment) => ({ assignment, source: team.name }))}
          resources={resources}
          accessLevels={accessLevels}
          emptyMessage="No resource access granted"
        />
        {canManage ? (
          <Button variant="outline" disabled={pending} onPress={manageAccess}>
            Manage access
          </Button>
        ) : null}
      </SettingsSection>
      {canManage ? (
        <SettingsSection title="Danger zone">
          <Button variant="destructive" disabled={pending} onPress={removeSelectedTeam}>
            Delete Team
          </Button>
        </SettingsSection>
      ) : null}
    </View>
  );
}

function TeamMemberMembershipRow({
  teamId,
  member,
  included,
  bordered,
  pending,
  canManage,
  setMembership,
}: {
  teamId: string;
  member: HubMember;
  included: boolean;
  bordered: boolean;
  pending: boolean;
  canManage: boolean;
  setMembership(teamId: string, userId: string, included: boolean): void;
}) {
  const toggle = useCallback(
    () => setMembership(teamId, member.userId, included),
    [included, member.userId, setMembership, teamId],
  );
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{member.name}</Text>
        <Text style={settingsStyles.rowHint}>{channelLabel(member.role)}</Text>
      </View>
      {canManage ? (
        <Button
          size="xs"
          variant={included ? "ghost" : "outline"}
          disabled={pending}
          onPress={toggle}
        >
          {included ? "Remove" : "Add"}
        </Button>
      ) : null}
    </View>
  );
}

function AccessSummary({
  entries,
  resources,
  accessLevels,
  emptyMessage,
}: {
  entries: { assignment: HubAssignment; source: string }[];
  resources: HubAccessResource[];
  accessLevels: HubAccessLevels;
  emptyMessage: string;
}) {
  const resourceByKey = new Map(
    resources.map((resource) => [`${resource.kind}\0${resource.id}`, resource]),
  );
  return (
    <View style={settingsStyles.card}>
      {entries.length === 0 ? (
        <EmptyRow message={emptyMessage} />
      ) : (
        entries.map(({ assignment, source }, index) => {
          const resource = resourceByKey.get(
            `${assignment.resourceKind}\0${assignment.resourceId}`,
          );
          const level = assignmentAccessLevel(accessLevels, assignment);
          return (
            <View
              key={`${assignment.id}:${source}`}
              style={[settingsStyles.row, index > 0 ? settingsStyles.rowBorder : null]}
            >
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>
                  {resource?.name ?? "Unavailable resource"}
                </Text>
                <Text style={settingsStyles.rowHint}>
                  {`${hubResourceKindLabel(assignment.resourceKind)} · ${level} · ${source}`}
                </Text>
                <Text style={settingsStyles.rowHint}>
                  {assignment.privileges
                    .map((privilege) => privilege.replaceAll(".", " "))
                    .join(", ") || "No privileges"}
                </Text>
                {accessConstraintSummary(assignment.constraints) === null ? null : (
                  <Text style={settingsStyles.rowHint}>
                    {accessConstraintSummary(assignment.constraints)}
                  </Text>
                )}
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}

function HubConfigurationSettings() {
  const hub = useHubAccount();
  const continuation = useHubConnectionContinuation();
  const openContinuation = continuation.open;
  const clearContinuation = continuation.dismiss;
  const connections = useHubResource("connections", HubConnectionsSchema);
  const daemons = useHubResource("daemons", HubDaemonsSchema);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [connectingApplicationId, setConnectingApplicationId] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [addingConnection, setAddingConnection] = useState(false);
  const openConnection = useCallback(() => setAddingConnection(true), []);
  const closeConnection = useCallback(() => setAddingConnection(false), []);
  const connectionSaved = useCallback(async () => {
    setAddingConnection(false);
    await connections.refetch();
  }, [connections]);
  const refreshHosts = useCallback(() => void daemons.refetch(), [daemons]);
  const refreshHostsAction = useMemo(
    () => (
      <Button size="sm" variant="ghost" loading={daemons.isFetching} onPress={refreshHosts}>
        Refresh
      </Button>
    ),
    [daemons.isFetching, refreshHosts],
  );
  const canManage = hub.signedIn?.capabilities.manageResources === true;
  const refreshConnections = useCallback(() => void connections.refetch(), [connections]);
  const refreshConnectionsAction = useMemo(
    () => (
      <Button
        size="sm"
        variant="ghost"
        loading={connections.isFetching}
        onPress={refreshConnections}
      >
        Refresh
      </Button>
    ),
    [connections.isFetching, refreshConnections],
  );
  const disconnect = useCallback(
    async (connection: NonNullable<typeof connections.data>["connections"][number]) => {
      if (connection.consumers.length > 0) return;
      const confirmed = await confirmDialog({
        title: `Disconnect ${connection.name}?`,
        message: "The saved provider credential and its Channel identity mappings will be removed.",
        confirmLabel: "Disconnect",
        destructive: true,
      });
      if (!confirmed) return;
      setConnectionError(null);
      setDisconnectingId(connection.id);
      try {
        await hub.api().delete(`connections/${encodeURIComponent(connection.id)}`);
        await connections.refetch();
      } catch (error) {
        setConnectionError(error instanceof Error ? error.message : "Hub request failed.");
      } finally {
        setDisconnectingId(null);
      }
    },
    [connections, hub],
  );
  const connect = useCallback(
    async (application: NonNullable<typeof connections.data>["providerApplications"][number]) => {
      setConnectionError(null);
      clearContinuation();
      setConnectingApplicationId(application.id);
      try {
        const result = await hub.api().post(
          "connections",
          {
            provider: application.provider,
            providerApplicationId: application.id,
          },
          HubConnectionContinuationSchema,
        );
        await openContinuation(result.url);
      } catch (error) {
        setConnectionError(error instanceof Error ? error.message : "Hub request failed.");
      } finally {
        setConnectingApplicationId(null);
      }
    },
    [clearContinuation, hub, openContinuation],
  );
  return (
    <View>
      <HubConnectionResultNotice />
      <ProviderApplicationSettings />
      <SettingsSection title="Connections" trailing={refreshConnectionsAction}>
        <HubConnectionContinuationNotice continuation={continuation} />
        {connectionError ? <Alert variant="error" title={connectionError} /> : null}
        <ResourceFeedback query={connections} />
        {connections.data !== undefined ? (
          <View style={settingsStyles.card}>
            {connections.data.connections.length === 0 ? (
              <EmptyRow message="No provider Connections are configured." />
            ) : (
              connections.data.connections.map((connection, index) => (
                <ConnectionRow
                  key={connection.id}
                  connection={connection}
                  bordered={index > 0}
                  canManage={canManage}
                  disconnecting={disconnectingId === connection.id}
                  disconnect={disconnect}
                />
              ))
            )}
          </View>
        ) : null}
        {canManage ? (
          <Button size="sm" variant="outline" disabled={addingConnection} onPress={openConnection}>
            Add Channel Connection
          </Button>
        ) : null}
        {canManage && (connections.data?.providerApplications.length ?? 0) > 0 ? (
          <View style={styles.connectionActions}>
            <Text style={settingsStyles.rowHint}>Connect another provider account</Text>
            <View style={styles.actions}>
              {connections.data?.providerApplications.map((application) => (
                <ConnectProviderApplicationButton
                  key={`${application.provider}:${application.id}`}
                  application={application}
                  disabled={connectingApplicationId !== null || continuation.pending}
                  loading={connectingApplicationId === application.id}
                  connect={connect}
                />
              ))}
            </View>
          </View>
        ) : null}
      </SettingsSection>
      {canManage && addingConnection ? (
        <ChannelConnectionSetupSection close={closeConnection} saved={connectionSaved} />
      ) : null}
      {canManage ? <ApiKeySettings /> : null}
      <SettingsSection title="Managed Hosts" trailing={refreshHostsAction}>
        <ResourceFeedback query={daemons} />
        {daemons.data !== undefined ? (
          <View style={settingsStyles.card}>
            {daemons.data.daemons.length === 0 ? (
              <EmptyRow message="No Daemons are enrolled in this organization." />
            ) : (
              daemons.data.daemons.map((daemon, index) => (
                <ManagedHostRow
                  key={`${hub.signedIn?.account.id}:${daemon.id}`}
                  daemon={daemon}
                  bordered={index > 0}
                />
              ))
            )}
          </View>
        ) : null}
      </SettingsSection>
    </View>
  );
}

/**
 * Configuration settings adds a Connection with the same catalog-driven form the
 * Channels editor uses. Provider Applications are administered from their own
 * section here, so this one offers only the pasted-credential channels.
 */
function ChannelConnectionSetupSection({
  close,
  saved,
}: {
  close(): void;
  saved(): Promise<void>;
}) {
  const hub = useHubAccount();
  const [pending, setPending] = useState(false);
  const create = useCallback(
    async (body: Record<string, unknown>) => {
      setPending(true);
      try {
        await hub.api().post("connections", body, HubConnectionSchema);
        await saved();
      } finally {
        setPending(false);
      }
    },
    [hub, saved],
  );
  return (
    <View>
      <AddChannelConnection allowProviderApplications={false} disabled={pending} create={create} />
      <Button variant="outline" disabled={pending} onPress={close}>
        Cancel
      </Button>
    </View>
  );
}

function ConnectionRow({
  connection,
  bordered,
  canManage,
  disconnecting,
  disconnect,
}: {
  connection: HubConnection;
  bordered: boolean;
  canManage: boolean;
  disconnecting: boolean;
  disconnect(connection: HubConnection): Promise<void>;
}) {
  const handleDisconnect = useCallback(() => void disconnect(connection), [connection, disconnect]);
  const consumers = connection.consumers.map((consumer) => consumer.name).join(", ");
  return (
    <View style={[styles.connection, bordered ? settingsStyles.rowBorder : null]}>
      <View style={styles.connectionHeader}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>
            {`${channelLabel(connection.provider)} · ${connection.name}`}
          </Text>
          <Text style={settingsStyles.rowHint}>
            {`${connection.externalName ?? "Not connected"} · ${connection.status}`}
          </Text>
        </View>
        {canManage ? (
          <Button
            size="xs"
            variant="destructive"
            disabled={connection.consumers.length > 0}
            loading={disconnecting}
            onPress={handleDisconnect}
          >
            Disconnect
          </Button>
        ) : null}
      </View>
      <Text style={settingsStyles.rowHint}>
        {connection.consumers.length === 0
          ? "Not used by a Channel account, Automation, or Project."
          : `Used by ${consumers}. Move or remove these consumers before disconnecting.`}
      </Text>
    </View>
  );
}

function ConnectProviderApplicationButton({
  application,
  disabled,
  loading,
  connect,
}: {
  application: z.infer<typeof HubConnectionsSchema>["providerApplications"][number];
  disabled: boolean;
  loading: boolean;
  connect(
    application: z.infer<typeof HubConnectionsSchema>["providerApplications"][number],
  ): Promise<void>;
}) {
  const handleConnect = useCallback(() => void connect(application), [application, connect]);
  return (
    <Button
      size="xs"
      variant="outline"
      disabled={disabled}
      loading={loading}
      onPress={handleConnect}
    >
      {`${channelLabel(application.provider)} · ${application.name}`}
    </Button>
  );
}

function useHubResource<Schema extends z.ZodType>(
  resource: string,
  schema: Schema,
): UseQueryResult<z.infer<Schema>, Error> {
  const hub = useHubAccount();
  const organizationId = hub.signedIn?.organization.id ?? null;
  return useFetchQuery({
    queryKey: hubResourceQueryKey(
      { origin: hub.origin, organizationId, accountId: hub.signedIn?.account.id ?? null },
      resource,
    ),
    queryFn: () => hub.api().get(resource, schema),
    dataShape: "value",
    enabled: organizationId !== null,
    retry: false,
    staleTimeMs: 0,
  });
}

type ResourceQuery = UseQueryResult<unknown, Error>;

function ResourceFeedback({ query }: { query: ResourceQuery }) {
  if (query.isPending) return <Text style={settingsStyles.rowHint}>Loading…</Text>;
  if (query.error) {
    return (
      <Alert
        variant="error"
        title={query.error instanceof Error ? query.error.message : "Hub request failed."}
      />
    );
  }
  return null;
}

function ResourceFeedbackGroup({ queries }: { queries: ResourceQuery[] }) {
  if (queries.some(({ isPending }) => isPending)) {
    return <Text style={settingsStyles.rowHint}>Loading…</Text>;
  }
  const error = queries.find((query) => query.error)?.error;
  return error ? <Alert variant="error" title={error.message} /> : null;
}

function InfoRow({
  title,
  hint,
  bordered = false,
}: {
  title: string;
  hint: string;
  bordered?: boolean;
}) {
  const style = useMemo(
    () => [settingsStyles.row, bordered ? settingsStyles.rowBorder : null],
    [bordered],
  );
  return (
    <View style={style}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        <Text style={settingsStyles.rowHint}>{hint}</Text>
      </View>
    </View>
  );
}

function EmptyRow({ message }: { message: string }) {
  return (
    <View style={styles.empty}>
      <Text style={settingsStyles.rowHint}>{message}</Text>
    </View>
  );
}

function StateMessage({ message }: { message: string }) {
  return (
    <View style={styles.state}>
      <Text style={settingsStyles.rowHint}>{message}</Text>
    </View>
  );
}

function channelLabel(value: string): string {
  if (value.length === 0) return value;
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}

function plural(count: number, singular: string, pluralValue = `${singular}s`): string {
  return count === 1 ? singular : pluralValue;
}

function teamAssignmentCount(assignments: HubAssignment[], teamId: string): number {
  return assignments.filter(
    ({ subjectKind, subjectId }) => subjectKind === "team" && subjectId === teamId,
  ).length;
}

function assignmentAccessLevel(levels: HubAccessLevels, assignment: HubAssignment): string {
  const fastMode = assignment.privileges.includes("agent.fast.use");
  const target = [
    ...new Set(assignment.privileges.filter((privilege) => privilege !== "agent.fast.use")),
  ].sort();
  const level = Object.entries(levels[assignment.resourceKind] ?? {}).find(([, privileges]) => {
    const candidate = [...new Set(privileges)].sort();
    return (
      candidate.length === target.length &&
      candidate.every((value, index) => value === target[index])
    );
  })?.[0];
  const label =
    level === undefined
      ? `${String(target.length)} ${plural(target.length, "privilege")}`
      : channelLabel(level.replaceAll("_", " "));
  return fastMode ? `${label} · Fast mode` : label;
}

function hubResourceKindLabel(kind: HubAssignment["resourceKind"]): string {
  return {
    organization: "Organization",
    daemon: "Host",
    project: "Project",
    channel_account: "Channel account",
    automation: "Automation",
  }[kind];
}

function accessConstraintSummary(constraints: Record<string, unknown>): string | null {
  const details: string[] = [];
  const configurations = constraints["agentConfigurations"];
  if (Array.isArray(configurations)) {
    details.push(
      `${String(configurations.length)} Agent ${plural(configurations.length, "configuration")}`,
    );
  }
  const conversation = constraints["conversation"];
  if (typeof conversation === "object" && conversation !== null) {
    const kind = Reflect.get(conversation, "kind");
    if (typeof kind === "string") details.push(channelLabel(kind.replaceAll("_", " ")));
  }
  return details.length === 0 ? null : details.join(" · ");
}

const styles = StyleSheet.create((theme) => ({
  form: {
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  empty: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[6],
    alignItems: "center",
  },
  state: {
    padding: theme.spacing[6],
    alignItems: "center",
  },
  connection: {
    padding: theme.spacing[4],
    gap: theme.spacing[2],
  },
  connectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  connectionActions: {
    gap: theme.spacing[2],
  },
}));
