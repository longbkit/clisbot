import type { AgentService } from "../../agents/runtime/agent-service.ts";
import type { resolveChannelAuth } from "../../auth/resolve.ts";
import type { OrderedIngressControls } from "../message/ordered-ingress-dispatcher.ts";
import type { resolveZaloPersonalConversationRoute } from "./route-config.ts";
import type { resolveZaloPersonalConversationTarget } from "./session-routing.ts";
import type { ZaloPersonalClient } from "./zca-js.ts";

export type ZaloPersonalSingleInboundMessage = Parameters<Parameters<ZaloPersonalClient["api"]["listener"]["on"]>[1]>[0];
export type ZaloPersonalInboundMessage = ZaloPersonalSingleInboundMessage & {
  mediaGroupMessages?: ZaloPersonalSingleInboundMessage[];
};
export type ZaloPersonalInboundParams = {
  message: ZaloPersonalInboundMessage;
  eventId: string;
  rawText: string;
  conversationKind: "dm" | "group";
  senderId: string;
  chatId: string;
  messageTime: number;
  mentionedSelf: boolean;
  ingressControls?: OrderedIngressControls;
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
  attachmentPaths: string[];
  identity: ZaloPersonalIdentity;
  auth: ReturnType<typeof resolveChannelAuth>;
  ingressControls?: OrderedIngressControls;
};

export type ZaloPersonalFollowUpState = Awaited<ReturnType<AgentService["getConversationFollowUpState"]>>;
