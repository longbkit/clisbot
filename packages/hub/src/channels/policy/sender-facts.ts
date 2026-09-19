// The sender-facts resolver behind audience rules: a channel identity → the
// linked Hub Member (through Channel identities on the account's Connection),
// their organization role, and their Teams. Resolved per message, so a role or
// Team change applies from the next message. Unlinked = null, which only an
// `anyone` or `identities` rule can admit.

import type { AccessStore } from "../../access/store.js";
import type { DatabaseRuntime } from "../../db/runtime/index.js";
import { memberTeamIds } from "../access-grants.js";
import type { ChannelSenderResolver } from "../plane/types.js";

export function createChannelSenderResolver(
  access: Pick<AccessStore, "resolveChannelMember">,
  runtime: DatabaseRuntime,
): ChannelSenderResolver {
  return async ({ organizationId, account, senderIdentity }) => {
    const member = await access.resolveChannelMember({
      organizationId,
      connectionId: account.connectionId,
      channel: account.channel,
      senderIdentity,
    });
    if (member === undefined) return null;
    return {
      membershipId: member.membershipId,
      role: member.role,
      teamIds: await memberTeamIds(runtime, organizationId, member.userId),
    };
  };
}
