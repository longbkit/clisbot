// Fusion-owned host adapter for `src/infra/outbound/source-delivery-plan.ts` (D-CORE-042).
//
// Upstream builds the delivery plan for the inbound turn's own conversation and
// compares a requested route against it using OpenClaw session keys, route peers
// and thread inheritance. Fusion answers the same question from the capability
// binding the Hub issued: a requested route matches the source when the provider,
// the account and the destination agree, and the thread either matches or is
// inherited.

export type SourceDeliveryRoute = {
  provider?: string | null;
  channel?: string | null;
  accountId?: string | null;
  to?: string | null;
  threadId?: string | number | null;
  threadImplicit?: boolean;
};

function normalize(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sameThread(requested: SourceDeliveryRoute, source: SourceDeliveryRoute): boolean {
  if (requested.threadImplicit === true) {
    return true;
  }
  const requestedThread = normalize(
    typeof requested.threadId === "number" ? String(requested.threadId) : requested.threadId,
  );
  const sourceThread = normalize(
    typeof source.threadId === "number" ? String(source.threadId) : source.threadId,
  );
  return requestedThread === sourceThread;
}

export function sourceDeliveryTargetsMatch(
  requested: SourceDeliveryRoute,
  source: SourceDeliveryRoute,
): boolean {
  const requestedChannel = normalize(requested.provider ?? requested.channel)?.toLowerCase();
  const sourceChannel = normalize(source.provider ?? source.channel)?.toLowerCase();
  if (requestedChannel && sourceChannel && requestedChannel !== sourceChannel) {
    return false;
  }
  const requestedAccount = normalize(requested.accountId);
  const sourceAccount = normalize(source.accountId);
  if (requestedAccount && sourceAccount && requestedAccount !== sourceAccount) {
    return false;
  }
  const requestedTo = normalize(requested.to);
  const sourceTo = normalize(source.to);
  if (!requestedTo || !sourceTo || requestedTo !== sourceTo) {
    return false;
  }
  return sameThread(requested, source);
}
