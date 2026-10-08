import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Switch } from "@/components/ui/switch";
import { settingsStyles } from "@/styles/settings";
import { API_KEY_SCOPES, scopeDetails, type ApiKeyScope } from "./api-key-scopes";

/** New API key: a name and the operations it may run, in a sheet so the list stays a list. */
export function ApiKeyCreateSheet({
  visible,
  pending,
  onCreate,
  onClose,
}: {
  visible: boolean;
  pending: boolean;
  onCreate(name: string, scopes: ApiKeyScope[]): Promise<boolean>;
  onClose(): void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Set<ApiKeyScope>>(new Set());
  const toggle = useCallback((scope: ApiKeyScope, enabled: boolean) => {
    setScopes((current) => {
      const next = new Set(current);
      if (enabled) next.add(scope);
      else next.delete(scope);
      return next;
    });
  }, []);
  const create = useCallback(() => {
    void onCreate(name.trim(), [...scopes]).then((created) => {
      if (!created) return false;
      setName("");
      setScopes(new Set());
      return true;
    });
  }, [name, onCreate, scopes]);
  const header = useMemo(() => ({ title: t("hub.settings.apiKeys.create.title") }), [t]);
  const disabled = pending || name.trim().length === 0 || scopes.size === 0;
  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button variant="secondary" size="sm" onPress={onClose}>
          {t("hub.settings.apiKeys.create.cancel")}
        </Button>
        <Button variant="default" size="sm" disabled={disabled} loading={pending} onPress={create}>
          {t("hub.settings.apiKeys.create.submit")}
        </Button>
      </View>
    ),
    [create, disabled, onClose, pending, t],
  );
  return (
    <AdaptiveModalSheet
      visible={visible}
      header={header}
      onClose={onClose}
      footer={footer}
      desktopMaxWidth={520}
    >
      <View style={styles.form}>
        <Field
          label={t("hub.settings.apiKeys.create.nameLabel")}
          hint={t("hub.settings.apiKeys.create.nameHint")}
        >
          <FormTextInput
            initialValue=""
            onChangeText={setName}
            placeholder={t("hub.settings.apiKeys.create.namePlaceholder")}
            editable={!pending}
          />
        </Field>
        <Field
          label={t("hub.settings.apiKeys.create.operationsLabel")}
          hint={t("hub.settings.apiKeys.create.operationsHint")}
        >
          <View style={styles.scopes}>
            {API_KEY_SCOPES.map((scope) => (
              <ScopeToggle
                key={scope}
                scope={scope}
                selected={scopes.has(scope)}
                pending={pending}
                toggle={toggle}
              />
            ))}
          </View>
        </Field>
      </View>
    </AdaptiveModalSheet>
  );
}

function ScopeToggle({
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
  const change = useCallback((enabled: boolean) => toggle(scope, enabled), [scope, toggle]);
  const detail = scopeDetails(scope);
  return (
    <View style={styles.scope}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{detail.label}</Text>
        <Text style={settingsStyles.rowHint}>{detail.description}</Text>
      </View>
      <Switch value={selected} disabled={pending} onValueChange={change} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  form: { gap: theme.spacing[4] },
  scopes: { gap: theme.spacing[3] },
  scope: { flexDirection: "row", alignItems: "center", gap: theme.spacing[3] },
  footer: { flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing[2], flex: 1 },
}));
