import { parseAgentCommand, type CommandPrefixes } from "../../agents/commands.ts";
import type { ProcessedEventsStore } from "../processed-events-store.ts";
import { shouldGuideUnroutedConversation } from "../unrouted-guidance-policy.ts";
import { hasBotMention } from "./message.ts";
import { renderCliCommand } from "../../shared/cli-name.ts";

export function isSlackCommandLikeMessage(params: {
  text: string;
  botUserId?: string;
  botUsername?: string;
  commandPrefixes?: CommandPrefixes;
}) {
  const normalized = params.text.trim();
  if (!normalized) {
    return false;
  }

  if (hasBotMention(normalized, params.botUserId)) {
    return true;
  }

  return (
    parseAgentCommand(normalized, {
      botUsername: params.botUsername,
      commandPrefixes: params.commandPrefixes,
    }) !== null
  );
}

export function renderSlackRouteChoiceMessage(params: {
  channelId: string;
  botLabel?: string;
}) {
  const botReference = params.botLabel?.trim()
    ? `mention this bot (${params.botLabel.trim()})`
    : "mention this bot";
  return [
    "clisbot: this Slack channel is not configured yet.",
    "",
    "Ask the bot owner to do these:",
    `- ${renderCliCommand(`routes add --channel slack channel:${params.channelId} --bot default`, { inline: true })}`,
    `- ${renderCliCommand(`routes set-agent --channel slack channel:${params.channelId} --bot default --agent <id>`, { inline: true })}`,
    "",
    `After that, ${botReference} and send \`\\start\`, \`\\status\`, or \`\\mention\` here.`,
  ].join("\n");
}

export function renderSlackMentionRequiredMessage(botLabel?: string) {
  const botReference = botLabel?.trim()
    ? `mention this bot (${botLabel.trim()})`
    : "mention this bot";
  return [
    "clisbot: this Slack channel requires a bot mention for new commands.",
    `Try ${botReference} and send \`\\status\` or \`\\mention\` here.`,
    "After the bot replies in a thread, normal follow-up messages there can continue according to the follow-up policy.",
  ].join("\n");
}

export function shouldSendSlackMentionRequiredGuidance(params: {
  conversationKind: "channel" | "group" | "dm";
  isCommandLike: boolean;
}) {
  return params.conversationKind === "dm" && params.isCommandLike;
}

export function shouldGuideUnroutedSlackEvent(params: {
  conversationKind: "channel" | "group" | "dm";
  isCommandLike: boolean;
  wasMentioned: boolean;
  isBotOriginated: boolean;
}) {
  return shouldGuideUnroutedConversation({
    conversationKind: params.conversationKind,
    explicitlyAddressed: params.wasMentioned,
    isGuidanceCommand: params.isCommandLike,
    allowCommandOnlyGuidance: false,
    isBotOriginated: params.isBotOriginated,
  });
}

export async function sendSlackGuidanceOnce(params: {
  eventId?: string;
  processedEventsStore: ProcessedEventsStore;
  send: () => Promise<void>;
}) {
  if (!params.eventId) {
    await params.send();
    return true;
  }

  const existingStatus = await params.processedEventsStore.getStatus(params.eventId);
  if (existingStatus === "processing" || existingStatus === "completed") {
    return false;
  }

  await params.processedEventsStore.markProcessing(params.eventId);
  try {
    await params.send();
    await params.processedEventsStore.markCompleted(params.eventId);
    return true;
  } catch (error) {
    await params.processedEventsStore.clear(params.eventId);
    throw error;
  }
}
