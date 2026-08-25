import { createFileRoute } from "@tanstack/react-router";
import { handleBillingPlans } from "../../../server/runtime.js";

// Public, unauthenticated, read-only — the contract the marketing site consumes. Registered in
// the route tree but only answers on a billing-configured (hosted) instance; a self-hosted
// instance has no billing surface, so the endpoint 404s as if it were never registered. See the
// plan's "Stripe is the plan catalog's source of truth" section and docs/public-api.md.
export const Route = createFileRoute("/api/billing/plans")({
  server: {
    handlers: {
      GET: async () => {
        const plans = await handleBillingPlans();
        if (plans === null) return new Response("Not Found", { status: 404 });
        return Response.json({ plans });
      },
    },
  },
});
