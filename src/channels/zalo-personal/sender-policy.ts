import { hasAgentCommandPrefix } from "../../agents/commands/commands.ts";
import type { resolveChannelAuth } from "../../auth/resolve.ts";
import { isChannelSenderAllowed } from "../pairing/access.ts";
import type { SurfaceRoute } from "../config/route-policy.ts";

export function resolveZaloPersonalGroupSenderPolicy(params: {
  conversationKind: "dm" | "group";
  senderId: string;
  rawText: string;
  mentionedSelf: boolean;
  route: SurfaceRoute;
  auth: ReturnType<typeof resolveChannelAuth>;
}) {
  if (
    params.conversationKind !== "group" ||
    params.auth.mayBypassSharedSenderPolicy ||
    (
      params.route.policy !== "allowlist" &&
      (params.route.allowUsers?.length ?? 0) === 0
    ) ||
    isChannelSenderAllowed({
      channel: "zalo-personal",
      allowFrom: params.route.allowUsers ?? [],
      subject: { userId: params.senderId },
    })
  ) {
    return { allowed: true, shouldSendDeny: false };
  }
  const explicitlyAddressed = params.mentionedSelf ||
    hasAgentCommandPrefix(params.rawText, { commandPrefixes: params.route.commandPrefixes });
  return {
    allowed: false,
    shouldSendDeny: !params.route.requireMention || explicitlyAddressed,
  };
}
