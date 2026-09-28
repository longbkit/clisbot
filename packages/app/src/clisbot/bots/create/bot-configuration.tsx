import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import type { AgentProfile } from "@getpaseo/protocol/agent-profile";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import type { BotFormModel, BotFormState } from "./bot-form-model";
import type { useBotProviderSnapshot } from "./use-bot-provider-snapshot";
import { botFormStyles as styles } from "./bot-form-styles";
interface Props {
  state: BotFormState;
  model: BotFormModel;
  size: "sm" | "md";
  providerSnapshot: ReturnType<typeof useBotProviderSnapshot>;
  hosts: { serverId: string; label: string }[];
  expanded?: boolean;
  onCustomize?: () => void;
}
export function BotConfiguration({
  state,
  model,
  size,
  providerSnapshot,
  hosts,
  expanded = false,
  onCustomize,
}: Props) {
  const modelLabel =
    state.selectedModelDisplay?.label ??
    (providerSnapshot.isLoading ? "Loading models…" : "Provider default model");
  const unresolvedSummary = providerSnapshot.isLoading
    ? "Checking available models…"
    : "Choose a model to continue";
  const summary = state.selectedProvider
    ? `${
        state.modelSelectorProviders.find((provider) => provider.id === state.selectedProvider)
          ?.label ?? state.selectedProvider
      } · ${modelLabel}`
    : unresolvedSummary;
  return (
    <>
      {!expanded ? (
        <View style={styles.configuration}>
          <View style={styles.configurationHeader}>
            <Text style={styles.text}>AI configuration</Text>
            <Button variant="ghost" size={size} onPress={onCustomize}>
              {state.selectedProvider ? "Customize" : "Choose setup"}
            </Button>
          </View>
          <Text style={styles.summary}>{state.selectedHostDisplay?.label ?? "Choose a Host"}</Text>
          <Text style={styles.summary}>{summary}</Text>
          <Text style={styles.hint}>
            {[state.selectedModeDisplay.label, state.selectedThinkingDisplay?.label]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </View>
      ) : null}
      {expanded ? (
        <>
          {state.showHostField ? (
            <SelectField
              label="Host"
              value={state.selectedServerId}
              selectedDisplay={state.selectedHostDisplay}
              options={hosts.map((host) => ({
                id: host.serverId,
                value: host.serverId,
                label: host.label,
              }))}
              onChange={model.setHost}
              placeholder="Choose a Host"
              emptyText="No eligible Hosts connected"
              size={size}
            />
          ) : null}
          <BotProfiles model={model} serverId={state.selectedServerId} size={size} />
          <BotLaunchFields state={state} model={model} providerSnapshot={providerSnapshot} />
        </>
      ) : null}
    </>
  );
}
function BotLaunchFields({
  state,
  model,
  providerSnapshot,
}: Pick<Props, "state" | "model" | "providerSnapshot">) {
  return (
    <>
      <Text style={styles.text}>Provider / model</Text>
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
      />
      {state.modeOptions.length ? (
        <SelectField
          label="Permission mode"
          value={state.selectedMode}
          selectedDisplay={state.selectedModeDisplay}
          options={state.modeOptions.map((option) => ({
            id: option.id,
            value: option.id,
            label: option.label,
          }))}
          onChange={model.setMode}
          placeholder="Choose permissions"
          emptyText="No permission modes available"
        />
      ) : null}
      {state.availableThinkingOptions.length ? (
        <SelectField
          label="Thinking"
          value={state.selectedThinkingOptionId}
          selectedDisplay={state.selectedThinkingDisplay}
          options={state.availableThinkingOptions.map((option) => ({
            id: option.id,
            value: option.id,
            label: option.label ?? option.id,
          }))}
          onChange={model.setThinkingOption}
          placeholder="Choose thinking level"
          emptyText="No thinking options available"
        />
      ) : null}
    </>
  );
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
      hint="Fill in saved model, permissions and thinking settings. Your Bot template stays unchanged."
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
