// Fusion-owned home for the durable-invoker contract upstream declares in
// `extensions/feishu/src/feishu-ingress.ts` (D-FS-004).
//
// Upstream's `feishu-ingress.ts` opens OpenClaw's SQLite-backed
// `openChannelIngressQueue`, serializes the raw Lark envelope into it and runs
// its own drain. In Fusion the Hub owns the durable queue
// (`channel_ingress_queue`) and one drain per account, and the shared inbound
// processor persists the normalized event before it returns
// (`@getpaseo/channels-shared` `createInboundEventProcessor`). What survives is
// the contract the ported webhook transport depends on, because it is what
// makes the HTTP 200 honest: only a `durable` invocation may carry the
// accepted marker; a throw means nothing was admitted and the caller answers
// 5xx so Feishu redelivers.
//
// `src/fusion/admission.ts` builds the invoker.

/** Upstream `feishu-ingress.ts`, unchanged. */
export type FeishuWebhookInvoker = (
  data: unknown,
  params?: { needCheck?: boolean },
) => Promise<{ kind: "durable" | "non-durable"; value: unknown }>;
