import {
  APP_ADMIN_PERMISSIONS,
  DEFAULT_AGENT_ADMIN_PERMISSIONS,
} from "../auth/defaults.ts";
import {
  normalizeAuthPrincipal,
  resolvePrincipalAuth,
  type ResolvedChannelAuth,
} from "../auth/resolve.ts";
import { readEditableConfig, writeEditableConfig } from "../config/config-file.ts";
import type { AgentEntry, ClisbotConfig } from "../config/schema.ts";
import { renderCliCommand } from "../shared/cli-name.ts";

function getEditableConfigPath() {
  return process.env.CLISBOT_CONFIG_PATH;
}

function parseRepeatedOption(args: string[], name: string) {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) {
      continue;
    }

    const value = args[index + 1]?.trim();
    if (!value) {
      throw new Error(`Missing value for ${name}`);
    }
    values.push(value);
  }

  return values;
}

function parseSingleOption(args: string[], name: string) {
  const values = parseRepeatedOption(args, name);
  if (values.length === 0) {
    return undefined;
  }
  return values[values.length - 1];
}

function hasFlag(args: string[], name: string) {
  return args.includes(name);
}

type AuthScope =
  | { kind: "app" }
  | { kind: "agent-defaults" }
  | { kind: "agent"; agentId: string };

function parseScope(raw: string | undefined, args: string[]): AuthScope {
  if (raw === "app") {
    return { kind: "app" };
  }

  if (raw === "agent-defaults") {
    return { kind: "agent-defaults" };
  }

  if (raw === "agent") {
    const agentId = parseSingleOption(args, "--agent");
    if (!agentId) {
      throw new Error("Missing value for --agent");
    }
    return { kind: "agent", agentId };
  }

  throw new Error("Scope required: app | agent-defaults | agent");
}

function renderAuthCliHelp() {
  return [
    renderCliCommand("auth"),
    "",
    "Manage auth roles, principals, and permissions in config.",
    "",
    "Usage:",
    `  ${renderCliCommand("auth list [--json]")}`,
    `  ${renderCliCommand("auth show <app|agent-defaults|agent> [--agent <id>] [--json]")}`,
    `  ${renderCliCommand("auth get-permissions --sender <principal> --agent <id> [--json] [--verbose]")}`,
    `  ${renderCliCommand("auth add-user <app|agent-defaults|agent> --role <role> --user <principal> [--agent <id>]")}`,
    `  ${renderCliCommand("auth remove-user <app|agent-defaults|agent> --role <role> --user <principal> [--agent <id>]")}`,
    `  ${renderCliCommand("auth add-permission <app|agent-defaults|agent> --role <role> --permission <permission> [--agent <id>]")}`,
    `  ${renderCliCommand("auth remove-permission <app|agent-defaults|agent> --role <role> --permission <permission> [--agent <id>]")}`,
    "",
    "Scopes:",
    "  app             edit app.auth",
    "  agent-defaults  edit agents.defaults.auth",
    "  agent           edit one agents.list[].auth override; requires --agent <id>",
    "",
    "Permission sets:",
    `  app             ${APP_ADMIN_PERMISSIONS.join(", ")}`,
    `  agent           ${DEFAULT_AGENT_ADMIN_PERMISSIONS.join(", ")}`,
    "",
    "Notes:",
    "  add-user/remove-user mutate roles.<role>.users",
    "  add-permission/remove-permission mutate roles.<role>.allow",
    "  principal format is <platform>:<provider-user-id>, for example telegram:1276408333 or slack:U123",
    "  get-permissions is read-only; use --sender when checking the current message sender",
    "  agent role edits clone the inherited agent-defaults role into the target agent override on first write",
    "  app `owner` and `admin` principals bypass DM pairing automatically once they are granted",
    "",
    "Examples:",
    `  ${renderCliCommand("auth add-user app --role owner --user telegram:1276408333")}`,
    `  ${renderCliCommand("auth get-permissions --sender telegram:1276408333 --agent default --json")}`,
    `  ${renderCliCommand("auth remove-user app --role admin --user slack:U123")}`,
    `  ${renderCliCommand("auth add-user agent --agent default --role admin --user slack:U123")}`,
    `  ${renderCliCommand("auth add-permission agent-defaults --role member --permission shellExecute")}`,
    `  ${renderCliCommand("auth remove-permission agent --agent default --role member --permission shellExecute")}`,
    `  ${renderCliCommand("auth show agent-defaults")}`,
    `  ${renderCliCommand("auth list --json")}`,
  ].join("\n");
}

function cloneRoleDefinition(value: { allow?: string[]; users?: string[] } | undefined) {
  return {
    allow: [...(value?.allow ?? [])],
    users: [...(value?.users ?? [])],
  };
}

function mergeRoleDefinitions(
  inherited: { allow?: string[]; users?: string[] } | undefined,
  override: { allow?: string[]; users?: string[] } | undefined,
) {
  return {
    allow: [...(override?.allow ?? inherited?.allow ?? [])],
    users: [...(override?.users ?? inherited?.users ?? [])],
  };
}

function mergeRoleRecord(
  defaults: Record<string, { allow?: string[]; users?: string[] }> | undefined,
  overrides: Record<string, { allow?: string[]; users?: string[] }> | undefined,
) {
  const merged: Record<string, { allow: string[]; users: string[] }> = {};
  const roleNames = new Set([
    ...Object.keys(defaults ?? {}),
    ...Object.keys(overrides ?? {}),
  ]);

  for (const roleName of roleNames) {
    merged[roleName] = mergeRoleDefinitions(defaults?.[roleName], overrides?.[roleName]);
  }

  return merged;
}

function normalizeUnique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function ensureAgentEntry(config: ClisbotConfig, agentId: string) {
  const entry = config.agents.list.find((item) => item.id === agentId);
  if (!entry) {
    throw new Error(`Unknown agent: ${agentId}`);
  }
  return entry;
}

function getAuthLabel(scope: AuthScope) {
  if (scope.kind === "app") {
    return "app.auth";
  }
  if (scope.kind === "agent-defaults") {
    return "agents.defaults.auth";
  }
  return `agents.list[${scope.agentId}].auth`;
}

function ensureEditableRoleDefinition(role: { allow?: string[]; users?: string[] }) {
  role.allow = role.allow ?? [];
  role.users = role.users ?? [];
  return role as { allow: string[]; users: string[] };
}

function resolveAppRole(config: ClisbotConfig, roleName: string) {
  const role = config.app.auth.roles[roleName];
  if (!role) {
    throw new Error(`Unknown app role: ${roleName}`);
  }
  return ensureEditableRoleDefinition(role);
}

function resolveAgentDefaultsRole(config: ClisbotConfig, roleName: string) {
  const role = config.agents.defaults.auth.roles[roleName];
  if (!role) {
    throw new Error(`Unknown agent-defaults role: ${roleName}`);
  }
  return ensureEditableRoleDefinition(role);
}

function ensureAgentOverrideAuth(entry: AgentEntry, config: ClisbotConfig) {
  if (!entry.auth) {
    entry.auth = {
      defaultRole: config.agents.defaults.auth.defaultRole,
      roles: {},
    };
  }

  return entry.auth;
}

function resolveAgentRoleForEdit(config: ClisbotConfig, agentId: string, roleName: string) {
  const entry = ensureAgentEntry(config, agentId);
  const explicitRole = entry.auth?.roles?.[roleName];
  if (explicitRole) {
    return ensureEditableRoleDefinition(explicitRole);
  }

  const inheritedRole = config.agents.defaults.auth.roles[roleName];
  if (!inheritedRole) {
    throw new Error(`Unknown agent role: ${roleName}`);
  }

  const auth = ensureAgentOverrideAuth(entry, config);
  auth.roles[roleName] = cloneRoleDefinition(inheritedRole);
  return ensureEditableRoleDefinition(auth.roles[roleName]!);
}

function resolveRoleForEdit(config: ClisbotConfig, scope: AuthScope, roleName: string) {
  if (scope.kind === "app") {
    return resolveAppRole(config, roleName);
  }

  if (scope.kind === "agent-defaults") {
    return resolveAgentDefaultsRole(config, roleName);
  }

  return resolveAgentRoleForEdit(config, scope.agentId, roleName);
}

function validatePermission(scope: AuthScope, permission: string) {
  const trimmed = permission.trim();
  if (!trimmed) {
    throw new Error("Missing value for --permission");
  }

  const allowedPermissions = new Set(
    scope.kind === "app" ? APP_ADMIN_PERMISSIONS : DEFAULT_AGENT_ADMIN_PERMISSIONS,
  );
  if (!allowedPermissions.has(trimmed as never)) {
    const sorted = [...allowedPermissions].sort().join(", ");
    throw new Error(`Unknown permission for ${scope.kind}: ${trimmed}. Allowed: ${sorted}`);
  }

  return trimmed;
}

function buildShowPayload(config: ClisbotConfig, scope: AuthScope) {
  if (scope.kind === "app") {
    return config.app.auth;
  }

  if (scope.kind === "agent-defaults") {
    return config.agents.defaults.auth;
  }

  const entry = ensureAgentEntry(config, scope.agentId);
  return {
    defaultRole: entry.auth?.defaultRole ?? config.agents.defaults.auth.defaultRole,
    roles: mergeRoleRecord(config.agents.defaults.auth.roles, entry.auth?.roles),
  };
}

async function listAuth(args: string[]) {
  const { config } = await readEditableConfig(getEditableConfigPath());
  const payload = {
    app: config.app.auth,
    agentDefaults: config.agents.defaults.auth,
    agents: config.agents.list.map((entry) => ({
      agentId: entry.id,
      auth: buildShowPayload(config, { kind: "agent", agentId: entry.id }),
    })),
  };

  if (hasFlag(args, "--json")) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(JSON.stringify(payload, null, 2));
}

async function showAuth(args: string[]) {
  const scope = parseScope(args[0], args.slice(1));
  const { config } = await readEditableConfig(getEditableConfigPath());
  const payload = buildShowPayload(config, scope);

  if (hasFlag(args, "--json")) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(JSON.stringify(payload, null, 2));
}

function renderPermissionExplanation(allowed: boolean, allowedText: string, deniedText: string) {
  return allowed ? `Can ${allowedText}` : `Cannot ${deniedText}`;
}

function permissionEntry(allowed: boolean, allowedText: string, deniedText = allowedText) {
  return {
    allowed,
    explanation: renderPermissionExplanation(allowed, allowedText, deniedText),
  };
}

function buildEffectivePermissionEntries(auth: ResolvedChannelAuth) {
  const appAdminLike = auth.appRole === "owner" || auth.appRole === "admin";
  const agentPermissions = auth.agentPermissions ?? [];
  const allows = (permission: string) => appAdminLike || agentPermissions.includes(permission);
  return {
    sendMessage: permissionEntry(
      allows("sendMessage"),
      "send normal prompts to this agent from the current surface.",
    ),
    manageQueue: permissionEntry(
      allows("queueManage"),
      "use queue commands when a request should wait behind the active run.",
    ),
    manageLoop: permissionEntry(
      allows("loopManage"),
      "create, inspect, and cancel scheduled or repeated messages with clisbot loops. Use for requests like every 7am, daily, weekly, every 5m, or run 3 times.",
      "create, inspect, or cancel scheduled or repeated messages with clisbot loops.",
    ),
    runShellSlashCommand: permissionEntry(
      auth.canUseShell,
      "use shell through clisbot slash commands such as /bash. Normal agent workspace file reads/edits are separate from this permission.",
    ),
    manageProtectedResources: permissionEntry(
      auth.mayManageProtectedResources,
      "change protected clisbot resources such as auth, routes, bots, agents, runtime controls, config, and prompt-governance settings.",
      "change protected clisbot resources such as auth, routes, bots, agents, runtime controls, config, or prompt-governance settings.",
    ),
  };
}

function buildVerbosePermissionResolution(auth: ResolvedChannelAuth) {
  return {
    principal: auth.principal,
    appRole: auth.appRole,
    agentRole: auth.agentRole,
    appPermissions: auth.appPermissions ?? [],
    agentPermissions: auth.agentPermissions ?? [],
    effective: {
      mayBypassPairing: auth.mayBypassPairing,
      mayBypassSharedSenderPolicy: auth.mayBypassSharedSenderPolicy,
      mayManageProtectedResources: auth.mayManageProtectedResources,
      canUseShell: auth.canUseShell,
    },
  };
}

function buildEffectivePermissionPayload(config: ClisbotConfig, args: string[]) {
  const sender = normalizeAuthPrincipal(parseSingleOption(args, "--sender") ?? "");
  const agentId = parseSingleOption(args, "--agent")?.trim();
  if (!sender) {
    throw new Error("Missing value for --sender");
  }
  if (!agentId) {
    throw new Error("Missing value for --agent");
  }
  ensureAgentEntry(config, agentId);

  const auth = resolvePrincipalAuth({ config, agentId, principal: sender });
  return {
    sender,
    agentId,
    permissions: buildEffectivePermissionEntries(auth),
    ...(hasFlag(args, "--verbose")
      ? {
          resolution: buildVerbosePermissionResolution(auth),
        }
      : {}),
  };
}

async function getPermissions(args: string[]) {
  const { config } = await readEditableConfig(getEditableConfigPath());
  const payload = buildEffectivePermissionPayload(config, args);

  if (hasFlag(args, "--json")) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(JSON.stringify(payload, null, 2));
}

async function mutateUsers(
  mode: "add" | "remove",
  args: string[],
) {
  const scope = parseScope(args[0], args.slice(1));
  const roleName = parseSingleOption(args, "--role");
  const principal = parseSingleOption(args, "--user")?.trim();

  if (!roleName) {
    throw new Error("Missing value for --role");
  }
  if (!principal) {
    throw new Error("Missing value for --user");
  }

  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  const role = resolveRoleForEdit(config, scope, roleName);

  role.users = normalizeUnique(
    mode === "add"
      ? [...role.users, principal]
      : role.users.filter((value) => value !== principal),
  );

  await writeEditableConfig(configPath, config);
  console.log(
    `${mode === "add" ? "Added" : "Removed"} user ${principal} ${mode === "add" ? "to" : "from"} ${getAuthLabel(scope)} role ${roleName}.`,
  );
}

async function mutatePermissions(
  mode: "add" | "remove",
  args: string[],
) {
  const scope = parseScope(args[0], args.slice(1));
  const roleName = parseSingleOption(args, "--role");
  const permission = validatePermission(scope, parseSingleOption(args, "--permission") ?? "");

  if (!roleName) {
    throw new Error("Missing value for --role");
  }

  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  const role = resolveRoleForEdit(config, scope, roleName);

  role.allow = normalizeUnique(
    mode === "add"
      ? [...role.allow, permission]
      : role.allow.filter((value) => value !== permission),
  );

  await writeEditableConfig(configPath, config);
  console.log(
    `${mode === "add" ? "Added" : "Removed"} permission ${permission} ${mode === "add" ? "to" : "from"} ${getAuthLabel(scope)} role ${roleName}.`,
  );
}

export async function runAuthCli(args: string[]) {
  const [command, ...rest] = args;

  if (!command || command === "--help" || command === "-h" || command === "help") {
    console.log(renderAuthCliHelp());
    return;
  }

  if (command === "list") {
    await listAuth(rest);
    return;
  }

  if (command === "show") {
    await showAuth(rest);
    return;
  }

  if (command === "get-permissions") {
    await getPermissions(rest);
    return;
  }

  if (command === "add-user") {
    await mutateUsers("add", rest);
    return;
  }

  if (command === "remove-user") {
    await mutateUsers("remove", rest);
    return;
  }

  if (command === "add-permission") {
    await mutatePermissions("add", rest);
    return;
  }

  if (command === "remove-permission") {
    await mutatePermissions("remove", rest);
    return;
  }

  throw new Error(renderAuthCliHelp());
}
