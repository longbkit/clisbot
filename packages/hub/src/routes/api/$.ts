import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: apiNotFound,
      POST: apiNotFound,
      PUT: apiNotFound,
      PATCH: apiNotFound,
      DELETE: apiNotFound,
      OPTIONS: apiNotFound,
    },
  },
});

function apiNotFound(): Response {
  return Response.json(
    {
      error: "not_found",
      message:
        "This Paseo Hub API endpoint does not exist. Check the request path and API version.",
    },
    { status: 404 },
  );
}
