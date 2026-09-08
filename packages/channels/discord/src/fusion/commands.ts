// Fusion owns one native /paseo door; command vocabulary and authorization remain in Hub.
import { ApplicationCommandOptionType, InteractionType, Routes, type APIInteraction } from "discord-api-types/v10";
import type { ChannelInboundEvent } from "@getpaseo/channels-shared";
import { InteractionCreateListener } from "../internal/listeners.js";
import type { Client } from "../internal/client.js";

export const PASEO_DISCORD_COMMAND = {
  name: "paseo", description: "Control the Paseo agent in this conversation",
  options: [{ type: ApplicationCommandOptionType.String, name: "command", description: "Command and arguments, for example: model list", required: false }],
};
export async function registerDiscordPaseoCommand(client: Client): Promise<void> {
  // POST upserts this name only; never replace commands owned by other integrations.
  await client.rest.post(Routes.applicationCommands(client.options.clientId), { body: PASEO_DISCORD_COMMAND });
}
export function normalizeDiscordPaseoCommand(interaction: APIInteraction, applicationId: string): ChannelInboundEvent | undefined {
  if (interaction.type !== InteractionType.ApplicationCommand || interaction.application_id !== applicationId || interaction.data.name !== "paseo") return undefined;
  const user = interaction.member?.user ?? interaction.user;
  const channelId = interaction.channel?.id ?? interaction.channel_id;
  if (!user || !channelId) return undefined;
  const option = "options" in interaction.data ? interaction.data.options?.find((entry) => entry.name === "command") : undefined;
  const args = option && "value" in option && typeof option.value === "string" ? option.value.trim().replace(/^[/\\]/u, "") : "";
  const body = `/${args || "help"}`;
  const words = /^\/([^\s]+)(?:\s+([\s\S]*))?$/u.exec(body)!;
  return {
    channel: "discord", externalEventId: interaction.id, externalMessageId: interaction.id,
    externalConversationId: channelId, chatType: interaction.guild_id ? "channel" : "direct",
    senderId: user.id, senderName: user.global_name ?? user.username, senderUsername: user.username,
    body, wasMentioned: true, timestampMs: Date.now(), replyTo: channelId,
    kind: "command", facts: { command: { name: words[1]!.toLowerCase(), args: words[2] ?? "" } },
  };
}
export class PaseoInteractionListener extends InteractionCreateListener {
  constructor(private readonly applicationId: string, private readonly onEvent: (event: ChannelInboundEvent) => Promise<unknown>) { super(); }
  override async handle(raw: unknown, client: Client): Promise<void> {
    const interaction = raw as APIInteraction;
    const event = normalizeDiscordPaseoCommand(interaction, this.applicationId);
    if (!event) return;
    // Durable admission precedes the interaction acknowledgement. The interaction
    // token is used only here and never copied into the persisted inbound event.
    try {
      await this.onEvent(event);
    } catch (error) {
      await client.rest.post(Routes.interactionCallback(interaction.id, interaction.token), {
        body: { type: 4, data: { content: "The command could not be accepted. Please try again.", flags: 64 } },
      });
      throw error;
    }
    await client.rest.post(Routes.interactionCallback(interaction.id, interaction.token), {
      body: { type: 4, data: { content: "Command received.", flags: 64 } },
    });
  }
}
