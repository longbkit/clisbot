import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_shell/o/$organizationSlug/projects/$projectSlug/activity")({
  component: Outlet,
});
