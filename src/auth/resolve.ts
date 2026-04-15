import type { ChannelIdentity } from "../channels/channel-identity.ts";
import type { ClisbotConfig } from "../config/schema.ts";

export type ResolvedChannelAuth = {
  principal?: string;
  appRole: string;
  agentRole: string;
  mayBypassPairing: boolean;
  mayManageProtectedResources: boolean;
  canUseShell: boolean;
};

type AuthRoleDefinition = {
  allow?: string[];
  users?: string[];
};

function mergeRoleDefinitions(
  inherited: AuthRoleDefinition | undefined,
  override: AuthRoleDefinition | undefined,
): AuthRoleDefinition {
  return {
    allow: override?.allow ?? inherited?.allow ?? [],
    users: override?.users ?? inherited?.users ?? [],
  };
}

function mergeRoleRecord(
  defaults: Record<string, AuthRoleDefinition> | undefined,
  overrides: Record<string, AuthRoleDefinition> | undefined,
) {
  const merged: Record<string, AuthRoleDefinition> = {};
  const roleNames = new Set([
    ...Object.keys(defaults ?? {}),
    ...Object.keys(overrides ?? {}),
  ]);

  for (const roleName of roleNames) {
    merged[roleName] = mergeRoleDefinitions(defaults?.[roleName], overrides?.[roleName]);
  }

  return merged;
}

function normalizePrincipal(principal: string) {
  const trimmed = principal.trim();
  if (!trimmed) {
    return "";
  }

  const [platform, userId] = trimmed.split(":", 2);
  if (!platform || !userId) {
    return trimmed;
  }

  if (platform === "slack") {
    return `slack:${userId.trim().toUpperCase()}`;
  }

  if (platform === "telegram") {
    return `telegram:${userId.trim()}`;
  }

  return `${platform}:${userId.trim()}`;
}

function normalizeRoleUsers(users: string[] | undefined) {
  return (users ?? []).map(normalizePrincipal).filter(Boolean);
}

function resolvePrincipal(identity: ChannelIdentity) {
  const senderId = identity.senderId?.trim();
  if (!senderId) {
    return undefined;
  }

  if (identity.platform === "slack") {
    return normalizePrincipal(`slack:${senderId}`);
  }

  return normalizePrincipal(`telegram:${senderId}`);
}

function findExplicitRole(
  roles: Record<string, AuthRoleDefinition> | undefined,
  principal: string | undefined,
) {
  if (!principal || !roles) {
    return undefined;
  }

  for (const [roleName, roleDefinition] of Object.entries(roles)) {
    if (normalizeRoleUsers(roleDefinition.users).includes(principal)) {
      return roleName;
    }
  }

  return undefined;
}

function getAgentAuth(config: ClisbotConfig, agentId: string) {
  const defaults = config.agents.defaults.auth;
  const entry = config.agents.list.find((item) => item.id === agentId);
  const override = entry?.auth;

  return {
    defaultRole: override?.defaultRole ?? defaults.defaultRole,
    roles: mergeRoleRecord(defaults.roles, override?.roles),
  };
}

function getAllowedPermissions(
  roles: Record<string, AuthRoleDefinition> | undefined,
  role: string,
) {
  return new Set(roles?.[role]?.allow ?? []);
}

function hasAppPermission(config: ClisbotConfig, appRole: string, permission: string) {
  if (appRole === "owner") {
    return true;
  }
  return getAllowedPermissions(config.app.auth.roles, appRole).has(permission);
}

export function resolveChannelAuth(params: {
  config: ClisbotConfig;
  agentId: string;
  identity: ChannelIdentity;
}): ResolvedChannelAuth {
  const principal = resolvePrincipal(params.identity);
  const appAuth = params.config.app.auth;
  const explicitAppRole = findExplicitRole(appAuth.roles, principal);
  const appRole = explicitAppRole ?? appAuth.defaultRole;
  const appAdminLike = appRole === "owner" || appRole === "admin";

  const agentAuth = getAgentAuth(params.config, params.agentId);
  const explicitAgentRole = findExplicitRole(agentAuth.roles, principal);
  const agentRole = explicitAgentRole ?? agentAuth.defaultRole;
  const agentPermissions = getAllowedPermissions(agentAuth.roles, agentRole);

  const mayManageProtectedResources =
    appAdminLike ||
    hasAppPermission(params.config, appRole, "configManage") ||
    hasAppPermission(params.config, appRole, "appAuthManage") ||
    hasAppPermission(params.config, appRole, "agentAuthManage") ||
    hasAppPermission(params.config, appRole, "promptGovernanceManage");

  return {
    principal,
    appRole,
    agentRole,
    mayBypassPairing: appAdminLike,
    mayManageProtectedResources,
    canUseShell: appAdminLike || agentPermissions.has("shellExecute"),
  };
}
