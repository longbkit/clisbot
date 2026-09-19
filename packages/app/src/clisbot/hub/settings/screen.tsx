import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { useHubAccount } from "../account-provider";
import { EmailRegistrationButton, EmailRegistrationCompletion } from "./email-registration";
import { GoogleFirstInstanceSetup, GoogleFirstSignIn } from "./google-sign-in";
import { ProfileSettings } from "./profile-settings";
import { OrganizationHeader } from "./organization-header";
import { OrganizationSelection } from "./organization-selection";
import { ChannelIdentitiesSection } from "./channel-identities-section";
import { openHubAccountEntryForm, type HubAccountEntryMode } from "../account-entry-form";
import { invitationTeams, type HubAccountState } from "../contracts";
import { type HubSectionSlug } from "../navigation";
import { ChannelSettings } from "./channel-settings";
import { AutomationSettings } from "./automation-settings";
import { HostsSettings } from "./hosts-settings";
import { InstanceSettings } from "./instance-settings";
import { IntegrationsSettings } from "./integrations-settings";
import { ChannelIdentitySelfLinkSettings } from "./channel-identity-self-link";
import { useHubSettingsDetailScroll } from "./detail-scroll";
import { capitalizeLabel as channelLabel } from "./labels";
import { InfoRow } from "./resource-rows";
import { TeamSettings } from "./team/team-settings";
import { BackLink } from "./back-link";

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
          description="Sign in before managing Channels, Automations, or People."
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
    case "hosts":
      return <HostsSettings />;
    case "integrations":
      return <IntegrationsSettings />;
    case "instance":
      return <InstanceSettings />;
  }
}

function HubAccountSettings() {
  const hub = useHubAccount();
  if (!hub.enabled) return null;
  if (hub.loading) return <StateMessage message="Loading Hub account..." />;
  const state = hub.state;
  // A registration link creates a new account; it only applies to a signed-out browser.
  if (hub.registrationToken && state?.status === "signedOut") {
    return <EmailRegistrationCompletion hub={hub} />;
  }
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
        organizationName={fields.organizationName}
        setOrganizationName={form.setOrganizationName}
        canCreate={fields.canSubmit}
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
    return (
      <GoogleFirstInstanceSetup
        googleSignIn={state.googleSignIn === true}
        hub={hub}
        pending={pending}
        run={run}
      >
        <InstanceSetup form={form} fields={fields} hub={hub} pending={pending} run={run} />
      </GoogleFirstInstanceSetup>
    );
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
  const teamNames = invitationTeams(invitation)
    .map(({ name }) => name)
    .join(", ");
  const description =
    teamNames.length === 0
      ? "Joining the organization does not grant access to any Host, Project, Channel, or Automation. An owner or admin assigns that separately."
      : `You will join ${teamNames} and receive their current access after accepting.`;
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
        {teamNames.length === 0 ? null : <InfoRow title="Teams" hint={teamNames} bordered />}
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
        <BackLink to="Account" onPress={backToAccount} />
        <ChannelIdentitySelfLinkSettings />
      </View>
    );
  return (
    <View>
      <SettingsSection title="Account">
        <OrganizationHeader
          hub={hub}
          organizationName={state.organization.name}
          organizationSlug={state.organization.slug}
          roleLabel={role}
          isOwner={state.membership.role === "owner"}
          pending={pending}
          run={run}
        />
        {state.membership.role === "owner" ? (
          <Alert
            variant="success"
            title="Full organization access"
            description="Owners automatically have access to every current and future Host, Project, Channel, and Automation. No assignment is required."
          />
        ) : null}
        <View style={settingsStyles.card}>
          <InfoRow title={state.account.name} hint={state.account.email} />
          {state.isInstanceOperator ? (
            <InfoRow title="Hub instance" hint="Instance role: Operator" bordered />
          ) : null}
        </View>
        <ProfileSettings hub={hub} account={state.account} pending={pending} run={run} />
        <Button variant="outline" disabled={pending} onPress={signOut}>
          Sign out
        </Button>
        {hub.error ? <Alert variant="error" title={hub.error} /> : null}
      </SettingsSection>
      <ChannelIdentitiesSection pending={pending} onManage={openIdentity} />
    </View>
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
  const maySignUp = mayCreateAccount(state, invitation);
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
        <GoogleFirstSignIn
          googleSignIn={state.googleSignIn === true}
          hub={hub}
          pending={pending}
          run={run}
        >
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
            <Field
              label="Confirm password"
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
          ) : null}
          <Button disabled={submitDisabled} loading={pending} onPress={submit}>
            {signingUp ? "Create account" : "Sign in"}
          </Button>
          <EmailRegistrationButton
            visible={state.emailSelfRegistration === true && invitation === undefined}
            email={email}
            hub={hub}
            pending={pending}
          />
          {maySignUp ? (
            <Button variant="ghost" disabled={pending} onPress={toggleEntryMode}>
              {signingUp ? "Already have an account? Sign in" : "Create an account"}
            </Button>
          ) : null}
        </GoogleFirstSignIn>
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
  const teamNames = invitationTeams(invitation)
    .map(({ name }) => name)
    .join(", ");
  const team = teamNames.length === 0 ? "" : ` in ${teamNames}`;
  return `${invitation.inviterName} invited you as ${channelLabel(invitation.role)}${team}. The invitation is bound to the invited email.`;
}

function mayCreateAccount(
  state: Extract<HubAccountState, { status: "signedOut" }>,
  invitation: HubInvitation | undefined,
): boolean {
  return invitation !== undefined || state.registration === "open";
}

function registrationMessage(state: Extract<HubAccountState, { status: "signedOut" }>): string {
  if (state.registration === "invite_only") {
    return "Accounts are created by invitation. Ask an organization owner to invite you.";
  }
  if (state.registration === "domain_self_registration") {
    return "Accounts are created by invitation or with an allowed company email address.";
  }
  return "This Hub is not accepting new accounts.";
}

function StateMessage({ message }: { message: string }) {
  return (
    <View style={styles.state}>
      <Text style={settingsStyles.rowHint}>{message}</Text>
    </View>
  );
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
