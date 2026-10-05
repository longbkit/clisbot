// The admission every inbound path into a bound or unbound conversation runs
// (`rule-trigger.ts`, docs/audits/2026-10-05-routes-and-rules.md): the
// conversation's conditions first, which need no sender facts, so a message
// that is not for the bot costs nothing; then the sender; then the conditions
// of the rules that admitted them, which differ only where the rules covering
// the conversation disagree.

import type { CompiledChannelAccount, CompiledRoute } from "../config/compile.js";
import type { InboundMessage } from "../plane/types.js";
import type { mayUseChannelRoute } from "../policy/gate.js";
import {
  conversationTrigger,
  mentionTrigger,
  sameTrigger,
  senderTrigger,
  type Trigger,
} from "../rule-trigger.js";
import type { FollowUpAdmission } from "./follow-up.js";

/** The two gates the bindings engine owns. */
export interface AdmissionGates {
  /** A mention, or a follow-up into the session bound here, under one trigger. */
  mentionGate(
    message: InboundMessage,
    route: CompiledRoute,
    trigger: Trigger,
    agentId: string | undefined,
  ): Promise<FollowUpAdmission>;
  mayUse(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    newConversation: boolean,
  ): ReturnType<typeof mayUseChannelRoute>;
}

/**
 * `agentId` is the session bound here. `newConversation` is true only while no
 * binding owns the conversation: a rule's `contains` applies then, and never to
 * a conversation a binding (pending or bound) already owns.
 */
export async function admitInbound(
  gates: AdmissionGates,
  message: InboundMessage,
  account: CompiledChannelAccount,
  route: CompiledRoute,
  session: { agentId: string | undefined; newConversation: boolean },
): Promise<FollowUpAdmission> {
  const scope = session.newConversation ? { text: message.text } : undefined;
  const conversation = conversationTrigger(route, message.conversation, scope);
  const gate = await gates.mentionGate(message, route, conversation, session.agentId);
  if (!gate.allowed) return gate;
  const decision = await gates.mayUse(message, account, route, session.newConversation);
  if (!decision.allowed) {
    // Only a message that was for the bot under the rules that need a mention
    // earns a refusal notice; anything else is chatter, kept as context.
    const strict = mentionTrigger(route, message.conversation, scope);
    if (!sameTrigger(strict, conversation)) {
      const addressed = await gates.mentionGate(message, route, strict, session.agentId);
      if (!addressed.allowed) return addressed;
    }
    return { ...decision, audienceRefused: true };
  }
  const own = senderTrigger(route, message.conversation, decision.rules, scope);
  const rules = decision.rules === undefined ? {} : { rules: decision.rules };
  if (sameTrigger(own, conversation)) return { allowed: true, ...rules };
  const ownGate = await gates.mentionGate(message, route, own, session.agentId);
  return ownGate.allowed ? { ...ownGate, ...rules } : ownGate;
}
