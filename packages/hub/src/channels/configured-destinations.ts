import type { ChannelConversationMetadata } from "@getpaseo/channels-shared";
import type { CompiledChannelAccount } from "./config/compile.js";
import type {
  ChannelConversationKind,
  ObservedChannelConversation,
} from "./conversation-catalog.js";

interface Destination {
  id: string;
  kind: ChannelConversationKind;
  rootConversationId: string;
  threadId: string | null;
}

/** Enrich only authored destinations, never enumerate a provider directory. */
export async function configuredChannelDestinations(
  account: { routes: ReadonlyArray<Pick<CompiledChannelAccount["routes"][number], "where">> },
  observed: readonly ObservedChannelConversation[],
  resolve: (
    id: string,
    budget: { remaining: number },
  ) => Promise<ChannelConversationMetadata | null>,
) {
  const destinations = new Map<string, Destination>();
  // An authored id names a room or a thread/topic inside one; the observed
  // catalog says which, and an id never seen yet reads as a room.
  for (const { where } of account.routes) {
    for (const id of where.conversations) {
      if (id === "*" || destinations.size >= 200) continue;
      const seen = observed.filter(
        (item) => item.id === id || (item.rootConversationId === id && item.threadId === null),
      );
      if (seen.length === 0) {
        destinations.set(`channel:${id}`, {
          id,
          kind: "channel",
          rootConversationId: id,
          threadId: null,
        });
        continue;
      }
      for (const item of seen.slice(0, 200 - destinations.size)) {
        destinations.set(`${item.kind}:${item.rootConversationId}:${item.id}`, item);
      }
    }
  }
  const roots = [...new Set([...destinations.values()].map((item) => item.rootConversationId))];
  const budget = { remaining: 20 };
  const metadata = new Map<string, ChannelConversationMetadata | null>();
  for (let index = 0; index < roots.length; index += 4) {
    await Promise.all(
      roots.slice(index, index + 4).map(async (id) => {
        metadata.set(id, await resolve(id, budget));
      }),
    );
  }
  return [...destinations.values()].map((item) => {
    const fact = metadata.get(item.rootConversationId);
    return {
      id: item.id,
      kind: item.kind,
      rootConversationId: item.rootConversationId,
      threadId: item.threadId,
      label: fact?.label ?? null,
      visibility: fact?.visibility ?? "unknown",
      source: fact?.label ? ("provider" as const) : ("unavailable" as const),
    };
  });
}
