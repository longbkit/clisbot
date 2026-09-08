// upstream: extensions/telegram/src/inbound-event-delivery.ts@5d8067a4483
// Telegram plugin module implements inbound event delivery behavior.
import { createInboundEventDeliveryCorrelation } from "@getpaseo/channels-core/plugin-sdk/inbound-event-delivery";
import { stripTelegramInternalPrefixes } from "./targets.js";

function normalizeTelegramDeliveryTarget(value: string): string {
  return stripTelegramInternalPrefixes(value).toLowerCase();
}

function stripTelegramTopicTarget(value: string): string {
  return value.replace(/:topic:\d+$/u, "");
}

function hasTelegramTopicTarget(value: string): boolean {
  return /:topic:\d+$/u.test(value);
}

function telegramDeliveryTargetsMatch(expected: string, actual: string): boolean {
  const expectedTarget = normalizeTelegramDeliveryTarget(expected);
  const actualTarget = normalizeTelegramDeliveryTarget(actual);
  if (expectedTarget === actualTarget) {
    return true;
  }
  if (hasTelegramTopicTarget(expectedTarget)) {
    return false;
  }
  const expectedBase = stripTelegramTopicTarget(expectedTarget);
  const actualBase = stripTelegramTopicTarget(actualTarget);
  return (
    expectedBase === actualBase && (expectedTarget === expectedBase || actualTarget === actualBase)
  );
}

export const telegramInboundEventDelivery = createInboundEventDeliveryCorrelation({
  targetsMatch: telegramDeliveryTargetsMatch,
});
