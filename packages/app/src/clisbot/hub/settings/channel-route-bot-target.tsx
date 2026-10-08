import { useMemo } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const loadingText = t("hub.routes.bot.loading");
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
        label={t("hub.routes.bot.label")}
        value={selected?.key ?? null}
        selectedDisplay={selectedDisplay}
        options={selectOptions}
        onChange={onChange}
        placeholder={loading ? loadingText : t("hub.routes.bot.choose")}
        emptyText={loading ? loadingText : t("hub.routes.bot.none")}
        searchable={selectOptions.length > 6}
        title={t("hub.routes.bot.label")}
        disabled={pending}
      />
      {selected === null ? null : <BotLaunchSummary option={selected} />}
      {selected !== null && launchChanged ? (
        <Alert
          variant="info"
          title={t("hub.routes.bot.launchChangedTitle", { bot: selected.bot.name })}
          description={t("hub.routes.bot.launchChangedDescription", { bot: selected.bot.name })}
        />
      ) : null}
      {selected !== null && replacesRouteDefault ? (
        <Alert
          variant="info"
          title={t("hub.routes.bot.routeDefaultTitle")}
          description={t("hub.routes.bot.routeDefaultDescription", { bot: selected.bot.name })}
        />
      ) : null}
    </>
  );
}

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
  const { t } = useTranslation();
  const launch = option.bot.launchDefaults;
  const { entries } = useProvidersSnapshot(option.serverId);
  const entry = entries?.find((candidate) => candidate.provider === launch.provider);
  const labels = botLaunchLabels(launch, entry);
  const model = [labels.provider, labels.model].filter(Boolean).join(" · ");
  return (
    <>
      <SetupCard>
        <ReadOnlySetupRow label={t("hub.routes.bot.host")} value={option.serverName} first />
        <ReadOnlySetupRow label={t("hub.routes.bot.model")} value={model} />
        <ReadOnlySetupRow label={t("hub.routes.bot.permissions")} value={labels.mode} />
        <ReadOnlySetupRow label={t("hub.routes.bot.thinking")} value={labels.thinking} last />
      </SetupCard>
      <Text style={settingsStyles.rowHint}>
        {t("hub.routes.bot.runsIn", { bot: option.bot.name })}
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
  const { t } = useTranslation();
  return (
    <SetupRowView
      label={label}
      value={value || t("hub.routes.common.default")}
      placeholder={!value}
      first={first === true}
      last={last === true}
      interactive={false}
      highlighted={false}
    />
  );
}
