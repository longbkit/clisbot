/* oxlint-disable typescript-eslint/no-unsafe-type-assertion -- the generated route type cannot express a server-resolved organization slug */
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useActiveAccount } from "../../auth/active-account.js";

export const Route = createFileRoute("/_shell/triggers")({ component: TriggerShortcut });

function TriggerShortcut() {
  const account = useActiveAccount();
  return <Navigate to={`/o/${account.organization.slug}/triggers` as never} replace />;
}
