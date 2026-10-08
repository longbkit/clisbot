import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
        <Field label={t("hub.access.terminal.profilesLabel")}>
          <Text style={settingsStyles.rowHint}>{t("hub.access.terminal.allIncluded")}</Text>
        </Field>
      ) : (
        <MultiSelectField
          label={t("hub.access.terminal.profilesLabel")}
          hint={t("hub.access.terminal.profilesHint")}
          options={options}
          value={profiles}
          onChange={setProfiles}
          disabled={pending}
          {...(sharesEveryTerminalProfile(holdings)
            ? { allLabel: t("hub.access.terminal.allProfiles") }
            : {})}
          placeholder={t("hub.access.terminal.profilesPlaceholder")}
          searchPlaceholder={t("hub.access.terminal.searchProfiles")}
        />
      )}
      {terminalSwitch ? (
        <View style={styles.switchRow}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("hub.access.terminal.shellLabel")}</Text>
            <Text style={settingsStyles.rowHint}>{t("hub.access.terminal.shellHint")}</Text>
          </View>
          <Switch
            value={terminal}
            onValueChange={setTerminal}
            disabled={pending}
            accessibilityLabel={t("hub.access.terminal.shellLabel")}
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
  const { t } = useTranslation();
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
          <Text style={settingsStyles.rowTitle}>{t("hub.access.terminal.narrowFolders")}</Text>
          <Text style={settingsStyles.rowHint}>{t("hub.access.terminal.narrowFoldersHint")}</Text>
        </View>
        <Switch
          value={narrowed}
          onValueChange={toggle}
          disabled={pending || mustNarrow}
          accessibilityLabel={t("hub.access.terminal.narrowFolders")}
        />
      </View>
      {narrowed ? (
        <>
          <Field label={t("hub.access.terminal.allow")} hint={t("hub.access.terminal.allowHint")}>
            <FormTextInput
              initialValue={value.allow.join(", ")}
              onChangeText={setAllow}
              placeholder="/workspace/**"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!pending}
            />
          </Field>
          <Field label={t("hub.access.terminal.deny")} hint={t("hub.access.terminal.denyHint")}>
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
