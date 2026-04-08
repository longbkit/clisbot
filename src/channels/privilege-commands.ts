export type PrivilegeCommandsConfig = {
  enabled: boolean;
  allowUsers: string[];
};

export type PrivilegeCommandsOverride = {
  enabled?: boolean;
  allowUsers?: string[];
};

export function resolvePrivilegeCommands(
  rootConfig: PrivilegeCommandsConfig,
  override?: PrivilegeCommandsOverride,
): PrivilegeCommandsConfig {
  return {
    enabled: override?.enabled ?? rootConfig.enabled,
    allowUsers: override?.allowUsers ?? rootConfig.allowUsers,
  };
}

export function canUsePrivilegeCommands(params: {
  config: PrivilegeCommandsConfig;
  userId?: string;
}) {
  if (!params.config.enabled) {
    return false;
  }

  if (!params.config.allowUsers.length) {
    return true;
  }

  const normalizedUserId = params.userId?.trim() ?? "";
  if (!normalizedUserId) {
    return false;
  }

  return params.config.allowUsers.includes(normalizedUserId);
}
