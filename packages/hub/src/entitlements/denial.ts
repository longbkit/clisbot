import { z } from "zod";

/**
 * The one transport-neutral shape an entitlement denial takes on the wire. Caps and meters
 * carry a numeric `limit`/`current`; flags carry null for both. Defined and parsed here once —
 * no protocol boundary defines its own copy or reshapes it per call site.
 *
 * This module imports nothing but zod, so both the server (producing the response) and the
 * browser bundle (parsing it) can share it without pulling server-only code into the client.
 */
export const entitlementDenialSchema = z
  .object({
    error: z.literal("entitlement_denied"),
    entitlement: z.string(),
    kind: z.enum(["cap", "meter", "flag"]),
    limit: z.number().nullable(),
    current: z.number().nullable(),
  })
  .strict();

export type EntitlementDenialPayload = z.infer<typeof entitlementDenialSchema>;

/** The HTTP boundary's single mapper: a denial payload becomes a 409. */
export function entitlementDenialResponse(denial: EntitlementDenialPayload): Response {
  return Response.json(denial, { status: 409 });
}

/** The single reader: recognize a denial payload, or `undefined` for anything else. */
export function parseEntitlementDenial(value: unknown): EntitlementDenialPayload | undefined {
  const parsed = entitlementDenialSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Encode a denial as a run's `failure_reason` — one text column shared with reasons like
 * `whole_run_timeout`. Storing the payload as its own JSON (tagged by the `entitlement_denied`
 * literal) keeps the reason machine-parseable, so a consumer reads the structured denial instead
 * of pattern-matching a human sentence. This is the field the run UI drives off.
 */
export function encodeEntitlementDenialFailureReason(denial: EntitlementDenialPayload): string {
  return JSON.stringify(denial);
}

/**
 * Decode a run's `failure_reason` back into a denial payload, or `undefined` for any other
 * reason (timeouts, crashes, plain strings). Paired with the encoder above — the same single
 * mapping in both directions.
 */
export function decodeEntitlementDenialFailureReason(
  reason: string | null,
): EntitlementDenialPayload | undefined {
  if (reason === null) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(reason);
  } catch {
    return undefined;
  }
  return parseEntitlementDenial(parsed);
}

/** A short, human summary derived from the structured denial — for display only. */
export function entitlementDenialSummary(denial: EntitlementDenialPayload): string {
  if (denial.kind === "flag") return `Entitlement not enabled: ${denial.entitlement}`;
  return `Entitlement limit reached: ${denial.entitlement} (${denial.current} of ${denial.limit})`;
}
