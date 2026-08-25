/**
 * The narrow port `src/billing/` reads the Stripe plan catalog through. Production wires the
 * real Stripe SDK (`stripe-client.ts`); the E2E harness wires a fixture implementation — see
 * the plan's "Testing Stripe" section. A caller never learns which one it got.
 *
 * `listProducts()` returns only products tagged `metadata.paseo_plan=true` — "which products
 * are Paseo plans" is this port's concern, not the sync algorithm's. `listPrices()` returns
 * every price; the caller joins by `productId`.
 */
export interface StripeCatalogSource {
  listProducts(): Promise<StripeCatalogProduct[]>;
  listPrices(): Promise<StripeCatalogPrice[]>;
}

export interface StripeCatalogProduct {
  id: string;
  name: string;
  active: boolean;
  /** Flat scalar keys, e.g. `ent_seats_max`. See the plan's "Stripe is the plan catalog's
   * source of truth" section for why this is not one JSON blob. */
  metadata: Record<string, string>;
  /** Pricing-page bullet copy, from Stripe's own `marketing_features` product field (max 15). */
  marketingFeatures: readonly string[];
}

export interface StripeCatalogPrice {
  id: string;
  productId: string;
  /** null for prices without a lookup key; the sync skips those — see catalog-sync.ts. */
  lookupKey: string | null;
  active: boolean;
  currency: string;
  unitAmount: number | null;
  /** null for one-time (non-recurring) prices; the sync skips those. */
  interval: "month" | "year" | null;
}
