import { HOME_V2_ENABLED } from "./feature";
import { NewWorkspaceScreen } from "@/screens/new-workspace-screen";
import { useAvailableHosts } from "@/clisbot/hub/host-inventory";
import { useCallback } from "react";
import { ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { ClisbotLogo } from "@/components/icons/clisbot-logo";
import { CommunityLinks } from "@/components/community-links";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { buildWelcomeRoute } from "@/utils/host-routes";
import { homeCopy } from "./copy";
import { HostReadinessCard } from "./host-readiness";
import { HomeActions } from "./home-actions";
import { MoreActions } from "./more-actions";
import { useOpenSidebarOnHome } from "./open-sidebar-on-home";

/**
 * The home screen (`/open-project`): which Hosts are connected and which providers are ready on
 * them, then the two ways to start — a bot or a project. Everything else is a quiet link.
 */
export function ClisbotHomeScreen() {
  const hosts = useAvailableHosts();
  useOpenSidebarOnHome(hosts);
  if (HOME_V2_ENABLED && hosts.length) return <NewWorkspaceScreen serverId="" home />;
  return (
    <View style={styles.container}>
      {/* The header is the window's drag region. A drag overlay inside the ScrollView would
          swallow wheel events everywhere but on buttons, so the page would not scroll. */}
      <MenuHeader borderless transparent />
      <ScrollView contentContainerStyle={styles.content}>
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
  // The settings page surface, so the settings cards on it lift the same way they do there.
  container: { flex: 1, backgroundColor: theme.colors.surfaceSettings },
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
