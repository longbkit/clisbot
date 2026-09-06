import { createHash } from "node:crypto";
import type {
  ChannelConversationMetadata,
  HostRuntime,
  ResolveConversationFn,
} from "@getpaseo/channels-shared";
import { z } from "zod";

const metadataSchema = z
  .object({
    label: z.string().max(200).nullable(),
    kind: z.enum(["dm", "channel", "group"]),
    visibility: z.enum(["public", "private", "unknown"]),
  })
  .nullable();

/** Rebuildable provider facts use the existing bounded account keyed-store seam. */
export function createConversationMetadataResolver(input: {
  channel: string;
  organizationId: string;
  connectionId: string;
  accountId: string;
  cfg: Record<string, unknown>;
  runtime: HostRuntime;
  lookup: ResolveConversationFn;
}): (to: string, budget?: { remaining: number }) => Promise<ChannelConversationMetadata | null> {
  const store = input.runtime.state.openKeyedStore({
    namespace: `${input.channel}.conversation-metadata`,
    maxEntries: 256,
    defaultTtlMs: 15 * 60_000,
  });
  // A credential or Connection replacement must not reuse another namespace's labels.
  const scope = createHash("sha256")
    .update(JSON.stringify([input.organizationId, input.connectionId, input.cfg]))
    .digest("hex");
  const pending = new Map<string, Promise<ChannelConversationMetadata | null>>();
  return (to, budget) => {
    const current = pending.get(to);
    if (current !== undefined) return current;
    if (pending.size >= 20) return Promise.resolve(null);
    const operation = (async () => {
      const key = `${scope}:${to}`;
      const cached = metadataSchema.safeParse(await store.lookup(key));
      if (cached.success) return cached.data;
      if (budget !== undefined) {
        if (budget.remaining <= 0) return null;
        budget.remaining -= 1;
      }
      let value: ChannelConversationMetadata | null = null;
      try {
        const result = metadataSchema.safeParse(
          await input.lookup({ cfg: input.cfg, accountId: input.accountId, to }),
        );
        if (result.success) value = result.data;
      } catch {
        // Missing scope, private/deleted destinations, rate limiting and network errors
        // all preserve the raw ID. Provider exceptions may contain credential-bearing URLs.
      }
      await store.register(key, value, { ttlMs: value === null ? 60_000 : 15 * 60_000 });
      return value;
    })()
      .catch(() => null)
      .finally(() => {
        pending.delete(to);
      });
    pending.set(to, operation);
    return operation;
  };
}
