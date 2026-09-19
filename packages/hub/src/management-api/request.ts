import type { z } from "zod";
import { ProductRequestError } from "../auth/organization-access.js";

/** The management contract's problem body: `{ error, message, requestId }`. */
export function problem(
  requestId: string,
  status: number,
  error: string,
  message: string,
): Response {
  return Response.json({ error, message, requestId }, { status });
}

export async function parseBody<Schema extends z.ZodType>(
  request: Request,
  bodySchema: Schema,
): Promise<z.infer<Schema>> {
  const value = await (request.json() as Promise<unknown>).catch(() => undefined);
  const parsed = bodySchema.safeParse(value);
  if (!parsed.success) throw new ProductRequestError(400, "invalid_request");
  return parsed.data;
}

/** `?include=team` opts a client into the `team` resource kind (see `COMPAT(team-resource-kind)`). */
export function includesTeamResources(request: Request): boolean {
  const include = new URL(request.url).searchParams.get("include") ?? "";
  return include.split(",").includes("team");
}
