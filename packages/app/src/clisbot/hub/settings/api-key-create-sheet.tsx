import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Switch } from "@/components/ui/switch";
import { settingsStyles } from "@/styles/settings";
import { API_KEY_SCOPES, SCOPE_DETAILS, type ApiKeyScope } from "./api-key-scopes";

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
  const header = useMemo(() => ({ title: "New API key" }), []);
  const disabled = pending || name.trim().length === 0 || scopes.size === 0;
  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button variant="secondary" size="sm" onPress={onClose}>
          Cancel
        </Button>
        <Button variant="default" size="sm" disabled={disabled} loading={pending} onPress={create}>
          Create key
        </Button>
      </View>
    ),
    [create, disabled, onClose, pending],
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
        <Field label="Name" hint="The machine or script that will hold it.">
          <FormTextInput
            initialValue=""
            onChangeText={setName}
            placeholder="CI deployment"
            editable={!pending}
          />
        </Field>
        <Field label="Allowed operations" hint="Grant only what it needs.">
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
  const detail = SCOPE_DETAILS[scope];
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
