import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { respondOk, type Result } from "../contract/respond.js";
import { reportFailure, respondWithFailure } from "../failures/index.js";
import { getApplication } from "../server/runtime.js";

const daemonSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  status: z.enum(["active", "revoked"]),
  presence: z.enum(["offline", "connected"]),
  connectedAt: z.string().datetime().nullable(),
  lastSeenAt: z.string().datetime(),
  registeredAt: z.string().datetime(),
  permissions: z.array(z.string()),
});
const daemonListSchema = z.object({
  daemons: z.array(daemonSchema),
  canManage: z.boolean(),
});
const renameSchema = z.object({ daemonId: z.string().uuid(), slug: z.string() });
const daemonIdSchema = z.object({ daemonId: z.string().uuid() });
const organizationScopeSchema = z.object({ organizationSlug: z.string().min(1) });
const scopedRenameSchema = organizationScopeSchema.extend(renameSchema.shape);
const scopedDaemonIdSchema = organizationScopeSchema.extend(daemonIdSchema.shape);

export type BrowserDaemon = z.infer<typeof daemonSchema>;
export type BrowserDaemonList = z.infer<typeof daemonListSchema>;
export interface DaemonCommand {
  state: "complete" | "sessionExpired" | "organizationRequired";
}

export const daemonList = createServerFn({ method: "GET" })
  .validator(organizationScopeSchema)
  .handler(async ({ data }): Promise<Result<z.infer<typeof daemonListSchema>>> => {
    try {
      const response = await (
        await getApplication()
      ).operations.handleOrganizationDaemons(
        operationRequest("GET", "/organization/daemons", undefined, data.organizationSlug),
      );
      if (!response.ok) {
        return daemonResponseFailure(
          "daemon.list",
          response,
          "Hub couldn't load this organization's daemons. Reload the page.",
          data.organizationSlug,
        );
      }
      return respondOk(daemonListSchema.parse(await response.json()));
    } catch (error) {
      return respondWithFailure(error, daemonContext("daemon.list", data.organizationSlug), {
        fallback: "Hub couldn't load this organization's daemons. Reload the page.",
      });
    }
  });

export const renameDaemon = createServerFn({ method: "POST" })
  .validator(scopedRenameSchema)
  .handler(async ({ data }): Promise<Result<DaemonCommand>> => {
    try {
      const response = await (
        await getApplication()
      ).operations.handleOrganizationDaemonRename(
        operationRequest(
          "POST",
          "/organization/daemons/rename",
          {
            slug: data.slug,
          },
          data.organizationSlug,
        ),
        data.daemonId,
      );
      if (response.status === 401)
        return daemonStateFailure("daemon.rename", response, "sessionExpired", data);
      if (response.status === 403) {
        const failure = z.object({ error: z.string() }).safeParse(await response.json());
        if (failure.success && failure.data.error === "organization_required") {
          return daemonStateFailure("daemon.rename", response, "organizationRequired", data);
        }
      }
      if (response.status === 409) {
        const failure = z
          .object({ error: z.literal("daemon_slug_conflict"), slug: z.string() })
          .safeParse(await response.json());
        if (failure.success) {
          return respondWithFailure(
            new Error("daemon slug conflict"),
            daemonContext("daemon.rename", data.organizationSlug, data.daemonId),
            {
              fallback: `The daemon slug “${failure.data.slug}” is already in use. Choose another slug.`,
            },
            { kind: "conflict" },
          );
        }
      }
      if (!response.ok)
        return daemonResponseFailure(
          "daemon.rename",
          response,
          "Hub couldn't rename the daemon. Reload its current name before submitting again.",
          data.organizationSlug,
          data.daemonId,
        );
      return respondOk({ state: "complete" });
    } catch (error) {
      return respondWithFailure(
        error,
        daemonContext("daemon.rename", data.organizationSlug, data.daemonId),
        {
          fallback:
            "Hub couldn't rename the daemon. Reload its current name before submitting again.",
        },
      );
    }
  });

export const revokeDaemon = createServerFn({ method: "POST" })
  .validator(scopedDaemonIdSchema)
  .handler(async ({ data }): Promise<Result<DaemonCommand>> => {
    try {
      const response = await (
        await getApplication()
      ).operations.handleOrganizationDaemonRevocation(
        operationRequest("POST", "/organization/daemons/revoke", {}, data.organizationSlug),
        data.daemonId,
      );
      if (response.status === 401)
        return daemonStateFailure("daemon.revoke", response, "sessionExpired", data);
      if (response.status === 403) {
        const failure = z.object({ error: z.string() }).safeParse(await response.json());
        if (failure.success && failure.data.error === "organization_required") {
          return daemonStateFailure("daemon.revoke", response, "organizationRequired", data);
        }
      }
      if (!response.ok)
        return daemonResponseFailure(
          "daemon.revoke",
          response,
          "Hub couldn't revoke the daemon. Reload its status before submitting again.",
          data.organizationSlug,
          data.daemonId,
        );
      return respondOk({ state: "complete" });
    } catch (error) {
      return respondWithFailure(
        error,
        daemonContext("daemon.revoke", data.organizationSlug, data.daemonId),
        { fallback: "Hub couldn't revoke the daemon. Reload its status before submitting again." },
      );
    }
  });

function operationRequest(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  organizationSlug?: string,
): Request {
  const incoming = getRequest();
  const headers = new Headers(incoming.headers);
  headers.delete("content-length");
  if (body !== undefined) headers.set("content-type", "application/json");
  const url = new URL(path, incoming.url);
  if (organizationSlug !== undefined) url.searchParams.set("organizationSlug", organizationSlug);
  return new Request(url, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function daemonContext(operation: string, organizationSlug: string, daemonId?: string) {
  return {
    operation,
    component: "daemons",
    organizationSlug,
    ...(daemonId === undefined ? {} : { daemonId }),
  } as const;
}

function daemonResponseFailure(
  operation: string,
  response: Response,
  message: string,
  organizationSlug: string,
  daemonId?: string,
) {
  return respondWithFailure(
    new Error(`daemon operation returned HTTP ${response.status}`),
    { ...daemonContext(operation, organizationSlug, daemonId), status: response.status },
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

function daemonStateFailure(
  operation: string,
  response: Response,
  state: "sessionExpired" | "organizationRequired",
  data: { organizationSlug: string; daemonId: string },
): Result<DaemonCommand> {
  reportFailure(
    new Error(`daemon operation returned HTTP ${response.status}`),
    { ...daemonContext(operation, data.organizationSlug, data.daemonId), status: response.status },
    { status: response.status },
  );
  return respondOk({ state });
}
