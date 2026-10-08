import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { i18n } from "@/i18n/i18next";
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
import { ChannelsSettingsRoute } from "./channels-settings-route";
import { AutomationSettings } from "./automation-settings";
import { HostsSettings } from "./hosts-settings";
import { InstanceSettings } from "./instance-settings";
import { IntegrationsSettings } from "./integrations-settings";
import { ChannelIdentitySelfLinkSettings } from "./channel-identity-self-link";
import { useHubSettingsDetailScroll } from "./detail-scroll";
import { organizationRoleLabel } from "./labels";
import { InfoRow } from "./resource-rows";
import { TeamSettings } from "./team/team-settings";
import { BackLink } from "./back-link";
import { FirstHostSetup } from "./first-host-setup";
import {
  HubConnectionSettings,
  HubOverviewSettings,
  HubLoginPolicySettings,
} from "@/device-access/hub-settings";
import { WhatIsHub } from "@/device-access/hub-help";
import { useHubEditLock } from "@/device-access/hub-edit-lock";
import { useHubProfiles } from "@/device-access/hub-profiles";
import { AccountSessions } from "@/device-access/account-sessions";
import { SegmentedControl } from "@/components/ui/segmented-control";

export function HubSettingsContent({
  section,
  initialAutomationCreate = false,
}: {
  section: HubSectionSlug;
  initialAutomationCreate?: boolean;
}) {
  const hub = useHubAccount();
  const showHelp =
    section === "hubs" || (section !== "overview" && section !== "sign-in" && !hub.signedIn);
  return (
    <>
      {showHelp ? <WhatIsHub /> : null}
      <HubSectionContent section={section} initialAutomationCreate={initialAutomationCreate} />
    </>
  );
}

function HubSectionContent({
  section,
  initialAutomationCreate,
}: {
  section: HubSectionSlug;
  initialAutomationCreate?: boolean;
}) {
  const hub = useHubAccount();
  if (section === "hubs") return <HubConnectionSettings />;
  if (section === "overview") return <HubOverviewSettings />;
  if (section === "sign-in") return <HubLoginPolicySettings />;
  if (section === "account") return <HubAccountSettings />;
  if (section === "hosts") return <HostsSettings />;
  return (
    <SignedInHubSettings
      key={JSON.stringify([hub.origin, hub.signedIn?.account.id, hub.signedIn?.organization.id])}
      section={section}
      initialAutomationCreate={initialAutomationCreate}
    />
  );
}

function SignedInHubSettings({
  section,
  initialAutomationCreate,
}: {
  section: Exclude<HubSectionSlug, "account" | "hosts" | "hubs" | "overview" | "sign-in">;
  initialAutomationCreate?: boolean;
}) {
  const { t } = useTranslation();
  const account = useHubAccount();
  if (!account.enabled) return null;
  if (account.loading) return <StateMessage message={t("hub.settings.account.loading")} />;
  // Sign in where the section was asked for; signing in changes this component's
  // key in HubSettingsContent, so the section renders without a trip to Account.
  if (!account.signedIn) return <HubAccountSettings />;

  switch (section) {
    case "channels":
      return <ChannelsSettingsRoute />;
    case "automations":
      return (
        <AutomationSettings
          ChannelInputs={ChannelSettings}
          initialCreate={initialAutomationCreate}
        />
      );
    case "team":
      return <TeamSettings />;
    case "integrations":
      return <IntegrationsSettings />;
    case "instance":
      return <InstanceSettings />;
  }
}

function HubAccountSettings() {
  const { t } = useTranslation();
  const hub = useHubAccount();
  if (hub.connection?.accountAuthentication === "personal") return <HubOverviewSettings />;
  if (!hub.enabled) return null;
  if (hub.loading) return <StateMessage message={t("hub.settings.account.loadingDots")} />;
  const state = hub.state;
  // A registration link creates a new account; it only applies to a signed-out browser.
  if (hub.registrationToken && state?.status === "signedOut") {
    return <EmailRegistrationCompletion hub={hub} />;
  }
  const invitation = getAccountInvitation(state);
  const accountId = state !== null && "account" in state ? state.account.id : null;
  const entry = (
    <HubAccountSettingsEntry
      key={JSON.stringify([hub.origin, state?.status, accountId, invitation?.id])}
      hub={hub}
      invitation={invitation}
    />
  );
  if (accountId && hub.origin?.startsWith("hub://"))
    return (
      <AuthenticatedAccountTabs key={JSON.stringify([hub.origin, accountId])}>
        {entry}
      </AuthenticatedAccountTabs>
    );
  return entry;
}

/** Account session management is independent of organization or resource access. */
function AuthenticatedAccountTabs({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"profile" | "sessions">("profile");
  return (
    <View>
      <SegmentedControl
        options={[
          { value: "profile", label: t("hub.settings.account.profileTab") },
          { value: "sessions", label: t("hub.settings.account.sessionsTab") },
        ]}
        value={tab}
        onValueChange={setTab}
      />
      {tab === "sessions" ? <AccountSessions /> : children}
    </View>
  );
}

function HubAccountSettingsEntry({
  hub,
  invitation,
}: {
  hub: HubAccount;
  invitation: HubInvitation | undefined;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const registry = useHubProfiles();
  const profile = registry.profiles.find((value) => value.hubId === registry.activeId);
  const setupUnavailable = hub.error?.startsWith("Owner setup approval is unavailable") === true;
  const setupBlocked = profile?.setupStatus === "blocked";
  const state = hub.state;
  const [pending, setPending] = useState(false);
  const scanOwnerSetup = useCallback(() => router.push("/pair-scan"), [router]);
  const retryAccount = useCallback(() => {
    setPending(true);
    void hub.refresh().finally(() => setPending(false));
  }, [hub]);
  if (setupBlocked)
    return (
      <SettingsSection title={t("hub.settings.account.ownerSetup")}>
        <Alert
          variant="warning"
          title={t("hub.settings.account.setupBlockedTitle")}
          description={t("hub.settings.account.setupBlockedDescription")}
        />
      </SettingsSection>
    );
  if (setupUnavailable && state?.status === "instanceSetupRequired")
    return (
      <SettingsSection title={t("hub.settings.account.ownerSetup")}>
        <Alert
          variant="warning"
          title={t("hub.settings.account.setupApprovalTitle")}
          description={t("hub.settings.account.setupApprovalDescription")}
        />
        <Button variant="outline" onPress={retryAccount} disabled={pending}>
          {t("hub.settings.account.checkSetupStatus")}
        </Button>
        <Button variant="outline" onPress={scanOwnerSetup} disabled={pending}>
          {t("hub.settings.account.scanSetupQr")}
        </Button>
        <Text style={settingsStyles.rowHint}>{t("hub.settings.account.pairingSeparate")}</Text>
      </SettingsSection>
    );

  return <HubAccountSettingsForm hub={hub} invitation={invitation} />;
}

function HubAccountSettingsForm({
  hub,
  invitation,
}: {
  hub: HubAccount;
  invitation: HubInvitation | undefined;
}) {
  useHubEditLock(hub.state?.status === "instanceSetupRequired");
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
    return <AccountStateUnavailable error={hub.error} pending={pending} retry={retryAccount} />;
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

function AccountStateUnavailable({
  error,
  pending,
  retry,
}: {
  error: string | null | undefined;
  pending: boolean;
  retry(): void;
}) {
  const { t } = useTranslation();
  return (
    <SettingsSection title={t("hub.settings.account.hubAccount")}>
      <Alert
        variant="error"
        title={t("hub.settings.account.stateUnavailableTitle")}
        description={error ?? t("hub.settings.account.stateUnavailableDescription")}
      >
        <Button size="sm" variant="outline" disabled={pending} onPress={retry}>
          {t("hub.settings.account.retry")}
        </Button>
      </Alert>
    </SettingsSection>
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
  const { t } = useTranslation();
  const signOut = useCallback(() => void run(hub.signOut), [hub.signOut, run]);
  const retry = useCallback(() => void run(hub.refresh), [hub.refresh, run]);
  return (
    <SettingsSection title={t("hub.settings.account.invitation")}>
      <Alert
        variant="warning"
        title={t("hub.settings.account.invitationUnavailableTitle")}
        description={t("hub.settings.account.invitationUnavailableSignedIn")}
      />
      <View style={settingsStyles.card}>
        <InfoRow title={t("hub.settings.account.signedInAs")} hint={accountEmail} />
      </View>
      <View style={styles.actions}>
        <Button variant="outline" disabled={pending} onPress={retry}>
          {t("hub.settings.account.retry")}
        </Button>
        <Button variant="outline" disabled={pending} onPress={signOut}>
          {t("hub.settings.account.signOut")}
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
  const { t } = useTranslation();
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
      ? t("hub.settings.account.joinNoTeams")
      : t("hub.settings.account.joinTeams", { teams: teamNames });
  const role = organizationRoleLabel(invitation.role);
  return (
    <SettingsSection
      title={t("hub.settings.account.joinTitle", { organization: invitation.organization.name })}
    >
      <Alert
        variant="info"
        title={t("hub.settings.account.invitedAs", { inviter: invitation.inviterName, role })}
        description={description}
      />
      <View style={settingsStyles.card}>
        <InfoRow
          title={t("hub.settings.account.organization")}
          hint={invitation.organization.name}
        />
        <InfoRow title={t("hub.settings.account.account")} hint={accountEmail} bordered />
        <InfoRow title={t("hub.settings.account.organizationRole")} hint={role} bordered />
        {teamNames.length === 0 ? null : (
          <InfoRow title={t("hub.settings.account.teams")} hint={teamNames} bordered />
        )}
      </View>
      <View style={styles.actions}>
        <Button disabled={pending} loading={pending} onPress={accept}>
          {t("hub.settings.account.acceptInvitation")}
        </Button>
        <Button variant="outline" disabled={pending} onPress={signOut}>
          {t("hub.settings.account.signOut")}
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
  const { t } = useTranslation();
  const router = useRouter();
  const [showIdentity, setShowIdentity] = useState(false);
  const openIdentity = useCallback(() => setShowIdentity(true), []);
  const params = useLocalSearchParams<{ channelConnectionId?: string }>();
  const backToAccount = useCallback(() => {
    setShowIdentity(false);
    router.setParams({ channelConnectionId: undefined });
  }, [router]);
  const role = organizationRoleLabel(state.membership.role);
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
        <BackLink to={t("hub.settings.navigation.account")} onPress={backToAccount} />
        <ChannelIdentitySelfLinkSettings />
      </View>
    );
  return (
    <View>
      <FirstHostSetup />
      <ProfileSettings
        hub={hub}
        account={state.account}
        isInstanceOperator={state.isInstanceOperator === true}
        pending={pending}
        run={run}
      />
      <OrganizationHeader
        hub={hub}
        organizationName={state.organization.name}
        organizationSlug={state.organization.slug}
        roleLabel={role}
        isOwner={state.membership.role === "owner"}
        pending={pending}
        run={run}
      />
      <ChannelIdentitiesSection pending={pending} onManage={openIdentity} />
      <View style={styles.signOut}>
        {hub.error ? <Alert variant="error" title={hub.error} /> : null}
        <Button size="sm" variant="outline" disabled={pending} onPress={signOut}>
          {t("hub.settings.account.signOut")}
        </Button>
      </View>
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
  const { t } = useTranslation();
  const signIn = useCallback(() => void run(() => hub.signIn()), [hub, run]);
  return (
    <SettingsSection title={t("hub.settings.account.hubAccount")}>
      <Alert
        variant="info"
        title={browserAuthenticationTitle(state)}
        description={t("hub.settings.account.browserDescription")}
      />
      <Button disabled={pending} loading={pending} onPress={signIn}>
        {t("hub.settings.account.continueInBrowser")}
      </Button>
      {hub.error ? <Alert variant="error" title={hub.error} /> : null}
    </SettingsSection>
  );
}

function browserAuthenticationTitle(state: HubAccountState | null): string {
  if (state?.status === "instanceSetupRequired") return i18n.t("hub.settings.account.setUpYourHub");
  if (state?.status === "passwordChangeRequired") {
    return i18n.t("hub.settings.account.passwordChangeRequired");
  }
  if (state?.status === "signedOut" && state.invitation !== undefined) {
    return i18n.t("hub.settings.account.joinTitle", {
      organization: state.invitation.organization.name,
    });
  }
  return i18n.t("hub.settings.account.signInToHub");
}

function InstanceSetup({ hub, pending, run, form, fields }: AccountEntryFormProps) {
  const { t } = useTranslation();
  useHubEditLock();
  const { email, password, confirmPassword, passwordsMatch } = fields;
  const { setEmail, setPassword, setConfirmPassword } = form;
  const compact = useIsCompactFormFactor();
  const fieldSize = compact ? "md" : "sm";
  const createOwner = useCallback(
    () => void run(() => hub.claimInstance({ email: email.trim().toLowerCase(), password })),
    [email, hub, password, run],
  );
  return (
    <SettingsSection title={t("hub.settings.account.setUpHub")}>
      <Alert
        variant="info"
        title={t("hub.settings.account.createFirstAccount")}
        description={t("hub.settings.account.createFirstAccountDescription")}
      />
      <View style={[settingsStyles.card, styles.form]}>
        <Field label={t("hub.settings.account.email")}>
          <FormTextInput
            size={fieldSize}
            initialValue={email}
            onChangeText={setEmail}
            placeholder={t("hub.settings.account.ownerEmailPlaceholder")}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!pending}
          />
        </Field>
        <Field
          label={t("hub.settings.account.password")}
          hint={t("hub.settings.account.passwordHint")}
        >
          <FormTextInput
            size={fieldSize}
            initialValue={password}
            onChangeText={setPassword}
            secureTextEntry
            editable={!pending}
          />
        </Field>
        <Field
          label={t("hub.settings.account.confirmPassword")}
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
        <Button disabled={pending || !fields.canSubmit} loading={pending} onPress={createOwner}>
          {t("hub.settings.account.createOwnerAccount")}
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
  const { t } = useTranslation();
  const { currentPassword, password, confirmPassword, passwordsMatch } = fields;
  const { setCurrentPassword, setPassword, setConfirmPassword } = form;
  const compact = useIsCompactFormFactor();
  const fieldSize = compact ? "md" : "sm";
  const savePassword = useCallback(
    () => void run(() => hub.changePassword({ currentPassword, newPassword: password })),
    [currentPassword, hub, password, run],
  );
  return (
    <SettingsSection title={t("hub.settings.account.chooseNewPassword")}>
      <Alert
        variant="info"
        title={t("hub.settings.account.signedInAsEmail", { email: state.account.email })}
        description={t("hub.settings.account.replaceTemporaryPassword")}
      />
      <View style={[settingsStyles.card, styles.form]}>
        <Field label={t("hub.settings.account.currentPassword")}>
          <FormTextInput
            size={fieldSize}
            initialValue={currentPassword}
            onChangeText={setCurrentPassword}
            secureTextEntry
            editable={!pending}
          />
        </Field>
        <Field
          label={t("hub.settings.account.newPassword")}
          hint={t("hub.settings.account.passwordHint")}
        >
          <FormTextInput
            size={fieldSize}
            initialValue={password}
            onChangeText={setPassword}
            secureTextEntry
            editable={!pending}
          />
        </Field>
        <Field
          label={t("hub.settings.account.confirmNewPassword")}
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
          {t("hub.settings.account.savePassword")}
        </Button>
      </View>
      {hub.error ? <Alert variant="error" title={hub.error} /> : null}
    </SettingsSection>
  );
}

function passwordMismatch(confirmPassword: string, passwordsMatch: boolean): string | null {
  return !passwordsMatch && confirmPassword.length > 0
    ? i18n.t("hub.settings.account.passwordsDoNotMatch")
    : null;
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
  const { t } = useTranslation();
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
  const submitDisabled = pending || !fields.canSubmit;
  return (
    <SettingsSection title={t("hub.settings.account.hubAccount")}>
      {state.invitationUnavailable === true ? (
        <Alert
          variant="warning"
          title={t("hub.settings.account.invitationUnavailableTitle")}
          description={t("hub.settings.account.invitationUnavailableSignedOut")}
        />
      ) : null}
      {/* One card: what signing in is for, then the ways to do it. */}
      <View style={[settingsStyles.card, styles.form]}>
        <View>
          <Text style={styles.formTitle}>{signedOutTitle(invitation, signingUp)}</Text>
          <Text style={settingsStyles.rowHint}>{signedOutDescription(invitation)}</Text>
        </View>
        <GoogleFirstSignIn
          googleSignIn={state.googleSignIn === true}
          hub={hub}
          pending={pending}
          run={run}
        >
          {signingUp ? (
            <Field label={t("hub.settings.account.name")}>
              <FormTextInput
                size={fieldSize}
                initialValue={name}
                onChangeText={setName}
                placeholder={t("hub.settings.account.namePlaceholder")}
                editable={!pending}
              />
            </Field>
          ) : null}
          <Field label={t("hub.settings.account.email")}>
            <FormTextInput
              size={fieldSize}
              key={invitedEmail ?? "email"}
              initialValue={email}
              onChangeText={setEmail}
              placeholder={t("hub.settings.account.emailPlaceholder")}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!pending && invitedEmail === undefined}
            />
          </Field>
          <Field label={t("hub.settings.account.password")} hint={passwordHint(signingUp)}>
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
              label={t("hub.settings.account.confirmPassword")}
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
            {submitLabel(signingUp)}
          </Button>
          <EmailRegistrationButton
            visible={state.emailSelfRegistration === true && invitation === undefined}
            email={email}
            hub={hub}
            pending={pending}
          />
          {maySignUp ? (
            <Button variant="ghost" disabled={pending} onPress={toggleEntryMode}>
              {entryModeToggleLabel(signingUp)}
            </Button>
          ) : null}
        </GoogleFirstSignIn>
      </View>
      {maySignUp ? null : <Text style={settingsStyles.rowHint}>{registrationMessage(state)}</Text>}
      {hub.error ? <Alert variant="error" title={hub.error} /> : null}
    </SettingsSection>
  );
}

function passwordHint(signingUp: boolean): string | undefined {
  return signingUp ? i18n.t("hub.settings.account.passwordHint") : undefined;
}

function submitLabel(signingUp: boolean): string {
  return signingUp
    ? i18n.t("hub.settings.account.createAccount")
    : i18n.t("hub.settings.account.signIn");
}

function entryModeToggleLabel(signingUp: boolean): string {
  return signingUp
    ? i18n.t("hub.settings.account.alreadyHaveAccount")
    : i18n.t("hub.settings.account.createAnAccount");
}

function signedOutTitle(invitation: HubInvitation | undefined, signingUp: boolean): string {
  if (invitation !== undefined) {
    return i18n.t("hub.settings.account.joinTitle", {
      organization: invitation.organization.name,
    });
  }
  return signingUp
    ? i18n.t("hub.settings.account.createHubAccount")
    : i18n.t("hub.settings.account.signInToHub");
}

function signedOutDescription(invitation: HubInvitation | undefined): string {
  if (invitation === undefined) {
    return i18n.t("hub.settings.account.signedOutDescription");
  }
  const teams = invitationTeams(invitation)
    .map(({ name }) => name)
    .join(", ");
  const inviter = invitation.inviterName;
  const role = organizationRoleLabel(invitation.role);
  return teams.length === 0
    ? i18n.t("hub.settings.account.invitedDescription", { inviter, role })
    : i18n.t("hub.settings.account.invitedToTeamsDescription", { inviter, role, teams });
}

function mayCreateAccount(
  state: Extract<HubAccountState, { status: "signedOut" }>,
  invitation: HubInvitation | undefined,
): boolean {
  return invitation !== undefined || state.registration === "open";
}

function registrationMessage(state: Extract<HubAccountState, { status: "signedOut" }>): string {
  if (state.registration === "invite_only") {
    return i18n.t("hub.settings.account.inviteOnly");
  }
  if (state.registration === "domain_self_registration") {
    return i18n.t("hub.settings.account.domainSelfRegistration");
  }
  return i18n.t("hub.settings.account.registrationClosed");
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
  formTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
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
  // Sign out ends the page, apart from what it describes, and never full width.
  signOut: {
    alignItems: "flex-start",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
}));
