import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { settingsStyles } from "@/styles/settings";
import type { AgentConfigurationCatalog } from "./access-catalog";
import { accessSettingsStyles as styles } from "./access-settings-styles";
import { MultiSelectField, selectionLabel, type MultiSelection } from "./multi-select-field";

/**
 * One row is one stored grant: a Provider plus the exact Models and Thinking
 * options it may select. Rows are not merged by Provider — two rows can name the
 * same Provider with different Thinking, and merging them would lose that.
 */
export interface AgentConfigurationDraft {
  id: number;
  providerId: string | null;
  modelIds: MultiSelection | null;
  thinkingOptionIds: MultiSelection | null;
}

let nextAgentConfigurationDraftId = 1;

export function createAgentConfigurationDraft(): AgentConfigurationDraft {
  return {
    id: nextAgentConfigurationDraftId++,
    providerId: null,
    modelIds: null,
    thinkingOptionIds: null,
  };
}

export function agentConfigurationDraftFrom(grant: {
  providerId: string;
  modelIds: MultiSelection;
  thinkingOptionIds: MultiSelection;
}): AgentConfigurationDraft {
  return { id: nextAgentConfigurationDraftId++, ...grant };
}

function isCompleteSelection(value: MultiSelection | null): boolean {
  return value === "*" || (Array.isArray(value) && value.length > 0);
}

export function isCompleteAgentConfiguration(configuration: AgentConfigurationDraft): boolean {
  return (
    configuration.providerId !== null &&
    isCompleteSelection(configuration.modelIds) &&
    isCompleteSelection(configuration.thinkingOptionIds)
  );
}

/** Drops incomplete rows and collapses exact duplicates into the stored grants. */
export function uniqueAgentConfigurationGrants(configurations: AgentConfigurationDraft[]) {
  const result: Array<{
    providerId: string;
    modelIds: "*" | string[];
    thinkingOptionIds: "*" | string[];
  }> = [];
  const seen = new Set<string>();
  for (const configuration of configurations) {
    const { providerId, modelIds, thinkingOptionIds } = configuration;
    if (providerId === null || modelIds === null || thinkingOptionIds === null) continue;
    if (!isCompleteAgentConfiguration(configuration)) continue;
    const models = normalizeSelection(modelIds);
    const thinking = normalizeSelection(thinkingOptionIds);
    const key = `${providerId}\0${selectionKey(models)}\0${selectionKey(thinking)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ providerId, modelIds: models, thinkingOptionIds: thinking });
  }
  return result;
}

/**
 * Drops repeats but keeps order. Sorting here would make an unchanged grant
 * differ from its stored form, and mergeAccessConstraints would then rewrite it
 * and lose fields a newer client stored.
 */
function normalizeSelection(value: MultiSelection): "*" | string[] {
  return value === "*" ? "*" : [...new Set(value)];
}

/** Order-insensitive identity, used only to recognize duplicate rows. */
function selectionKey(value: "*" | string[]): string {
  return value === "*" ? "*" : [...value].sort().join(",");
}

export function AgentConfigurationGrantEditor({
  index,
  catalog,
  value,
  disabled,
  canRemove,
  setConfigurations,
}: {
  index: number;
  catalog: AgentConfigurationCatalog;
  value: AgentConfigurationDraft;
  disabled: boolean;
  canRemove: boolean;
  setConfigurations(
    update: (current: AgentConfigurationDraft[]) => AgentConfigurationDraft[],
  ): void;
}) {
  const change = useCallback(
    (next: AgentConfigurationDraft) =>
      setConfigurations((current) =>
        current.map((candidate) => (candidate.id === value.id ? next : candidate)),
      ),
    [setConfigurations, value.id],
  );
  const remove = useCallback(
    () => setConfigurations((current) => current.filter((candidate) => candidate.id !== value.id)),
    [setConfigurations, value.id],
  );
  return (
    <AgentConfigurationGrantFields
      index={index}
      catalog={catalog}
      value={value}
      disabled={disabled}
      canRemove={canRemove}
      onChange={change}
      onRemove={remove}
    />
  );
}

function AgentConfigurationGrantFields({
  index,
  catalog,
  value,
  disabled,
  canRemove,
  onChange,
  onRemove,
}: {
  index: number;
  catalog: AgentConfigurationCatalog;
  value: AgentConfigurationDraft;
  disabled: boolean;
  canRemove: boolean;
  onChange(value: AgentConfigurationDraft): void;
  onRemove(): void;
}) {
  // A finished row reads as one line; only an unfinished one needs the controls.
  const [expanded, setExpanded] = useState(() => !isCompleteAgentConfiguration(value));
  const toggleExpanded = useCallback(() => setExpanded((current) => !current), []);
  const providerOptions: SelectFieldOption<string>[] = catalog.providers.map((provider) => ({
    id: provider.id,
    value: provider.id,
    label: provider.label,
  }));
  const provider = catalog.providers.find(({ id }) => id === value.providerId);
  const modelOptions: SelectFieldOption<string>[] = (provider?.models ?? []).map((model) => ({
    id: model.id,
    value: model.id,
    label: model.label,
    description: model.id,
  }));
  const thinkingOptions = useThinkingOptions(provider, value.modelIds);
  const providerDisplay = useMemo(() => (provider ? { label: provider.label } : null), [provider]);
  const changeProvider = useCallback(
    (providerId: string) =>
      onChange({ ...value, providerId, modelIds: null, thinkingOptionIds: null }),
    [onChange, value],
  );
  const changeModels = useCallback(
    (modelIds: MultiSelection) => onChange({ ...value, modelIds, thinkingOptionIds: "*" }),
    [onChange, value],
  );
  const changeThinking = useCallback(
    (thinkingOptionIds: MultiSelection) => onChange({ ...value, thinkingOptionIds }),
    [onChange, value],
  );
  const summary = [
    provider?.label ?? `Agent configuration ${String(index + 1)}`,
    selectionLabel(value.modelIds, modelOptions, "All Models"),
    selectionLabel(value.thinkingOptionIds, thinkingOptions, "All Thinking"),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <View style={styles.configurationCard}>
      <View style={styles.configurationHeader}>
        <Button
          size="xs"
          variant="ghost"
          leftIcon={expanded ? ChevronDown : ChevronRight}
          onPress={toggleExpanded}
          accessibilityLabel={expanded ? "Collapse" : "Expand"}
        />
        <Text style={[settingsStyles.rowTitle, styles.configurationSummary]} numberOfLines={1}>
          {summary}
        </Text>
        {canRemove ? (
          <Button size="xs" variant="ghost" disabled={disabled} onPress={onRemove}>
            Remove
          </Button>
        ) : null}
      </View>
      {expanded ? (
        <>
          <SelectField
            label="Provider"
            value={value.providerId}
            selectedDisplay={providerDisplay}
            options={providerOptions}
            onChange={changeProvider}
            placeholder="Choose a Provider"
            emptyText="No enabled Providers were published by this Host."
            searchable={providerOptions.length > 6}
            title="Provider"
            disabled={disabled}
          />
          <MultiSelectField
            label="Models"
            options={modelOptions}
            value={value.modelIds}
            onChange={changeModels}
            disabled={disabled || provider === undefined}
            allLabel="All available Models"
            placeholder="Choose Models"
            searchPlaceholder="Search Models"
          />
          <MultiSelectField
            label="Thinking"
            options={thinkingOptions}
            value={value.thinkingOptionIds}
            onChange={changeThinking}
            disabled={disabled || !isCompleteSelection(value.modelIds)}
            allLabel="All available Thinking"
            placeholder="Choose Thinking"
            searchPlaceholder="Search Thinking options"
          />
        </>
      ) : null}
    </View>
  );
}

/** Thinking options offered by any selected Model; a grant may span Models. */
function useThinkingOptions(
  provider: AgentConfigurationCatalog["providers"][number] | undefined,
  modelIds: MultiSelection | null,
): SelectFieldOption<string>[] {
  return useMemo(() => {
    const models = (provider?.models ?? []).filter(
      ({ id }) => modelIds === "*" || (Array.isArray(modelIds) && modelIds.includes(id)),
    );
    const byId = new Map<string, SelectFieldOption<string>>();
    for (const model of models) {
      for (const option of model.thinkingOptions) {
        byId.set(option.id, {
          id: option.id,
          value: option.id,
          label: option.label,
          description: option.id,
        });
      }
    }
    return [...byId.values()];
  }, [modelIds, provider]);
}
