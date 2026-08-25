import { z } from "zod";
import { entitlementsSchema, type EntitlementTemplate } from "../entitlements/catalog.js";

/**
 * The zod ingest gate: Stripe product metadata is always flat strings, so every entitlement
 * value is parsed from its string form here. `"unlimited"` maps to `null`, matching the
 * catalog's own "null means unlimited" convention. A dashboard typo (a non-numeric limit, a
 * value outside "true"/"false") fails this parse — see `parsePlanMetadata` for what happens
 * next, which is never "store it anyway".
 */
const positiveIntegerOrUnlimited = z.string().transform((value, ctx) => {
  if (value === "unlimited") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    ctx.addIssue({ code: "custom", message: `must be a positive integer or "unlimited"` });
    return z.NEVER;
  }
  return parsed;
});

const booleanFlag = z.enum(["true", "false"]).transform((value) => value === "true");

/**
 * The metadata shape a Paseo plan product must carry. Keys map 1:1 onto `entitlementsSchema`
 * in `src/entitlements/catalog.ts` — add a field there, add its `ent_` key here.
 * `paseo_plan_slug` is catalog identity, not an entitlement, so it carries no `ent_` prefix.
 */
const planMetadataSchema = z.object({
  paseo_plan_slug: z.string().trim().min(1, "paseo_plan_slug must not be blank"),
  ent_seats_max: positiveIntegerOrUnlimited,
  ent_can_invite: booleanFlag,
  ent_executions_monthly_limit: positiveIntegerOrUnlimited,
});

export interface ParsedPlanTemplate {
  slug: string;
  template: EntitlementTemplate;
}

export type ParsePlanMetadataResult =
  | { readonly success: true; readonly data: ParsedPlanTemplate }
  | { readonly success: false; readonly message: string };

/**
 * Validates one product's metadata into a plan slug and entitlement template. Never throws —
 * the caller (catalog-sync.ts) decides what "invalid" means for that product's sync, per the
 * plan: reject just that product, keep the last known good row, log loudly.
 */
export function parsePlanMetadata(metadata: Record<string, string>): ParsePlanMetadataResult {
  const raw = planMetadataSchema.safeParse(metadata);
  if (!raw.success) return { success: false, message: z.prettifyError(raw.error) };
  const template = entitlementsSchema.safeParse({
    seats: { max: raw.data.ent_seats_max },
    canInviteMembers: raw.data.ent_can_invite,
    meters: { "executions.monthly": { limit: raw.data.ent_executions_monthly_limit } },
  });
  if (!template.success) return { success: false, message: z.prettifyError(template.error) };
  return { success: true, data: { slug: raw.data.paseo_plan_slug, template: template.data } };
}
