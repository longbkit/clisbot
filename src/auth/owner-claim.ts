import { statSync } from "node:fs";
import lockfile from "proper-lockfile";
import type { ChannelIdentity } from "../channels/channel-identity.ts";
import {
  ensureEditableConfigFile,
  readEditableConfig,
  writeEditableConfig,
} from "../config/config-file.ts";
import type { ClisbotConfig } from "../config/schema.ts";
import {
  resolveAuthPrincipal,
} from "./resolve.ts";
import { suppressConfigReload } from "../control/config-reload-suppression.ts";

const OWNER_CLAIM_RUNTIME_STARTED_AT_MS = Date.now();
const CONFIG_LOCK_OPTIONS = {
  retries: {
    retries: 10,
    factor: 2,
    minTimeout: 50,
    maxTimeout: 2_000,
    randomize: true,
  },
  stale: 30_000,
} as const;

type OwnerClaimRuntimeState = {
  initialized: boolean;
  armed: boolean;
  closed: boolean;
  openedAtMs: number;
  windowMs: number;
};

const ownerClaimRuntimeState: OwnerClaimRuntimeState = {
  initialized: false,
  armed: false,
  closed: false,
  openedAtMs: OWNER_CLAIM_RUNTIME_STARTED_AT_MS,
  windowMs: 0,
};

function getOwnerUsers(config: ClisbotConfig) {
  return config.app.auth.roles.owner?.users ?? [];
}

function hasConfiguredOwner(config: ClisbotConfig) {
  return getOwnerUsers(config).some((entry) => entry.trim().length > 0);
}

function syncRuntimeStateWithConfig(config: ClisbotConfig) {
  if (hasConfiguredOwner(config)) {
    ownerClaimRuntimeState.closed = true;
  }
}

export function primeOwnerClaimRuntime(
  config: ClisbotConfig,
  nowMs = OWNER_CLAIM_RUNTIME_STARTED_AT_MS,
) {
  if (!ownerClaimRuntimeState.initialized) {
    ownerClaimRuntimeState.initialized = true;
    ownerClaimRuntimeState.armed = !hasConfiguredOwner(config);
    ownerClaimRuntimeState.closed = !ownerClaimRuntimeState.armed;
    ownerClaimRuntimeState.openedAtMs = nowMs;
    ownerClaimRuntimeState.windowMs = Math.max(
      0,
      config.app.auth.ownerClaimWindowMinutes * 60_000,
    );
  }

  syncRuntimeStateWithConfig(config);
  return { ...ownerClaimRuntimeState };
}

export function isOwnerClaimOpen(config: ClisbotConfig, nowMs = Date.now()) {
  primeOwnerClaimRuntime(config);
  syncRuntimeStateWithConfig(config);

  if (ownerClaimRuntimeState.closed || !ownerClaimRuntimeState.armed) {
    return false;
  }

  return nowMs - ownerClaimRuntimeState.openedAtMs <= ownerClaimRuntimeState.windowMs;
}

function syncOwnerUsers(target: ClisbotConfig, source: ClisbotConfig) {
  target.app.auth.roles.owner = {
    ...target.app.auth.roles.owner,
    allow: [...(source.app.auth.roles.owner?.allow ?? target.app.auth.roles.owner?.allow ?? [])],
    users: [...(source.app.auth.roles.owner?.users ?? [])],
  };
}

async function withConfigLock<T>(configPath: string | undefined, fn: (expandedPath: string) => Promise<T>) {
  const expandedPath = await ensureEditableConfigFile(configPath);
  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(expandedPath, CONFIG_LOCK_OPTIONS);
    return await fn(expandedPath);
  } finally {
    if (release) {
      try {
        await release();
      } catch {
        // Ignore unlock failures.
      }
    }
  }
}

export async function claimFirstOwnerFromDirectMessage(params: {
  config: ClisbotConfig;
  configPath?: string;
  identity: ChannelIdentity;
  nowMs?: number;
}) {
  const nowMs = params.nowMs ?? Date.now();
  primeOwnerClaimRuntime(params.config);

  if (params.identity.conversationKind !== "dm") {
    return { claimed: false, principal: undefined };
  }

  const principal = resolveAuthPrincipal(params.identity);
  if (!principal || !isOwnerClaimOpen(params.config, nowMs)) {
    return { claimed: false, principal };
  }

  const result = await withConfigLock(params.configPath, async (expandedPath) => {
    const { config: freshConfig } = await readEditableConfig(expandedPath);
    primeOwnerClaimRuntime(freshConfig);
    syncRuntimeStateWithConfig(freshConfig);

    if (!isOwnerClaimOpen(freshConfig, nowMs)) {
      syncOwnerUsers(params.config, freshConfig);
      return { claimed: false, principal, configPath: expandedPath };
    }

    const currentOwners = getOwnerUsers(freshConfig)
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (currentOwners.includes(principal)) {
      syncOwnerUsers(params.config, freshConfig);
      ownerClaimRuntimeState.closed = true;
      return { claimed: false, principal, configPath: expandedPath };
    }

    freshConfig.app.auth.roles.owner.users = [...currentOwners, principal];
    await writeEditableConfig(expandedPath, freshConfig);
    suppressConfigReload(expandedPath, statSync(expandedPath).mtimeMs);
    syncOwnerUsers(params.config, freshConfig);
    ownerClaimRuntimeState.closed = true;
    console.log(`clisbot auto-claimed first owner ${principal}`);
    return { claimed: true, principal, configPath: expandedPath };
  });

  return result;
}

export function renderFirstOwnerClaimMessage(params: {
  principal: string;
  ownerClaimWindowMinutes: number;
}) {
  return [
    "First owner claim complete.",
    "",
    `principal: \`${params.principal}\``,
    "role: `owner`",
    `reason: no owner was configured, and this was the first direct message received during the first ${params.ownerClaimWindowMinutes} minutes after runtime start`,
    "pairing: not required for you anymore because app owners bypass DM pairing",
    "",
    "You can now:",
    "- chat without pairing approval",
    "- use full app-level control",
    "- manage auth, channels, and agent settings",
    "- use admin-level actions across all agents and routed surfaces",
  ].join("\n");
}

export function resetOwnerClaimRuntimeForTests() {
  ownerClaimRuntimeState.initialized = false;
  ownerClaimRuntimeState.armed = false;
  ownerClaimRuntimeState.closed = false;
  ownerClaimRuntimeState.openedAtMs = OWNER_CLAIM_RUNTIME_STARTED_AT_MS;
  ownerClaimRuntimeState.windowMs = 0;
}
