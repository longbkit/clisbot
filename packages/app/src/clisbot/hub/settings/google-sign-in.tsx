import { useCallback, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useHubAccount } from "../account-provider";

type HubAccount = ReturnType<typeof useHubAccount>;
type HubRun = (operation: () => Promise<void>) => Promise<void>;

/** Google sign-in for a client served from the Hub origin. System-browser clients reach the same
 * button on the sign-in page they open. */
export function GoogleSignInButton({
  visible,
  hub,
  pending,
  run,
  claimInstance = false,
  primary = false,
}: {
  visible: boolean;
  hub: HubAccount;
  pending: boolean;
  run: HubRun;
  /** First-run setup: the Google account claims the pristine Hub as its first operator. */
  claimInstance?: boolean;
  /** The recommended way in, styled as the main action. */
  primary?: boolean;
}) {
  const { t } = useTranslation();
  const start = hub.signInWithGoogle;
  const continueWithGoogle = useCallback(() => {
    if (start !== undefined) void run(() => start({ claimInstance }));
  }, [claimInstance, run, start]);
  if (!visible || start === undefined) return null;
  return (
    <Button
      variant={primary ? "default" : "outline"}
      disabled={pending}
      onPress={continueWithGoogle}
    >
      {hub.googleSignInLabel ?? t("hub.settings.googleSignIn.continueWithGoogle")}
    </Button>
  );
}

/**
 * First-run setup leads with Google when the Hub has it configured: Google has verified the
 * address, so the first operator is not a self-declared email. The password form (`children`)
 * stays one step away.
 */
export function GoogleFirstInstanceSetup({
  googleSignIn,
  hub,
  pending,
  run,
  children,
}: {
  googleSignIn: boolean;
  hub: HubAccount;
  pending: boolean;
  run: HubRun;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [passwordChosen, setPasswordChosen] = useState(false);
  const choosePassword = useCallback(() => setPasswordChosen(true), []);
  if (!googleSignIn || hub.signInWithGoogle === undefined || passwordChosen) return children;
  return (
    <SettingsSection title={t("hub.settings.googleSignIn.setupTitle")}>
      <Alert
        variant="info"
        title={t("hub.settings.googleSignIn.setupAlertTitle")}
        description={t("hub.settings.googleSignIn.setupAlertDescription")}
      />
      <GoogleSignInButton visible hub={hub} pending={pending} run={run} claimInstance primary />
      <Button variant="ghost" disabled={pending} onPress={choosePassword}>
        {t("hub.settings.googleSignIn.usePasswordForSetup")}
      </Button>
      {hub.error ? <Alert variant="error" title={hub.error} /> : null}
    </SettingsSection>
  );
}

/**
 * Sign-in and sign-up lead with Google when the Hub has it configured, matching first-run setup:
 * Google has verified the address and the account needs no password. The email form (`children`)
 * stays one step away and keeps Google as a secondary action.
 */
export function GoogleFirstSignIn({
  googleSignIn,
  hub,
  pending,
  run,
  children,
}: {
  googleSignIn: boolean;
  hub: HubAccount;
  pending: boolean;
  run: HubRun;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [emailChosen, setEmailChosen] = useState(false);
  const chooseEmail = useCallback(() => setEmailChosen(true), []);
  if (!googleSignIn || hub.signInWithGoogle === undefined) return children;
  if (emailChosen) {
    return (
      <>
        {children}
        <GoogleSignInButton visible hub={hub} pending={pending} run={run} />
      </>
    );
  }
  return (
    <>
      <GoogleSignInButton visible hub={hub} pending={pending} run={run} primary />
      <Button variant="ghost" disabled={pending} onPress={chooseEmail}>
        {t("hub.settings.googleSignIn.useEmailAndPassword")}
      </Button>
    </>
  );
}
