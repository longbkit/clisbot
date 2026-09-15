import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import { settingsStyles } from "@/styles/settings";
import { useHubAccount, type HubRegistrationStart } from "../account-provider";
import type { HubRegistrationLink } from "../contracts";

type HubAccount = ReturnType<typeof useHubAccount>;

const PASSWORD_MIN_LENGTH = 12;

const REGISTRATION_START_NOTICES: Record<
  HubRegistrationStart,
  { variant: "info" | "warning"; title: string }
> = {
  sent: {
    variant: "info",
    title: "If this address can register, a sign-up link is on its way. It expires in 30 minutes.",
  },
  domainNotAllowed: {
    variant: "warning",
    title: "This email's domain can't register here. Ask an organization owner to invite you.",
  },
  rateLimited: {
    variant: "warning",
    title: "A link was sent recently. Check your inbox, or try again in a minute.",
  },
  unavailable: {
    variant: "warning",
    title: "Hub couldn't send a sign-up link. Try again, or ask the Hub operator.",
  },
};

/** Email-first self-registration: the Hub mails a link, and the password is chosen on the page
 * that link opens, so this form only needs the address. */
export function EmailRegistrationButton({
  visible,
  email,
  hub,
  pending,
}: {
  visible: boolean;
  email: string;
  hub: HubAccount;
  pending: boolean;
}) {
  const [result, setResult] = useState<HubRegistrationStart | null>(null);
  const [sending, setSending] = useState(false);
  const request = useCallback(() => {
    setSending(true);
    void hub
      .startRegistration(email.trim().toLowerCase())
      .catch((): HubRegistrationStart => "unavailable")
      .then(setResult)
      .finally(() => setSending(false));
  }, [email, hub]);
  if (!visible) return null;
  const notice = result === null ? null : REGISTRATION_START_NOTICES[result];
  return (
    <>
      {notice === null ? null : <Alert variant={notice.variant} title={notice.title} />}
      <Button
        variant="ghost"
        disabled={pending || sending || email.trim().length === 0}
        onPress={request}
      >
        Email me a sign-up link
      </Button>
    </>
  );
}

type LinkView =
  | { status: "loading" }
  | { status: "valid"; email: string }
  | { status: Exclude<HubRegistrationLink["status"], "valid"> | "failed" };

type FinishedStatus = Exclude<LinkView["status"], "loading" | "valid">;

const LINK_MESSAGES: Record<FinishedStatus, string> = {
  registered: "Your account is ready.",
  invalid: "This sign-up link isn't valid.",
  expired: "This sign-up link has expired. Request a new one from the sign-in form.",
  used: "This sign-up link was already used. Sign in, or request a new link.",
  already_registered: "An account already uses this email. Sign in instead.",
  registration_closed:
    "This Hub no longer admits this email. Ask an organization owner to invite you.",
  failed: "Hub couldn't finish creating your account. Try the link again.",
};

/**
 * The screen a Hub registration link opens: choose a name and password, then Hub creates, admits,
 * and signs in the account. Opening the link only inspects it; the account exists after submit.
 */
export function EmailRegistrationCompletion({ hub }: { hub: HubAccount }) {
  const token = hub.registrationToken;
  const inspect = hub.inspectRegistration;
  const [view, setView] = useState<LinkView>({ status: "loading" });
  useEffect(() => {
    if (token === null) return;
    void inspect(token)
      .then(linkView)
      .catch((): LinkView => ({ status: "failed" }))
      .then(setView);
  }, [inspect, token]);
  if (token === null) return null;
  if (view.status === "loading") {
    return <SettingsSection title="Create your Hub account">{null}</SettingsSection>;
  }
  if (view.status === "valid") {
    return <ChoosePassword hub={hub} token={token} email={view.email} onFinished={setView} />;
  }
  return (
    <SettingsSection title="Create your Hub account">
      <Alert
        variant={view.status === "registered" ? "info" : "error"}
        title={LINK_MESSAGES[view.status]}
      />
      <Button variant="outline" onPress={hub.dismissRegistration}>
        Continue to sign in
      </Button>
    </SettingsSection>
  );
}

function ChoosePassword({
  hub,
  token,
  email,
  onFinished,
}: {
  hub: HubAccount;
  token: string;
  email: string;
  onFinished: (view: LinkView) => void;
}) {
  const compact = useIsCompactFormFactor();
  const fieldSize = compact ? "md" : "sm";
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = useCallback(async () => {
    setSubmitting(true);
    const next = await hub
      .completeRegistration({ token, name: name.trim(), password })
      .then(linkView)
      .catch((): LinkView => ({ status: "failed" }));
    setSubmitting(false);
    // A registered account is signed in; the account state refresh replaces this screen.
    if (next.status !== "registered") onFinished(next);
  }, [hub, name, onFinished, password, token]);
  const canSubmit = name.trim().length > 0 && password.length >= PASSWORD_MIN_LENGTH;
  return (
    <SettingsSection title="Create your Hub account">
      <View style={[settingsStyles.card, styles.form]}>
        <Field label="Email">
          <FormTextInput size={fieldSize} initialValue={email} editable={false} />
        </Field>
        <Field label="Name">
          <FormTextInput
            size={fieldSize}
            initialValue={name}
            onChangeText={setName}
            placeholder="Your name"
            editable={!submitting}
          />
        </Field>
        <Field label="Password" hint="Use at least 12 characters.">
          <FormTextInput
            size={fieldSize}
            initialValue={password}
            onChangeText={setPassword}
            secureTextEntry
            editable={!submitting}
          />
        </Field>
        <Button disabled={submitting || !canSubmit} loading={submitting} onPress={submit}>
          Create account
        </Button>
      </View>
    </SettingsSection>
  );
}

function linkView(link: HubRegistrationLink): LinkView {
  if (link.status === "valid") {
    return link.email === undefined ? { status: "failed" } : { status: "valid", email: link.email };
  }
  return { status: link.status };
}

const styles = StyleSheet.create((theme) => ({
  form: {
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
}));
