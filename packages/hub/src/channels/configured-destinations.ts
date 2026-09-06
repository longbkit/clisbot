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
  account: { routes: ReadonlyArray<Pick<CompiledChannelAccount["routes"][number], "match">> },
  observed: readonly ObservedChannelConversation[],
  resolve: (
    id: string,
    budget: { remaining: number },
  ) => Promise<ChannelConversationMetadata | null>,
) {
  const destinations = new Map<string, Destination>();
  for (const { match } of account.routes) {
    for (const id of match.ids) {
      if (id === "*" || destinations.size >= 200) continue;
      if (match.kind === "thread" || match.kind === "topic") {
        const matching = observed.filter((item) => item.kind === match.kind && item.id === id);
        for (const item of matching.slice(0, 200 - destinations.size)) {
          destinations.set(`${item.kind}:${item.rootConversationId}:${id}`, item);
        }
      } else {
        destinations.set(`${match.kind}:${id}`, {
          id,
          kind: match.kind,
          rootConversationId: id,
          threadId: null,
        });
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
