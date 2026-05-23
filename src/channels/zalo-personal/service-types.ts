import type { AgentService } from "../../agents/runtime/agent-service.ts";
import type { resolveChannelAuth } from "../../auth/resolve.ts";
import type { resolveZaloPersonalConversationRoute } from "./route-config.ts";
import type { resolveZaloPersonalConversationTarget } from "./session-routing.ts";
import type { ZaloPersonalClient } from "./zca-js.ts";

export type ZaloPersonalInboundMessage = Parameters<Parameters<ZaloPersonalClient["api"]["listener"]["on"]>[1]>[0];
export type ZaloPersonalInboundParams = {
  eventId: string;
  rawText: string;
  conversationKind: "dm" | "group";
  senderId: string;
  chatId: string;
  messageTime: number;
  mentionedSelf: boolean;
};
export type ZaloPersonalIdentity = {
  platform: "zalo-personal";
  botId: string;
  conversationKind: "dm" | "group";
  senderId: string;
  chatId: string;
};
export type ZaloPersonalSubmissionContext = {
  params: ZaloPersonalInboundParams;
  routeInfo: ReturnType<typeof resolveZaloPersonalConversationRoute>;
  route: NonNullable<ReturnType<typeof resolveZaloPersonalConversationRoute>["route"]>;
  sessionTarget: ReturnType<typeof resolveZaloPersonalConversationTarget>;
  identity: ZaloPersonalIdentity;
  auth: ReturnType<typeof resolveChannelAuth>;
};

export type ZaloPersonalFollowUpState = Awaited<ReturnType<AgentService["getConversationFollowUpState"]>>;
