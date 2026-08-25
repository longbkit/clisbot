import { createFileRoute } from "@tanstack/react-router";
import { handleWebhook } from "../server/runtime.js";

export const Route = createFileRoute("/webhook")({
  server: { handlers: { POST: ({ request }) => handleWebhook(request) } },
});
