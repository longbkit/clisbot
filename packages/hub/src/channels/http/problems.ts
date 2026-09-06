import { reportFailure } from "../../failures/index.js";
import { ProviderApplicationError } from "../../provider-applications/index.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";

export function controlPlaneAbsent(request: Request): Response {
  return problem(
    request,
    404,
    "not_found",
    "Not found",
    "No canonical API route matches this path.",
  );
}

export function errorResponse(request: Request, error: unknown): Response {
  if (!(error instanceof ControlPlaneHttpError))
    reportFailure(error, {
      operation: "channel.control_plane",
      component: "channels",
      method: request.method,
      path: new URL(request.url).pathname,
    });
  if (error instanceof ProviderApplicationError) {
    return problem(
      request,
      422,
      "provider_application_configuration",
      "Channel credentials could not be configured",
      error.safeContext ?? `Provider Application setup failed: ${error.code}`,
    );
  }
  if (error instanceof ControlPlaneHttpError) {
    return problem(request, error.status, error.code, error.title, error.detail);
  }
  return problem(
    request,
    500,
    "internal_error",
    "Internal error",
    "an unexpected failure occurred",
  );
}

/** A typed 4xx/5xx the handlers throw for their own failure classes. */
export class ControlPlaneHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly title: string,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "ControlPlaneHttpError";
  }
}

export function invalidRequest(detail: string): ControlPlaneHttpError {
  return new ControlPlaneHttpError(400, "invalid_request", "Invalid request", detail);
}

export function conflict(detail: string): ControlPlaneHttpError {
  return new ControlPlaneHttpError(409, "control_plane_conflict", "Conflict", detail);
}

export function invalidConfiguration(detail: string): ControlPlaneHttpError {
  return new ControlPlaneHttpError(422, "invalid_configuration", "Invalid configuration", detail);
}

export async function parseJsonBody<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
): Promise<z.infer<Schema>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw invalidRequest("the request body is not valid JSON");
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    const detail = result.error.issues
      .slice(0, 5)
      .map((entry) => `${entry.path.join(".")}: ${entry.message}`)
      .join("; ");
    throw invalidRequest(`invalid request body${detail.length > 0 ? `: ${detail}` : ""}`);
  }
  return result.data;
}

export function problem(
  request: Request,
  status: number,
  code: string,
  title: string,
  detail: string,
): Response {
  const requestId = request.headers.get("x-request-id")?.trim() || randomUUID();
  return Response.json(
    {
      type: `https://paseo.sh/problems/${code.replaceAll("_", "-")}`,
      title,
      status,
      detail,
      code,
      requestId,
    },
    {
      status,
      headers: {
        "content-type": "application/problem+json",
        "x-request-id": requestId,
        ...(status === 401 ? { "www-authenticate": "Bearer" } : {}),
      },
    },
  );
}
