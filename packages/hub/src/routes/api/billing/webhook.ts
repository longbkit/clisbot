import { createFileRoute } from "@tanstack/react-router";
import { handleBillingWebhook } from "../../../server/runtime.js";

export const Route = createFileRoute("/api/billing/webhook")({
  server: { handlers: { POST: ({ request }) => handleBillingWebhook(request) } },
});
