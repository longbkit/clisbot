import { describe, expect, test, vi } from "vitest";
import { CliAccessTickets, isCliAccessTicketRequest } from "./cli-access-tickets.js";
import { AccessTicketError } from "./tickets.js";

const PATH = ["organizations", "org-1", "daemons", "daemon-1", "access-tickets"];

function ticketRequest(authorization = "Bearer paseo_cli_abc_secret") {
  return new Request(
    "https://hub.test/api/management/v1/organizations/org-1/daemons/daemon-1/access-tickets",
    {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ clientId: "cid_cli" }),
    },
  );
}

function service(options: {
  kind?: "cliCredential" | "apiKey";
  member?: { user_id: string; member_id: string } | null;
  issue?: () => Promise<{ accessTicket: string; expiresAt: Date }>;
}) {
  const issue = vi.fn(
    options.issue ??
      (async () => ({
        accessTicket: "paseo_dat_ticket",
        expiresAt: new Date("2026-09-15T00:00:00Z"),
      })),
  );
  const tickets = new CliAccessTickets(
    {
      query: async () => ({
        rows: options.member === null ? [] : [options.member ?? { user_id: "u1", member_id: "m1" }],
      }),
    } as never,
    {
      authorize: async () => ({
        status: "authorized",
        access: {
          kind: options.kind ?? "cliCredential",
          credentialId: "cred-1",
          organizationId: "org-1",
          scopes: [],
        },
      }),
    } as never,
    { issue },
  );
  return { tickets, issue };
}

describe("CLI daemon access tickets", () => {
  test("only claims CLI bearer requests for a daemon ticket", () => {
    expect(isCliAccessTicketRequest(ticketRequest(), PATH)).toBe(true);
    expect(isCliAccessTicketRequest(ticketRequest("Bearer paseo_key_x"), PATH)).toBe(false);
    expect(isCliAccessTicketRequest(ticketRequest(), PATH.slice(0, 4))).toBe(false);
  });

  test("issues a ticket for the member who approved the CLI login", async () => {
    const { tickets, issue } = service({});
    const response = await tickets.handle(ticketRequest(), "org-1", "daemon-1");

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ accessTicket: "paseo_dat_ticket" });
    expect(issue).toHaveBeenCalledWith({
      organizationId: "org-1",
      daemonId: "daemon-1",
      userId: "u1",
      membershipId: "m1",
      clientId: "cid_cli",
    });
  });

  test("refuses organization API keys, which act for no person", async () => {
    const { tickets, issue } = service({ kind: "apiKey" });
    const response = await tickets.handle(ticketRequest(), "org-1", "daemon-1");

    expect(response.status).toBe(403);
    expect(issue).not.toHaveBeenCalled();
  });

  test("reports the member's missing daemon access as forbidden", async () => {
    const { tickets } = service({
      issue: async () => {
        throw new AccessTicketError("access_denied", "daemon access is not granted");
      },
    });
    const response = await tickets.handle(ticketRequest(), "org-1", "daemon-1");

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "access_denied" });
  });
});
