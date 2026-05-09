import type { ZaloBotMessage, ZaloBotUpdate } from "./api.ts";

export function getZaloBotUpdateSkipReason(update: ZaloBotUpdate) {
  if (!update.message) {
    return "no-message";
  }

  if (!update.message.from?.id?.trim()) {
    return "missing-user";
  }

  return null;
}

export function isZaloBotOriginatedMessage(message: ZaloBotMessage) {
  return message.from?.is_bot === true;
}

function extractMentionTargets(text: string) {
  if (!text) {
    return [];
  }

  const matches = new Set<string>();
  const pattern = /(^|\s)@([^\s@]+)/g;
  for (const match of text.matchAll(pattern)) {
    const target = match[2]?.trim().replace(/^@+/, "").toLowerCase();
    if (target) {
      matches.add(target);
    }
  }
  return [...matches];
}

export function hasZaloBotMention(text: string, botName?: string) {
  const normalizedBotName = (botName ?? "").trim().replace(/^@+/, "").toLowerCase();
  if (!text || !normalizedBotName) {
    return false;
  }
  return extractMentionTargets(text).includes(normalizedBotName);
}

export function hasForeignZaloBotMention(text: string, botName?: string) {
  const mentions = extractMentionTargets(text);
  if (mentions.length === 0) {
    return false;
  }

  const normalizedBotName = (botName ?? "").trim().replace(/^@+/, "").toLowerCase();
  if (!normalizedBotName) {
    return true;
  }

  return !mentions.includes(normalizedBotName);
}

export function stripZaloBotMention(text: string, botName?: string) {
  const normalizedBotName = (botName ?? "").trim().replace(/^@+/, "");
  if (!normalizedBotName) {
    return text.trim();
  }

  const pattern = new RegExp(`(^|\\s)@${normalizedBotName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "ig");
  return text.replace(pattern, " ").replace(/\s+/g, " ").trim();
}
