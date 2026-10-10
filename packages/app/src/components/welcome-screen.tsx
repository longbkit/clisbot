import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { ExternalLink, Settings, X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { HostProfile } from "@/types/host-connection";
import { getHostRuntimeStore, isHostRuntimeConnected, useHosts } from "@/runtime/host-runtime";
import { AddHostModal } from "./add-host-modal";
import { AddRemoteSshHostModal } from "./add-remote-ssh-host-modal";
import { PairLinkModal } from "./pair-link-modal";
import { resolveAppVersion } from "@/utils/app-version";
import { formatVersionWithPrefix } from "@/desktop/updates/desktop-updates";
import {
  buildOpenProjectRoute,
  isDeliberateWelcomeVisit,
  WELCOME_STAY_PARAM,
} from "@/utils/host-routes";
import { ClisbotLogo } from "@/components/icons/clisbot-logo";
import { openExternalUrl } from "@/utils/open-external-url";
import { isNative } from "@/constants/platform";
import { WindowChromeSafeArea } from "@/utils/desktop-window";
import { HubWelcomeSignIn, WelcomeOwnComputerLabel } from "@/clisbot/hub/welcome-sign-in";
import { HostConnectionMethods, type HostConnectionMethod } from "./host-connection-methods";
import { ProductAnalyticsWelcomeNotice } from "@/clisbot/analytics/welcome-notice";
import { WelcomeLanguageDropdown, WelcomeLanguageList } from "@/clisbot/language/language-surfaces";

const ACTION_TEST_IDS: Record<HostConnectionMethod, string> = {
  scanQr: "welcome-scan-qr",
  pasteLink: "welcome-paste-pairing-link",
  direct: "welcome-direct-connection",
  remoteSsh: "welcome-remote-ssh",
};

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  scrollView: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    padding: theme.spacing[6],
    paddingBottom: 0,
    alignItems: "center",
  },
  content: {
    width: "100%",
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    textAlign: "center",
  },
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  copyBlock: {
    alignItems: "center",
    gap: theme.spacing[2],
    marginBottom: theme.spacing[12],
  },
  actions: {
    width: "100%",
    maxWidth: 420,
    gap: theme.spacing[3],
  },
  setupLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  setupLinkText: {
    color: theme.colors.accent,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  versionLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
    marginTop: theme.spacing[6],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[1],
  },
  headerButton: {
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
  },
}));

function useAnyHostOnline(serverIds: string[]): string | null {
  const runtime = getHostRuntimeStore();
  return useSyncExternalStore(
    (onStoreChange) => runtime.subscribeAll(onStoreChange),
    () => {
      let firstOnlineServerId: string | null = null;
      let firstOnlineAt: string | null = null;
      for (const serverId of serverIds) {
        const snapshot = runtime.getSnapshot(serverId);
        const lastOnlineAt = snapshot?.lastOnlineAt ?? null;
        if (!isHostRuntimeConnected(snapshot) || !lastOnlineAt) {
          continue;
        }
        if (!firstOnlineAt || lastOnlineAt < firstOnlineAt) {
          firstOnlineAt = lastOnlineAt;
          firstOnlineServerId = serverId;
        }
      }
      return firstOnlineServerId;
    },
    () => {
      let firstOnlineServerId: string | null = null;
      let firstOnlineAt: string | null = null;
      for (const serverId of serverIds) {
        const snapshot = runtime.getSnapshot(serverId);
        const lastOnlineAt = snapshot?.lastOnlineAt ?? null;
        if (!isHostRuntimeConnected(snapshot) || !lastOnlineAt) {
          continue;
        }
        if (!firstOnlineAt || lastOnlineAt < firstOnlineAt) {
          firstOnlineAt = lastOnlineAt;
          firstOnlineServerId = serverId;
        }
      }
      return firstOnlineServerId;
    },
  );
}

export interface WelcomeScreenProps {
  onHostAdded?: (profile: HostProfile) => void;
}

export function WelcomeScreen({ onHostAdded }: WelcomeScreenProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const appVersion = resolveAppVersion();
  const appVersionText = formatVersionWithPrefix(appVersion);
  const [isDirectOpen, setIsDirectOpen] = useState(false);
  const [isRemoteSshOpen, setIsRemoteSshOpen] = useState(false);
  const [isPasteLinkOpen, setIsPasteLinkOpen] = useState(false);
  const hosts = useHosts();
  const anyOnlineServerId = useAnyHostOnline(hosts.map((h) => h.serverId));
  const params = useLocalSearchParams<{ [WELCOME_STAY_PARAM]?: string }>();
  const stayOnWelcome = isDeliberateWelcomeVisit(params);

  // Onboarding ends the moment a Host answers. Someone who opened Welcome to add another Host
  // stays: there is nothing to finish, and leaving would hide the screen they asked for.
  useEffect(() => {
    if (!anyOnlineServerId || stayOnWelcome) return;
    router.replace(buildOpenProjectRoute());
  }, [anyOnlineServerId, router, stayOnWelcome]);

  const finishOnboarding = useCallback(() => {
    router.replace(buildOpenProjectRoute());
  }, [router]);

  const handleOpenClisbotSite = useCallback(() => {
    void openExternalUrl("https://clisbot.com");
  }, []);

  const handleOpenSettings = useCallback(() => {
    router.push("/settings");
  }, [router]);

  // Welcome is reachable again from the home screen, so leaving it is a choice rather than a
  // dead end while no Host is connected yet.
  const handleClose = useCallback(() => {
    router.replace(buildOpenProjectRoute());
  }, [router]);

  const handleOpenDirect = useCallback(() => setIsDirectOpen(true), []);
  const handleCloseDirect = useCallback(() => setIsDirectOpen(false), []);
  const handleOpenRemoteSsh = useCallback(() => setIsRemoteSshOpen(true), []);
  const handleCloseRemoteSsh = useCallback(() => setIsRemoteSshOpen(false), []);
  const [pasteLinkInitialUrl, setPasteLinkInitialUrl] = useState<string>();
  const handleOpenPasteLink = useCallback(() => {
    setPasteLinkInitialUrl(undefined);
    setIsPasteLinkOpen(true);
  }, []);
  const handleClosePasteLink = useCallback(() => setIsPasteLinkOpen(false), []);
  const handleDirectToPasteLink = useCallback((link?: string) => {
    setIsDirectOpen(false);
    setPasteLinkInitialUrl(link);
    setIsPasteLinkOpen(true);
  }, []);
  const handleScanQr = useCallback(() => {
    router.push("/pair-scan?source=onboarding");
  }, [router]);

  const handleHostSaved = useCallback(
    ({ profile }: { profile: HostProfile; serverId: string }) => {
      onHostAdded?.(profile);
      finishOnboarding();
    },
    [onHostAdded, finishOnboarding],
  );

  const scrollContentContainerStyle = useMemo(
    () => [styles.container, { paddingBottom: theme.spacing[6] + insets.bottom }],
    [theme.spacing, insets.bottom],
  );
  const headerStyle = useMemo(
    () => [styles.header, { paddingTop: theme.spacing[2] + insets.top }],
    [theme.spacing, insets.top],
  );

  return (
    <View style={styles.root}>
      <WindowChromeSafeArea
        placement="inline"
        horizontalPadding={theme.spacing[2]}
        style={headerStyle}
      >
        {/* Clisbot: the language is the first thing someone may need to change. */}
        <WelcomeLanguageDropdown />
        <Pressable
          onPress={handleOpenSettings}
          style={styles.headerButton}
          accessibilityRole="button"
          accessibilityLabel={t("onboarding.actions.settings")}
          testID="welcome-open-settings"
        >
          <Settings size={20} color={theme.colors.foregroundMuted} />
        </Pressable>
        <Pressable
          onPress={handleClose}
          style={styles.headerButton}
          accessibilityRole="button"
          accessibilityLabel={t("onboarding.actions.close")}
          testID="welcome-close"
        >
          <X size={20} color={theme.colors.foregroundMuted} />
        </Pressable>
      </WindowChromeSafeArea>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={scrollContentContainerStyle}
        showsVerticalScrollIndicator={false}
        testID="welcome-screen"
      >
        <View style={styles.content}>
          <ClisbotLogo size={96} />
          <View style={styles.copyBlock}>
            <Text style={styles.title}>{t("onboarding.title")}</Text>
            <Text style={styles.subtitle}>{t("onboarding.subtitle")}</Text>
            {isNative ? (
              <Pressable style={styles.setupLink} onPress={handleOpenClisbotSite}>
                <Text style={styles.setupLinkText}>clisbot.com</Text>
                <ExternalLink size={14} color={theme.colors.accent} />
              </Pressable>
            ) : null}
          </View>

          {/* Your own computer leads: pairing it is the way most people start. */}
          <View style={styles.actions}>
            <WelcomeOwnComputerLabel />
            <HostConnectionMethods
              onScanQr={handleScanQr}
              onPasteLink={handleOpenPasteLink}
              onDirectConnection={handleOpenDirect}
              onRemoteSsh={handleOpenRemoteSsh}
              testIDs={ACTION_TEST_IDS}
            />
          </View>

          {/* COMPAT(clisbot-welcome-hub-sign-in): managed Hosts beside adding a Host directly. */}
          <HubWelcomeSignIn />
          <WelcomeLanguageList />
        </View>
        <ProductAnalyticsWelcomeNotice />
        <Text style={styles.versionLabel}>{appVersionText}</Text>

        <AddHostModal
          visible={isDirectOpen}
          onClose={handleCloseDirect}
          onSaved={handleHostSaved}
          onPasteLink={handleDirectToPasteLink}
        />

        <AddRemoteSshHostModal
          visible={isRemoteSshOpen}
          onClose={handleCloseRemoteSsh}
          onSaved={handleHostSaved}
        />

        <PairLinkModal
          visible={isPasteLinkOpen}
          initialUrl={pasteLinkInitialUrl}
          onClose={handleClosePasteLink}
          onSaved={handleHostSaved}
        />
      </ScrollView>
    </View>
  );
}
