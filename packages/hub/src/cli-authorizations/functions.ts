import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { respondOk, type Result } from "../contract/respond.js";
import { respondWithFailure } from "../failures/index.js";
import { getApplication } from "../server/runtime.js";

const userCodeSchema = z.object({ userCode: z.string().min(1) });
const decisionSchema = userCodeSchema.extend({
  decision: z.enum(["approve", "deny"]),
  organizationId: z.string().min(1),
});
const authorizationSchema = z.object({
  expiresAt: z.string().datetime(),
  organization: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
  canManage: z.boolean(),
});

export type CliAuthorizationRequest = z.infer<typeof authorizationSchema>;

export const inspectCliAuthorization = createServerFn({ method: "POST" })
  .validator(userCodeSchema)
  .handler(async ({ data }): Promise<Result<CliAuthorizationRequest>> => {
    try {
      const response = await (
        await getApplication()
      ).operations.handleCliAuthorizationInspect(operationRequest("inspect", data));
      if (!response.ok) {
        return cliResponseFailure(
          "cli_authorization.inspect",
          response,
          "This CLI login request is unavailable or expired.",
        );
      }
      return respondOk(authorizationSchema.parse(await response.json()));
    } catch (error) {
      return respondWithFailure(error, cliContext("cli_authorization.inspect"), {
        fallback: "This CLI login request is unavailable or expired.",
      });
    }
  });

export const decideCliAuthorization = createServerFn({ method: "POST" })
  .validator(decisionSchema)
  .handler(async ({ data }): Promise<Result<{ decision: "approved" | "denied" }>> => {
    try {
      const response = await (
        await getApplication()
      ).operations.handleCliAuthorizationDecision(operationRequest("decision", data));
      if (response.status === 401 || response.status === 403) {
        return cliResponseFailure(
          "cli_authorization.decide",
          response,
          "An organization owner or admin must approve this CLI login.",
        );
      }
      if (!response.ok) {
        return cliResponseFailure(
          "cli_authorization.decide",
          response,
          "Hub couldn't record this CLI login decision. Confirm the request is still active before deciding again.",
        );
      }
      return respondOk({
        decision: data.decision === "approve" ? ("approved" as const) : ("denied" as const),
      });
    } catch (error) {
      return respondWithFailure(error, cliContext("cli_authorization.decide"), {
        fallback:
          "Hub couldn't record this CLI login decision. Confirm the request is still active before deciding again.",
      });
    }
  });

function operationRequest(path: "inspect" | "decision", body: unknown): Request {
  const incoming = getRequest();
  const headers = new Headers(incoming.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  return new Request(new URL(`/cli-authorizations/${path}`, incoming.url), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function cliContext(operation: string) {
  return { operation, component: "cli_authorizations" } as const;
}

function cliResponseFailure(operation: string, response: Response, message: string) {
  return respondWithFailure(
    new Error(`CLI authorization returned HTTP ${response.status}`),
    { ...cliContext(operation), status: response.status },
    {
      fallback: message,
      authentication: message,
      forbidden: message,
      notFound: message,
      conflict: message,
      validation: message,
    },
    { status: response.status },
  );
}
