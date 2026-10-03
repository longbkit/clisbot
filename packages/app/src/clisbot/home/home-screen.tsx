import { useCallback, useEffect } from "react";
import { ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { useHosts } from "@/runtime/host-runtime";
import { ClisbotLogo } from "@/components/icons/clisbot-logo";
import { CommunityLinks } from "@/components/community-links";
import { MenuHeader } from "@/components/headers/menu-header";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { Button } from "@/components/ui/button";
import { useIsCompactFormFactor } from "@/constants/layout";
import { usePanelStore } from "@/stores/panel-store";
import { buildWelcomeRoute } from "@/utils/host-routes";
import { homeCopy } from "./copy";
import { HostReadinessCard } from "./host-readiness";
import { HomeActions } from "./home-actions";
import { MoreActions } from "./more-actions";

/**
 * The home screen (`/open-project`): which Hosts are connected and which providers are ready on
 * them, then the two ways to start — a bot or a project. Everything else is a quiet link.
 */
export function ClisbotHomeScreen() {
  const hosts = useHosts();
  const isCompact = useIsCompactFormFactor();
  const openDesktopAgentList = usePanelStore((s) => s.openDesktopAgentList);
  useEffect(() => {
    if (!isCompact) openDesktopAgentList();
  }, [isCompact, openDesktopAgentList]);
  return (
    <View style={styles.container}>
      <MenuHeader borderless />
      <ScrollView contentContainerStyle={styles.content}>
        <TitlebarDragRegion />
        <ClisbotLogo size={44} />
        {hosts.length ? <ReadyHome hosts={hosts} /> : <NoHost />}
      </ScrollView>
      <View style={styles.community}>
        <CommunityLinks />
      </View>
    </View>
  );
}

function ReadyHome({ hosts }: { hosts: { serverId: string; label: string }[] }) {
  return (
    <View style={styles.column}>
      <View style={styles.heading}>
        <Text style={styles.title}>{homeCopy.title}</Text>
        <Text style={styles.subtitle}>{homeCopy.subtitle}</Text>
      </View>
      <HomeActions />
      {hosts.map((host) => (
        <HostReadinessCard key={host.serverId} serverId={host.serverId} label={host.label} />
      ))}
      <MoreActions />
    </View>
  );
}

function NoHost() {
  const router = useRouter();
  const connect = useCallback(() => router.push(buildWelcomeRoute({ stay: true })), [router]);
  return (
    <View style={[styles.column, styles.center]}>
      <Text style={styles.title}>{homeCopy.noHost.title}</Text>
      <Text style={styles.subtitle}>{homeCopy.noHost.description}</Text>
      <Button variant="default" onPress={connect} testID="home-connect-host">
        {homeCopy.noHost.action}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, backgroundColor: theme.colors.surface0 },
  content: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: { xs: "flex-start", md: "center" },
    gap: theme.spacing[6],
    padding: theme.spacing[6],
    paddingBottom: theme.spacing[16],
  },
  column: { width: "100%", maxWidth: 520, gap: theme.spacing[4] },
  center: { alignItems: "center" },
  heading: { alignItems: "center", gap: theme.spacing[1] },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.semibold,
    textAlign: "center",
  },
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  community: { alignItems: "center", paddingBottom: theme.spacing[4] },
}));
