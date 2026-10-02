import { Pressable, Text } from "react-native";
import { useCallback } from "react";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { useProductAnalytics } from "./runtime";

const styles = StyleSheet.create((theme) => ({
  notice: { maxWidth: 420, paddingTop: theme.spacing[6], paddingHorizontal: theme.spacing[2] },
  text: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, textAlign: "center" },
  link: { color: theme.colors.accent },
}));

export function ProductAnalyticsWelcomeNotice() {
  const { enabled } = useProductAnalytics();
  const router = useRouter();
  const { t } = useTranslation();
  const openPrivacySettings = useCallback(() => router.push("/settings/general"), [router]);
  if (!enabled) return null;
  return (
    <Pressable
      style={styles.notice}
      accessibilityRole="button"
      accessibilityLabel={t("productAnalytics.welcomeLink", {
        defaultValue: "Usage analytics and privacy settings",
      })}
      onPress={openPrivacySettings}
    >
      <Text style={styles.text}>
        {t("productAnalytics.welcomeDescription", {
          defaultValue:
            "Google Analytics measures app opens, screen visits and usage time to help improve Clisbot. Your code and chats stay private. ",
        })}
        <Text style={styles.link}>
          {t("productAnalytics.welcomeAction", { defaultValue: "Turn off in Privacy settings." })}
        </Text>
      </Text>
    </Pressable>
  );
}
