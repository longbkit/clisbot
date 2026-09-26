import type { BotPayload } from "../data/contracts";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import { ChoiceButton } from "./choice-button";
import type { AgentProfile } from "@getpaseo/protocol/agent-profile";
import { FormTextInput } from "@/components/ui/form-field";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { openBotForm, toCreateRequest, toUpdateRequest } from "./bot-form-model";
import { refreshBotsAndChats } from "../data/runtime";

export function BotCreateForm({
  name,
  defaultServerId,
  bot,
  hosts,
  onCreated,
  onCancel,
}: {
  name: string;
  defaultServerId?: string;
  bot?: BotPayload;
  hosts: { serverId: string; label: string }[];
  onCreated: (serverId: string, botId: string) => void;
  onCancel: () => void;
}) {
  const [model] = useState(() =>
    openBotForm({
      mode: bot ? "edit" : "create",
      bot,
      hosts,
      defaults: { name, ...(defaultServerId ? { serverId: defaultServerId } : {}) },
    }),
  );
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => model.close(), [model]);
  useEffect(() => model.applyHosts(hosts), [hosts, model]);
  useEffect(() => {
    const serverId = state.selectedServerId;
    if (!serverId) return;
    let current = true;
    const client = getHostRuntimeStore().getClient(serverId);
    if (client)
      void client
        .getProvidersSnapshot()
        .then((snapshot) => {
          if (current) model.applyProviderSnapshot(serverId, snapshot);
          return undefined;
        })
        .catch((error) => model.setSubmitError(String(error)));
    setProfiles([]);
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
  }, [model, state.selectedServerId]);
  const submit = useCallback(async () => {
    setBusy(true);
    model.setSubmitError(null);
    try {
      const { serverId, ...request } = toCreateRequest(state);
      const client = getHostRuntimeStore().getClient(serverId);
      if (!client) throw new Error("Host is disconnected");
      const { serverId: _serverId, ...update } = toUpdateRequest(state, bot?.id ?? "");
      const result = bot ? await client.updateBot(update) : await client.createBot(request);
      if (result.error || !result.bot) throw new Error(result.error ?? "Bot could not be created");
      refreshBotsAndChats();
      onCreated(serverId, result.bot.id);
    } catch (error) {
      model.setSubmitError(String(error));
    } finally {
      setBusy(false);
    }
  }, [state, model, onCreated, bot]);
  const selectProfile = useCallback(
    (id: string) => {
      const profile = profiles.find((p) => p.id === id);
      if (profile) model.applyProfile(profile);
    },
    [model, profiles],
  );
  const submitAction = useCallback(() => {
    void submit();
  }, [submit]);
  const submitLabel = bot ? "Save bot" : "Create bot";
  return (
    <View style={styles.form}>
      <Text style={styles.title}>{bot ? "Bot settings" : "New bot"}</Text>
      <FormTextInput
        accessibilityLabel="Bot name"
        style={styles.input}
        initialValue={state.name}
        onChangeText={model.setName}
        placeholder="Name"
      />
      {state.showHostField ? (
        <View style={styles.row}>
          {hosts.map((host) => (
            <ChoiceButton
              key={host.serverId}
              value={host.serverId}
              selected={state.selectedServerId === host.serverId}
              onSelect={model.setHost}
            >
              {host.label}
            </ChoiceButton>
          ))}
        </View>
      ) : null}
      <View style={styles.row}>
        {profiles.map((profile) => (
          <ChoiceButton key={profile.id} value={profile.id} onSelect={selectProfile}>
            {profile.name}
          </ChoiceButton>
        ))}
      </View>
      <Text style={styles.text}>Provider</Text>
      <View style={styles.row}>
        {state.modelSelectorProviders.map((provider) => (
          <ChoiceButton
            key={provider.id}
            value={provider.id}
            selected={state.selectedProvider === provider.id}
            onSelect={model.setProvider}
          >
            {provider.label}
          </ChoiceButton>
        ))}
      </View>
      <CombinedModelSelector
        providers={state.modelSelectorProviders}
        selectedProvider={state.selectedProvider ?? ""}
        selectedModel={state.selectedModel}
        onSelect={model.setModel}
        isLoading={Boolean(state.providerSnapshotRequest)}
        serverId={state.selectedServerId}
      />
      <View style={styles.row}>
        {state.modeOptions.map((mode) => (
          <ChoiceButton
            key={mode.id}
            value={mode.id}
            selected={state.selectedMode === mode.id}
            onSelect={model.setMode}
          >
            {mode.label}
          </ChoiceButton>
        ))}
      </View>
      <View style={styles.row}>
        {state.availableThinkingOptions.map((option) => (
          <ChoiceButton
            key={option.id}
            value={option.id}
            selected={state.selectedThinkingOptionId === option.id}
            onSelect={model.setThinkingOption}
          >
            {option.label ?? option.id}
          </ChoiceButton>
        ))}
      </View>
      {!bot ? (
        <View style={styles.row}>
          {(["personal", "team"] as const).map((kind) => (
            <ChoiceButton
              key={kind}
              value={kind}
              selected={state.kind === kind}
              onSelect={model.setKind}
            >
              {kind === "personal" ? "Personal memory" : "Team memory"}
            </ChoiceButton>
          ))}
        </View>
      ) : null}
      {state.submitError ? (
        <Text accessibilityRole="alert" style={styles.text}>
          {state.submitError}
        </Text>
      ) : null}
      <View style={styles.row}>
        <Button disabled={!state.canSubmit || busy} onPress={submitAction}>
          {busy ? "Saving…" : submitLabel}
        </Button>
        <Button variant="ghost" onPress={onCancel}>
          Cancel
        </Button>
      </View>
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  form: { padding: theme.spacing[4], gap: theme.spacing[3] },
  title: { color: theme.colors.foreground, fontSize: theme.fontSize.lg },
  text: { color: theme.colors.foreground },
  input: {
    color: theme.colors.foreground,
    borderColor: theme.colors.surface2,
    borderWidth: 1,
    borderRadius: 8,
    padding: theme.spacing[3],
  },
  row: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
}));
