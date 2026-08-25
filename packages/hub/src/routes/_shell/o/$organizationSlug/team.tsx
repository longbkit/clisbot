import { createFileRoute } from "@tanstack/react-router";
import { Team } from "../../../../auth/team.js";
export const Route = createFileRoute("/_shell/o/$organizationSlug/team")({ component: Team });
