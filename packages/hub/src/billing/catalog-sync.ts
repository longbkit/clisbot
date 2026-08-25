import type { Database, SyncBillingPlanInput, SyncBillingPlanPriceInput } from "../db/types.js";
import { hashTemplate } from "../entitlements/catalog.js";
import { reportFailure } from "../failures/index.js";
import { parsePlanMetadata, type ParsedPlanTemplate } from "./plan-template.js";
import type {
  StripeCatalogPrice,
  StripeCatalogProduct,
  StripeCatalogSource,
} from "./stripe-catalog-source.js";

const MAX_MARKETING_FEATURES = 15;

/**
 * Mirrors the Stripe plan catalog into `billing_plans`/`billing_plan_prices` as one reconciled
 * snapshot. Runs on boot and on `product.created`/`product.updated`/`price.created`/`price.updated`
 * — always a full resync, since the catalog is a handful of products and one code path is easier
 * to keep correct than an incremental one plus a full one.
 *
 * Two products claiming one `paseo_plan_slug` is an ambiguity: both are rejected (slug is catalog
 * identity, and picking a winner would be arbitrary). Invalid entitlement metadata rejects only
 * that product. A rejected product keeps its last known good row and is logged loudly — nothing
 * here ever syncs an unvalidated template or an ambiguous slug.
 *
 * After upserting the valid, unambiguous products, every plan absent from the snapshot (a product
 * that lost its `paseo_plan` tag or was deleted) is deactivated, so it stops being selectable
 * rather than lingering active in the mirror.
 */
export async function syncBillingCatalog(
  source: StripeCatalogSource,
  database: Database,
): Promise<void> {
  const [products, prices] = await Promise.all([source.listProducts(), source.listPrices()]);
  const pricesByProduct = groupPricesByProduct(prices);
  const parsed = products.map((product) => ({
    product,
    result: parsePlanMetadata(product.metadata),
  }));
  const ambiguousSlugs = duplicateValidSlugs(parsed);
  for (const { product, result } of parsed) {
    if (!result.success) {
      reportFailure(
        Object.assign(new Error("Billing product metadata rejected"), {
          code: "invalid_plan_metadata",
        }),
        { operation: "billing.catalog.product.validate", component: "billing", provider: "stripe" },
        { kind: "validation", diagnostic: { productId: product.id } },
      );
      continue;
    }
    if (ambiguousSlugs.has(result.data.slug)) {
      reportFailure(
        Object.assign(new Error("Billing product slug is ambiguous"), {
          code: "configurationConflict",
        }),
        {
          operation: "billing.catalog.product.reconcile",
          component: "billing",
          provider: "stripe",
        },
        { kind: "conflict", diagnostic: { productId: product.id, planSlug: result.data.slug } },
      );
      continue;
    }
    await database.syncBillingPlan(
      planInput(product, result.data, pricesByProduct.get(product.id) ?? []),
    );
  }
  await database.deactivateBillingPlansExcept(products.map((product) => product.id));
}

/** The plan slugs that more than one valid product claims — rejected as ambiguous identity. */
function duplicateValidSlugs(
  parsed: readonly { result: ReturnType<typeof parsePlanMetadata> }[],
): Set<string> {
  const counts = new Map<string, number>();
  for (const { result } of parsed) {
    if (result.success) counts.set(result.data.slug, (counts.get(result.data.slug) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([slug]) => slug));
}

function planInput(
  product: StripeCatalogProduct,
  parsed: ParsedPlanTemplate,
  productPrices: readonly StripeCatalogPrice[],
): SyncBillingPlanInput {
  return {
    id: product.id,
    slug: parsed.slug,
    name: product.name,
    template: parsed.template,
    templateHash: hashTemplate(parsed.template),
    marketing: { features: product.marketingFeatures.slice(0, MAX_MARKETING_FEATURES) },
    active: product.active,
    prices: syncablePrices(product.id, productPrices),
  };
}

function syncablePrices(
  productId: string,
  prices: readonly StripeCatalogPrice[],
): SyncBillingPlanPriceInput[] {
  return prices.flatMap((price) => {
    if (price.lookupKey === null || price.interval === null) {
      reportFailure(
        Object.assign(new Error("Billing price is incomplete"), { code: "invalid_plan_price" }),
        { operation: "billing.catalog.price.validate", component: "billing", provider: "stripe" },
        { kind: "validation", diagnostic: { priceId: price.id, productId } },
      );
      return [];
    }
    return [
      {
        id: price.id,
        lookupKey: price.lookupKey,
        interval: price.interval === "month" ? ("monthly" as const) : ("annual" as const),
        unitAmount: price.unitAmount ?? 0,
        currency: price.currency,
        active: price.active,
      },
    ];
  });
}

function groupPricesByProduct(
  prices: readonly StripeCatalogPrice[],
): Map<string, StripeCatalogPrice[]> {
  const byProduct = new Map<string, StripeCatalogPrice[]>();
  for (const price of prices) {
    const list = byProduct.get(price.productId) ?? [];
    list.push(price);
    byProduct.set(price.productId, list);
  }
  return byProduct;
}
