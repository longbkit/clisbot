import { useCallback, useEffect, useMemo, useState } from "react";
import type { PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { AgentProfile } from "@clisbot/protocol/agent-profile";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { Field } from "@/components/ui/form-field";
import { SelectField } from "@/components/ui/select-field";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import { getProviderIcon } from "@/components/provider-icons";
import type { BotFormModel, BotFormState } from "./bot-form-model";
import type { useBotProviderSnapshot } from "./use-bot-provider-snapshot";
import { SetupCard, SetupRowView, SetupSelectRow } from "./bot-setup-rows";

interface Props {
  state: BotFormState;
  model: BotFormModel;
  size: "sm" | "md";
  providerSnapshot: ReturnType<typeof useBotProviderSnapshot>;
  hosts: { serverId: string; label: string }[];
}

/**
 * How the bot runs, as one card of labeled rows: Host, Model, Permissions, Thinking. Every row is
 * always shown; a row with nothing to choose shows the value the bot will use.
 */
export function BotConfiguration({ state, model, size, providerSnapshot, hosts }: Props) {
  return (
    <>
      <Field label="AI configuration">
        <SetupCard>
          <HostRow state={state} model={model} hosts={hosts} />
          <ModelRow state={state} model={model} providerSnapshot={providerSnapshot} />
          <PermissionsRow state={state} model={model} />
          <ThinkingRow state={state} model={model} />
        </SetupCard>
      </Field>
      <BotProfiles model={model} serverId={state.selectedServerId} size={size} />
    </>
  );
}

function HostRow({ state, model, hosts }: Pick<Props, "state" | "model" | "hosts">) {
  const options = useMemo(
    () => hosts.map((host) => ({ id: host.serverId, label: host.label })),
    [hosts],
  );
  const choose = useCallback(
    (id: string) => {
      const host = hosts.find((entry) => entry.serverId === id);
      model.setHost(id, host ? { label: host.label } : null);
    },
    [hosts, model],
  );
  return (
    <SetupSelectRow
      label="Host"
      first
      value={state.selectedHostDisplay?.label ?? "Choose a Host"}
      placeholder={!state.selectedHostDisplay}
      options={options}
      selectedId={state.selectedServerId}
      onChange={choose}
      emptyText="No eligible Hosts connected"
      testID="bot-host-row"
    />
  );
}

/** Provider and model in one picker: the row names both, with the provider's icon. */
function ModelRow({ state, model, providerSnapshot }: Omit<Props, "hosts" | "size">) {
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
    (
      input: { selectedModelLabel: string; isOpen: boolean } & PressableStateCallbackType & {
          hovered: boolean;
        },
    ) => {
      const modelLabel = state.selectedModelDisplay?.label ?? input.selectedModelLabel;
      const empty = providerSnapshot.isLoading ? "Checking available models…" : "Choose a model";
      return (
        <SetupRowView
          label="Model"
          value={providerLabel ? `${providerLabel} · ${modelLabel}` : empty}
          placeholder={!providerLabel}
          leading={leading}
          interactive
          highlighted={input.hovered || input.pressed || input.isOpen}
          testID="bot-model-trigger"
        />
      );
    },
    [leading, providerLabel, providerSnapshot.isLoading, state.selectedModelDisplay],
  );
  return (
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
  );
}

function PermissionsRow({ state, model }: Pick<Props, "state" | "model">) {
  const options = useMemo(
    () => state.modeOptions.map((option) => ({ id: option.id, label: option.label })),
    [state.modeOptions],
  );
  return (
    <SetupSelectRow
      label="Permissions"
      value={state.selectedModeDisplay.label}
      options={options}
      selectedId={state.selectedMode}
      onChange={model.setMode}
      emptyText="No permission modes available"
      testID="bot-permissions-row"
    />
  );
}

function ThinkingRow({ state, model }: Pick<Props, "state" | "model">) {
  const options = useMemo(
    () =>
      state.availableThinkingOptions.map((option) => ({
        id: option.id,
        label: option.label ?? option.id,
      })),
    [state.availableThinkingOptions],
  );
  return (
    <SetupSelectRow
      label="Thinking"
      value={state.selectedThinkingDisplay?.label ?? "Model default"}
      options={options}
      selectedId={state.selectedThinkingOptionId}
      onChange={model.setThinkingOption}
      emptyText="No thinking options available"
      last
      testID="bot-thinking-row"
    />
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
  icon: { color: theme.colors.foregroundMuted },
}));
