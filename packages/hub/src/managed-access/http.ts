import { z } from "zod";
import { authenticateDaemonRequest } from "../daemons/registration.js";
import type { Database } from "../db/types.js";
import { reportFailure } from "../failures/index.js";
import { AccessTicketError, AccessTicketService } from "./tickets.js";

const consumptionBodySchema = z
  .object({
    accessTicket: z.string().min(1),
    clientId: z.string().min(1),
  })
  .strict();
const refreshBodySchema = z.object({ leaseId: z.string().uuid() }).strict();

export async function consumeDaemonAccessTicket(
  request: Request,
  database: Database,
  tickets: AccessTicketService,
): Promise<Response> {
  const daemonId = request.headers.get("x-paseo-daemon-id");
  if (daemonId === null) return Response.json({ error: "unauthorized" }, { status: 401 });
  const daemon = await authenticateDaemonRequest(request, daemonId, database);
  if (daemon instanceof Response) return daemon;
  if (daemon.status !== "active") {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  let value: unknown;
  try {
    value = await request.json();
  } catch (error) {
    reportFailure(
      error,
      { operation: "managed_access.ticket.consume.parse", component: "managed-access" },
      { kind: "validation" },
    );
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const body = consumptionBodySchema.safeParse(value);
  if (!body.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    const admission = await tickets.consume({ daemonId, ...body.data });
    return accessAdmissionResponse(admission);
  } catch (error) {
    if (error instanceof AccessTicketError) {
      return Response.json({ error: error.code }, { status: 401 });
    }
    throw error;
  }
}

export async function refreshDaemonAccessLease(
  request: Request,
  database: Database,
  tickets: AccessTicketService,
): Promise<Response> {
  const daemonId = request.headers.get("x-paseo-daemon-id");
  if (daemonId === null) return Response.json({ error: "unauthorized" }, { status: 401 });
  const daemon = await authenticateDaemonRequest(request, daemonId, database);
  if (daemon instanceof Response) return daemon;
  if (daemon.status !== "active") {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = refreshBodySchema.safeParse(await request.json().catch(() => undefined));
  if (!body.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    const admission = await tickets.refresh({ daemonId, leaseId: body.data.leaseId });
    return accessAdmissionResponse(admission);
  } catch (error) {
    if (error instanceof AccessTicketError) {
      return Response.json({ error: error.code }, { status: 401 });
    }
    throw error;
  }
}

function accessAdmissionResponse(
  admission: Awaited<ReturnType<AccessTicketService["consume"]>>,
): Response {
  return Response.json({
    leaseId: admission.leaseId,
    principalId: admission.principalId,
    permissions: admission.permissions,
    resourceMode: admission.resourceMode,
    projects: admission.projects,
    leaseExpiresAt: admission.leaseExpiresAt.toISOString(),
  });
}
