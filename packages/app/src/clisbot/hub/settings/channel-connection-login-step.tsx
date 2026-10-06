import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import type { ChannelQrPhase } from "../channel-qr-linking";
import { useChannelCatalog } from "./channel-catalog-queries";
import { ChannelQrLinkPanel, type ChannelQrVerbs } from "./channel-qr-link-panel";
import { CHANNEL_QR_OPERATIONS_AVAILABLE, useChannelQrVerbs } from "./channel-qr-verbs";

/** A Connection just added for a channel that logs in by QR: its account to log in. */
export interface ConnectionLoginTarget {
  channel: string;
  accountId: string;
}

/** Add Route's steps: a new Connection, its QR login, then the Route. */
export type EditorStep = "connect" | "login" | "route";

export function editorStep(loggingIn: boolean, addingConnection: boolean): EditorStep {
  if (loggingIn) return "login";
  return addingConnection ? "connect" : "route";
}

/** The channels whose Connections log in by QR, from the Hub's catalog. */
export function useQrLoginChannels(): ReadonlySet<string> {
  const catalog = useChannelCatalog();
  return useMemo(
    () => new Set(catalog.entries.filter((entry) => entry.auth === "qr").map((entry) => entry.id)),
    [catalog.entries],
  );
}

/**
 * Which just-added Connection is logging in. `created` is called with every new
 * Connection; only a QR channel's opens the login step.
 */
export function useConnectionLogin(): {
  loginFor: ConnectionLoginTarget | null;
  created(connection: { provider: string; name: string }): void;
  finish(): void;
} {
  const qrChannels = useQrLoginChannels();
  const [loginFor, setLoginFor] = useState<ConnectionLoginTarget | null>(null);
  const created = useCallback(
    (connection: { provider: string; name: string }) => {
      if (qrChannels.has(connection.provider)) {
        setLoginFor({ channel: connection.provider, accountId: connection.name });
      }
    },
    [qrChannels],
  );
  const finish = useCallback(() => setLoginFor(null), []);
  return { loginFor, created, finish };
}

/**
 * The step between naming a QR Connection and giving it a Route: the code shows
 * at once, so the scan follows the name. Continuing before the scan is allowed —
 * the Connection's card keeps the same login row until it is done — and leaving
 * cancels a code still waiting, so the Hub does not hold a login nobody polls.
 */
export function ConnectionLoginStep({
  target,
  done,
}: {
  target: ConnectionLoginTarget;
  done(): void;
}) {
  const verbs = useChannelQrVerbs(target);
  const [phase, setPhase] = useState<ChannelQrPhase>("idle");
  useCancelWaitingCodeOnLeave(phase, verbs);
  const finish = useCallback(() => done(), [done]);
  return (
    <View style={styles.view}>
      <ChannelQrLinkPanel
        channel={target.channel}
        available={CHANNEL_QR_OPERATIONS_AVAILABLE}
        verbs={verbs}
        framed
        autoStart
        onPhase={setPhase}
      />
      <View style={styles.actions}>
        {phase === "linked" ? (
          <Button size="sm" variant="default" onPress={finish}>
            Continue to the Route
          </Button>
        ) : (
          <Button size="sm" variant="outline" onPress={finish}>
            Log in later
          </Button>
        )}
      </View>
    </View>
  );
}

/** On unmount, cancel a code the Hub is still waiting on. */
function useCancelWaitingCodeOnLeave(phase: ChannelQrPhase, verbs: ChannelQrVerbs): void {
  const latest = useRef(phase);
  latest.current = phase;
  useEffect(
    () => () => {
      if (latest.current === "pending" || latest.current === "starting") {
        void verbs.cancel().catch(() => undefined);
      }
    },
    [verbs],
  );
}

const styles = StyleSheet.create((theme) => ({
  view: {
    gap: theme.spacing[3],
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
}));
