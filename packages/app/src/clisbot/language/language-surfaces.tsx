import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useAppSettings } from "@/hooks/use-settings";
import type { AppLanguage } from "@/i18n/locales";
import { settingsStyles } from "@/styles/settings";
import { LanguageDropdown, LanguageQuickList, type LanguagePickerProps } from "./language-picker";

/** Settings → General: the usual label/control row, then every language on a band below it. */
export function LanguageSettingsCard({ language, onChange }: LanguagePickerProps) {
  const { t } = useTranslation();
  // On a phone the title and the dropdown share a narrow row. The band below already marks the
  // language in use and the menu still offers "System - …", so the dropdown names only the language.
  const compact = useIsCompactFormFactor();
  return (
    <View style={settingsStyles.card} testID="language-settings-card">
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("settings.general.language.label")}</Text>
          <Text style={settingsStyles.rowHint}>{t("settings.general.language.description")}</Text>
        </View>
        <View style={styles.control}>
          <LanguageDropdown language={language} onChange={onChange} nameOnly={compact} />
        </View>
      </View>
      <View style={[settingsStyles.rowBorder, styles.band]}>
        <LanguageQuickList language={language} onChange={onChange} />
      </View>
    </View>
  );
}

/** Welcome reads and writes the same saved setting as Settings → General. */
function useAppLanguage(): LanguagePickerProps {
  const { settings, updateSettings } = useAppSettings();
  const onChange = useCallback(
    (language: AppLanguage) => {
      void updateSettings({ language });
    },
    [updateSettings],
  );
  return { language: settings.language, onChange };
}

/** Top of Welcome, beside Settings: visible on open, before anything is read. */
export function WelcomeLanguageDropdown() {
  const picker = useAppLanguage();
  return <LanguageDropdown {...picker} />;
}

/** Foot of Welcome: every language named in itself. */
export function WelcomeLanguageList() {
  const picker = useAppLanguage();
  return (
    <View style={styles.welcomeList}>
      <LanguageQuickList {...picker} centered />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // The title takes the rest of the row, so the dropdown needs a cap to leave the title room.
  control: {
    flexShrink: 1,
    maxWidth: "60%",
  },
  band: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  welcomeList: {
    width: "100%",
    maxWidth: 680,
    marginTop: theme.spacing[8],
  },
}));
