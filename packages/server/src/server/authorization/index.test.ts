import { describe, expect, test } from "vitest";
import {
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
  type SessionInboundMessage,
  type SessionOutboundMessage,
} from "../messages.js";
import {
  DAEMON_PERMISSIONS,
  OWNER_PERMISSIONS,
  SessionAuthorization,
  permissionsForLegacyHubScopes,
  parseDaemonPermissions,
} from "./index.js";

function inboundOperationTypes(): SessionInboundMessage["type"][] {
  return SessionInboundMessageSchema.options.map((option) => option.shape.type.value);
}

function outboundOperationTypes(): SessionOutboundMessage["type"][] {
  return SessionOutboundMessageSchema.options.map((option) => option.shape.type.value);
}

function inboundMessage(type: SessionInboundMessage["type"]): SessionInboundMessage {
  return { type } as SessionInboundMessage;
}

function outboundMessage(type: SessionOutboundMessage["type"]): SessionOutboundMessage {
  return { type } as SessionOutboundMessage;
}

describe("SessionAuthorization", () => {
  test("owner authority covers every session operation", () => {
    const authorization = new SessionAuthorization(OWNER_PERMISSIONS);

    expect(
      inboundOperationTypes().every((type) => authorization.allowsInbound(inboundMessage(type))),
    ).toBe(true);
    expect(
      outboundOperationTypes().every((type) => authorization.allowsOutbound(outboundMessage(type))),
    ).toBe(true);
  });

  test("semantic permissions authorize operations instead of RPC namespaces", () => {
    const authorization = new SessionAuthorization(["hub.execute"]);

    expect(authorization.allowsInbound(inboundMessage("hub.execution.agent.create.request"))).toBe(
      true,
    );
    expect(authorization.allowsOutbound(outboundMessage("hub.execution.agent.update"))).toBe(true);
    expect(authorization.allowsInbound(inboundMessage("ping"))).toBe(false);
    expect(
      authorization.allowsInbound(inboundMessage("hub.management.daemon.get_status.request")),
    ).toBe(false);
  });

  test("correlated authorization errors can always be emitted", () => {
    const authorization = new SessionAuthorization([]);

    expect(authorization.allowsOutbound(outboundMessage("rpc_error"))).toBe(true);
  });

  test("legacy Hub authority is translated at one compatibility boundary", () => {
    expect(permissionsForLegacyHubScopes(["hub.execution.*"])).toEqual(["hub.execute"]);
    expect(permissionsForLegacyHubScopes(["*"])).toEqual([]);
  });

  test("permission names are semantic", () => {
    expect(
      DAEMON_PERMISSIONS.every(
        (permission) => !permission.includes("*") && !permission.includes("request"),
      ),
    ).toBe(true);
  });

  test("permission parsing validates against the shared registry and removes duplicates", () => {
    expect(parseDaemonPermissions(["hub.execute", "hub.execute"])).toEqual(["hub.execute"]);
    expect(() => parseDaemonPermissions(["hub.execution.*"])).toThrow("Invalid daemon permission");
  });
});

describe("Project workspace creation", () => {
  function managed(privileges: readonly ("project.use" | "workspace.create")[], expired = false) {
    return new SessionAuthorization(["workspace.read", "workspace.write"], {
      resourceMode: "projects",
      projects: new Map([
        ["project-a", { privileges: new Set(privileges), agentConfigurations: [] }],
      ]),
      leaseId: "lease-a",
      leaseExpiresAt: Date.now() + (expired ? -1 : 60_000),
    });
  }

  test("admits only workspace creation without granting daemon workspace management", () => {
    const authorization = managed(["project.use", "workspace.create"]);
    expect(authorization.allowsInbound(inboundMessage("workspace.create.request"))).toBe(true);
    expect(authorization.allowsOutbound(outboundMessage("workspace.create.response"))).toBe(true);
    expect(authorization.allowsPermission("workspace.manage")).toBe(false);
    const revoked = managed(["project.use", "workspace.create"]);
    revoked.replacePermissions([]);
    expect(revoked.allowsInbound(inboundMessage("workspace.create.request"))).toBe(false);
    for (const type of [
      "project.add.request",
      "project.rename.request",
      "project.remove.request",
      "project.create_directory.request",
      "archive_workspace_request",
      "create_paseo_worktree_request",
    ] as const) {
      expect(authorization.allowsInbound(inboundMessage(type))).toBe(false);
    }
  });

  test("does not widen existing Project grants, expired leases, or ordinary Paseo clients", () => {
    for (const authorization of [
      managed(["project.use"]),
      managed(["workspace.create"]),
      managed(["project.use", "workspace.create"], true),
      new SessionAuthorization(["workspace.write"]),
    ]) {
      expect(authorization.allowsInbound(inboundMessage("workspace.create.request"))).toBe(false);
      expect(authorization.allowsOutbound(outboundMessage("workspace.create.response"))).toBe(
        false,
      );
    }
  });
});
