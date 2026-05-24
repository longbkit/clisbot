import { sleep } from "../../infra/process.ts";
import { OrderedIngressDispatcher } from "../message/ordered-ingress-dispatcher.ts";
import { resolveZaloPersonalMediaGroup } from "./attachments.ts";
import { getZaloPersonalMessageSenderId } from "./inbound-message.ts";
import type { ZaloPersonalInboundMessage } from "./service-types.ts";

const ZALO_PERSONAL_MEDIA_GROUP_COALESCE_DELAY_MS = 800;

export function getZaloPersonalIngressKey(botId: string, message: ZaloPersonalInboundMessage) {
  return ["zalo-personal", botId, String(message.threadId)].join(":");
}

export function coalesceZaloPersonalMediaGroupMessages(messages: ZaloPersonalInboundMessage[]) {
  const groups = new Map<string, { index: number; messages: ZaloPersonalInboundMessage[] }>();
  const ordered: Array<ZaloPersonalInboundMessage | { mediaGroupKey: string }> = [];

  for (const message of messages) {
    const key = getZaloPersonalMediaGroupKey(message);
    if (!key) {
      ordered.push(message);
      continue;
    }
    const existing = groups.get(key);
    if (existing) {
      existing.messages.push(message);
      continue;
    }
    groups.set(key, { index: ordered.length, messages: [message] });
    ordered.push({ mediaGroupKey: key });
  }

  for (const [key, group] of groups) {
    ordered[group.index] = mergeZaloPersonalMediaGroupMessages(key, group.messages);
  }
  return ordered as ZaloPersonalInboundMessage[];
}

export class ZaloPersonalMediaGroupDispatcher {
  private readonly pendingGroups = new Map<string, { ingressKey: string; messages: ZaloPersonalInboundMessage[] }>();
  private readonly tailsByIngressKey = new Map<string, Promise<void>>();

  constructor(
    private readonly dispatcher: OrderedIngressDispatcher<ZaloPersonalInboundMessage>,
    private readonly delayMs = ZALO_PERSONAL_MEDIA_GROUP_COALESCE_DELAY_MS,
  ) {}

  dispatch(messages: ZaloPersonalInboundMessage[]) {
    const tasks: Promise<void>[] = [];
    for (const message of messages) {
      const ingressKey = getZaloPersonalIngressKey("media-group-buffer", message);
      const key = getZaloPersonalMediaGroupKey(message);
      if (!key) {
        tasks.push(this.enqueueAfterIngressTail(ingressKey, async () => {
          await Promise.all(this.dispatcher.dispatch([message]));
        }));
        continue;
      }
      const existing = this.pendingGroups.get(key);
      if (existing) {
        existing.messages.push(message);
        continue;
      }
      this.pendingGroups.set(key, { ingressKey: ingressKey ?? key, messages: [message] });
      tasks.push(this.enqueueAfterIngressTail(
        ingressKey ?? key,
        () => this.dispatchPendingGroupAfterDelay(key),
      ));
    }
    return tasks;
  }

  private enqueueAfterIngressTail(ingressKey: string | undefined, task: () => Promise<void>) {
    if (!ingressKey) {
      return task();
    }
    const previous = this.tailsByIngressKey.get(ingressKey) ?? Promise.resolve();
    const next = previous.then(task, task);
    this.tailsByIngressKey.set(ingressKey, next);
    next.finally(() => {
      if (this.tailsByIngressKey.get(ingressKey) === next) {
        this.tailsByIngressKey.delete(ingressKey);
      }
    });
    return next;
  }

  private async dispatchPendingGroupAfterDelay(key: string) {
    await sleep(this.delayMs);
    const pending = this.pendingGroups.get(key);
    if (!pending) {
      return;
    }
    this.pendingGroups.delete(key);
    const [merged] = coalesceZaloPersonalMediaGroupMessages(pending.messages);
    if (merged) {
      await Promise.all(this.dispatcher.dispatch([merged]));
    }
  }
}

function getZaloPersonalMediaGroupKey(message: ZaloPersonalInboundMessage) {
  const mediaGroup = resolveZaloPersonalMediaGroup(message);
  if (!mediaGroup) {
    return undefined;
  }
  return [
    "zalo-personal-media-group",
    String(message.threadId),
    getZaloPersonalMessageSenderId(message) || "unknown-sender",
    mediaGroup.groupLayoutId,
  ].join(":");
}

function mergeZaloPersonalMediaGroupMessages(
  _key: string,
  messages: ZaloPersonalInboundMessage[],
): ZaloPersonalInboundMessage {
  const sorted = [...messages].sort(compareZaloPersonalMediaGroupMessages);
  const first = sorted[0];
  if (!first || sorted.length <= 1) {
    return first ?? messages[0]!;
  }
  return {
    ...first,
    mediaGroupMessages: sorted,
  };
}

function compareZaloPersonalMediaGroupMessages(
  left: ZaloPersonalInboundMessage,
  right: ZaloPersonalInboundMessage,
) {
  const leftGroup = resolveZaloPersonalMediaGroup(left);
  const rightGroup = resolveZaloPersonalMediaGroup(right);
  const leftIndex = leftGroup?.idInGroup ?? Number.MAX_SAFE_INTEGER;
  const rightIndex = rightGroup?.idInGroup ?? Number.MAX_SAFE_INTEGER;
  if (leftIndex !== rightIndex) {
    return leftIndex - rightIndex;
  }
  return Number(left.data.ts || 0) - Number(right.data.ts || 0);
}
