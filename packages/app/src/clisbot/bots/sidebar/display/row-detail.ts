// The second line of a bot or group chat row in the sidebar, from the items the user shows. Pure.
import type { ProviderSnapshotEntry } from "@clisbot/protocol/agent-types";
import { formatThinkingOptionLabel } from "@/agent-controls/labels";
import type { BotRowItem, ChatRowItem } from "./preferences";

export interface BotLaunch {
  provider?: string | null;
  model?: string | null;
  modeId?: string | null;
  thinkingOptionId?: string | null;
}

const SEPARATOR = " · ";

/**
 * Host, provider, model, permission mode, thinking and role, in that order, for the items shown.
 * `entry` is the Host's provider snapshot for the bot's provider: it names each value, and a value
 * the bot leaves unset shows as the default it will run with. Without it the stored ids stand in.
 */
export function botRowDetail(
  bot: { hostName?: string; description?: string | null; launch?: BotLaunch },
  items: Readonly<Record<BotRowItem, boolean>>,
  entry?: ProviderSnapshotEntry,
): string | null {
  const parts: Record<BotRowItem, string | null | undefined> = {
    host: bot.hostName,
    ...botLaunchLabels(bot.launch ?? {}, entry),
    role: bot.description?.trim(),
  };
  return joinShown(parts, items);
}

type SnapshotModel = NonNullable<ProviderSnapshotEntry["models"]>[number];

/** Provider, model, permission mode and thinking, named from the Host's provider snapshot. */
export function botLaunchLabels(
  launch: BotLaunch,
  entry: ProviderSnapshotEntry | undefined,
): Record<"provider" | "model" | "mode" | "thinking", string | null | undefined> {
  const model = effectiveModel(launch.model, entry);
  const modeId = launch.modeId || entry?.defaultModeId || entry?.modes?.[0]?.id;
  const thinkingId = launch.thinkingOptionId || defaultThinking(model);
  return {
    provider: launch.provider ? (entry?.label ?? launch.provider) : null,
    model: model?.label ?? launch.model,
    mode: modeId
      ? (entry?.modes?.find((mode) => mode.id === modeId)?.label ?? readable(modeId))
      : null,
    thinking: thinkingId ? thinkingLabel(thinkingId, model) : null,
  };
}

function effectiveModel(
  id: string | null | undefined,
  entry: ProviderSnapshotEntry | undefined,
): SnapshotModel | undefined {
  const models = entry?.models ?? [];
  if (id) return models.find((candidate) => candidate.id === id);
  return models.find((candidate) => candidate.isDefault) ?? models[0];
}

function defaultThinking(model: SnapshotModel | undefined): string | undefined {
  return (
    model?.defaultThinkingOptionId ?? model?.thinkingOptions?.find((option) => option.isDefault)?.id
  );
}

/** Host, member count and member names, for the items shown. */
export function chatRowDetail(
  chat: { hostName?: string; memberNames: readonly string[] },
  items: Readonly<Record<ChatRowItem, boolean>>,
): string | null {
  const count = chat.memberNames.length;
  return joinShown(
    {
      host: chat.hostName,
      memberCount: `${count} ${count === 1 ? "bot" : "bots"}`,
      members: chat.memberNames.join(", "),
    },
    items,
  );
}

function thinkingLabel(
  id: string,
  model: { thinkingOptions?: readonly { id: string; label?: string }[] } | undefined,
): string {
  const option = model?.thinkingOptions?.find((candidate) => candidate.id === id) ?? { id };
  return formatThinkingOptionLabel(option);
}

/** An id the snapshot does not name, such as Codex's `auto-review` when it is not offered. */
function readable(id: string): string {
  const words = id.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function joinShown<K extends string>(
  parts: Record<K, string | null | undefined>,
  items: Readonly<Record<K, boolean>>,
): string | null {
  const shown = (Object.keys(parts) as K[])
    .filter((key) => items[key] && parts[key])
    .map((key) => parts[key]);
  return shown.length > 0 ? shown.join(SEPARATOR) : null;
}
