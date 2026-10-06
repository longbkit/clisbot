// The read-receipt target type from upstream `inbound/durable-receive.ts`
// (omitted, D-WA-019): `inbound/socket-session.ts` types its `markRead` with it.
export type WhatsAppReadReceiptTarget = {
  remoteJid: string;
  id: string;
  participant?: string;
};
