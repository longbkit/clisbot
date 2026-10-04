import { useCallback } from "react";
import { useRouter } from "expo-router";
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
  const router = useRouter();
  const openChannels = useCallback(() => router.push("/settings/hub/channels"), [router]);
  const signIn = useCallback(() => router.push("/settings/hub/account"), [router]);
  if (!started) return null;
  const needsSignIn =
    capabilities.loginRequired && capabilities.accountAuthentication !== "signedIn";
  return (
    <Alert
      variant="success"
      title="Hub started successfully"
      description={
        needsSignIn
          ? "Sign in to this Hub to continue."
          : "This device is connected and ready to use."
      }
    >
      {needsSignIn ? (
        <Button variant="outline" size="sm" onPress={signIn}>
          Sign in to this Hub
        </Button>
      ) : null}
      {!needsSignIn && capabilities.canManageDevices ? (
        <Button variant="outline" size="sm" onPress={openChannels}>
          Set up a channel
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
  const needsSignIn =
    capabilities.loginRequired && capabilities.accountAuthentication !== "signedIn";
  return (
    <SettingsSection title="Hub settings">
      <SettingsCard>
        <SettingsLinkRow
          label="Connection"
          hint={profile.origin ?? "Encrypted relay"}
          value={needsSignIn ? "Sign-in required" : "Connected"}
          tone={needsSignIn ? "warning" : "success"}
          onPress={reviewConnection}
        />
        <HubAccountSignInRow capabilities={capabilities} signIn={signIn} openPolicy={openPolicy} />
        {capabilities.canManageDevices ? (
          <SettingsLinkRow label="Paired devices" onPress={openDevices} />
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
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
  return (
    <SettingsSection title="Sign-in">
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
  const needsSignIn =
    capabilities.loginRequired && capabilities.accountAuthentication !== "signedIn";
  if (needsSignIn)
    return (
      <SettingsLinkRow
        label="Account sign-in"
        hint="Sign in to use this Hub"
        value="Not signed in"
        tone="warning"
        onPress={signIn}
      />
    );
  return (
    <SettingsLinkRow
      label="Account sign-in"
      hint={
        capabilities.loginRequired
          ? "Account roles determine access"
          : "Access through device pairing"
      }
      value={capabilities.loginRequired ? "Required" : "Not required"}
      onPress={capabilities.canConfigureLogin ? openPolicy : undefined}
    />
  );
}
