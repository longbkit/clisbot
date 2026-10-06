import { useMemo } from "react";
import { Text } from "react-native";
import { Alert } from "@/components/ui/alert";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { settingsStyles } from "@/styles/settings";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { SetupCard, SetupRowView } from "@/clisbot/bots/create/bot-setup-card";
import { botLaunchLabels } from "@/clisbot/bots/sidebar/display/row-detail";
import type { RouteBotOption } from "../channel-route-bot";

/**
 * "Start or continue a Bot": the Bot is picked, and what it runs is the Bot's, shown read-only.
 * Host, Project, folder and AI configuration belong to the Bot, so the Route form asks none of them.
 */
export function BotTargetFields({
  options,
  loading,
  selected,
  onChange,
  launchChanged,
  replacesRouteDefault,
  pending,
}: {
  options: readonly RouteBotOption[];
  loading: boolean;
  selected: RouteBotOption | null;
  onChange(key: string | null): void;
  /** Editing a Route whose saved launch settings differ from the Bot's now. */
  launchChanged: boolean;
  /** The Route being edited runs a model chosen in a conversation, which saving removes. */
  replacesRouteDefault: boolean;
  pending: boolean;
}) {
  const selectOptions = useMemo<SelectFieldOption<string>[]>(
    () => options.map(botSelectOption),
    [options],
  );
  const selectedDisplay = useMemo(
    () => (selected === null ? null : botSelectOption(selected)),
    [selected],
  );
  return (
    <>
      <SelectField
        label="Bot"
        value={selected?.key ?? null}
        selectedDisplay={selectedDisplay}
        options={selectOptions}
        onChange={onChange}
        placeholder={loading ? "Loading Bots…" : "Choose a Bot"}
        emptyText={loading ? "Loading Bots…" : NO_BOTS}
        searchable={selectOptions.length > 6}
        title="Bot"
        disabled={pending}
      />
      {selected === null ? null : <BotLaunchSummary option={selected} />}
      {selected !== null && launchChanged ? (
        <Alert
          variant="info"
          title={`${selected.bot.name}'s AI configuration changed since this Route was saved`}
          description={`Saving runs what ${selected.bot.name} has now.`}
        />
      ) : null}
      {selected !== null && replacesRouteDefault ? (
        <Alert
          variant="info"
          title="This Route runs a model chosen in a conversation"
          description={`Saving goes back to ${selected.bot.name}'s AI configuration.`}
        />
      ) : null}
    </>
  );
}

const NO_BOTS = "No Bot runs on a Host this Hub has enrolled.";

function botSelectOption(option: RouteBotOption): SelectFieldOption<string> {
  const role = option.bot.description?.trim();
  return {
    id: option.key,
    value: option.key,
    label: option.bot.name,
    description: role ? `${option.serverName} · ${role}` : option.serverName,
  };
}

/** The Bot's Host and launch settings, named the way the Bot's own form names them. */
function BotLaunchSummary({ option }: { option: RouteBotOption }) {
  const launch = option.bot.launchDefaults;
  const { entries } = useProvidersSnapshot(option.serverId);
  const entry = entries?.find((candidate) => candidate.provider === launch.provider);
  const labels = botLaunchLabels(launch, entry);
  const model = [labels.provider, labels.model].filter(Boolean).join(" · ");
  return (
    <>
      <SetupCard>
        <ReadOnlySetupRow label="Host" value={option.serverName} first />
        <ReadOnlySetupRow label="Model" value={model} />
        <ReadOnlySetupRow label="Permissions" value={labels.mode} />
        <ReadOnlySetupRow label="Thinking" value={labels.thinking} last />
      </SetupCard>
      <Text style={settingsStyles.rowHint}>
        {`Runs in ${option.bot.name}'s folder and keeps every conversation in its Workspace. Change what it runs in ${option.bot.name}'s Bot settings.`}
      </Text>
    </>
  );
}

function ReadOnlySetupRow({
  label,
  value,
  first,
  last,
}: {
  label: string;
  value: string | null | undefined;
  first?: boolean;
  last?: boolean;
}) {
  return (
    <SetupRowView
      label={label}
      value={value || "Default"}
      placeholder={!value}
      first={first === true}
      last={last === true}
      interactive={false}
      highlighted={false}
    />
  );
}
