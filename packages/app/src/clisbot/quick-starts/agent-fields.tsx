import { useCallback, useEffect, useMemo } from "react";
import { Text, View } from "react-native";
import type { BotLaunchDefaults } from "@clisbot/protocol/bots/types";
import { Field } from "@/components/ui/form-field";
import { SelectField, SelectFieldTrigger } from "@/components/ui/select-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { buildSelectableProviderSelectorProviders } from "@/provider-selection/provider-selection";
import { formatThinkingOptionLabel, formatAgentModeLabel } from "@/agent-controls/labels";
import type { FieldControlSize } from "@/components/ui/control-geometry";
import type { QuickStartForm, QuickStartFormState } from "./form-model";
import { ProviderFeatureFields } from "./feature-fields";
import { useQuickStartPicker } from "./picker-scope";
import { styles } from "./styles";
const OPTIONS: { value: "default" | "configured"; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "configured", label: "Custom" },
];
interface Props {
  form: QuickStartForm;
  state: QuickStartFormState;
  serverId: string;
  cwd?: string;
  size: FieldControlSize;
  disabled: boolean;
}
export function AgentFields(props: Props) {
  const { form, state, serverId, cwd, size, disabled } = props;
  const snapshot = useProvidersSnapshot(serverId, { cwd });
  useEffect(() => {
    if (snapshot.entries) form.applyProviders(snapshot.entries);
  }, [snapshot.entries, form]);
  const config = state.input.agent.kind === "configured" ? state.input.agent.config : null;
  const setKind = useCallback((kind: "default" | "configured") => form.setAgentKind(kind), [form]);
  const change = useCallback(
    (next: BotLaunchDefaults) =>
      form.change({
        ...state.input,
        agent: { kind: "configured", config: next },
      }),
    [form, state.input],
  );
  return (
    <View style={styles.group}>
      <Field label="Agent configuration">
        <SegmentedControl
          options={OPTIONS.map((option) => Object.assign({}, option, { disabled }))}
          value={state.input.agent.kind}
          onValueChange={setKind}
          size={size}
          variant="track"
        />
      </Field>
      {config ? (
        <ConfiguredAgent {...props} config={config} change={change} snapshot={snapshot} />
      ) : (
        <Text style={styles.detail}>
          {state.input.target.kind === "bot"
            ? "Use this bot’s defaults when starting"
            : "Use your chat defaults on the device you start from"}
        </Text>
      )}
      {config ? (
        <ProviderFeatureFields
          serverId={serverId}
          cwd={cwd}
          config={config}
          onChange={change}
          size={size}
          disabled={disabled}
        />
      ) : null}
    </View>
  );
}
function ConfiguredAgent({
  config,
  change,
  snapshot,
  serverId,
  size,
  disabled,
}: Props & {
  config: BotLaunchDefaults;
  change: (config: BotLaunchDefaults) => void;
  snapshot: ReturnType<typeof useProvidersSnapshot>;
}) {
  const modelPicker = useQuickStartPicker("model");
  const providers = useMemo(
    () => buildSelectableProviderSelectorProviders(snapshot.entries),
    [snapshot.entries],
  );
  const providerEntry = snapshot.entries?.find((e) => e.provider === config.provider);
  const modelEntry =
    providerEntry?.models?.find((m) => m.id === config.model) ??
    (!config.model
      ? (providerEntry?.models?.find((m) => m.isDefault) ?? providerEntry?.models?.[0])
      : undefined);
  const select = useCallback(
    (provider: string, model: string) =>
      change({
        provider,
        model: model || undefined,
        ...(provider === config.provider ? { modeId: config.modeId } : {}),
      }),
    [change, config.provider, config.modeId],
  );
  const renderTrigger = useCallback(
    (input: {
      selectedModelLabel: string;
      hovered: boolean;
      pressed: boolean;
      isOpen: boolean;
    }) => (
      <ModelTrigger
        label={
          input.selectedModelLabel || config.model || config.provider || "Select agent and model"
        }
        size={size}
        hovered={input.hovered}
        active={input.isOpen || input.pressed}
        disabled={disabled}
      />
    ),
    [size, config.model, config.provider, disabled],
  );
  const open = useCallback(
    () => snapshot.refetchIfStale(config.provider),
    [snapshot, config.provider],
  );
  const retry = useCallback(
    (provider: string) => {
      void snapshot.refresh([provider]);
    },
    [snapshot],
  );
  return (
    <>
      <Field label="Agent and model" error={snapshot.error}>
        <CombinedModelSelector
          {...modelPicker}
          desktopPlacement="top-start"
          providers={providers}
          selectedProvider={config.provider}
          selectedModel={config.model ?? ""}
          onSelect={select}
          isLoading={snapshot.isLoading}
          serverId={serverId}
          renderTrigger={renderTrigger}
          triggerFill
          onOpen={open}
          onRetryProvider={retry}
          isRetryingProvider={snapshot.isRefreshing}
          disabled={disabled}
        />
      </Field>
      <LaunchOptions
        config={config}
        change={change}
        providerEntry={providerEntry}
        modelEntry={modelEntry}
        size={size}
        disabled={disabled}
      />
    </>
  );
}
function LaunchOptions({
  config,
  change,
  providerEntry,
  modelEntry,
  size,
  disabled,
}: {
  config: BotLaunchDefaults;
  change: (next: BotLaunchDefaults) => void;
  providerEntry?: import("@clisbot/protocol/agent-types").ProviderSnapshotEntry;
  modelEntry?: import("@clisbot/protocol/agent-types").AgentModelDefinition;
  size: FieldControlSize;
  disabled: boolean;
}) {
  const thinking = (modelEntry?.thinkingOptions ?? []).map((o) => ({
    id: o.id,
    value: o.id,
    label: formatThinkingOptionLabel(o),
  }));
  const modes = (providerEntry?.modes ?? []).map((o) => ({
    id: o.id,
    value: o.id,
    label: formatAgentModeLabel(o),
  }));
  const mode = useCallback(
    (modeId: string) =>
      change({
        ...config,
        modeId: modeId || undefined,
        featureValues: undefined,
      }),
    [config, change],
  );
  const effort = useCallback(
    (thinkingOptionId: string) =>
      change({ ...config, thinkingOptionId: thinkingOptionId || undefined }),
    [config, change],
  );
  return (
    <>
      {thinking.length || config.thinkingOptionId ? (
        <ConfigurationSelect
          label="Effort"
          value={config.thinkingOptionId}
          options={thinking}
          onChange={effort}
          size={size}
          disabled={disabled}
        />
      ) : null}
      {modes.length || config.modeId ? (
        <ConfigurationSelect
          label="Permission mode"
          value={config.modeId}
          options={modes}
          onChange={mode}
          size={size}
          disabled={disabled}
        />
      ) : null}
    </>
  );
}
function ModelTrigger({
  label,
  ...props
}: {
  label: string;
  size: FieldControlSize;
  hovered: boolean;
  active: boolean;
  disabled: boolean;
}) {
  const display = useMemo(() => ({ label }), [label]);
  return <SelectFieldTrigger {...props} display={display} placeholder="Select agent and model" />;
}
function ConfigurationSelect({
  label,
  value,
  options,
  onChange,
  size,
  disabled,
}: {
  label: string;
  value?: string;
  options: { id: string; value: string; label: string }[];
  onChange: (value: string) => void;
  size: FieldControlSize;
  disabled: boolean;
}) {
  const picker = useQuickStartPicker(label);
  const display = useMemo(
    () => ({
      label: options.find((o) => o.id === value)?.label ?? value ?? "Provider default",
    }),
    [options, value],
  );
  const allOptions = [{ id: "", value: "", label: "Provider default" }, ...options];
  return (
    <SelectField
      {...picker}
      label={label}
      triggerTestID={label === "Effort" ? "quick-start-effort" : "quick-start-mode"}
      title={label}
      value={value ?? ""}
      selectedDisplay={display}
      options={allOptions}
      onChange={onChange}
      placeholder="Provider default"
      emptyText="No options available"
      size={size}
      disabled={disabled}
    />
  );
}
