// upstream: extensions/discord/src/internal/api.webhooks.ts@5d8067a4483
// Discord plugin module implements api.webhooks behavior.
import { Routes } from "discord-api-types/v10";
import type { RequestClient, RequestData } from "./rest.js";

export async function createChannelWebhook(
  rest: RequestClient,
  channelId: string,
  data: RequestData,
): Promise<{ id?: string; token?: string }> {
  return (await rest.post(Routes.channelWebhooks(channelId), data)) as {
    id?: string;
    token?: string;
  };
}
