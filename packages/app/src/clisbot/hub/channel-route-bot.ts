// A Route that starts or continues a Bot (docs/features/bots-and-chats/README.md, D15). The Hub
// has no Bot target: a Bot's Route is a direct Agent target built from the Bot's Host, Project,
// folder and launch defaults, with `workspace.organize: false` so its sessions stay in the Bot's
// own Workspace. The same three facts tell the form, reopening the Route, that it is a Bot's.
// Pure.

import type { BotPayload } from "@/clisbot/bots/data/contracts";
import type { ChannelRouteTarget } from "./channel-route-target";

type ConfigurationRecord = Record<string, unknown>;
type AgentTarget = Extract<ChannelRouteTarget, { kind: "agent" }>;

/** A Bot the Route form can pick: one on a Host this Hub has enrolled. */
export interface RouteBotOption {
  /** `<serverId>/<botId>`: a Bot id is unique per Host only. */
  key: string;
  serverId: string;
  serverName: string;
  /** The Hub's id for the Bot's Host. */
  daemonId: string;
  bot: BotPayload;
}

/** What `routeBotOptions` reads of a Hub daemon: its id and the Host it offers. */
export interface RouteBotDaemon {
  id: string;
  connectionOffer: { serverId: string } | null;
}

/** The Bot "Connect to a channel…" opened the form for. */
export interface RouteBotRequest {
  serverId: string;
  botId: string;
}

export function routeBotKey(serverId: string, botId: string): string {
  return `${serverId}/${botId}`;
}

/** The Bots whose Host the Hub knows, by name. A Bot on a Host it does not know cannot run there. */
export function routeBotOptions(
  bots: readonly (BotPayload & { serverId: string; serverName: string })[],
  daemons: readonly RouteBotDaemon[],
): RouteBotOption[] {
  const daemonByServer = new Map<string, string>();
  for (const daemon of daemons) {
    if (daemon.connectionOffer !== null)
      daemonByServer.set(daemon.connectionOffer.serverId, daemon.id);
  }
  return bots
    .flatMap(({ serverId, serverName, ...bot }) => {
      const daemonId = daemonByServer.get(serverId);
      if (daemonId === undefined) return [];
      return [{ key: routeBotKey(serverId, bot.id), serverId, serverName, daemonId, bot }];
    })
    .sort((left, right) => left.bot.name.localeCompare(right.bot.name));
}

/** What the Route runs: the Bot's folder, with the launch defaults it has now. */
export function botRouteTarget(option: RouteBotOption): AgentTarget {
  const { bot } = option;
  const launch = bot.launchDefaults;
  const target: AgentTarget = {
    kind: "agent",
    daemonId: option.daemonId,
    projectId: bot.projectId,
    cwd: bot.cwd,
    provider: launch.provider,
    workspaceOrganize: "off",
  };
  if (launch.model) target.model = launch.model;
  if (launch.modeId) target.mode = launch.modeId;
  if (launch.thinkingOptionId) target.thinkingOptionId = launch.thinkingOptionId;
  if (launch.featureValues && Object.keys(launch.featureValues).length > 0)
    target.featureValues = launch.featureValues;
  return target;
}

/**
 * The Bot a stored Route runs, or null. A Route is a Bot's when it keeps its sessions in place
 * and runs in that Bot's folder on its Host, with no worktree: what `botRouteTarget` writes.
 */
export function routeBotMatch(
  route: ConfigurationRecord | undefined,
  environment: ConfigurationRecord | null,
  options: readonly RouteBotOption[],
): RouteBotOption | null {
  if (route === undefined || environment === null) return null;
  const workspace = route["workspace"];
  if (!isRecord(workspace) || workspace["organize"] !== false) return null;
  if (environment["worktree"] !== undefined) return null;
  return (
    options.find(
      ({ daemonId, bot }) =>
        environment["daemon"] === daemonId &&
        environment["projectId"] === bot.projectId &&
        environment["cwd"] === bot.cwd,
    ) ?? null
  );
}

/**
 * True when the Route's named agent (before any Route default set from a conversation) differs
 * from what the Bot launches with now: a save replaces it with the Bot's.
 */
export function botLaunchChanged(
  option: RouteBotOption,
  agent: ConfigurationRecord | null,
): boolean {
  const launch = option.bot.launchDefaults;
  const stored = agent ?? {};
  const same = (key: string, value: string | null | undefined) =>
    (typeof stored[key] === "string" ? stored[key] : "") === (value ?? "");
  return !(
    same("provider", launch.provider) &&
    same("model", launch.model) &&
    same("mode", launch.modeId) &&
    same("thinkingOptionId", launch.thinkingOptionId) &&
    sameFeatureValues(stored["featureValues"], launch.featureValues)
  );
}

/** Feature values compared by key; an absent record equals an empty one. */
function sameFeatureValues(stored: unknown, launch: Record<string, unknown> | undefined): boolean {
  const left = isRecord(stored) ? stored : {};
  const right = launch ?? {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => Object.is(left[key], right[key]));
}

function isRecord(value: unknown): value is ConfigurationRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
