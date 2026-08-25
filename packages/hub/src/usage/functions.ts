import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { respondOk, type Result } from "../contract/respond.js";
import { respondWithFailure } from "../failures/index.js";
import { tenantRouteNotFoundMessage } from "../projects/access.js";
import { getApplication } from "../server/runtime.js";
import type { UsageDashboard } from "./dashboard.js";

const organizationScopeSchema = z
  .object({ organizationSlug: z.string().trim().min(1).max(100) })
  .strict();

export const usageSnapshot = createServerFn({ method: "GET" })
  .validator(organizationScopeSchema)
  .handler(async ({ data }): Promise<Result<Awaited<ReturnType<UsageDashboard["snapshot"]>>>> => {
    try {
      const dashboard = (await getApplication()).usageDashboard;
      if (dashboard === null) throw new Error("usage dashboard unavailable");
      return respondOk(await dashboard.snapshot(getRequest(), data));
    } catch (error) {
      const message = usageSnapshotErrorMessage(error);
      return respondWithFailure(
        error,
        {
          operation: "usage.snapshot",
          component: "usage",
          organizationSlug: data.organizationSlug,
        },
        { fallback: message, notFound: message, forbidden: message },
      );
    }
  });

export function usageSnapshotErrorMessage(error: unknown): string {
  return tenantRouteNotFoundMessage(error) ?? "We couldn't load this organization's usage.";
}
