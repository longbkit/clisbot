import { z } from "zod";

export const DEFAULT_APP_BASE_URL = "https://app.clisbot.com";

/**
 * Relay-only pairing offer.
 *
 * `serverId` is a stable daemon identifier scoped to `CLISBOT_HOME`, and is also
 * used as the relay session identifier.
 */
export const ConnectionOfferV2Schema = z.object({
  v: z.literal(2),
  serverId: z.string().min(1),
  daemonPublicKeyB64: z.string().min(1),
  relay: z.object({
    endpoint: z.string().min(1),
    useTls: z.boolean().optional(),
  }),
  /** Optional VPN/internal direct WebSocket candidate. */
  direct: z
    .object({
      endpoint: z.string().min(1),
      useTls: z.boolean().optional(),
    })
    .optional(),
});

export type ConnectionOfferV2 = z.infer<typeof ConnectionOfferV2Schema>;

// COMPAT(deviceConnectionOffer): protected admission can publish direct-only routes.
// This is public inventory metadata; it contains no pairing grant.
export const ConnectionOfferV5Schema = z
  .object({
    v: z.literal(5),
    serverId: z.string().min(1),
    daemonPublicKeyB64: z.string().min(1),
    encrypted: z.literal(true),
    relay: ConnectionOfferV2Schema.shape.relay.optional(),
    direct: ConnectionOfferV2Schema.shape.direct,
  })
  .refine((value) => value.relay || value.direct, "A connection route is required");
export const ConnectionOfferSchema = z.union([ConnectionOfferV2Schema, ConnectionOfferV5Schema]);
export type ConnectionOffer = z.infer<typeof ConnectionOfferSchema>;

function decodeBase64UrlToUtf8(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = globalThis.atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function decodeOfferFragmentPayload(encoded: string): unknown {
  const json = decodeBase64UrlToUtf8(encoded);
  return JSON.parse(json) as unknown;
}

const OFFER_FRAGMENT_PREFIX = "#offer=";

function extractOfferFragmentEncoded(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const fragmentIndex = trimmed.indexOf(OFFER_FRAGMENT_PREFIX);
  if (fragmentIndex === -1) return null;
  const encoded = trimmed.slice(fragmentIndex + OFFER_FRAGMENT_PREFIX.length).trim();
  return encoded.length > 0 ? encoded : null;
}

/**
 * Parse a pairing-offer URL of the form `https://app.clisbot.com/#offer=<base64url>`.
 *
 * Returns `null` if the input has no `#offer=` fragment. Throws if the fragment
 * exists but the payload is malformed or fails schema validation.
 */
export function parseConnectionOfferFromUrl(input: string): ConnectionOffer | null {
  const encoded = extractOfferFragmentEncoded(input);
  if (!encoded) return null;
  const payload = decodeOfferFragmentPayload(encoded);
  return ConnectionOfferSchema.parse(payload);
}
