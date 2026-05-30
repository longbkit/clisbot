import type { ChannelIdentity } from "../channels/surface/channel-identity.ts";
import {
  buildNormalizedChannelPrincipal,
  isKnownChannelId,
} from "../channels/integration/channel-surface-contract-registry.ts";
import type { ClisbotConfig } from "../config/core/schema.ts";

export type ResolvedChannelAuth = {
  principal?: string;
  appRole: string;
  agentRole: string;
  appPermissions?: string[];
  agentPermissions?: string[];
  mayBypassPairing: boolean;
  mayBypassSharedSenderPolicy: boolean;
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

export function normalizeAuthPrincipal(principal: string) {
  const trimmed = principal.trim();
  if (!trimmed) {
    return "";
  }

  const separatorIndex = trimmed.indexOf(":");
  const platform = separatorIndex >= 0 ? trimmed.slice(0, separatorIndex) : "";
  const userId = separatorIndex >= 0 ? trimmed.slice(separatorIndex + 1) : "";
  if (!platform || !userId) {
    return trimmed;
  }
  if (!isKnownChannelId(platform)) {
    return trimmed;
  }
  return buildNormalizedChannelPrincipal(platform, userId);
}

function normalizeRoleUsers(users: string[] | undefined) {
  return (users ?? []).map(normalizeAuthPrincipal).filter(Boolean);
}

export function resolveAuthPrincipal(identity: ChannelIdentity) {
  const senderId = identity.senderId?.trim();
  if (!senderId) {
    return undefined;
  }
  return normalizeAuthPrincipal(buildNormalizedChannelPrincipal(identity.platform, senderId));
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

export function hasEffectiveAgentPermission(
  auth: Pick<ResolvedChannelAuth, "appRole" | "agentPermissions">,
  permission: string,
) {
  return auth.appRole === "owner" ||
    auth.appRole === "admin" ||
    (auth.agentPermissions ?? []).includes(permission);
}

export function resolveChannelAuth(params: {
  config: ClisbotConfig;
  agentId: string;
  identity: ChannelIdentity;
}): ResolvedChannelAuth {
  const principal = resolveAuthPrincipal(params.identity);
  return resolvePrincipalAuth({
    config: params.config,
    agentId: params.agentId,
    principal,
  });
}

export function resolvePrincipalAuth(params: {
  config: ClisbotConfig;
  agentId: string;
  principal?: string;
}): ResolvedChannelAuth {
  const principal = params.principal ? normalizeAuthPrincipal(params.principal) : undefined;
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
    appPermissions: [...getAllowedPermissions(params.config.app.auth.roles, appRole)],
    agentPermissions: [...agentPermissions],
    mayBypassPairing: appAdminLike,
    mayBypassSharedSenderPolicy: appAdminLike,
    mayManageProtectedResources,
    canUseShell: appAdminLike || agentPermissions.has("shellExecute"),
  };
}
