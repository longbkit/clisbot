import { ExternalLink } from "lucide-react-native";
import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { FormTextInput } from "@/components/ui/form-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import { settingsStyles } from "@/styles/settings";
import { openExternalUrl } from "@/utils/open-external-url";
import { saveComposioKey } from "./data";
import { toErrorMessage } from "@/utils/error-messages";

/**
 * The first thing on a Host without a Composio key (docs/features/connectors/README.md,
 * "Decisions"): who Composio is, what leaves the Host, their own pages, and the key field with
 * where to get a key. MCP servers need none of this, so they sit beside it, not behind it.
 */

export const COMPOSIO_LINKS = [
  { label: "What is Composio", url: "https://composio.dev" },
  { label: "Quickstart", url: "https://docs.composio.dev/docs/quickstart" },
  { label: "Security", url: "https://docs.composio.dev/docs/security/overview" },
  { label: "Privacy", url: "https://composio.dev/privacy" },
] as const;

/**
 * The dashboard opens in the person's own project; its API keys page sits under that project's
 * path, so there is no link that lands on it for everyone.
 */
const COMPOSIO_DASHBOARD = "https://dashboard.composio.dev";

export const COMPOSIO_SECTION_INFO =
  "Each Host has its own Composio key, and the app accounts you connect belong to that Host. Free plan: 100,000 tool calls a month.";

export function ComposioSetup({ serverId }: { serverId: string }) {
  return (
    <SettingsSection title="Composio" info={COMPOSIO_SECTION_INFO}>
      <View style={settingsStyles.card}>
        <ComposioIntro />
        <View style={[styles.block, settingsStyles.rowBorder]}>
          <ComposioKeyForm serverId={serverId} />
        </View>
      </View>
    </SettingsSection>
  );
}

/** Who Composio is and what leaves the Host, in two lines, with their own pages. */
export function ComposioIntro() {
  return (
    <View style={styles.block}>
      <Text style={settingsStyles.rowTitle}>Connect 1,000+ apps through Composio</Text>
      <Text style={styles.body}>
        Composio keeps your app sign-ins (Gmail, GitHub, Slack, Notion…) and runs their actions for
        your agents. Those requests pass through its cloud; your code and files stay here. For
        nothing to leave this Host, add an MCP server instead.
      </Text>
      <ComposioLinks />
    </View>
  );
}

function ComposioLinks() {
  return (
    <View style={styles.links}>
      {COMPOSIO_LINKS.map((link) => (
        <ComposioLink key={link.url} label={link.label} url={link.url} />
      ))}
    </View>
  );
}

function ComposioLink({ label, url }: { label: string; url: string }) {
  const open = useCallback(() => void openExternalUrl(url), [url]);
  return (
    <Button size="xs" variant="ghost" leftIcon={ExternalLink} onPress={open}>
      {label}
    </Button>
  );
}

const openDashboard = () => void openExternalUrl(COMPOSIO_DASHBOARD);

/** The key field, with where to get a key; `onCancel` adds Cancel when it replaces a saved key. */
export function ComposioKeyForm({
  serverId,
  onSaved,
  onCancel,
}: {
  serverId: string;
  onSaved?(): void;
  onCancel?(): void;
}) {
  const compact = useIsCompactFormFactor();
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = useCallback(async () => {
    // Enter submits too, so the button's guard is repeated here.
    if (!key.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await saveComposioKey(serverId, key.trim());
      onSaved?.();
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  }, [key, onSaved, saving, serverId]);
  return (
    <View style={styles.form}>
      <View style={styles.keyHelp}>
        <Text style={[settingsStyles.rowHint, styles.keyHelpText]}>
          In Composio: API Keys → Create, then paste it here. Agents never see it.
        </Text>
        <Button size="sm" variant="outline" leftIcon={ExternalLink} onPress={openDashboard}>
          Get a key
        </Button>
      </View>
      <View style={styles.keyRow}>
        <View style={styles.keyInput}>
          <FormTextInput
            accessibilityLabel="Composio API key"
            placeholder="ak_…"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            size={compact ? "md" : "sm"}
            onChangeText={setKey}
            onSubmitEditing={save}
            testID="connectors-composio-key"
          />
        </View>
        <Button
          variant="default"
          size={compact ? "md" : "sm"}
          loading={saving}
          disabled={!key.trim() || saving}
          onPress={save}
        >
          Save key
        </Button>
        {onCancel ? (
          <Button variant="ghost" size={compact ? "md" : "sm"} onPress={onCancel}>
            Cancel
          </Button>
        ) : null}
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={settingsStyles.rowError}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  block: { padding: theme.spacing[4], gap: theme.spacing[2] },
  body: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  links: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[1],
    marginLeft: -theme.spacing[2],
  },
  form: { gap: theme.spacing[2] },
  keyHelp: { flexDirection: "row", alignItems: "center", gap: theme.spacing[3] },
  keyHelpText: { flex: 1, minWidth: 0 },
  keyRow: { flexDirection: "row", gap: theme.spacing[2], alignItems: "center" },
  keyInput: { flex: 1, minWidth: 0 },
}));
