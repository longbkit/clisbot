import { useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { ConnectorMcpServer, ConnectorMcpTransport } from "@clisbot/protocol/connectors/types";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { i18n } from "@/i18n/i18next";
import { settingsStyles } from "@/styles/settings";
import { useMcpServerForm, type McpServerForm } from "./use-mcp-server-form";

/**
 * Add or edit one MCP server (docs/features/connectors/README.md, "MCP servers"). Secret
 * values are typed here once and never shown again: an edit with the field left empty
 * keeps what the Host stores. The caller remounts the sheet per server it edits.
 */

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
  const { t } = useTranslation();
  const form = useMcpServerForm(serverId, editing, onSaved);
  const transports = useMemo(
    () => [
      { value: "http" as const, label: t("connectors.screen.mcp.remoteUrl") },
      { value: "stdio" as const, label: t("connectors.screen.common.localCommand") },
    ],
    [t],
  );
  const header = useMemo(
    () => ({
      title: editing
        ? t("connectors.screen.mcp.editTitle", { name: editing.name })
        : t("connectors.screen.common.addMcpServer"),
    }),
    [editing, t],
  );
  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button variant="ghost" onPress={onClose}>
          {t("connectors.screen.common.cancel")}
        </Button>
        <Button
          variant="default"
          loading={form.saving}
          disabled={form.saving}
          onPress={form.save}
          testID="connectors-mcp-save"
        >
          {editing ? t("connectors.screen.mcp.saveServer") : t("connectors.screen.mcp.addServer")}
        </Button>
      </View>
    ),
    [editing, form.save, form.saving, onClose, t],
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
        <Field label={t("connectors.screen.mcp.name")} hint={t("connectors.screen.mcp.nameHint")}>
          <FormTextInput
            accessibilityLabel={t("connectors.screen.mcp.name")}
            initialValue={editing?.name ?? ""}
            placeholder="linear"
            autoCapitalize="none"
            onChangeText={form.setName}
            testID="connectors-mcp-name"
          />
        </Field>
        <Field label={t("connectors.screen.mcp.runsAs")}>
          <SegmentedControl<ConnectorMcpTransport>
            options={transports}
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
  return names?.length
    ? i18n.t("connectors.screen.mcp.stored", { names: names.join(", ") })
    : fallback;
}

function RemoteFields({
  editing,
  form,
}: {
  editing: ConnectorMcpServer | null;
  form: McpServerForm;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Field label={t("connectors.screen.mcp.url")}>
        <FormTextInput
          accessibilityLabel={t("connectors.screen.mcp.url")}
          initialValue={editing?.url ?? ""}
          placeholder="https://mcp.example.com/mcp"
          autoCapitalize="none"
          keyboardType="url"
          onChangeText={form.setUrl}
          testID="connectors-mcp-url"
        />
      </Field>
      <Field
        label={t("connectors.screen.mcp.headers")}
        hint={storedHint(editing?.headerKeys, t("connectors.screen.mcp.headersHint"))}
      >
        <FormTextInput
          accessibilityLabel={t("connectors.screen.mcp.headers")}
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
  const { t } = useTranslation();
  return (
    <>
      <Field
        label={t("connectors.screen.mcp.command")}
        hint={t("connectors.screen.mcp.commandHint")}
      >
        <FormTextInput
          accessibilityLabel={t("connectors.screen.mcp.command")}
          initialValue={form.command}
          placeholder="npx -y my-mcp-server"
          autoCapitalize="none"
          onChangeText={form.setCommand}
          testID="connectors-mcp-command"
        />
      </Field>
      <Field
        label={t("connectors.screen.mcp.environment")}
        hint={storedHint(editing?.envKeys, t("connectors.screen.mcp.envHint"))}
      >
        <FormTextInput
          accessibilityLabel={t("connectors.screen.mcp.environment")}
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
