import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { AgentProfile } from "@getpaseo/protocol/agent-profile";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { Field } from "@/components/ui/form-field";
import { SelectField, SelectFieldTrigger } from "@/components/ui/select-field";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import { getProviderIcon } from "@/components/provider-icons";
import type { BotFormModel, BotFormState } from "./bot-form-model";
import type { useBotProviderSnapshot } from "./use-bot-provider-snapshot";

interface Props {
  state: BotFormState;
  model: BotFormModel;
  size: "sm" | "md";
  providerSnapshot: ReturnType<typeof useBotProviderSnapshot>;
  hosts: { serverId: string; label: string }[];
}

/** How the bot runs: Host (only when there is a choice), Model, then Permissions and Thinking. */
export function BotConfiguration({ state, model, size, providerSnapshot, hosts }: Props) {
  const hostOptions = useMemo(
    () => hosts.map((host) => ({ id: host.serverId, value: host.serverId, label: host.label })),
    [hosts],
  );
  return (
    <>
      {state.showHostField ? (
        <SelectField
          label="Host"
          value={state.selectedServerId}
          selectedDisplay={state.selectedHostDisplay}
          options={hostOptions}
          onChange={model.setHost}
          placeholder="Choose a Host"
          emptyText="No eligible Hosts connected"
          size={size}
        />
      ) : null}
      <BotProfiles model={model} serverId={state.selectedServerId} size={size} />
      <BotModelField state={state} model={model} size={size} providerSnapshot={providerSnapshot} />
      <BotRunOptions state={state} model={model} size={size} />
    </>
  );
}

/** Provider and model in one picker; the trigger names both, with the provider's icon. */
function BotModelField({ state, model, size, providerSnapshot }: Omit<Props, "hosts">) {
  const providerLabel =
    state.modelSelectorProviders.find((provider) => provider.id === state.selectedProvider)
      ?.label ?? state.selectedProvider;
  const leading = useMemo(
    () =>
      state.selectedProvider ? (
        <ProviderIcon provider={state.selectedProvider} serverId={state.selectedServerId} />
      ) : null,
    [state.selectedProvider, state.selectedServerId],
  );
  const renderTrigger = useCallback(
    (input: {
      selectedModelLabel: string;
      disabled: boolean;
      isOpen: boolean;
      hovered: boolean;
      pressed: boolean;
    }): ReactNode => {
      const modelLabel = state.selectedModelDisplay?.label ?? input.selectedModelLabel;
      const label = providerLabel ? `${providerLabel} · ${modelLabel}` : undefined;
      return (
        <SelectFieldTrigger
          label={label}
          isPlaceholder={!providerLabel}
          placeholder={providerSnapshot.isLoading ? "Checking available models…" : "Choose a model"}
          leading={leading}
          loading={providerSnapshot.isLoading && !providerLabel}
          disabled={input.disabled}
          active={input.hovered || input.pressed || input.isOpen}
          size={size}
          testID="bot-model-trigger"
        />
      );
    },
    [leading, providerLabel, providerSnapshot.isLoading, size, state.selectedModelDisplay],
  );
  return (
    <Field
      label="Model"
      hint={state.showHostField ? undefined : hostHint(state.selectedHostDisplay?.label)}
    >
      <CombinedModelSelector
        providers={state.modelSelectorProviders}
        selectedProvider={state.selectedProvider ?? ""}
        selectedModel={state.selectedModel}
        onSelect={model.setModel}
        isLoading={providerSnapshot.isLoading}
        onOpen={providerSnapshot.onOpen}
        onRetryProvider={providerSnapshot.onRetryProvider}
        isRetryingProvider={providerSnapshot.isRefreshing}
        serverId={state.selectedServerId}
        renderTrigger={renderTrigger}
        triggerFill
      />
    </Field>
  );
}

function hostHint(host: string | undefined): string | undefined {
  return host ? `Runs on ${host}.` : undefined;
}

/** Permissions and Thinking side by side: both are short choices the model decides. */
function BotRunOptions({ state, model, size }: Pick<Props, "state" | "model" | "size">) {
  const modeOptions = useMemo(
    () =>
      state.modeOptions.map((option) => ({ id: option.id, value: option.id, label: option.label })),
    [state.modeOptions],
  );
  const thinkingOptions = useMemo(
    () =>
      state.availableThinkingOptions.map((option) => ({
        id: option.id,
        value: option.id,
        label: option.label ?? option.id,
      })),
    [state.availableThinkingOptions],
  );
  if (!modeOptions.length && !thinkingOptions.length) return null;
  return (
    <View style={styles.pair}>
      {modeOptions.length ? (
        <View style={styles.half}>
          <SelectField
            label="Permissions"
            value={state.selectedMode}
            selectedDisplay={state.selectedModeDisplay}
            options={modeOptions}
            onChange={model.setMode}
            placeholder="Choose permissions"
            emptyText="No permission modes available"
            size={size}
          />
        </View>
      ) : null}
      {thinkingOptions.length ? (
        <View style={styles.half}>
          <SelectField
            label="Thinking"
            value={state.selectedThinkingOptionId}
            selectedDisplay={state.selectedThinkingDisplay}
            options={thinkingOptions}
            onChange={model.setThinkingOption}
            placeholder="Choose thinking level"
            emptyText="No thinking options available"
            size={size}
          />
        </View>
      ) : null}
    </View>
  );
}

function ProviderIcon({ provider, serverId }: { provider: string; serverId: string | null }) {
  const Icon = getProviderIcon(provider, serverId);
  return <Icon size={16} color={styles.icon.color} />;
}

function useBotProfiles(serverId: string | null) {
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  useEffect(() => {
    let current = true;
    setProfiles([]);
    const client = serverId ? getHostRuntimeStore().getClient(serverId) : null;
    if (client)
      void client
        .getDaemonConfig()
        .then((result) => {
          if (current) setProfiles(result.config.agentProfiles ?? []);
          return undefined;
        })
        .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [serverId]);
  return profiles;
}

function BotProfiles({
  model,
  serverId,
  size,
}: {
  model: BotFormModel;
  serverId: string | null;
  size: "sm" | "md";
}) {
  const profiles = useBotProfiles(serverId);
  const apply = useCallback(
    (id: string) => {
      const profile = profiles.find((item) => item.id === id);
      if (profile) {
        model.applyProfile(profile);
      }
    },
    [model, profiles],
  );
  if (!profiles.length) return null;
  return (
    <SelectField
      label="Apply agent profile"
      hint="Fill in saved model, permissions and thinking settings. The template stays unchanged."
      value={null}
      selectedDisplay={null}
      options={profiles.map((profile) => ({
        id: profile.id,
        value: profile.id,
        label: profile.name,
      }))}
      onChange={apply}
      placeholder="Use saved AI settings…"
      emptyText="No saved profiles"
      size={size}
      searchable
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  pair: { flexDirection: "row", gap: theme.spacing[3] },
  half: { flex: 1, minWidth: 0 },
  icon: { color: theme.colors.foregroundMuted },
}));
