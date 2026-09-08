// Simulated chat platforms for tests that need the real SDK on one side.
//
// Import as `@getpaseo/channels-shared/sim`; the subpath keeps `ws` out of the
// import graph of every production consumer of `@getpaseo/channels-shared`.
//
// See docs/testing.md "Channel platform" for when a sim is the right tier and
// when only a live run counts.
export type { SimFault, SimFaultRule, SimHandler, SimHttpServer, SimRequest } from "./server.js";
export { pendingFault, sendJson, SimRecorder, startSimHttpServer, waitFor } from "./server.js";
export type {
  SimDiscord,
  SimDiscordFrame,
  SimDiscordMessage,
  SimDiscordOptions,
} from "./discord.js";
export { startDiscordSim } from "./discord.js";
export type { SimSlack, SimSlackMessage, SimSlackOptions } from "./slack.js";
export { startSlackSim } from "./slack.js";
export type { SimTelegram, SimTelegramMessage, SimTelegramOptions } from "./telegram.js";
export { startTelegramSim } from "./telegram.js";
export type {
  SimGoogleChatKey,
  SimSignedWebhookRequest,
  SimWebhookClient,
  SimWebhookDelivery,
  SimWebhookPlatform,
  SimWebhookResponse,
  SimWebhookSignParams,
} from "./webhook.js";
export {
  createGoogleChatSimKey,
  createSimWebhookClient,
  googleChatSimKey,
  postSignedWebhook,
  signWebhookRequest,
} from "./webhook.js";
