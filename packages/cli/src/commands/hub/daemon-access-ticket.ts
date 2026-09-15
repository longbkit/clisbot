import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { PrivateHubCredentialStore } from "./credentials.js";
import { HubHttpClient } from "./hub-client/index.js";
import { requestHub } from "./hub-client/internal/transport.js";

const relationshipSchema = z.object({
  state: z.string(),
  relationship: z.object({ daemonId: z.string().min(1), hubOrigin: z.string().min(1) }),
});
const ticketSchema = z.object({ accessTicket: z.string().min(1) });

/** The daemon closed the hello because managed access needs a Hub ticket. */
export function requiresDaemonAccessTicket(error: unknown): boolean {
  return /managed access ticket required/i.test(error instanceof Error ? error.message : "");
}

/**
 * Tickets for the daemon in this Paseo home, issued by the Hub it is enrolled in to the account
 * that logged this CLI in. The CLI reaches a managed-access daemon the way the app does.
 * Returns `null` when the daemon is not enrolled or this CLI is not logged in to its Hub.
 */
export function createDaemonAccessTicketResolver(input: {
  paseoHome: string;
  clientId: string;
  env?: Readonly<Record<string, string | undefined>>;
}): (() => Promise<string>) | null {
  const enrollment = readEnrollment(input.paseoHome);
  if (enrollment === null) return null;
  const stored = new PrivateHubCredentialStore(input.env).get(enrollment.hubOrigin);
  if (stored === null) return null;
  const { origin, credential } = stored;
  return async () => {
    const identity = await new HubHttpClient().describeCredential(origin, credential);
    const organizationId = encodeURIComponent(identity.organization.id);
    const daemonId = encodeURIComponent(enrollment.daemonId);
    const ticket = await requestHub({
      origin,
      path: `/api/management/v1/organizations/${organizationId}/daemons/${daemonId}/access-tickets`,
      method: "POST",
      apiKey: credential,
      body: { clientId: input.clientId },
      successStatus: 201,
      schema: ticketSchema,
      failureMessage: "Hub did not issue an access ticket for this daemon",
    });
    return ticket.accessTicket;
  };
}

function readEnrollment(paseoHome: string): { daemonId: string; hubOrigin: string } | null {
  try {
    const record = relationshipSchema.parse(
      JSON.parse(readFileSync(path.join(paseoHome, "hub-relationship.json"), "utf8")),
    );
    return record.state === "active" ? record.relationship : null;
  } catch {
    return null;
  }
}
