import { createFileRoute } from "@tanstack/react-router";
import { OperatorEntitlementsPage } from "../../operator/panel.js";

// Instance-scoped, deliberately outside /o/$organizationSlug — an operator acts across
// organizations it does not belong to. Server-side authorization is the guard: every operator
// read and write refuses without the instance-operator flag, so a non-operator reaching this
// route sees only "You don't have operator access." The nav entry is gated separately as
// presentation.
export const Route = createFileRoute("/_shell/operator")({
  component: OperatorEntitlementsPage,
});
