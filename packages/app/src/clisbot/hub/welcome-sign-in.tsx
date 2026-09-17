import { useIsFocused } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeConnectionStatuses, useHosts } from "@/runtime/host-runtime";
import { buildWelcomeRoute } from "@/utils/host-routes";
import { useHubAccount } from "./account-provider";
import { HubDaemonsSchema } from "./contracts";
import { projectHubHostOnboarding, type HubHostOnboardingItem } from "./host-onboarding";
import {
  hubHostSynchronizationKey,
  useFirstHubHostSynchronizationFailureKey,
  useHubHostSynchronizationFailure,
} from "./host-synchronization-status";
import { buildHubSettingsRoute } from "./navigation";
import { hubResourceQueryKey } from "./query-keys";
import {
  resolveHubWelcomeCard,
  type HubWelcomeAction,
  type HubWelcomeStatusView,
} from "./welcome-status";

const SIGN_IN_PARAM = "hubSignIn";
// Returning here keeps the reader on Welcome even when a Host is already online: the account they
// just signed into still has a step to show.
const WELCOME_SIGN_IN_RETURN_PATH = `${buildWelcomeRoute({ stay: true })}&${SIGN_IN_PARAM}=1`;

type HubAccount = ReturnType<typeof useHubAccount>;
type DaemonsQuery = ReturnType<typeof useHubWelcomeDaemons>;

/**
 * Managed Hosts on the Welcome screen: sign in to a Hub, then watch the Hosts that Hub shares
 * arrive. It stays on screen after sign-in because connecting a Host of your own stays available
 * beside it — a Member can hold Hosts from a Hub and Hosts they paired themselves.
 */
export function HubWelcomeSignIn() {
  const hub = useHubAccount();
  const params = useLocalSearchParams<{ [SIGN_IN_PARAM]?: string }>();
  const [attempted, setAttempted] = useState(false);
  const continuing = attempted || params[SIGN_IN_PARAM] === "1";
  const daemons = useHubWelcomeDaemons(hub);
  const items = useHubWelcomeHostItems(hub, daemons);
  const failure = useHubWelcomeSynchronizationFailure(hub, items);
  useContinueAfterSignIn(hub, continuing, daemons);
  const card = resolveHubWelcomeCard({
    enabled: hub.enabled,
    loading: hub.loading,
    status: hub.state?.status ?? null,
    items,
    hostsPending: daemons.isPending,
    hostsFailed: daemons.isError,
    canAddHost: hub.signedIn?.capabilities.manageResources === true,
    synchronizationFailure: failure,
  });
  if (card.kind === "hidden") return null;
  return (
    <View style={styles.section}>
      <HubWelcomeSectionLabel />
      <View style={styles.card}>
        <HubWelcomeCardHeader
          badge={card.kind === "status" ? card.view.badge : null}
          tone={card.kind === "status" ? card.view.tone : "muted"}
        />
        {card.kind === "status" ? (
          <HubWelcomeStatus view={card.view} hub={hub} daemons={daemons} failureRetry={failure} />
        ) : (
          <HubWelcomeSignInActions
            hub={hub}
            setupRequired={card.kind === "setupRequired"}
            onAttempt={setAttempted}
          />
        )}
        {hub.error ? <Alert variant="error" title={hub.error} /> : null}
      </View>
      {/* "Another" only reads right once this app already holds a Hub account. */}
      {card.kind === "status" ? <AddAnotherHubRow /> : null}
    </View>
  );
}

function HubWelcomeSectionLabel() {
  const { t } = useTranslation();
  return <Text style={styles.sectionLabel}>{t("onboarding.groups.managedHosts")}</Text>;
}

function HubWelcomeCardHeader({
  badge,
  tone,
}: {
  badge: string | null;
  tone: HubWelcomeStatusView["tone"];
}) {
  return (
    <View style={styles.headerRow}>
      <Text style={styles.title}>Paseo Hub</Text>
      {badge ? <StatusBadge label={badge} variant={badgeVariant(tone)} /> : null}
    </View>
  );
}

function badgeVariant(tone: HubWelcomeStatusView["tone"]) {
  if (tone === "error") return "error" as const;
  if (tone === "warning") return "warning" as const;
  if (tone === "success") return "success" as const;
  return "muted" as const;
}

/** The signed-in lines: who this client is signed in as, and what the Hosts are doing. */
function HubWelcomeStatus({
  view,
  hub,
  daemons,
  failureRetry,
}: {
  view: HubWelcomeStatusView;
  hub: HubAccount;
  daemons: DaemonsQuery;
  failureRetry: { retry(): void } | null;
}) {
  const router = useRouter();
  const signedIn = hub.signedIn;
  const identity = signedIn ? `${signedIn.account.email} · ${signedIn.organization.name}` : null;
  const run = useCallback(
    (action: HubWelcomeAction) => {
      if (action === "account") router.push(buildHubSettingsRoute("account"));
      if (action === "refreshHosts") void daemons.refetch();
      if (action === "retrySynchronization") failureRetry?.retry();
    },
    [daemons, failureRetry, router],
  );
  return (
    <>
      {identity ? <Text style={styles.identity}>{identity}</Text> : null}
      <Text style={view.tone === "error" ? styles.messageError : styles.description}>
        {view.message}
      </Text>
      {view.actions.length > 0 ? (
        <View style={styles.actionRow}>
          {view.actions.map((action) => (
            <HubWelcomeActionButton
              key={action}
              action={action}
              primary={action === view.primaryAction}
              loading={action === "refreshHosts" && daemons.isFetching}
              onRun={run}
            />
          ))}
        </View>
      ) : null}
    </>
  );
}

function HubWelcomeActionButton({
  action,
  primary,
  loading,
  onRun,
}: {
  action: HubWelcomeAction;
  primary: boolean;
  loading: boolean;
  onRun: (action: HubWelcomeAction) => void;
}) {
  const press = useCallback(() => onRun(action), [action, onRun]);
  return (
    <Button size="sm" variant={primary ? "secondary" : "ghost"} loading={loading} onPress={press}>
      {actionLabel(action)}
    </Button>
  );
}

function actionLabel(action: HubWelcomeAction): string {
  if (action === "account") return "Account";
  // Same label as Settings → Account so one action keeps one name (docs/glossary.md).
  if (action === "refreshHosts") return "Refresh Hosts";
  return "Retry";
}

/**
 * Names the Hosts a user connects themselves, so they read as a second source beside managed
 * Hosts rather than a fallback. Absent when this build has no Hub: one unlabelled list needs no
 * heading.
 */
export function WelcomeOwnComputerLabel() {
  const hub = useHubAccount();
  const { t } = useTranslation();
  if (!hub.enabled) return null;
  return <Text style={styles.sectionLabel}>{t("onboarding.groups.ownComputer")}</Text>;
}

/** Placed now so a second Hub does not change this layout later; one Hub origin per app today. */
function AddAnotherHubRow() {
  return (
    <View style={styles.addHubRow}>
      <Button size="sm" variant="ghost" disabled>
        + Add another Hub
      </Button>
      <Text style={styles.hint}>One Hub per app for now.</Text>
    </View>
  );
}

function HubWelcomeSignInActions({
  hub,
  setupRequired,
  onAttempt,
}: {
  hub: HubAccount;
  setupRequired: boolean;
  onAttempt: (attempted: boolean) => void;
}) {
  const router = useRouter();
  const openAccount = useCallback(() => router.push(buildHubSettingsRoute("account")), [router]);
  const startGoogle = hub.signInWithGoogle;
  const googleSignIn = hub.state?.status === "signedOut" && hub.state.googleSignIn === true;
  // A failed start is already shown through `hub.error`.
  const continueWithGoogle = useCallback(() => {
    startGoogle?.({ returnPath: WELCOME_SIGN_IN_RETURN_PATH }).catch(() => undefined);
  }, [startGoogle]);
  const signInThroughBrowser = useCallback(() => {
    onAttempt(true);
    void hub.signIn().catch(() => onAttempt(false));
  }, [hub, onAttempt]);
  if (setupRequired) {
    return <Button onPress={openAccount}>Set up Hub</Button>;
  }
  return (
    <>
      <Text style={styles.description}>
        Sign in to use the Hosts and Projects your organization shares with you.
      </Text>
      {/* Native and desktop clients sign in on the Hub page they open, which offers every method. */}
      {hub.signInKind === "system-browser" ? (
        <Button onPress={signInThroughBrowser}>Sign in to Hub</Button>
      ) : (
        <>
          {googleSignIn && startGoogle !== undefined ? (
            <Button onPress={continueWithGoogle}>Continue with Google</Button>
          ) : null}
          <Button variant={googleSignIn ? "ghost" : "default"} onPress={openAccount}>
            {googleSignIn ? "Use email and password instead" : "Sign in to Hub"}
          </Button>
        </>
      )}
    </>
  );
}

/** The Hosts this account's organization shares, read the same way Settings → Account reads them. */
function useHubWelcomeDaemons(hub: HubAccount) {
  const signedIn = hub.signedIn;
  const focused = useIsFocused();
  return useFetchQuery({
    queryKey: hubResourceQueryKey(
      {
        origin: hub.origin,
        organizationId: signedIn?.organization.id ?? null,
        accountId: signedIn?.account.id ?? null,
      },
      "daemons",
    ),
    queryFn: () => hub.api().get("daemons", HubDaemonsSchema),
    dataShape: "value",
    // Only an active account reads this list, and only while Welcome is the screen in front.
    enabled: focused && hub.state?.status === "active",
    retry: false,
    staleTimeMs: 0,
  });
}

function useHubWelcomeHostItems(hub: HubAccount, daemons: DaemonsQuery): HubHostOnboardingItem[] {
  const hosts = useHosts();
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const connectionStatuses = useHostRuntimeConnectionStatuses(serverIds);
  const daemonList = daemons.data?.daemons;
  return useMemo(
    () =>
      hub.signedIn === null
        ? []
        : projectHubHostOnboarding({
            daemons: daemonList ?? [],
            hosts,
            connectionStatuses,
          }),
    [connectionStatuses, daemonList, hosts, hub.signedIn],
  );
}

function useHubWelcomeSynchronizationFailure(
  hub: HubAccount,
  items: readonly HubHostOnboardingItem[],
) {
  const accountId = hub.signedIn?.account.id ?? null;
  const organizationId = hub.signedIn?.organization.id ?? null;
  const keys = useMemo(
    () =>
      items.map((item) =>
        hubHostSynchronizationKey({
          origin: hub.origin,
          organizationId,
          accountId,
          daemonId: item.daemonId,
        }),
      ),
    [accountId, hub.origin, items, organizationId],
  );
  const failedKey = useFirstHubHostSynchronizationFailureKey(keys);
  const failure = useHubHostSynchronizationFailure(failedKey ?? "");
  const label = items[keys.indexOf(failedKey ?? "")]?.label;
  return failure && label ? { label, message: failure.message, retry: failure.retry } : null;
}

/**
 * Leaves Welcome once, and only while Welcome is on screen: Account opened on top of it owns the
 * flow from there.
 */
function useContinueAfterSignIn(hub: HubAccount, continuing: boolean, daemons: DaemonsQuery) {
  const router = useRouter();
  const focused = useIsFocused();
  const left = useRef(false);
  const hasHost = useHosts().length > 0;
  const status = hub.loading ? null : (hub.state?.status ?? null);
  const hasReachableHost = daemons.data?.daemons.some((daemon) => daemon.connectionOffer !== null);
  const destination = continueDestination({
    status,
    hasReachableHost,
    daemonsFailed: daemons.isError,
    hasHost,
  });
  useEffect(() => {
    if (!continuing || !focused || left.current || destination === null) return;
    left.current = true;
    router.replace(destination);
  }, [continuing, destination, focused, router]);
}

/** `/` once the Member's organization gives a Host (Hub synchronization saves it first); Account
 * for every other step. `null` keeps waiting. */
function continueDestination(input: {
  status: string | null;
  hasReachableHost: boolean | undefined;
  daemonsFailed: boolean;
  hasHost: boolean;
}): "/" | ReturnType<typeof buildHubSettingsRoute<"account">> | null {
  if (input.status === null || input.status === "signedOut") return null;
  const account = buildHubSettingsRoute("account");
  if (input.status !== "active") return account;
  if (input.hasReachableHost === true) return input.hasHost ? "/" : null;
  return input.hasReachableHost === false || input.daemonsFailed ? account : null;
}

const styles = StyleSheet.create((theme) => ({
  section: {
    width: "100%",
    maxWidth: 420,
    // Separates managed Hosts from the Host connection buttons below them on Welcome.
    marginBottom: theme.spacing[6],
    gap: theme.spacing[2],
  },
  sectionLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  card: {
    gap: theme.spacing[3],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  identity: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  description: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  messageError: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  addHubRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
