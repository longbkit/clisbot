import { createFileRoute } from "@tanstack/react-router";
import { AccountApp } from "../auth/account-app.js";

/**
 * The dashboard chrome. Pathless, so the URLs beneath it are unchanged, and mounted
 * once for the whole session — every route below swaps only the panel inside its outlet.
 */
export const Route = createFileRoute("/_shell")({ component: AccountApp });
