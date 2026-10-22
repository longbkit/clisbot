import { useCallback } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { PageLayout } from "@/components/page-layout";
import { Button } from "@/components/ui/button";

export default function NotFoundScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const goHome = useCallback(() => router.replace("/open-project"), [router]);
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else goHome();
  }, [router, goHome]);
  return (
    <PageLayout title={t("notFound.title")} onBack={goBack} testID="not-found-screen">
      <View style={styles.content}>
        <Text style={styles.body}>{t("notFound.body")}</Text>
        <Button onPress={goHome}>{t("notFound.home")}</Button>
      </View>
    </PageLayout>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { gap: theme.spacing[4], alignItems: "flex-start" },
  body: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base },
}));
