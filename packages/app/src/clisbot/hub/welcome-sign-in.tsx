import { useIsFocused } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useFetchQuery } from "@/data/query";
import { useHosts } from "@/runtime/host-runtime";
import { useHubAccount } from "./account-provider";
import { HubDaemonsSchema } from "./contracts";
import { buildHubSettingsRoute } from "./navigation";
import { hubResourceQueryKey } from "./query-keys";

const SIGN_IN_PARAM = "hubSignIn";
const WELCOME_SIGN_IN_RETURN_PATH = `/welcome?${SIGN_IN_PARAM}=1`;

type HubAccount = ReturnType<typeof useHubAccount>;

/**
 * Hub sign-in on the Welcome screen, beside adding a Host directly. After a sign-in started here,
 * the app opens a workspace when the organization gives this Member a Host, and Settings → Account
 * otherwise, where the next step is shown.
 */
export function HubWelcomeSignIn() {
  const hub = useHubAccount();
  const params = useLocalSearchParams<{ [SIGN_IN_PARAM]?: string }>();
  const [attempted, setAttempted] = useState(false);
  const continuing = attempted || params[SIGN_IN_PARAM] === "1";
  useContinueAfterSignIn(hub, continuing);
  if (!hub.enabled || hub.loading || hub.state === null) return null;
  const status = hub.state.status;
  if (status !== "signedOut" && status !== "instanceSetupRequired") return null;
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Paseo Hub</Text>
      <Text style={styles.description}>
        Sign in to use the Hosts and Projects your organization shares with you.
      </Text>
      <HubWelcomeSignInActions
        hub={hub}
        setupRequired={status === "instanceSetupRequired"}
        onAttempt={setAttempted}
      />
      {hub.error ? <Alert variant="error" title={hub.error} /> : null}
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
  // Native and desktop clients sign in on the Hub page they open, which offers every method.
  if (hub.signInKind === "system-browser") {
    return <Button onPress={signInThroughBrowser}>Sign in to Hub</Button>;
  }
  return (
    <>
      {googleSignIn && startGoogle !== undefined ? (
        <Button onPress={continueWithGoogle}>Continue with Google</Button>
      ) : null}
      <Button variant={googleSignIn ? "ghost" : "default"} onPress={openAccount}>
        {googleSignIn ? "Use email and password instead" : "Sign in to Hub"}
      </Button>
    </>
  );
}

/**
 * Leaves Welcome once, and only while Welcome is on screen: Account opened on top of it owns the
 * flow from there.
 */
function useContinueAfterSignIn(hub: HubAccount, continuing: boolean) {
  const router = useRouter();
  const focused = useIsFocused();
  const left = useRef(false);
  const hasHost = useHosts().length > 0;
  const signedIn = hub.signedIn;
  const daemons = useFetchQuery({
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
    enabled: continuing && focused && signedIn !== null,
    retry: false,
    staleTimeMs: 0,
  });
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
  card: {
    width: "100%",
    maxWidth: 420,
    // Separates Hub sign-in from the Host connection buttons below it on Welcome.
    marginBottom: theme.spacing[6],
    gap: theme.spacing[3],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  description: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
