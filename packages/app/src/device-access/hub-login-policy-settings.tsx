import { useCallback, useState } from "react";
import { useRouter } from "expo-router";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { z } from "zod";
import { useHubAccount } from "@/clisbot/hub/account-provider";
import { SettingsSection, SettingsCard, SettingsRow } from "@/components/settings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { useHubProfiles } from "./hub-profiles";
import { useHubDeviceCapabilities } from "./use-hub-device-capabilities";
import { useHubEditLock } from "./hub-edit-lock";
import { HubDeviceCapabilityError, type HubDeviceCapabilities } from "./hub-capabilities";
import type { PairedHubTransport } from "./hub-transport";
import { HubAccountSignInSummary } from "./hub-access-summary";
import { HubText as Text } from "./hub-text";

export function HubLoginPolicySummary() {
  const registry = useHubProfiles();
  const profile = registry.profiles.find((value) => value.hubId === registry.activeId);
  const { capabilities } = useHubDeviceCapabilities(profile);
  const router = useRouter();
  const openPolicy = useCallback(() => router.push("/settings/hub/sign-in"), [router]);
  const signIn = useCallback(() => router.push("/settings/hub/account"), [router]);
  return capabilities ? (
    <HubAccountSignInSummary capabilities={capabilities} openPolicy={openPolicy} signIn={signIn} />
  ) : null;
}

export function HubLoginPolicySettings() {
  const registry = useHubProfiles();
  const profile = registry.profiles.find((value) => value.hubId === registry.activeId);
  const account = useHubAccount();
  const { capabilities, transport, error, retry } = useHubDeviceCapabilities(profile);
  const router = useRouter();
  const signIn = useCallback(() => router.push("/settings/hub/account"), [router]);
  if (!profile || !transport)
    return (
      <Alert
        title="Connect a Hub first"
        description="Select a connected Hub from Hubs to manage its account sign-in."
      />
    );
  if (error)
    return <PolicyConnectionError error={error} profile={profile} signIn={signIn} retry={retry} />;
  if (!capabilities) return <Text>Loading account sign-in settings…</Text>;
  if (capabilities.loginRequired && !account.signedIn)
    return (
      <Alert
        variant="info"
        title="Account sign-in is required"
        description="Sign in to this Hub to continue. Your account determines your access."
      >
        <Button variant="outline" size="sm" onPress={signIn}>
          Sign in to this Hub
        </Button>
      </Alert>
    );
  if (!capabilities.canConfigureLogin)
    return (
      <Alert
        title="Only the Hub operator can change account sign-in"
        description="Ask the person who runs this Hub to update this setting."
      />
    );
  return (
    <HubLoginPolicy
      key={`${profile.hubId}:${capabilities.loginRequired}`}
      transport={transport}
      capabilities={capabilities}
      reload={retry}
    />
  );
}

function PolicyConnectionError({
  error,
  profile,
  signIn,
  retry,
}: {
  error: Error;
  profile: { entry?: string };
  signIn(): void;
  retry(): void;
}) {
  const router = useRouter();
  const pairAgain = useCallback(
    () =>
      router.push({
        pathname: "/settings/hub/[hubSection]",
        params: { hubSection: "hubs", hubIntent: "connect" },
      }),
    [router],
  );
  const denied = error instanceof HubDeviceCapabilityError && [401, 403].includes(error.status);
  if (!denied)
    return (
      <Alert
        variant="warning"
        title="Hub is unavailable"
        description="Check the connection and try again."
      >
        <Button variant="outline" onPress={retry}>
          Retry connection
        </Button>
      </Alert>
    );
  if (profile.entry === "account")
    return (
      <Alert
        variant="info"
        title="Sign in to this Hub"
        description="Use your Hub account to restore access."
      >
        <Button variant="outline" size="sm" onPress={signIn}>
          Sign in to this Hub
        </Button>
      </Alert>
    );
  return (
    <Alert
      variant="warning"
      title="This device needs to pair again"
      description="Ask the Hub operator for a new pairing QR or link."
    >
      <Button variant="outline" onPress={pairAgain}>
        Pair again
      </Button>
    </Alert>
  );
}

function HubLoginPolicy({
  transport,
  capabilities,
  reload,
}: {
  transport: PairedHubTransport;
  capabilities: HubDeviceCapabilities;
  reload(): void;
}) {
  const [editing, setEditing] = useState(false);
  const begin = useCallback(() => setEditing(true), []);
  const cancel = useCallback(() => {
    setEditing(false);
    reload();
  }, [reload]);
  useHubEditLock(editing);
  return (
    <SettingsSection title="Account sign-in">
      <SettingsCard>
        <SettingsRow
          label={capabilities.loginRequired ? "Required" : "Not required"}
          hint={
            capabilities.loginRequired
              ? "Account roles determine access to this Hub."
              : "Pairing is usually enough for your own devices. Enable sign-in when sharing this Hub, so each person has their own account and permissions."
          }
        >
          {!editing ? (
            <Button size="sm" variant="outline" onPress={begin}>
              {capabilities.loginRequired ? "Turn off account sign-in" : "Require account sign-in"}
            </Button>
          ) : null}
        </SettingsRow>
        {editing ? (
          <HubLoginPolicyEditor
            transport={transport}
            capabilities={capabilities}
            cancel={cancel}
            reload={reload}
          />
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}

function HubLoginPolicyEditor({
  transport,
  capabilities,
  cancel,
  reload,
}: {
  transport: PairedHubTransport;
  capabilities: HubDeviceCapabilities;
  cancel(): void;
  reload(): void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [ownerReady, setOwnerReady] = useState(capabilities.ownerLoginConfigured === true);
  const account = useHubAccount();
  const { pending, error, save } = usePolicyChange(
    transport,
    capabilities.loginRequired,
    async () => {
      if (!ownerReady) {
        await configureOwnerLogin(transport, email.trim(), password);
        setOwnerReady(true);
        setPassword("");
      }
    },
    async () => {
      // The policy is committed. A failed account refresh must not report that it was unchanged.
      await account.refresh().catch(() => undefined);
      reload();
    },
  );
  const needsOwner = !capabilities.loginRequired && !ownerReady;
  const valid =
    !needsOwner ||
    (z.string().email().max(320).safeParse(email.trim()).success &&
      password.length >= 12 &&
      password.length <= 1024);
  const useExisting = useCallback(() => setOwnerReady(true), []);
  const saveLabel = capabilities.loginRequired
    ? "Turn off account sign-in"
    : "Enable account sign-in";
  return (
    <View style={styles.card}>
      <PolicyChangeExplanation required={capabilities.loginRequired} needsOwner={needsOwner} />
      {needsOwner ? (
        <OwnerLoginFields
          email={email}
          password={password}
          setEmail={setEmail}
          setPassword={setPassword}
          pending={pending}
        />
      ) : null}
      {needsOwner && capabilities.ownerLoginConfigured === undefined ? (
        <Button variant="outline" disabled={pending} onPress={useExisting}>
          Use existing owner sign-in
        </Button>
      ) : null}
      {error ? (
        <Alert variant="error" title="Account sign-in was not changed" description={error} />
      ) : null}
      <View style={styles.actions}>
        <Button variant="outline" disabled={pending} onPress={cancel}>
          Cancel
        </Button>
        <Button variant="default" disabled={pending || !valid} loading={pending} onPress={save}>
          {pending ? "Saving..." : saveLabel}
        </Button>
      </View>
    </View>
  );
}

function PolicyChangeExplanation({
  required,
  needsOwner,
}: {
  required: boolean;
  needsOwner: boolean;
}) {
  if (required)
    return (
      <Alert
        variant="warning"
        title="Paired devices will have personal owner access"
        description="Account roles will no longer limit Hub access. Only turn this off for a personal Hub. Host managed access is unchanged."
      />
    );
  return (
    <>
      <Text>{needsOwner ? "Set up the owner's sign-in" : "Use the owner's existing sign-in"}</Text>
      <Text style={styles.hint}>
        Everyone will need to sign in after enabling. Account roles determine Hub access; Host
        managed access is unchanged.
      </Text>
      {!needsOwner ? (
        <Text style={styles.hint}>
          {"Sign in with the owner's existing account to continue after enabling."}
        </Text>
      ) : null}
    </>
  );
}

function OwnerLoginFields({
  email,
  password,
  setEmail,
  setPassword,
  pending,
}: {
  email: string;
  password: string;
  setEmail(value: string): void;
  setPassword(value: string): void;
  pending: boolean;
}) {
  return (
    <>
      <Field label="Owner email">
        <FormTextInput
          initialValue={email}
          onChangeText={setEmail}
          accessibilityLabel="Owner email"
          placeholder="you@example.com"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          editable={!pending}
        />
      </Field>
      <Field
        label="Owner password"
        hint="At least 12 characters. Keep it somewhere safe before continuing."
      >
        <FormTextInput
          initialValue={password}
          onChangeText={setPassword}
          accessibilityLabel="Owner password"
          placeholder="Choose a password"
          autoComplete="new-password"
          secureTextEntry
          editable={!pending}
        />
      </Field>
    </>
  );
}

function usePolicyChange(
  transport: PairedHubTransport,
  required: boolean,
  prepare: () => Promise<void>,
  complete: () => Promise<void>,
) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      if (!required) await prepare();
      const response = await transport.request("/api/auth/clisbot/device/login-policy", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ required: !required }),
      });
      if (!response.ok)
        throw new Error(
          response.status === 409
            ? "This Hub needs a configured personal owner to make this change. Review the owner's sign-in and try again."
            : "The Hub could not change this setting. Check your access and try again.",
        );
      await complete();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "The setting could not be changed. Try again.",
      );
    } finally {
      setPending(false);
    }
  }, [transport, required, prepare, complete]);
  return { pending, error, save };
}

async function configureOwnerLogin(transport: PairedHubTransport, email: string, password: string) {
  const response = await transport.request("/api/auth/clisbot/device/owner-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok)
    throw new Error(
      response.status === 409
        ? "The owner may already have a sign-in method, or this email is in use. Cancel to reload the setting before trying again."
        : "The owner's sign-in could not be saved. Check the email, password and your Hub access.",
    );
}

const styles = StyleSheet.create((theme) => ({
  card: { padding: theme.spacing[4], gap: theme.spacing[4] },
  hint: { fontSize: theme.fontSize.sm, lineHeight: 20, color: theme.colors.foregroundMuted },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
