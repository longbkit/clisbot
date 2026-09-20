import type { Command } from "commander";
import { withOutput, type ListResult, type OutputSchema } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import type { HubDaemonConnection, HubStatus } from "./daemon-client.js";
import { withHubDaemon } from "./daemon-client.js";
import { reportHubProgress, type HubReporter } from "./reporter.js";
import { hubStatusResult } from "./status-output.js";

/**
 * What connecting to a Hub asks for by default.
 *
 * A Hub drives this daemon the way a local client does: it creates agents and
 * workspaces, steers them, answers their permission prompts, and reads which
 * providers and models exist to offer them. Asking for `hub.execute` alone left
 * half of that refused — a channel could start a session but not name its
 * workspace, switch its model, or list the profiles behind `/agent`.
 *
 * Administration is deliberately not in here: `daemon.manage`, `access.manage`,
 * `tunnel.manage` and `automation.manage` stay with the operator. Narrow this
 * further per daemon with `paseo hub permissions revoke <permission>`.
 */
export const DEFAULT_HUB_CONNECTION_PERMISSIONS: readonly string[] = [
  "hub.execute",
  "daemon.read",
  "workspace.read",
  "workspace.write",
  "workspace.manage",
];

interface HubPermissionsOptions {
  host?: string;
  json?: boolean;
}

interface HubPermissionsDependencies {
  daemon: HubDaemonConnection;
  reporter: HubReporter;
}

interface PermissionRow {
  permission: string;
  description: string;
}

const schema: OutputSchema<PermissionRow> = {
  idField: "permission",
  columns: [
    { header: "PERMISSION", field: "permission" },
    { header: "DESCRIPTION", field: "description" },
  ],
};

export function runHubPermissionsList(
  options: HubPermissionsOptions,
  dependencies: HubPermissionsDependencies,
): Promise<ListResult<PermissionRow>> {
  return withHubDaemon(dependencies.daemon, options.host, async (client) => {
    const status = (await client.getHubStatus()).status;
    requireConnectedHub(status);
    return {
      type: "list",
      data: status.permissions.map((permission) => ({
        permission,
        description: describePermission(permission),
      })),
      schema,
    };
  });
}

export function runHubPermissionChange(
  operation: "grant" | "revoke",
  permission: string,
  options: HubPermissionsOptions,
  dependencies: HubPermissionsDependencies,
) {
  return withHubDaemon(dependencies.daemon, options.host, async (client) => {
    const current = (await client.getHubStatus()).status;
    requireConnectedHub(current);
    const response = await client.updateHubPermissions(
      operation === "grant" ? { grant: [permission] } : { revoke: [permission] },
    );
    reportHubProgress(
      dependencies.reporter,
      options,
      `${operation === "grant" ? "Granted" : "Revoked"} ${permission} ${
        operation === "grant" ? "to" : "from"
      } ${response.status.hubOrigin}`,
    );
    return hubStatusResult(response.status);
  });
}

export function addHubPermissionsCommand(
  parent: Command,
  dependencies: HubPermissionsDependencies,
): void {
  const permissions = parent
    .command("permissions")
    .description("Manage this Hub's daemon permissions");

  addJsonAndDaemonHostOptions(permissions.command("list")).action(
    withOutput(async (...args) => {
      const options = args.at(-2) as HubPermissionsOptions;
      return runHubPermissionsList(options, dependencies);
    }),
  );

  for (const operation of ["grant", "revoke"] as const) {
    addJsonAndDaemonHostOptions(
      permissions.command(operation).argument("<permission>", "Daemon permission"),
    ).action(
      withOutput(async (...args) => {
        const permission = args[0] as string;
        const options = args.at(-2) as HubPermissionsOptions;
        return runHubPermissionChange(operation, permission, options, dependencies);
      }),
    );
  }
}

function requireConnectedHub(status: HubStatus): void {
  if (
    status.hubOrigin === null ||
    (status.state !== "connected" && status.state !== "reconnecting")
  ) {
    throw new Error("This daemon is not connected to a Hub");
  }
}

function describePermission(permission: string): string {
  return permission === "hub.execute" ? "Run agents for Hub automations" : permission;
}
