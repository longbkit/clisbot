import { createFileRoute } from "@tanstack/react-router";
import { PublicApiReference } from "../../public-api/reference.js";

export const Route = createFileRoute("/api/reference")({
  component: PublicApiReference,
});
