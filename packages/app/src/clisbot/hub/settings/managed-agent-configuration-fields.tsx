import { useCallback, useMemo, type ReactNode } from "react";
import { Text, View } from "react-native";
import type { AgentProvider } from "@getpaseo/protocol/agent-types";
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
}

function configurationHint(input: {
  hasServer: boolean;
  hasProviders: boolean;
  isLoading: boolean;
  hasProfiles: boolean;
}): string | undefined {
  if (input.hasServer && !input.hasProviders && !input.isLoading) {
    return "Connect the Host and enable a Provider first.";
  }
  if (input.hasProfiles) return "Choose directly or apply an Agent profile as a copy.";
  return undefined;
}

/** Shared Agent controls for Channel and Automation authoring on every Paseo platform. */
export function ManagedAgentConfigurationFields({
  serverId,
  cwd,
  value,
  onChange,
  disabled = false,
  allowFastMode = true,
}: ManagedAgentConfigurationFieldsProps) {
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
  const modeOptions = useMemo<SelectFieldOption<string>[]>(
    () => [
      { id: "default", value: "", label: "Default" },
      ...(selectedEntry?.modes ?? []).map((mode) => ({
        id: mode.id,
        value: mode.id,
        label: mode.label,
        description: mode.description,
      })),
    ],
    [selectedEntry?.modes],
  );
  const thinkingOptions = useMemo<SelectFieldOption<string>[]>(
    () => [
      { id: "default", value: "", label: "Default" },
      ...(selectedModel?.thinkingOptions ?? []).map((option) => ({
        id: option.id,
        value: option.id,
        label: option.label,
        description: option.description,
      })),
    ],
    [selectedModel?.thinkingOptions],
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
        placeholder={serverId ? "Choose a Provider and Model" : "Choose a Host first"}
        disabled={triggerDisabled}
        active={hovered || pressed || isOpen}
      />
    ),
    [serverId, value.provider],
  );

  const setFastMode = useCallback(
    (enabled: boolean) => {
      const featureValues = { ...value.featureValues };
      if (enabled) featureValues["fast_mode"] = true;
      else delete featureValues["fast_mode"];
      onChange({ ...value, featureValues });
    },
    [onChange, value],
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
      <Field label="Provider and Model" hint={hint}>
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
      <SelectField
        label="Thinking"
        value={value.thinkingOptionId}
        selectedDisplay={thinkingDisplay}
        options={thinkingOptions}
        onChange={setThinkingOption}
        placeholder="Default"
        emptyText="No Thinking options are available."
        searchable={thinkingOptions.length > 6}
        title="Thinking"
        disabled={disabled || serverId === null || thinkingOptions.length <= 1}
      />
      <SelectField
        label="Mode"
        value={value.mode}
        selectedDisplay={modeDisplay}
        options={modeOptions}
        onChange={setMode}
        placeholder="Default"
        emptyText="No Modes are available."
        searchable={modeOptions.length > 6}
        title="Mode"
        disabled={disabled || serverId === null || modeOptions.length <= 1}
      />
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>Use Fast mode</Text>
          <Text style={settingsStyles.rowHint}>
            {allowFastMode
              ? "Uses the Provider's faster service tier when supported and may cost more."
              : "Unavailable for Routes that external participants can invoke."}
          </Text>
        </View>
        <Switch
          value={allowFastMode && value.featureValues["fast_mode"] === true}
          onValueChange={setFastMode}
          disabled={disabled || serverId === null || !allowFastMode}
          accessibilityLabel="Use Fast mode"
        />
      </View>
    </>
  );
}
