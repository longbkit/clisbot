import type { z } from "zod";
import { HubProblemSchema } from "./contracts";
import type { HubRequestInput, HubTransport } from "./transport/contract";
import { i18n } from "@/i18n/i18next";

export class HubApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * What a failed Hub request means for the user. Only an explicit answer from a reachable Hub
 * changes access: 401 asks to sign in to that Hub again, 403 means access was removed. Anything
 * else (offline, VPN, timeout, 5xx) is "unreachable" and must never hide or wipe data.
 */
export type HubFailureKind = "unreachable" | "needs-sign-in" | "revoked";

export function classifyHubFailure(error: unknown): HubFailureKind {
  const status = typeof error === "object" && error !== null ? Reflect.get(error, "status") : null;
  if (status === 401) return "needs-sign-in";
  if (status === 403) return "revoked";
  return "unreachable";
}

export class HubApiClient {
  constructor(
    private readonly transport: HubTransport,
    private readonly organizationId: string,
  ) {}

  get<Schema extends z.ZodType>(resource: string, schema: Schema): Promise<z.infer<Schema>> {
    return this.request(resource, schema);
  }

  getAuth<Schema extends z.ZodType>(resource: string, schema: Schema): Promise<z.infer<Schema>> {
    return this.requestPath(this.authPath(resource), schema);
  }

  post<Schema extends z.ZodType>(
    resource: string,
    body: unknown,
    schema: Schema,
  ): Promise<z.infer<Schema>> {
    return this.request(resource, schema, jsonRequest("POST", body));
  }

  postAuth<Schema extends z.ZodType>(
    resource: string,
    body: unknown,
    schema: Schema,
  ): Promise<z.infer<Schema>> {
    return this.requestPath(this.authPath(resource), schema, jsonRequest("POST", body));
  }

  put<Schema extends z.ZodType>(
    resource: string,
    body: unknown,
    schema: Schema,
  ): Promise<z.infer<Schema>> {
    return this.request(resource, schema, jsonRequest("PUT", body));
  }

  async delete(resource: string): Promise<void> {
    const response = await this.transport.request(this.path(resource), { method: "DELETE" });
    if (!response.ok) await throwResponse(response);
  }

  private async request<Schema extends z.ZodType>(
    resource: string,
    schema: Schema,
    input?: HubRequestInput,
  ): Promise<z.infer<Schema>> {
    return this.requestPath(this.path(resource), schema, input);
  }

  private async requestPath<Schema extends z.ZodType>(
    path: string,
    schema: Schema,
    input?: HubRequestInput,
  ): Promise<z.infer<Schema>> {
    const response = await this.transport.request(path, input);
    if (!response.ok) await throwResponse(response);
    return schema.parse(await response.json());
  }

  private path(resource: string): string {
    const normalized = resource.replace(/^\/+/, "");
    return `/api/management/v1/organizations/${encodeURIComponent(this.organizationId)}/${normalized}`;
  }

  private authPath(resource: string): string {
    const normalized = resource.replace(/^\/+/, "");
    return `/api/auth/clisbot/${normalized}`;
  }
}

function jsonRequest(method: "POST" | "PUT", body: unknown): HubRequestInput {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function throwResponse(response: Response): Promise<never> {
  const payload = HubProblemSchema.safeParse(await response.json().catch(() => undefined));
  throw new HubApiError(
    response.status,
    payload.success ? payload.data.error : "request_failed",
    payload.success
      ? (payload.data.message ?? payload.data.error)
      : i18n.t("hub.account.errors.requestFailedStatus", { status: response.status }),
  );
}
