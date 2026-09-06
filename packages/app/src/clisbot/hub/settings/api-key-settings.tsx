import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Switch } from "@/components/ui/switch";
import { useFetchQuery } from "@/data/query";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { useHubAccount } from "../account-provider";
import { hubResourceQueryKey } from "../query-keys";

const API_KEY_SCOPES = [
  "projects:read",
  "configuration:validate",
  "configuration:install",
  "runs:dispatch",
  "daemons:enroll",
] as const;
type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

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

const SCOPE_DETAILS: Record<ApiKeyScope, { label: string; description: string }> = {
  "projects:read": {
    label: "Read Projects",
    description: "List Project configuration through the public API.",
  },
  "configuration:validate": {
    label: "Validate configuration",
    description: "Check configuration without activating it.",
  },
  "configuration:install": {
    label: "Install configuration",
    description: "Activate Project configuration revisions.",
  },
  "runs:dispatch": {
    label: "Start Automation runs",
    description: "Dispatch configured Automation runs.",
  },
  "daemons:enroll": {
    label: "Enroll Hosts",
    description: "Issue short-lived daemon enrollment tokens.",
  },
};

/** Shared API-key administration for Paseo web, native, and Electron. */
export function ApiKeySettings() {
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
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Set<ApiKeyScope>>(new Set());
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

  const create = useCallback(async () => {
    if (name.trim().length === 0 || scopes.size === 0) return;
    setPending(true);
    setError(null);
    try {
      const result = await hub
        .api()
        .postAuth("api-keys", { name: name.trim(), scopes: [...scopes] }, CreatedApiKeySchema);
      setSecret(result.secret);
      setCopied(false);
      setName("");
      setScopes(new Set());
      await query.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Hub request failed.");
    } finally {
      setPending(false);
    }
  }, [hub, name, query, scopes]);

  const revoke = useCallback(
    async (kind: "api-key" | "cli-credential", id: string, label: string) => {
      const confirmed = await confirmDialog({
        title: `Revoke ${label}?`,
        message:
          kind === "api-key"
            ? "Requests using this key will stop working. Unused Host enrollment tokens issued by it also expire."
            : "The CLI session using this credential will stop working.",
        confirmLabel: "Revoke",
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
        setError(cause instanceof Error ? cause.message : "Hub request failed.");
      } finally {
        setPending(false);
      }
    },
    [hub, query],
  );
  const copySecret = useCallback(() => {
    if (secret === null) return;
    void copyToClipboard(secret);
    setCopied(true);
  }, [secret]);
  const dismissSecret = useCallback(() => setSecret(null), []);
  const createKey = useCallback(() => void create(), [create]);
  const toggleScope = useCallback((scope: ApiKeyScope, enabled: boolean) => {
    setScopes((current) => {
      const next = new Set(current);
      if (enabled) next.add(scope);
      else next.delete(scope);
      return next;
    });
  }, []);

  return (
    <SettingsSection title="API keys">
      <Alert
        variant="info"
        title="For external integrations and CLI automation"
        description="Paseo itself does not need an API key. Create one only for a machine or script, and grant only the operations it needs."
      />
      {query.error ? <Alert variant="error" title={query.error.message} /> : null}
      {error ? <Alert variant="error" title={error} /> : null}
      {secret === null ? null : (
        <Alert
          variant="warning"
          title="Copy this key now"
          description="The Hub stores only a verifier and cannot show this secret again."
        >
          <Text selectable style={styles.secret}>
            {secret}
          </Text>
          <Button size="xs" variant="outline" onPress={copySecret}>
            {copied ? "Copied" : "Copy key"}
          </Button>
          <Button size="xs" variant="ghost" onPress={dismissSecret}>
            Done
          </Button>
        </Alert>
      )}
      <View style={settingsStyles.card}>
        <ApiKeyList keys={activeKeys} pending={pending} loading={query.isPending} revoke={revoke} />
      </View>
      <View style={[settingsStyles.card, styles.form]}>
        <Field label="Key name" hint="Name the machine or integration that will hold it.">
          <FormTextInput
            initialValue=""
            resetKey={query.data?.keys.length ?? 0}
            onChangeText={setName}
            placeholder="CI deployment"
            editable={!pending}
          />
        </Field>
        <View style={styles.scopeList}>
          {API_KEY_SCOPES.map((scope) => (
            <ScopeToggleRow
              key={scope}
              scope={scope}
              selected={scopes.has(scope)}
              pending={pending}
              toggle={toggleScope}
            />
          ))}
        </View>
        <Button
          disabled={pending || name.trim().length === 0 || scopes.size === 0}
          loading={pending}
          onPress={createKey}
        >
          Create API key
        </Button>
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
    </SettingsSection>
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
  if (loading) return <InfoRow title="Loading API keys…" />;
  if (keys.length === 0) {
    return <InfoRow title="No active API keys" hint="Paseo works without one." />;
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
        >{`${apiKey.prefix} · ${apiKey.scopes.map((scope) => SCOPE_DETAILS[scope].label).join(", ")}`}</Text>
        <Text style={settingsStyles.rowHint}>
          {apiKey.lastUsedAt === null ? "Never used" : `Last used ${formatDate(apiKey.lastUsedAt)}`}
        </Text>
      </View>
      <Button size="xs" variant="ghost" disabled={pending} onPress={handleRevoke}>
        Revoke
      </Button>
    </View>
  );
}

function ScopeToggleRow({
  scope,
  selected,
  pending,
  toggle,
}: {
  scope: ApiKeyScope;
  selected: boolean;
  pending: boolean;
  toggle(scope: ApiKeyScope, enabled: boolean): void;
}) {
  const handleToggle = useCallback((enabled: boolean) => toggle(scope, enabled), [scope, toggle]);
  const detail = SCOPE_DETAILS[scope];
  return (
    <View style={styles.row}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{detail.label}</Text>
        <Text style={settingsStyles.rowHint}>{detail.description}</Text>
      </View>
      <Switch value={selected} disabled={pending} onValueChange={handleToggle} />
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
  const handleRevoke = useCallback(
    () => void revoke("cli-credential", credential.id, "this CLI credential"),
    [credential.id, revoke],
  );
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null, styles.row]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>CLI credential</Text>
        <Text style={settingsStyles.rowHint}>{credential.prefix}</Text>
      </View>
      <Button size="xs" variant="ghost" disabled={pending} onPress={handleRevoke}>
        Revoke
      </Button>
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
  form: {
    padding: theme.spacing[4],
    gap: theme.spacing[4],
  },
  scopeList: {
    gap: theme.spacing[3],
  },
  secret: {
    color: theme.colors.foreground,
    fontFamily: "monospace",
    fontSize: theme.fontSize.sm,
  },
}));
