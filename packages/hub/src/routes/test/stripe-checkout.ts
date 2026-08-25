import { createFileRoute } from "@tanstack/react-router";

/**
 * The fixture Stripe Checkout stand-in. The fixture billing client (E2E only) points its
 * checkout URL here so the browser round-trips through a "checkout" and returns to the dashboard,
 * exactly as production redirects to Stripe's hosted page. It only ever redirects to a same-origin
 * success URL — never an external one — so it is inert on a real deployment where nothing links
 * here. The subscription webhook that actually stamps entitlements is delivered separately and
 * HMAC-signed, so signature verification stays exercised for real.
 */
export const Route = createFileRoute("/test/stripe-checkout")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const url = new URL(request.url);
        const success = url.searchParams.get("success");
        if (success === null) return new Response("Not Found", { status: 404 });
        let target: URL;
        try {
          target = new URL(success);
        } catch {
          return new Response("Bad Request", { status: 400 });
        }
        if (target.origin !== url.origin) return new Response("Bad Request", { status: 400 });
        return new Response(null, { status: 303, headers: { location: target.toString() } });
      },
    },
  },
});
