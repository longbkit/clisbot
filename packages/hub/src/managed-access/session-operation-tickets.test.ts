import { describe, expect, it } from "vitest";
import { SessionOperationTickets } from "./session-operation-tickets.js";
import { sessionOperationContent } from "@getpaseo/protocol/session-operation";

describe("operation identity tickets", () => {
  it("binds the sender snapshot to daemon, channel socket and exact operation; redemption is repeatable", () => {
    const tickets = new SessionOperationTickets();
    const actor = {
      kind: "user" as const,
      id: "slack:U1",
      displayName: "Initial",
      organizationId: "org",
      connectionId: "conn",
    };
    const token = tickets.issue(
      {
        daemonId: "daemon",
        clientId: "channel-account:slack:a",
        digest: "operation",
        identity: { actor },
      },
      1000,
    );
    actor.displayName = "Later";
    const redemption = {
      ticket: token,
      daemonId: "daemon",
      clientId: "channel-account:slack:a",
      digest: "operation",
    };
    expect(tickets.consume(redemption, 1001).actor.displayName).toBe("Initial");
    expect(tickets.consume(redemption, 1002).actor.displayName).toBe("Initial");
    for (const mismatch of [{ daemonId: "other" }, { clientId: "other" }, { digest: "other" }]) {
      expect(() => tickets.consume({ ...redemption, ...mismatch }, 1002)).toThrow(
        "different operation",
      );
    }
    expect(() => tickets.consume(redemption, 61000)).toThrow("expired");
  });
  it("ignores transient RPC correlation but preserves permission request identity and logical content", () => {
    const base = {
      type: "send_agent_message_request",
      requestId: "first",
      text: "hello",
      messageId: "logical",
    };
    expect(sessionOperationContent(base)).toBe(
      sessionOperationContent({ ...base, requestId: "retry", sessionOperationTicket: "new" }),
    );
    expect(sessionOperationContent(base)).not.toBe(
      sessionOperationContent({ ...base, text: "changed" }),
    );
    const permission = { ...base, type: "agent_permission_response" };
    expect(sessionOperationContent(permission)).not.toBe(
      sessionOperationContent({ ...permission, requestId: "other" }),
    );
  });
});
