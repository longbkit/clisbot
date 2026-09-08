// upstream: src/infra/outbound/identity-types.ts@5d8067a4483
/** Agent identity metadata that outbound channels can render with a message. */
export type OutboundIdentity = {
  name?: string;
  avatarUrl?: string;
  emoji?: string;
  theme?: string;
};
