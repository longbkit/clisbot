import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useResumeHostReturnTo, withHostReturnTo } from "@/navigation/host-return-to";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import {
  QrCode,
  Link2,
  ClipboardPaste,
  ExternalLink,
  Settings,
  Terminal,
  X,
} from "lucide-react-native";
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
import { PaseoLogo } from "@/components/icons/paseo-logo";
import { openExternalUrl } from "@/utils/open-external-url";
import { isFdroidBuild } from "@/constants/build-profile";
import { isWeb, isNative } from "@/constants/platform";
import { isElectronRuntime } from "@/desktop/host";
import { HubWelcomeSignIn, WelcomeOwnComputerLabel } from "@/clisbot/hub/welcome-sign-in";

interface WelcomeAction {
  key: "scan-qr" | "direct-connection" | "remote-ssh" | "paste-pairing-link";
  label: string;
  testID: string;
  icon: typeof QrCode;
  onPress: () => void;
}

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
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[4],
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  actionButtonPrimary: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  actionText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  actionTextPrimary: {
    color: theme.colors.accentForeground,
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
    paddingHorizontal: theme.spacing[2],
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

  // Someone sent here because their Host briefly left the registry goes straight back to it.
  const returnTo = useResumeHostReturnTo({ enabled: !stayOnWelcome });
  const returnToPath = returnTo?.path ?? null;

  // Onboarding ends the moment a Host answers. Someone who opened Welcome to add another Host
  // stays: there is nothing to finish, and leaving would hide the screen they asked for.
  useEffect(() => {
    if (!anyOnlineServerId || stayOnWelcome || returnTo?.available) return;
    router.replace(withHostReturnTo(buildOpenProjectRoute(), returnToPath) as never);
  }, [anyOnlineServerId, returnTo?.available, returnToPath, router, stayOnWelcome]);

  const finishOnboarding = useCallback(() => {
    router.replace(buildOpenProjectRoute());
  }, [router]);

  const handleOpenPaseoSite = useCallback(() => {
    void openExternalUrl("https://paseo.sh");
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
  const handleOpenPasteLink = useCallback(() => setIsPasteLinkOpen(true), []);
  const handleClosePasteLink = useCallback(() => setIsPasteLinkOpen(false), []);
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

  // One order on every platform, pairing methods first: scanning a QR code and pasting the link it
  // encodes are the same connection, so they stay adjacent. Platforms drop the rows they lack
  // instead of reordering the rest, and the first row that survives is the recommended one.
  const actions: WelcomeAction[] = [
    ...(isWeb || isFdroidBuild
      ? []
      : [
          {
            key: "scan-qr" as const,
            label: t("pairing.connectionMethods.scanQr.title"),
            testID: "welcome-scan-qr",
            icon: QrCode,
            onPress: handleScanQr,
          },
        ]),
    {
      key: "paste-pairing-link",
      label: t("pairing.connectionMethods.pasteLink.title"),
      testID: "welcome-paste-pairing-link",
      icon: ClipboardPaste,
      onPress: handleOpenPasteLink,
    },
    {
      key: "direct-connection",
      label: t("pairing.connectionMethods.direct.title"),
      testID: "welcome-direct-connection",
      icon: Link2,
      onPress: handleOpenDirect,
    },
    ...(isElectronRuntime()
      ? [
          {
            key: "remote-ssh" as const,
            label: t("pairing.connectionMethods.remoteSsh.title"),
            testID: "welcome-remote-ssh",
            icon: Terminal,
            onPress: handleOpenRemoteSsh,
          },
        ]
      : []),
  ];
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
      <View style={headerStyle}>
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
      </View>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={scrollContentContainerStyle}
        showsVerticalScrollIndicator={false}
        testID="welcome-screen"
      >
        <View style={styles.content}>
          <PaseoLogo size={96} />
          <View style={styles.copyBlock}>
            <Text style={styles.title}>{t("onboarding.title")}</Text>
            <Text style={styles.subtitle}>{t("onboarding.subtitle")}</Text>
            {isNative ? (
              <Pressable style={styles.setupLink} onPress={handleOpenPaseoSite}>
                <Text style={styles.setupLinkText}>paseo.sh</Text>
                <ExternalLink size={14} color={theme.colors.accent} />
              </Pressable>
            ) : null}
          </View>

          {/* COMPAT(clisbot-welcome-hub-sign-in): managed Hosts beside adding a Host directly. */}
          <HubWelcomeSignIn />

          <View style={styles.actions}>
            <WelcomeOwnComputerLabel />
            {actions.map((action, index) => (
              <WelcomeActionButton key={action.key} action={action} primary={index === 0} />
            ))}
          </View>
        </View>
        <Text style={styles.versionLabel}>{appVersionText}</Text>

        <AddHostModal
          visible={isDirectOpen}
          onClose={handleCloseDirect}
          onSaved={handleHostSaved}
        />

        <AddRemoteSshHostModal
          visible={isRemoteSshOpen}
          onClose={handleCloseRemoteSsh}
          onSaved={handleHostSaved}
        />

        <PairLinkModal
          visible={isPasteLinkOpen}
          onClose={handleClosePasteLink}
          onSaved={handleHostSaved}
        />
      </ScrollView>
    </View>
  );
}

interface WelcomeActionButtonProps {
  action: WelcomeAction;
  /** The recommended way to connect on this platform: the first row that the platform keeps. */
  primary: boolean;
}

function WelcomeActionButton({ action, primary }: WelcomeActionButtonProps) {
  const { theme } = useUnistyles();
  const Icon = action.icon;
  const buttonStyle = useMemo(
    () => [styles.actionButton, primary ? styles.actionButtonPrimary : null],
    [primary],
  );
  const textStyle = useMemo(
    () => [styles.actionText, primary ? styles.actionTextPrimary : null],
    [primary],
  );
  return (
    <Pressable style={buttonStyle} onPress={action.onPress} testID={action.testID}>
      <Icon size={18} color={primary ? theme.colors.accentForeground : theme.colors.foreground} />
      <Text style={textStyle}>{action.label}</Text>
    </Pressable>
  );
}
