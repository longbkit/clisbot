import type { SessionAuthorship } from "@clisbot/protocol/session-authorship";
import { isVerifiedPerson, participationKeyOf, type OwnershipEvidence } from "./ownership-key";

/** A session as the parent walk reads it; `parentAgentId` is a parent on the same Host. */
export interface InheritanceSource extends SessionAuthorship {
  parentAgentId: string | null;
  /** The reader follows this session on its Host; it then counts as theirs. */
  followed?: boolean;
}

/** How far up a subagent's parents ownership is looked for; deeper chains stay unknown. */
export const MAX_INHERITED_OWNERSHIP_DEPTH = 8;

/** The same senders `participationKeyOf` reads, checked without building the key. */
function namesVerifiedPerson(source: SessionAuthorship): boolean {
  return (
    isVerifiedPerson(source.createdBy) ||
    isVerifiedPerson(source.lastMessageBy) ||
    (source.participantActors ?? []).some(isVerifiedPerson)
  );
}

/**
 * The evidence of the nearest ancestor that names a verified person, for a session that names
 * none: a subagent records no creator and its messages come from its parent agent, so it belongs
 * to whoever owns the parent. Undefined when the session has evidence of its own, or no loaded
 * ancestor within reach has any.
 */
export function inheritedOwnershipOf(
  agent: InheritanceSource,
  hostAgents: ReadonlyMap<string, InheritanceSource> | null | undefined,
): OwnershipEvidence | undefined {
  if (!agent.parentAgentId || !hostAgents || namesVerifiedPerson(agent)) return undefined;
  const visited = new Set<InheritanceSource>([agent]);
  let parent = hostAgents.get(agent.parentAgentId);
  for (let depth = 0; parent && depth < MAX_INHERITED_OWNERSHIP_DEPTH; depth += 1) {
    if (visited.has(parent)) return undefined;
    if (namesVerifiedPerson(parent))
      return { createdBy: parent.createdBy, participationKey: participationKeyOf(parent) };
    visited.add(parent);
    parent = parent.parentAgentId ? hostAgents.get(parent.parentAgentId) : undefined;
  }
  return undefined;
}

export interface AgentOwnershipEvidence {
  createdBy: SessionAuthorship["createdBy"];
  participationKey: string | undefined;
  inheritedOwnership?: OwnershipEvidence;
  watched?: boolean;
}

/** A session's ownership evidence for `resolveOwnership`, every surface's one way to build it. */
export function agentOwnershipEvidence(
  agent: InheritanceSource,
  hostAgents: ReadonlyMap<string, InheritanceSource> | null | undefined,
): AgentOwnershipEvidence {
  const inheritedOwnership = inheritedOwnershipOf(agent, hostAgents);
  return {
    createdBy: agent.createdBy,
    participationKey: participationKeyOf(agent),
    ...(inheritedOwnership ? { inheritedOwnership } : {}),
    ...(agent.followed ? { watched: true } : {}),
  };
}
