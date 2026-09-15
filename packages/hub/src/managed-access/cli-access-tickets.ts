import { z } from "zod";
import type { OperationAuthenticator } from "../auth/operation-auth.js";
import { CLI_CREDENTIAL_PREFIX } from "../auth/cli-credentials.js";
import type { DatabaseRuntime, QueryRow } from "../db/runtime/index.js";
import { AccessTicketError, type AccessTicketService } from "./tickets.js";

const requestSchema = z
  .object({
    clientId: z
      .string()
      .min(1)
      .max(256)
      .refine((id) => !id.startsWith("channel-account:"), "Reserved channel client identity"),
  })
  .strict();

interface MemberRow extends QueryRow {
  user_id: string;
  member_id: string;
}

/** Whether a management request is a CLI asking for a daemon access ticket with its credential. */
export function isCliAccessTicketRequest(request: Request, segments: readonly string[]): boolean {
  return (
    request.method.toUpperCase() === "POST" &&
    segments.length === 5 &&
    segments[0] === "organizations" &&
    segments[2] === "daemons" &&
    segments[4] === "access-tickets" &&
    (request.headers.get("authorization")?.startsWith(`Bearer ${CLI_CREDENTIAL_PREFIX}`) ?? false)
  );
}

/**
 * The CLI reaches a managed-access daemon the same way the app does: with a short-lived ticket for
 * the account that approved its credential. The ticket carries that account's current daemon
 * access, so the CLI never holds more authority than the person who logged it in.
 */
export class CliAccessTickets {
  constructor(
    private readonly runtime: DatabaseRuntime,
    private readonly credentials: OperationAuthenticator | undefined,
    private readonly tickets: Pick<AccessTicketService, "issue">,
  ) {}

  async handle(request: Request, organizationId: string, daemonId: string): Promise<Response> {
    if (this.credentials === undefined) return error(503, "auth_unavailable");
    const authorization = await this.credentials.authorize(request, "projects:read");
    if (authorization.status !== "authorized") {
      return error(authorization.status === "forbidden" ? 403 : 401, authorization.status);
    }
    const { kind, credentialId } = authorization.access;
    if (kind !== "cliCredential" || authorization.access.organizationId !== organizationId) {
      return error(403, "organization_required");
    }
    const input = requestSchema.safeParse(await request.json().catch(() => undefined));
    if (!input.success) return error(400, "invalid_request");
    const member = await this.approvingMember(credentialId, organizationId);
    if (member === undefined) return error(403, "access_denied");
    try {
      const ticket = await this.tickets.issue({
        organizationId,
        daemonId,
        userId: member.user_id,
        membershipId: member.member_id,
        clientId: input.data.clientId,
      });
      return Response.json(
        { accessTicket: ticket.accessTicket, expiresAt: ticket.expiresAt.toISOString() },
        { status: 201, headers: { "cache-control": "no-store" } },
      );
    } catch (cause) {
      if (cause instanceof AccessTicketError) return error(403, cause.code);
      throw cause;
    }
  }

  private async approvingMember(
    credentialId: string,
    organizationId: string,
  ): Promise<MemberRow | undefined> {
    const result = await this.runtime.query<MemberRow>(
      `select m.user_id, m.id as member_id
       from organization_cli_credentials c
       join member m on m.organization_id = c.organization_id and m.user_id = c.created_by_user_id
       where c.id = $1 and c.organization_id = $2`,
      [credentialId, organizationId],
    );
    return result.rows[0];
  }
}

function error(status: number, code: string): Response {
  return Response.json({ error: code }, { status });
}
