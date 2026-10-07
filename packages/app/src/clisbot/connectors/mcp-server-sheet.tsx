import { useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { ConnectorMcpServer, ConnectorMcpTransport } from "@clisbot/protocol/connectors/types";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { settingsStyles } from "@/styles/settings";
import { useMcpServerForm, type McpServerForm } from "./use-mcp-server-form";

/**
 * Add or edit one MCP server (docs/features/connectors/README.md, "MCP servers"). Secret
 * values are typed here once and never shown again: an edit with the field left empty
 * keeps what the Host stores. The caller remounts the sheet per server it edits.
 */

const TRANSPORTS = [
  { value: "http" as const, label: "Remote URL" },
  { value: "stdio" as const, label: "Local command" },
];

export function McpServerSheet({
  serverId,
  visible,
  editing,
  onClose,
  onSaved,
}: {
  serverId: string;
  visible: boolean;
  editing: ConnectorMcpServer | null;
  onClose(): void;
  onSaved(name: string): void;
}) {
  const form = useMcpServerForm(serverId, editing, onSaved);
  const header = useMemo(
    () => ({ title: editing ? `Edit ${editing.name}` : "Add MCP server" }),
    [editing],
  );
  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button variant="ghost" onPress={onClose}>
          Cancel
        </Button>
        <Button
          variant="default"
          loading={form.saving}
          disabled={form.saving}
          onPress={form.save}
          testID="connectors-mcp-save"
        >
          {editing ? "Save server" : "Add server"}
        </Button>
      </View>
    ),
    [editing, form.save, form.saving, onClose],
  );
  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      footer={footer}
      desktopMaxWidth={560}
    >
      <View style={styles.body}>
        <Field
          label="Name"
          hint="Lowercase letters, digits, - and _. Agents see its tools under this name."
        >
          <FormTextInput
            accessibilityLabel="Name"
            initialValue={editing?.name ?? ""}
            placeholder="linear"
            autoCapitalize="none"
            onChangeText={form.setName}
            testID="connectors-mcp-name"
          />
        </Field>
        <Field label="Runs as">
          <SegmentedControl<ConnectorMcpTransport>
            options={TRANSPORTS}
            value={form.transport}
            onValueChange={form.setTransport}
            size="sm"
          />
        </Field>
        {form.transport === "http" ? (
          <RemoteFields editing={editing} form={form} />
        ) : (
          <LocalFields editing={editing} form={form} />
        )}
        {form.error ? (
          <Text accessibilityRole="alert" style={settingsStyles.rowError}>
            {form.error}
          </Text>
        ) : null}
      </View>
    </AdaptiveModalSheet>
  );
}

function storedHint(names: string[] | undefined, fallback: string): string {
  return names?.length ? `Stored: ${names.join(", ")}. Leave empty to keep them.` : fallback;
}

function RemoteFields({
  editing,
  form,
}: {
  editing: ConnectorMcpServer | null;
  form: McpServerForm;
}) {
  return (
    <>
      <Field label="URL">
        <FormTextInput
          accessibilityLabel="URL"
          initialValue={editing?.url ?? ""}
          placeholder="https://mcp.example.com/mcp"
          autoCapitalize="none"
          keyboardType="url"
          onChangeText={form.setUrl}
          testID="connectors-mcp-url"
        />
      </Field>
      <Field
        label="Headers"
        hint={storedHint(
          editing?.headerKeys,
          "One per line, Name: value. Stored on this Host only; agents never see them.",
        )}
      >
        <FormTextInput
          accessibilityLabel="Headers"
          placeholder="Authorization: Bearer …"
          autoCapitalize="none"
          multiline
          onChangeText={form.setSecrets}
          testID="connectors-mcp-headers"
        />
      </Field>
    </>
  );
}

function LocalFields({
  editing,
  form,
}: {
  editing: ConnectorMcpServer | null;
  form: McpServerForm;
}) {
  return (
    <>
      <Field
        label="Command"
        hint="Runs on this Host in the agent's folder, for example npx -y @modelcontextprotocol/server-filesystem ~/notes"
      >
        <FormTextInput
          accessibilityLabel="Command"
          initialValue={form.command}
          placeholder="npx -y my-mcp-server"
          autoCapitalize="none"
          onChangeText={form.setCommand}
          testID="connectors-mcp-command"
        />
      </Field>
      <Field
        label="Environment"
        hint={storedHint(
          editing?.envKeys,
          "One per line, NAME=value. The server starts inside each granted agent with these.",
        )}
      >
        <FormTextInput
          accessibilityLabel="Environment"
          placeholder="API_TOKEN=…"
          autoCapitalize="none"
          multiline
          onChangeText={form.setSecrets}
          testID="connectors-mcp-env"
        />
      </Field>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: { gap: theme.spacing[4] },
  footer: { flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing[2] },
}));
