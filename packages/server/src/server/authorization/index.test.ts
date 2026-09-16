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
import type { ProjectPrivilege } from "../managed-access/types.js";

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
  if (type === "status")
    return {
      type,
      payload: { status: "agent_create_failed", error: "test", requestId: "test" },
    } as SessionOutboundMessage;
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
    expect(authorization.allowsInbound(inboundMessage("get_providers_snapshot_request"))).toBe(
      true,
    );
    expect(authorization.allowsInbound(inboundMessage("refresh_providers_snapshot_request"))).toBe(
      true,
    );
    expect(authorization.allowsOutbound(outboundMessage("get_providers_snapshot_response"))).toBe(
      true,
    );
    expect(authorization.allowsOutbound(outboundMessage("providers_snapshot_update"))).toBe(true);
    expect(
      authorization.allowsOutbound(outboundMessage("refresh_providers_snapshot_response")),
    ).toBe(true);
    expect(authorization.allowsInbound(inboundMessage("get_daemon_config_request"))).toBe(false);
    expect(authorization.allowsInbound(inboundMessage("provider_diagnostic_request"))).toBe(false);
    expect(authorization.allowsInbound(inboundMessage("ping"))).toBe(false);
    expect(
      authorization.allowsInbound(inboundMessage("hub.management.daemon.get_status.request")),
    ).toBe(false);
  });

  test("Hub can operate ordinary agents and recover workspaces without daemon administration", () => {
    const authorization = new SessionAuthorization(["hub.execute"]);
    for (const type of [
      "create_agent_request",
      "send_agent_message_request",
      "fetch_agent_request",
      "agent.timeline.set_subscription.request",
      "workspace.recovery.inspect.request",
      "workspace.recovery.restore.request",
    ] as const) {
      expect(authorization.allowsInbound(inboundMessage(type))).toBe(true);
    }
    for (const type of [
      "status",
      "agent_update",
      "agent_stream",
      "send_agent_message_response",
      "workspace.recovery.restore.response",
    ] as const) {
      expect(authorization.allowsOutbound(outboundMessage(type))).toBe(true);
    }
    for (const type of [
      "restart_server_request",
      "terminal_input",
      "hub.management.daemon.permissions.update.request",
    ] as const) {
      expect(authorization.allowsInbound(inboundMessage(type))).toBe(false);
    }
    expect(
      authorization.allowsOutbound({
        type: "status",
        payload: { status: "shutdown_requested", clientId: "owner", requestId: "shutdown" },
      }),
    ).toBe(false);
    authorization.replacePermissions([]);
    expect(authorization.allowsInbound(inboundMessage("send_agent_message_request"))).toBe(false);
    expect(authorization.allowsOutbound(outboundMessage("agent_update"))).toBe(false);
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

describe("Host-wide Project privileges", () => {
  function managed(daemonPrivileges: ReadonlySet<ProjectPrivilege> | undefined, expired = false) {
    return new SessionAuthorization(["workspace.read", "workspace.write", "workspace.manage"], {
      resourceMode: "projects",
      projects: new Map(),
      ...(daemonPrivileges === undefined ? {} : { daemonPrivileges }),
      leaseId: "lease-a",
      leaseExpiresAt: Date.now() + (expired ? -1 : 60_000),
    });
  }

  test("count only with project.use and an active lease, like a Project grant", () => {
    expect(
      managed(new Set(["project.use", "workspace.manage"])).allowsDaemonPrivilege(
        "workspace.manage",
      ),
    ).toBe(true);
    expect(managed(new Set(["workspace.manage"])).allowsDaemonPrivilege("workspace.manage")).toBe(
      false,
    );
    expect(managed(undefined).allowsDaemonPrivilege("workspace.manage")).toBe(false);
    expect(
      managed(new Set(["project.use", "workspace.manage"]), true).allowsDaemonPrivilege(
        "workspace.manage",
      ),
    ).toBe(false);
  });
});
