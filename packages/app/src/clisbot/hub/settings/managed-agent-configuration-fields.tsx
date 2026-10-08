import { useCallback, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { AgentProvider } from "@clisbot/protocol/agent-types";
import type { AgentProfilePicker } from "@/agent-profiles";
import { useAgentProfiles } from "@/agent-profiles";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import { Field } from "@/components/ui/form-field";
import {
  SelectField,
  SelectFieldTrigger,
  type SelectFieldOption,
} from "@/components/ui/select-field";
import { Switch } from "@/components/ui/switch";
import { i18n } from "@/i18n/i18next";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { buildSelectableProviderSelectorProviders } from "@/provider-selection/provider-selection";
import { settingsStyles } from "@/styles/settings";

export interface ManagedAgentConfigurationValue {
  provider: string;
  model: string;
  mode: string;
  thinkingOptionId: string;
  featureValues: Record<string, unknown>;
}

interface ManagedAgentConfigurationFieldsProps {
  serverId: string | null;
  cwd: string;
  value: ManagedAgentConfigurationValue;
  onChange(value: ManagedAgentConfigurationValue): void;
  disabled?: boolean;
  allowFastMode?: boolean;
  /** Off when the surface places Fast mode in its own advanced group instead. */
  showFastMode?: boolean;
}

function configurationHint(input: {
  hasServer: boolean;
  hasProviders: boolean;
  isLoading: boolean;
  hasProfiles: boolean;
}): string | undefined {
  if (input.hasServer && !input.hasProviders && !input.isLoading) {
    return i18n.t("hub.access.managedAgent.connectHost");
  }
  if (input.hasProfiles) return i18n.t("hub.access.managedAgent.profilesHint");
  return undefined;
}

/** "Default" first, then the Provider's own Modes or Thinking options. */
function withDefaultOption(
  defaultLabel: string,
  choices: readonly (Pick<SelectFieldOption<string>, "label" | "description"> & {
    id: string;
  })[] = [],
): SelectFieldOption<string>[] {
  return [
    { id: "default", value: "", label: defaultLabel },
    ...choices.map(({ id, label, description }) => ({ id, value: id, label, description })),
  ];
}

/** Shared Agent controls for Channel and Automation authoring on every Clisbot platform. */
export function ManagedAgentConfigurationFields({
  serverId,
  cwd,
  value,
  onChange,
  disabled = false,
  allowFastMode = true,
  showFastMode = true,
}: ManagedAgentConfigurationFieldsProps) {
  const { t } = useTranslation();
  const snapshot = useProvidersSnapshot(serverId, { cwd: cwd.trim() || null });
  const { profiles, isSupported: profilesSupported } = useAgentProfiles(serverId);
  const providers = useMemo(
    () => buildSelectableProviderSelectorProviders(snapshot.entries),
    [snapshot.entries],
  );
  const selectedEntry = useMemo(
    () => snapshot.entries?.find((entry) => entry.provider === value.provider) ?? null,
    [snapshot.entries, value.provider],
  );
  const selectedModel = useMemo(
    () =>
      selectedEntry?.models?.find((model) => model.id === value.model) ??
      selectedEntry?.models?.find((model) => model.isDefault) ??
      selectedEntry?.models?.[0] ??
      null,
    [selectedEntry, value.model],
  );
  const modeOptions = useMemo(
    () => withDefaultOption(t("hub.access.managedAgent.default"), selectedEntry?.modes),
    [selectedEntry?.modes, t],
  );
  const thinkingOptions = useMemo(
    () => withDefaultOption(t("hub.access.managedAgent.default"), selectedModel?.thinkingOptions),
    [selectedModel?.thinkingOptions, t],
  );

  const applyProfile = useCallback(
    (profileId: string) => {
      const profile = profiles?.find((candidate) => candidate.id === profileId);
      if (!profile) return;
      onChange({
        provider: profile.provider.trim(),
        model: profile.model?.trim() ?? "",
        mode: profile.modeId?.trim() ?? "",
        thinkingOptionId: profile.thinkingOptionId?.trim() ?? "",
        featureValues: { ...profile.featureValues },
      });
    },
    [onChange, profiles],
  );
  const profilePicker = useMemo<AgentProfilePicker | null>(() => {
    if (!profilesSupported || profiles === null) return null;
    const available = new Set(providers.map(({ id }) => id));
    return {
      rows: profiles
        .filter((profile) => available.has(profile.provider))
        .map((profile) => ({
          id: profile.id,
          provider: profile.provider,
          modelId: profile.model?.trim() ?? "",
          icon: profile.icon ?? "",
          color: profile.color ?? "",
          name: profile.name,
          summary: [profile.provider, profile.model, profile.modeId, profile.thinkingOptionId]
            .filter(Boolean)
            .join(" · "),
        })),
      applyProfile,
    };
  }, [applyProfile, profiles, profilesSupported, providers]);

  const selectModel = useCallback(
    (provider: AgentProvider, model: string) => {
      const entry = snapshot.entries?.find((candidate) => candidate.provider === provider);
      const definition = entry?.models?.find((candidate) => candidate.id === model);
      const modeStillAvailable = entry?.modes?.some(({ id }) => id === value.mode) === true;
      const thinkingStillAvailable =
        definition?.thinkingOptions?.some(({ id }) => id === value.thinkingOptionId) === true;
      onChange({
        ...value,
        provider,
        model,
        mode: modeStillAvailable ? value.mode : (entry?.defaultModeId ?? ""),
        thinkingOptionId: thinkingStillAvailable
          ? value.thinkingOptionId
          : (definition?.defaultThinkingOptionId ?? ""),
      });
    },
    [onChange, snapshot.entries, value],
  );
  const renderModelTrigger = useCallback(
    ({
      selectedModelLabel,
      disabled: triggerDisabled,
      isOpen,
      hovered,
      pressed,
    }: {
      selectedModelLabel: string;
      onPress: () => void;
      disabled: boolean;
      isOpen: boolean;
      hovered: boolean;
      pressed: boolean;
    }): ReactNode => (
      <SelectFieldTrigger
        label={selectedModelLabel}
        isPlaceholder={!value.provider}
        placeholder={
          serverId
            ? t("hub.access.managedAgent.chooseProviderModel")
            : t("hub.access.managedAgent.chooseHostFirst")
        }
        disabled={triggerDisabled}
        active={hovered || pressed || isOpen}
      />
    ),
    [serverId, t, value.provider],
  );

  const setThinkingOption = useCallback(
    (thinkingOptionId: string) => onChange({ ...value, thinkingOptionId }),
    [onChange, value],
  );
  const setMode = useCallback((mode: string) => onChange({ ...value, mode }), [onChange, value]);
  const openModelSelector = useCallback(
    () => snapshot.refetchIfStale(value.provider),
    [snapshot, value.provider],
  );
  const retryProvider = useCallback(
    (provider: AgentProvider) => {
      void snapshot.refresh([provider]);
    },
    [snapshot],
  );
  const thinkingDisplay = useMemo(
    () => ({
      label:
        thinkingOptions.find(({ value: optionValue }) => optionValue === value.thinkingOptionId)
          ?.label ?? value.thinkingOptionId,
    }),
    [thinkingOptions, value.thinkingOptionId],
  );
  const modeDisplay = useMemo(
    () => ({
      label:
        modeOptions.find(({ value: optionValue }) => optionValue === value.mode)?.label ??
        value.mode,
    }),
    [modeOptions, value.mode],
  );
  const hint = configurationHint({
    hasServer: Boolean(serverId),
    hasProviders: providers.length > 0,
    isLoading: snapshot.isLoading,
    hasProfiles: Boolean(profilePicker && profilePicker.rows.length > 0),
  });

  return (
    <>
      {/* One line while the surface is wide enough; each selector wraps whole. */}
      <View style={styles.selectorRow}>
        <View style={styles.selector}>
          <Field label={t("hub.access.managedAgent.providerAndModel")} hint={hint}>
            <CombinedModelSelector
              providers={providers}
              selectedProvider={value.provider}
              selectedModel={value.model}
              onSelect={selectModel}
              isLoading={snapshot.isLoading || snapshot.isFetching}
              profiles={profilePicker}
              onApplyProfile={applyProfile}
              renderTrigger={renderModelTrigger}
              triggerFill
              serverId={serverId}
              disabled={disabled || serverId === null}
              onOpen={openModelSelector}
              onRetryProvider={retryProvider}
              isRetryingProvider={snapshot.isRefreshing}
            />
          </Field>
        </View>
        <View style={styles.selector}>
          <SelectField
            label={t("hub.access.managedAgent.thinking")}
            value={value.thinkingOptionId}
            selectedDisplay={thinkingDisplay}
            options={thinkingOptions}
            onChange={setThinkingOption}
            placeholder={t("hub.access.managedAgent.default")}
            emptyText={t("hub.access.managedAgent.noThinking")}
            searchable={thinkingOptions.length > 6}
            title={t("hub.access.managedAgent.thinking")}
            disabled={disabled || serverId === null || thinkingOptions.length <= 1}
          />
        </View>
        {modeOptions.length > 1 || value.mode.length > 0 ? (
          <View style={styles.selector}>
            <SelectField
              label={t("hub.access.managedAgent.mode")}
              value={value.mode}
              selectedDisplay={modeDisplay}
              options={modeOptions}
              onChange={setMode}
              placeholder={t("hub.access.managedAgent.default")}
              emptyText={t("hub.access.managedAgent.noModes")}
              searchable={modeOptions.length > 6}
              title={t("hub.access.managedAgent.mode")}
              disabled={disabled || serverId === null || modeOptions.length <= 1}
            />
          </View>
        ) : null}
      </View>
      {showFastMode ? (
        <ManagedAgentFastModeSwitch
          serverId={serverId}
          value={value}
          onChange={onChange}
          disabled={disabled}
          allowFastMode={allowFastMode}
        />
      ) : null}
    </>
  );
}

/** The Fast mode row, so a surface can place it in its own advanced group. */
export function ManagedAgentFastModeSwitch({
  serverId,
  value,
  onChange,
  disabled = false,
  allowFastMode = true,
}: {
  serverId: string | null;
  value: ManagedAgentConfigurationValue;
  onChange(value: ManagedAgentConfigurationValue): void;
  disabled?: boolean;
  allowFastMode?: boolean;
}) {
  const { t } = useTranslation();
  const setFastMode = useCallback(
    (enabled: boolean) => {
      const featureValues = { ...value.featureValues };
      if (enabled) featureValues["fast_mode"] = true;
      else delete featureValues["fast_mode"];
      onChange({ ...value, featureValues });
    },
    [onChange, value],
  );
  return (
    <View style={settingsStyles.formRow}>
      <View style={settingsStyles.formRowContent}>
        <Text style={settingsStyles.rowTitle}>{t("hub.access.managedAgent.useFastMode")}</Text>
        <Text style={settingsStyles.rowHint}>
          {allowFastMode
            ? t("hub.access.managedAgent.fastModeHint")
            : t("hub.access.managedAgent.fastModeUnavailable")}
        </Text>
      </View>
      <Switch
        value={allowFastMode && value.featureValues["fast_mode"] === true}
        onValueChange={setFastMode}
        disabled={disabled || serverId === null || !allowFastMode}
        accessibilityLabel={t("hub.access.managedAgent.useFastMode")}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  selectorRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[3],
  },
  selector: {
    flexBasis: 180,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  },
}));
