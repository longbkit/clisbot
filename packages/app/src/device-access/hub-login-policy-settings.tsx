import { useCallback, useState } from "react";
import { useRouter } from "expo-router";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
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
  const { t } = useTranslation();
  const registry = useHubProfiles();
  const profile = registry.profiles.find((value) => value.hubId === registry.activeId);
  const account = useHubAccount();
  const { capabilities, transport, error, retry } = useHubDeviceCapabilities(profile);
  const router = useRouter();
  const signIn = useCallback(() => router.push("/settings/hub/account"), [router]);
  if (!profile || !transport)
    return (
      <Alert
        title={t("hub.connection.policy.connectFirstTitle")}
        description={t("hub.connection.policy.connectFirstBody")}
      />
    );
  if (error)
    return <PolicyConnectionError error={error} profile={profile} signIn={signIn} retry={retry} />;
  if (!capabilities) return <Text>{t("hub.connection.policy.loading")}</Text>;
  if (capabilities.loginRequired && !account.signedIn)
    return (
      <Alert
        variant="info"
        title={t("hub.connection.policy.requiredTitle")}
        description={t("hub.connection.policy.requiredBody")}
      >
        <Button variant="outline" size="sm" onPress={signIn}>
          {t("hub.connection.common.signInToHub")}
        </Button>
      </Alert>
    );
  if (!capabilities.canConfigureLogin)
    return (
      <Alert
        title={t("hub.connection.policy.operatorOnlyTitle")}
        description={t("hub.connection.policy.operatorOnlyBody")}
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
  const { t } = useTranslation();
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
        title={t("hub.connection.common.hubUnavailable")}
        description={t("hub.connection.policy.unavailableBody")}
      >
        <Button variant="outline" onPress={retry}>
          {t("hub.connection.common.retryConnection")}
        </Button>
      </Alert>
    );
  if (profile.entry === "account")
    return (
      <Alert
        variant="info"
        title={t("hub.connection.common.signInToHub")}
        description={t("hub.connection.policy.signInBody")}
      >
        <Button variant="outline" size="sm" onPress={signIn}>
          {t("hub.connection.common.signInToHub")}
        </Button>
      </Alert>
    );
  return (
    <Alert
      variant="warning"
      title={t("hub.connection.common.pairAgainTitle")}
      description={t("hub.connection.policy.pairAgainBody")}
    >
      <Button variant="outline" onPress={pairAgain}>
        {t("hub.connection.common.pairAgain")}
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
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const begin = useCallback(() => setEditing(true), []);
  const cancel = useCallback(() => {
    setEditing(false);
    reload();
  }, [reload]);
  useHubEditLock(editing);
  return (
    <SettingsSection title={t("hub.connection.common.accountSignIn")}>
      <SettingsCard>
        <SettingsRow
          label={
            capabilities.loginRequired
              ? t("hub.connection.common.required")
              : t("hub.connection.common.notRequired")
          }
          hint={
            capabilities.loginRequired
              ? t("hub.connection.policy.rolesHint")
              : t("hub.connection.policy.pairingHint")
          }
        >
          {!editing ? (
            <Button size="sm" variant="outline" onPress={begin}>
              {capabilities.loginRequired
                ? t("hub.connection.policy.turnOff")
                : t("hub.connection.policy.require")}
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
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [ownerReady, setOwnerReady] = useState(capabilities.ownerLoginConfigured === true);
  const account = useHubAccount();
  const { pending, error, save } = usePolicyChange(
    transport,
    capabilities.loginRequired,
    async () => {
      if (!ownerReady) {
        await configureOwnerLogin(transport, email.trim(), password, t);
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
    ? t("hub.connection.policy.turnOff")
    : t("hub.connection.policy.enable");
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
          {t("hub.connection.policy.useExisting")}
        </Button>
      ) : null}
      {error ? (
        <Alert
          variant="error"
          title={t("hub.connection.policy.notChangedTitle")}
          description={error}
        />
      ) : null}
      <View style={styles.actions}>
        <Button variant="outline" disabled={pending} onPress={cancel}>
          {t("hub.connection.common.cancel")}
        </Button>
        <Button variant="default" disabled={pending || !valid} loading={pending} onPress={save}>
          {pending ? t("hub.connection.common.saving") : saveLabel}
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
  const { t } = useTranslation();
  if (required)
    return (
      <Alert
        variant="warning"
        title={t("hub.connection.policy.warnTitle")}
        description={t("hub.connection.policy.warnBody")}
      />
    );
  return (
    <>
      <Text>
        {needsOwner
          ? t("hub.connection.policy.setUpOwner")
          : t("hub.connection.policy.useOwnerExisting")}
      </Text>
      <Text style={styles.hint}>{t("hub.connection.policy.everyoneHint")}</Text>
      {!needsOwner ? (
        <Text style={styles.hint}>{t("hub.connection.policy.ownerExistingHint")}</Text>
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
  const { t } = useTranslation();
  return (
    <>
      <Field label={t("hub.connection.policy.ownerEmail")}>
        <FormTextInput
          initialValue={email}
          onChangeText={setEmail}
          accessibilityLabel={t("hub.connection.policy.ownerEmail")}
          placeholder="you@example.com"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          editable={!pending}
        />
      </Field>
      <Field
        label={t("hub.connection.policy.ownerPassword")}
        hint={t("hub.connection.policy.passwordHint")}
      >
        <FormTextInput
          initialValue={password}
          onChangeText={setPassword}
          accessibilityLabel={t("hub.connection.policy.ownerPassword")}
          placeholder={t("hub.connection.policy.passwordPlaceholder")}
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
  const { t } = useTranslation();
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
            ? t("hub.connection.policy.needsOwner")
            : t("hub.connection.policy.couldNotChange"),
        );
      await complete();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("hub.connection.policy.changeFailed"));
    } finally {
      setPending(false);
    }
  }, [transport, required, prepare, complete, t]);
  return { pending, error, save };
}

async function configureOwnerLogin(
  transport: PairedHubTransport,
  email: string,
  password: string,
  t: TFunction,
) {
  const response = await transport.request("/api/auth/clisbot/device/owner-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok)
    throw new Error(
      response.status === 409
        ? t("hub.connection.policy.ownerConflict")
        : t("hub.connection.policy.ownerSaveFailed"),
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
