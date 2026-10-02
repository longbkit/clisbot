import { useTranslation } from "react-i18next";
import { Linking } from "react-native";
import {
  SettingsAction,
  SettingsCard,
  SettingsSection,
  SettingsSwitch,
} from "@/components/settings";
import { analyticsAvailable } from "./config";
import { productAnalytics, useProductAnalytics } from "./runtime";

function setAnalyticsEnabled(value: boolean) {
  void productAnalytics.setEnabled(value);
}

function openPrivacyPolicy() {
  void Linking.openURL("https://clisbot.com/privacy");
}

function retrySavingConsent() {
  void productAnalytics.retrySavingConsent();
}

export function ProductAnalyticsSettings() {
  const { t } = useTranslation();
  const state = useProductAnalytics();
  const text = (key: string, defaultValue: string) =>
    t(`productAnalytics.${key}`, { defaultValue });
  let hint = text(
    "description",
    "Help improve Clisbot by sharing app opens, screen names, usage duration, version and device/platform details with Google Analytics. Uses a random identifier; never sends prompts, chats, code, paths or project/host names. No advertising IDs or ad personalization. You can turn it off anytime.",
  );
  if (state.pending) hint = text("saving", "Saving…");
  else if (!analyticsAvailable)
    hint = text("unavailable", "Analytics is unavailable in this build.");
  let error: string | undefined;
  if (state.error === "storage")
    error = text(
      "storageError",
      "Collection is paused. Your preference could not be saved; retry before restarting the app.",
    );
  else if (state.error === "unavailable")
    error = text(
      "serviceError",
      "Analytics could not be enabled. Collection remains off; you can retry.",
    );
  return (
    <SettingsSection title={text("title", "Privacy")}>
      <SettingsCard>
        <SettingsSwitch
          testID="product-analytics-consent"
          label={text("label", "Share usage analytics")}
          hint={hint}
          error={error}
          value={state.enabled}
          disabled={!analyticsAvailable || !state.ready || state.pending}
          onValueChange={setAnalyticsEnabled}
        />
        <SettingsAction
          label={text("detailsLabel", "How analytics works")}
          actionLabel={text("privacyPolicy", "Privacy policy")}
          onPress={openPrivacyPolicy}
        />
        {state.error === "storage" ? (
          <SettingsAction
            label={text("retryLabel", "Save your privacy choice")}
            actionLabel={text("retry", "Retry")}
            disabled={state.pending}
            onPress={retrySavingConsent}
          />
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}
