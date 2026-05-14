import type { ClisbotConfig } from "../../config/core/schema.ts";
import type { ChannelIdentity } from "../surface/channel-identity.ts";
import { CHANNEL_CONFIG_TARGET_CONTRACTS } from "../integration/channel-installation-inventory.ts";
import {
  type ChannelSurfaceConfigTargetContract,
  type ConfiguredSurfaceTarget,
  type SurfaceConfigTargetBinding,
  type SurfaceTargetScope,
} from "./surface-config-target-contract.ts";

function requireSurfaceConfigTargetContract(channel: ConfiguredSurfaceTarget["channel"]) {
  const contract = CHANNEL_CONFIG_TARGET_CONTRACTS.find((entry) => entry.channel === channel);
  if (!contract) {
    throw new Error(`Unsupported channel config target contract: ${channel}`);
  }
  return contract;
}

export function resolveConfiguredSurfaceTargetBinding(
  config: ClisbotConfig,
  params: ConfiguredSurfaceTarget,
) {
  return requireSurfaceConfigTargetContract(params.channel).resolveConfiguredSurfaceTargetBinding(
    config,
    params,
  );
}

export function buildConfiguredTargetFromIdentity(
  identity: ChannelIdentity,
  options: {
    scope?: SurfaceTargetScope;
  } = {},
): ConfiguredSurfaceTarget {
  return requireSurfaceConfigTargetContract(identity.platform).buildConfiguredTargetFromIdentity(
    identity,
    options,
  );
}

export type { ConfiguredSurfaceTarget, SurfaceConfigTargetBinding, SurfaceTargetScope };
