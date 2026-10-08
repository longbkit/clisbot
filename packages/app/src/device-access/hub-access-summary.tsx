import { useCallback } from "react";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { SettingsCard, SettingsSection } from "@/components/settings";
import { SettingsLinkRow } from "@/clisbot/hub/settings/settings-link-row";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { HubDeviceCapabilities } from "./hub-capabilities";
import type { HubProfile } from "./hub-profiles";

export function HubReadyNotice({
  capabilities,
  started,
}: {
  capabilities: HubDeviceCapabilities;
  started: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const openChannels = useCallback(() => router.push("/settings/hub/channels"), [router]);
  const signIn = useCallback(() => router.push("/settings/hub/account"), [router]);
  if (!started) return null;
  const needsSignIn =
    capabilities.loginRequired && capabilities.accountAuthentication !== "signedIn";
  return (
    <Alert
      variant="success"
      title={t("hub.connection.summary.startedTitle")}
      description={
        needsSignIn
          ? t("hub.connection.summary.signInToContinue")
          : t("hub.connection.summary.ready")
      }
    >
      {needsSignIn ? (
        <Button variant="outline" size="sm" onPress={signIn}>
          {t("hub.connection.common.signInToHub")}
        </Button>
      ) : null}
      {!needsSignIn && capabilities.canManageDevices ? (
        <Button variant="outline" size="sm" onPress={openChannels}>
          {t("hub.connection.summary.setUpChannel")}
        </Button>
      ) : null}
    </Alert>
  );
}

export function HubOverviewSummary({
  profile,
  capabilities,
  openDevices,
  reviewConnection,
  signIn,
  openPolicy,
}: {
  profile: HubProfile;
  capabilities: HubDeviceCapabilities;
  openDevices(): void;
  reviewConnection(): void;
  signIn(): void;
  openPolicy(): void;
}) {
  const { t } = useTranslation();
  const needsSignIn =
    capabilities.loginRequired && capabilities.accountAuthentication !== "signedIn";
  return (
    <SettingsSection title={t("hub.connection.summary.settingsTitle")}>
      <SettingsCard>
        <SettingsLinkRow
          label={t("hub.connection.summary.connection")}
          hint={connectionRoutes(profile, t("hub.connection.common.encryptedRelay"))}
          value={
            needsSignIn
              ? t("hub.connection.summary.signInRequired")
              : t("hub.connection.status.connected")
          }
          tone={needsSignIn ? "warning" : "success"}
          onPress={reviewConnection}
        />
        <HubAccountSignInRow capabilities={capabilities} signIn={signIn} openPolicy={openPolicy} />
        {capabilities.canManageDevices ? (
          <SettingsLinkRow label={t("hub.connection.devices.title")} onPress={openDevices} />
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}

/** Every route this device can use, so a loopback address does not read as the only one. */
function connectionRoutes(profile: HubProfile, relayLabel: string): string {
  return [profile.origin, profile.relay ? relayLabel : null].filter(Boolean).join(" · ");
}

export function HubAccountSignInSummary({
  capabilities,
  signIn,
  openPolicy,
}: {
  capabilities: HubDeviceCapabilities;
  signIn(): void;
  openPolicy(): void;
}) {
  const { t } = useTranslation();
  return (
    <SettingsSection title={t("hub.connection.summary.signInSection")}>
      <SettingsCard>
        <HubAccountSignInRow capabilities={capabilities} signIn={signIn} openPolicy={openPolicy} />
      </SettingsCard>
    </SettingsSection>
  );
}

function HubAccountSignInRow({
  capabilities,
  signIn,
  openPolicy,
}: {
  capabilities: HubDeviceCapabilities;
  signIn(): void;
  openPolicy(): void;
}) {
  const { t } = useTranslation();
  const needsSignIn =
    capabilities.loginRequired && capabilities.accountAuthentication !== "signedIn";
  if (needsSignIn)
    return (
      <SettingsLinkRow
        label={t("hub.connection.common.accountSignIn")}
        hint={t("hub.connection.summary.signInToUse")}
        value={t("hub.connection.summary.notSignedIn")}
        tone="warning"
        onPress={signIn}
      />
    );
  return (
    <SettingsLinkRow
      label={t("hub.connection.common.accountSignIn")}
      hint={
        capabilities.loginRequired
          ? t("hub.connection.summary.rolesDetermine")
          : t("hub.connection.summary.viaPairing")
      }
      value={
        capabilities.loginRequired
          ? t("hub.connection.common.required")
          : t("hub.connection.common.notRequired")
      }
      onPress={capabilities.canConfigureLogin ? openPolicy : undefined}
    />
  );
}
