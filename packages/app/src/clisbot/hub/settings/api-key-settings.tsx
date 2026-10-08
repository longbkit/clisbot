import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useFetchQuery } from "@/data/query";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { useHubAccount } from "../account-provider";
import { hubResourceQueryKey } from "../query-keys";
import { ApiKeyCreateSheet } from "./api-key-create-sheet";
import { API_KEY_SCOPES, scopeDetails, type ApiKeyScope } from "./api-key-scopes";
import { EmptyRow } from "./resource-rows";
import { RowActionsMenu } from "./team/row-actions-menu";

const ApiKeySummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(z.enum(API_KEY_SCOPES)),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});
const ApiKeysSchema = z.object({
  keys: z.array(ApiKeySummarySchema),
  cliCredentials: z.array(
    z.object({
      id: z.string(),
      prefix: z.string(),
      createdAt: z.string(),
      lastUsedAt: z.string().nullable(),
      revokedAt: z.string().nullable(),
    }),
  ),
});
const CreatedApiKeySchema = z.object({ key: ApiKeySummarySchema, secret: z.string().min(1) });
type ApiKeySummary = z.infer<typeof ApiKeySummarySchema>;
type CliCredentialSummary = z.infer<typeof ApiKeysSchema>["cliCredentials"][number];

/** Shared API-key administration for Clisbot web, native, and Electron. */
export function ApiKeySettings() {
  const { t } = useTranslation();
  const hub = useHubAccount();
  const organizationId = hub.signedIn?.organization.id ?? "";
  const accountId = hub.signedIn?.account.id ?? null;
  const query = useFetchQuery({
    queryKey: hubResourceQueryKey({ origin: hub.origin, organizationId, accountId }, "api-keys"),
    queryFn: () => hub.api().getAuth("api-keys", ApiKeysSchema),
    dataShape: "value",
    enabled: organizationId.length > 0 && hub.signedIn?.capabilities.manageResources === true,
    retry: false,
    staleTimeMs: 0,
  });
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeKeys = useMemo(
    () => query.data?.keys.filter(({ revokedAt }) => revokedAt === null) ?? [],
    [query.data?.keys],
  );
  const activeCliCredentials = useMemo(
    () => query.data?.cliCredentials.filter(({ revokedAt }) => revokedAt === null) ?? [],
    [query.data?.cliCredentials],
  );

  const create = useCallback(
    async (name: string, scopes: ApiKeyScope[]) => {
      setPending(true);
      setError(null);
      try {
        const result = await hub.api().postAuth("api-keys", { name, scopes }, CreatedApiKeySchema);
        setSecret(result.secret);
        setCopied(false);
        setCreating(false);
        await query.refetch();
        return true;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t("hub.settings.apiKeys.requestFailed"));
        return false;
      } finally {
        setPending(false);
      }
    },
    [hub, query, t],
  );

  const revoke = useCallback(
    async (kind: "api-key" | "cli-credential", id: string, label: string) => {
      const confirmed = await confirmDialog({
        title: t("hub.settings.apiKeys.revokeTitle", { label }),
        message:
          kind === "api-key"
            ? t("hub.settings.apiKeys.revokeKeyMessage")
            : t("hub.settings.apiKeys.revokeCliMessage"),
        confirmLabel: t("hub.settings.apiKeys.revoke"),
        destructive: true,
      });
      if (!confirmed) return;
      setPending(true);
      setError(null);
      try {
        await hub
          .api()
          .postAuth(
            kind === "api-key" ? "revoke-api-key" : "revoke-cli-credential",
            { id },
            z.object({ revoked: z.literal(true) }),
          );
        await query.refetch();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t("hub.settings.apiKeys.requestFailed"));
      } finally {
        setPending(false);
      }
    },
    [hub, query, t],
  );
  const copySecret = useCallback(() => {
    if (secret === null) return;
    void copyToClipboard(secret);
    setCopied(true);
  }, [secret]);
  const dismissSecret = useCallback(() => setSecret(null), []);
  const openCreate = useCallback(() => setCreating(true), []);
  const closeCreate = useCallback(() => setCreating(false), []);
  const createButton = useMemo(
    () => (
      <Button size="sm" onPress={openCreate}>
        {t("hub.settings.apiKeys.createButton")}
      </Button>
    ),
    [openCreate, t],
  );

  return (
    <SettingsSection
      title={t("hub.settings.apiKeys.title")}
      info={t("hub.settings.apiKeys.info")}
      trailing={createButton}
    >
      {query.error ? <Alert variant="error" title={query.error.message} /> : null}
      {error ? <Alert variant="error" title={error} /> : null}
      {secret === null ? null : (
        <NewKeySecret secret={secret} copied={copied} copy={copySecret} dismiss={dismissSecret} />
      )}
      <View style={settingsStyles.card}>
        <ApiKeyList keys={activeKeys} pending={pending} loading={query.isPending} revoke={revoke} />
      </View>
      {activeCliCredentials.length === 0 ? null : (
        <View style={settingsStyles.card}>
          {activeCliCredentials.map((credential, index) => (
            <CliCredentialRow
              key={credential.id}
              credential={credential}
              bordered={index > 0}
              pending={pending}
              revoke={revoke}
            />
          ))}
        </View>
      )}
      <ApiKeyCreateSheet
        visible={creating}
        pending={pending}
        onCreate={create}
        onClose={closeCreate}
      />
    </SettingsSection>
  );
}

/** The secret of a key just created, shown once. */
function NewKeySecret({
  secret,
  copied,
  copy,
  dismiss,
}: {
  secret: string;
  copied: boolean;
  copy(): void;
  dismiss(): void;
}) {
  const { t } = useTranslation();
  return (
    <Alert
      variant="warning"
      title={t("hub.settings.apiKeys.copyNowTitle")}
      description={t("hub.settings.apiKeys.copyNowDescription")}
    >
      <Text selectable style={styles.secret}>
        {secret}
      </Text>
      <Button size="xs" variant="outline" onPress={copy}>
        {copied ? t("hub.settings.apiKeys.copied") : t("hub.settings.apiKeys.copyKey")}
      </Button>
      <Button size="xs" variant="ghost" onPress={dismiss}>
        {t("hub.settings.apiKeys.done")}
      </Button>
    </Alert>
  );
}

function ApiKeyList({
  keys,
  pending,
  loading,
  revoke,
}: {
  keys: ApiKeySummary[];
  pending: boolean;
  loading: boolean;
  revoke(kind: "api-key" | "cli-credential", id: string, label: string): Promise<void>;
}) {
  const { t } = useTranslation();
  if (loading) return <InfoRow title={t("hub.settings.apiKeys.loading")} />;
  if (keys.length === 0) {
    return <EmptyRow message={t("hub.settings.apiKeys.empty")} />;
  }
  return keys.map((key, index) => (
    <ApiKeyRow key={key.id} apiKey={key} bordered={index > 0} pending={pending} revoke={revoke} />
  ));
}

function ApiKeyRow({
  apiKey,
  bordered,
  pending,
  revoke,
}: {
  apiKey: ApiKeySummary;
  bordered: boolean;
  pending: boolean;
  revoke(kind: "api-key" | "cli-credential", id: string, label: string): Promise<void>;
}) {
  const { t } = useTranslation();
  const handleRevoke = useCallback(
    () => void revoke("api-key", apiKey.id, apiKey.name),
    [apiKey.id, apiKey.name, revoke],
  );
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null, styles.row]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{apiKey.name}</Text>
        <Text
          style={settingsStyles.rowHint}
        >{`${apiKey.prefix} · ${apiKey.scopes.map((scope) => scopeDetails(scope).label).join(", ")}`}</Text>
        <Text style={settingsStyles.rowHint}>
          {apiKey.lastUsedAt === null
            ? t("hub.settings.apiKeys.neverUsed")
            : t("hub.settings.apiKeys.lastUsed", { date: formatDate(apiKey.lastUsedAt) })}
        </Text>
      </View>
      <RowActionsMenu
        label={t("hub.settings.apiKeys.keyActions")}
        actions={[
          { label: t("hub.settings.apiKeys.revoke"), onSelect: handleRevoke, destructive: true },
        ]}
        disabled={pending}
      />
    </View>
  );
}

function CliCredentialRow({
  credential,
  bordered,
  pending,
  revoke,
}: {
  credential: CliCredentialSummary;
  bordered: boolean;
  pending: boolean;
  revoke(kind: "api-key" | "cli-credential", id: string, label: string): Promise<void>;
}) {
  const { t } = useTranslation();
  const handleRevoke = useCallback(
    () => void revoke("cli-credential", credential.id, t("hub.settings.apiKeys.thisCliCredential")),
    [credential.id, revoke, t],
  );
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null, styles.row]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{t("hub.settings.apiKeys.cliCredential")}</Text>
        <Text style={settingsStyles.rowHint}>{credential.prefix}</Text>
      </View>
      <RowActionsMenu
        label={t("hub.settings.apiKeys.keyActions")}
        actions={[
          { label: t("hub.settings.apiKeys.revoke"), onSelect: handleRevoke, destructive: true },
        ]}
        disabled={pending}
      />
    </View>
  );
}

function InfoRow({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={settingsStyles.row}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        {hint ? <Text style={settingsStyles.rowHint}>{hint}</Text> : null}
      </View>
    </View>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  secret: {
    color: theme.colors.foreground,
    fontFamily: "monospace",
    fontSize: theme.fontSize.sm,
  },
}));
