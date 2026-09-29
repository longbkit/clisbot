import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Switch } from "@/components/ui/switch";
import { settingsStyles } from "@/styles/settings";
import { parseFolderPatterns } from "@clisbot/protocol/project-folders";
import type { AccessResource } from "./access-catalog";
import {
  shareableTerminalProfiles,
  sharesEveryTerminalProfile,
  type ViewerHoldings,
} from "./access-grantor";
import { accessSettingsStyles as styles } from "./access-settings-styles";
import { MultiSelectField, type MultiSelection } from "./multi-select-field";

/**
 * Terminal (shell) and Terminal profiles on a Host or Project grant
 * (docs/features/access/terminal-and-project-creation.md#screens).
 */
export function TerminalAccessFields({
  resource,
  holdings,
  terminalSwitch,
  terminal,
  setTerminal,
  profiles,
  setProfiles,
  pending,
}: {
  resource: AccessResource;
  holdings: ViewerHoldings;
  terminalSwitch: boolean;
  terminal: boolean;
  setTerminal(value: boolean): void;
  profiles: MultiSelection;
  setProfiles(value: MultiSelection): void;
  pending: boolean;
}) {
  const options = useMemo(
    () =>
      shareableTerminalProfiles(resource.terminalProfileCatalog, holdings).map(({ id, name }) => ({
        id,
        value: id,
        label: name,
      })),
    [holdings, resource.terminalProfileCatalog],
  );
  return (
    <>
      {terminal ? (
        <Field label="Terminal profiles">
          <Text style={settingsStyles.rowHint}>All profiles, included with Terminal</Text>
        </Field>
      ) : (
        <MultiSelectField
          label="Terminal profiles"
          hint="Each opens an agent CLI directly, with no shell. Exiting closes the terminal."
          options={options}
          value={profiles}
          onChange={setProfiles}
          disabled={pending}
          {...(sharesEveryTerminalProfile(holdings) ? { allLabel: "All profiles" } : {})}
          placeholder="Choose Terminal profiles"
          searchPlaceholder="Search Terminal profiles"
        />
      )}
      {terminalSwitch ? (
        <View style={styles.switchRow}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>Terminal (shell)</Text>
            <Text style={settingsStyles.rowHint}>
              Runs any command. Reads every file the daemon can, secrets included.
            </Text>
          </View>
          <Switch
            value={terminal}
            onValueChange={setTerminal}
            disabled={pending}
            accessibilityLabel="Terminal (shell)"
          />
        </View>
      ) : null}
    </>
  );
}

/**
 * Where a Host grant creates Projects: the Host's folder policy, optionally
 * narrowed for this grant. A narrowed grantor's own rules are the starting point.
 */
export function ProjectFolderFields({
  value,
  onChange,
  holdings,
  pending,
}: {
  value: { allow: string[]; deny: string[] } | null;
  onChange(value: { allow: string[]; deny: string[] } | null): void;
  holdings: ViewerHoldings;
  pending: boolean;
}) {
  // A narrowed grantor passes their narrowing on, so it cannot be switched off.
  const mustNarrow = holdings.projectFolders !== undefined;
  const narrowed = value !== null;
  const toggle = useCallback(
    (on: boolean) => onChange(on ? { allow: ["**"], deny: [] } : null),
    [onChange],
  );
  const setAllow = useCallback(
    (text: string) => onChange({ allow: parseFolderPatterns(text), deny: value?.deny ?? [] }),
    [onChange, value?.deny],
  );
  const setDeny = useCallback(
    (text: string) => onChange({ allow: value?.allow ?? [], deny: parseFolderPatterns(text) }),
    [onChange, value?.allow],
  );
  return (
    <>
      <View style={styles.switchRow}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>Narrow Project folders</Text>
          <Text style={settingsStyles.rowHint}>
            Creates Projects wherever the Host folder policy allows, unless narrowed here.
          </Text>
        </View>
        <Switch
          value={narrowed}
          onValueChange={toggle}
          disabled={pending || mustNarrow}
          accessibilityLabel="Narrow Project folders"
        />
      </View>
      {narrowed ? (
        <>
          <Field label="Allow" hint="Folders, comma-separated. * is one level, ** any depth.">
            <FormTextInput
              initialValue={value.allow.join(", ")}
              onChangeText={setAllow}
              placeholder="/workspace/**"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!pending}
            />
          </Field>
          <Field label="Deny" hint="Wins over Allow.">
            <FormTextInput
              initialValue={value.deny.join(", ")}
              onChangeText={setDeny}
              placeholder="/workspace/prod-*/**"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!pending}
            />
          </Field>
        </>
      ) : null}
    </>
  );
}
