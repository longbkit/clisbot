import assert from "node:assert/strict";
import { afterAll, beforeAll, describe, it } from "vitest";
import { readDiscordOperatorAuth } from "../../auth/discord.js";
import { createDiscordBotClient, type DiscordBotClient } from "./bot.js";
import {
  NormalizedDiscordMessageEventSchema,
  type NormalizedDiscordMessageEvent,
} from "./events.js";
import { createDiscordGatewaySource } from "./gateway.js";
import type { ExternalTrigger, TriggerSource } from "../index.js";

const SHOULD_RUN = process.env["RUN_DISCORD_REAL_E2E"] === "1";
const TEST_CHANNEL_ID = process.env["DISCORD_TEST_CHANNEL_ID"] ?? "1506251032320282736";
const TEST_GUILD_ID = process.env["DISCORD_TEST_GUILD_ID"] ?? "1481169421832814616";
const TEST_TIMEOUT_MS = 60_000;

describe.skipIf(!SHOULD_RUN)("Discord real E2E", () => {
  let bot: DiscordBotClient | undefined;
  let source: TriggerSource | undefined;

  beforeAll(() => {
    const auth = readDiscordOperatorAuth(process.env);
    if (auth === undefined) {
      throw new Error("DISCORD_BOT_TOKEN required for RUN_DISCORD_REAL_E2E=1");
    }
    bot = createDiscordBotClient({
      token: auth.token,
      ...(auth.clientId === undefined ? {} : { clientId: auth.clientId }),
    });
  });

  afterAll(async () => {
    if (source !== undefined) {
      await source.stop();
    } else if (bot !== undefined) {
      await bot.stop();
    }
  }, TEST_TIMEOUT_MS);

  it(
    "receives a self-posted message through the Gateway source",
    async () => {
      const activeBot = bot;
      if (activeBot === undefined) {
        throw new Error("bot not initialised");
      }

      const probe = `paseo e2e ${Date.now()}`;
      const seen = new Promise<NormalizedDiscordMessageEvent>((resolve) => {
        const handler = (trigger: ExternalTrigger) => {
          const parsed = NormalizedDiscordMessageEventSchema.safeParse(trigger.payload);
          if (!parsed.success) {
            return Promise.resolve();
          }
          if (parsed.data.guildId === TEST_GUILD_ID && parsed.data.content.includes(probe)) {
            resolve(parsed.data);
          }
          return Promise.resolve();
        };

        source = createDiscordGatewaySource({
          bot: activeBot,
          accept: (input) =>
            Promise.resolve({
              status: "accepted",
              events: [
                {
                  providerEventReceiptId: `real-${input.deliveryId}`,
                  organizationId: "real-e2e",
                  projectId: "project-1",
                  configurationRevisionId: "11111111-1111-4111-8111-111111111134",
                  deliveryId: input.deliveryId,
                  source: input.source,
                  payload: input.payload,
                  receivedAt: input.receivedAt,
                  connectionId: "discord-connection",
                  resourceId: TEST_GUILD_ID,
                },
              ],
              receiptId: `receipt-${input.deliveryId}`,
            }),
          applyGuildDelete: () => Promise.resolve(),
        });
        void source.start(handler);
      });

      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await activeBot.sendChannelMessage({
        channelId: TEST_CHANNEL_ID,
        content: probe,
      });

      const event = await seen;
      assert.equal(event.channelId, TEST_CHANNEL_ID);
      assert.equal(event.guildId, TEST_GUILD_ID);
      assert.ok(event.content.includes(probe));
    },
    TEST_TIMEOUT_MS,
  );
});
