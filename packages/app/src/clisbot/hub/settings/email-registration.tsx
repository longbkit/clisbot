import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { i18n } from "@/i18n/i18next";

type HubAccount = ReturnType<typeof useHubAccount>;

const PASSWORD_MIN_LENGTH = 12;

function registrationStartNotice(result: HubRegistrationStart): {
  variant: "info" | "warning";
  title: string;
} {
  switch (result) {
    case "sent":
      return { variant: "info", title: i18n.t("hub.settings.emailRegistration.notices.sent") };
    case "domainNotAllowed":
      return {
        variant: "warning",
        title: i18n.t("hub.settings.emailRegistration.notices.domainNotAllowed"),
      };
    case "rateLimited":
      return {
        variant: "warning",
        title: i18n.t("hub.settings.emailRegistration.notices.rateLimited"),
      };
    case "unavailable":
      return {
        variant: "warning",
        title: i18n.t("hub.settings.emailRegistration.notices.unavailable"),
      };
  }
}

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
  const { t } = useTranslation();
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
  const notice = result === null ? null : registrationStartNotice(result);
  return (
    <>
      {notice === null ? null : <Alert variant={notice.variant} title={notice.title} />}
      <Button
        variant="ghost"
        disabled={pending || sending || email.trim().length === 0}
        onPress={request}
      >
        {t("hub.settings.emailRegistration.emailMeLink")}
      </Button>
    </>
  );
}

type LinkView =
  | { status: "loading" }
  | { status: "valid"; email: string }
  | { status: Exclude<HubRegistrationLink["status"], "valid"> | "failed" };

type FinishedStatus = Exclude<LinkView["status"], "loading" | "valid">;

function linkMessage(status: FinishedStatus): string {
  switch (status) {
    case "registered":
      return i18n.t("hub.settings.emailRegistration.linkMessages.registered");
    case "invalid":
      return i18n.t("hub.settings.emailRegistration.linkMessages.invalid");
    case "expired":
      return i18n.t("hub.settings.emailRegistration.linkMessages.expired");
    case "used":
      return i18n.t("hub.settings.emailRegistration.linkMessages.used");
    case "already_registered":
      return i18n.t("hub.settings.emailRegistration.linkMessages.alreadyRegistered");
    case "registration_closed":
      return i18n.t("hub.settings.emailRegistration.linkMessages.registrationClosed");
    case "failed":
      return i18n.t("hub.settings.emailRegistration.linkMessages.failed");
  }
}

/**
 * The screen a Hub registration link opens: choose a name and password, then Hub creates, admits,
 * and signs in the account. Opening the link only inspects it; the account exists after submit.
 */
export function EmailRegistrationCompletion({ hub }: { hub: HubAccount }) {
  const { t } = useTranslation();
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
    return (
      <SettingsSection title={t("hub.settings.emailRegistration.title")}>{null}</SettingsSection>
    );
  }
  if (view.status === "valid") {
    return <ChoosePassword hub={hub} token={token} email={view.email} onFinished={setView} />;
  }
  return (
    <SettingsSection title={t("hub.settings.emailRegistration.title")}>
      <Alert
        variant={view.status === "registered" ? "info" : "error"}
        title={linkMessage(view.status)}
      />
      <Button variant="outline" onPress={hub.dismissRegistration}>
        {t("hub.settings.emailRegistration.continueToSignIn")}
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
  const { t } = useTranslation();
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
    <SettingsSection title={t("hub.settings.emailRegistration.title")}>
      <View style={[settingsStyles.card, styles.form]}>
        <Field label={t("hub.settings.emailRegistration.email")}>
          <FormTextInput size={fieldSize} initialValue={email} editable={false} />
        </Field>
        <Field label={t("hub.settings.emailRegistration.name")}>
          <FormTextInput
            size={fieldSize}
            initialValue={name}
            onChangeText={setName}
            placeholder={t("hub.settings.emailRegistration.namePlaceholder")}
            editable={!submitting}
          />
        </Field>
        <Field
          label={t("hub.settings.emailRegistration.password")}
          hint={t("hub.settings.emailRegistration.passwordHint")}
        >
          <FormTextInput
            size={fieldSize}
            initialValue={password}
            onChangeText={setPassword}
            secureTextEntry
            editable={!submitting}
          />
        </Field>
        <Button disabled={submitting || !canSubmit} loading={submitting} onPress={submit}>
          {t("hub.settings.emailRegistration.createAccount")}
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
