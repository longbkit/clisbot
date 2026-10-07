import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  CONNECTOR_CARD_METADATA,
  ConnectorCardSchema,
  type ConnectorAccess,
  type ConnectorCard,
} from "@clisbot/protocol/connectors/types";
import type { AgentPermissionResponse } from "@clisbot/protocol/agent-types";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ConnectorLogo } from "./connector-logo";
import { addAppToProjectGrant } from "./project-grants";
import { useConnectAccount } from "./use-connect-account";
import { toErrorMessage } from "@/utils/error-messages";

/**
 * The connect card in an agent's timeline (docs/features/connectors/README.md, "Connect card").
 * The daemon holds the agent's tool call while it is open. Connect starts the sign-in and the
 * daemon closes the card once the account is active; Allow changes the Project's grant first,
 * so an answer from someone who may not change it changes nothing.
 */

/** The card a permission request carries, or null for every other request. */
export function readConnectorCard(
  metadata: Record<string, unknown> | undefined,
): ConnectorCard | null {
  const parsed = ConnectorCardSchema.safeParse(metadata?.[CONNECTOR_CARD_METADATA]);
  return parsed.success ? parsed.data : null;
}

export interface ConnectorPermissionCardProps {
  card: ConnectorCard;
  serverId: string;
  isResponding: boolean;
  onRespond(response: AgentPermissionResponse): void;
}

export function ConnectorPermissionCard(props: ConnectorPermissionCardProps) {
  if (props.card.action === "send") return <SendCard {...props} />;
  return props.card.action === "connect" ? <ConnectCard {...props} /> : <GrantCard {...props} />;
}

/**
 * A send waiting for the person: the app, what the tool does, then who receives what as labelled
 * lines. Allow once sends this call only; the same send again asks again.
 */
function SendCard({ card, isResponding, onRespond }: ConnectorPermissionCardProps) {
  const deny = useCallback(
    () => onRespond({ behavior: "deny", message: "The person declined this send." }),
    [onRespond],
  );
  const allow = useCallback(() => onRespond({ behavior: "allow" }), [onRespond]);
  return (
    <View style={styles.card} testID="connector-send-card">
      <CardHeader
        card={card}
        title={card.title ?? `${card.appName}: send`}
        hint="This agent wants to send something on your behalf. Check who receives it."
      />
      {card.fields && card.fields.length > 0 ? (
        <View style={styles.fields}>
          {card.fields.map((field) => (
            <View key={field.label} style={styles.field}>
              <Text style={styles.fieldLabel}>{field.label}</Text>
              <Text style={styles.fieldValue} selectable>
                {field.value}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.actions}>
        <Button variant="ghost" size="sm" onPress={deny} disabled={isResponding}>
          Deny
        </Button>
        <Button size="sm" onPress={allow} disabled={isResponding} testID="connector-card-send">
          Allow once
        </Button>
      </View>
    </View>
  );
}

function CardHeader({ card, title, hint }: { card: ConnectorCard; title: string; hint: string }) {
  return (
    <View style={styles.header}>
      <ConnectorLogo slug={card.app} name={card.appName} logo={card.logo} />
      <View style={styles.headerText}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.hint}>{hint}</Text>
      </View>
    </View>
  );
}

function ConnectCard({ card, serverId, isResponding, onRespond }: ConnectorPermissionCardProps) {
  const connect = useConnectAccount(serverId, card.app);
  const stop = useCallback(
    () => onRespond({ behavior: "deny", message: `Not connecting ${card.appName} now.` }),
    [card.appName, onRespond],
  );
  const waiting = connect.link !== null;
  return (
    <View style={styles.card} testID="connector-connect-card">
      <CardHeader
        card={card}
        title={
          waiting ? "Finish signing in in your browser" : `${card.appName} isn't connected yet`
        }
        hint={
          waiting
            ? "The task continues on its own when you are done."
            : "This agent needs it to continue. The sign-in opens in your browser."
        }
      />
      {connect.error ? <Text style={styles.error}>{connect.error}</Text> : null}
      <View style={styles.actions}>
        <Button variant="ghost" size="sm" onPress={stop} disabled={isResponding}>
          {waiting ? "Cancel" : "Not now"}
        </Button>
        {waiting ? (
          <Button variant="outline" size="sm" onPress={connect.reopen}>
            Open sign-in again
          </Button>
        ) : (
          <Button
            size="sm"
            loading={connect.busy}
            onPress={connect.start}
            testID="connector-card-connect"
          >
            {`Connect ${card.appName}`}
          </Button>
        )}
      </View>
    </View>
  );
}

const ACCESS_OPTIONS = [
  { value: "read" as const, label: "Read only" },
  { value: "write" as const, label: "Read and write" },
];

function GrantCard({ card, serverId, isResponding, onRespond }: ConnectorPermissionCardProps) {
  const [access, setAccess] = useState<ConnectorAccess>("read");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deny = useCallback(
    () => onRespond({ behavior: "deny", message: `${card.appName} was not allowed.` }),
    [card.appName, onRespond],
  );
  const allow = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await addAppToProjectGrant({ serverId, projectId: card.projectId, app: card.app, access });
      onRespond({ behavior: "allow" });
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  }, [access, card.app, card.projectId, onRespond, serverId]);
  const allowPress = useCallback(() => void allow(), [allow]);
  return (
    <View style={styles.card} testID="connector-grant-card">
      <CardHeader
        card={card}
        title={`Use ${card.appName} in this Project?`}
        hint="This agent wants an app the Project's Connectors do not include. Every session in the Project will be able to use it."
      />
      <SegmentedControl<ConnectorAccess>
        options={ACCESS_OPTIONS}
        value={access}
        onValueChange={setAccess}
        size="sm"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.actions}>
        <Button variant="ghost" size="sm" onPress={deny} disabled={isResponding || saving}>
          Deny
        </Button>
        <Button
          size="sm"
          loading={saving}
          disabled={isResponding}
          onPress={allowPress}
          testID="connector-card-allow"
        >
          {`Allow ${card.appName}`}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    marginVertical: theme.spacing[3],
    padding: theme.spacing[3],
    borderRadius: theme.spacing[2],
    borderWidth: 1,
    gap: theme.spacing[3],
    backgroundColor: theme.colors.surface1,
    borderColor: theme.colors.border,
  },
  header: { flexDirection: "row", alignItems: "center", gap: theme.spacing[3] },
  headerText: { flex: 1, gap: theme.spacing[1] },
  title: { fontSize: theme.fontSize.base, color: theme.colors.foreground },
  hint: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  error: { fontSize: theme.fontSize.sm, color: theme.colors.destructive },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing[2] },
  // The lines start under the title, past the 24px logo and its gap.
  fields: { gap: theme.spacing[1.5], marginLeft: 24 + theme.spacing[3] },
  field: { flexDirection: "row", gap: theme.spacing[3] },
  fieldLabel: { width: 96, fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  fieldValue: { flex: 1, fontSize: theme.fontSize.sm, color: theme.colors.foreground },
}));
