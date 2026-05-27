import type { FollowUpMode } from "../../agents/commands/follow-up-policy.ts";
import { readEditableConfig, writeEditableConfig } from "../../config/core/config-file.ts";
import type { ClisbotConfig } from "../../config/core/schema.ts";
import type { ChannelIdentity } from "../surface/channel-identity.ts";
import { resolveChannelIdentityBotId } from "../surface/channel-identity.ts";
import {
  buildConfiguredTargetFromIdentity,
  resolveConfiguredSurfaceTargetBinding,
  type ConfiguredSurfaceTarget,
} from "./surface-config-target.ts";

export type ConfiguredFollowUpModeScope = "channel" | "all";

type ConfiguredFollowUpModeTarget = ConfiguredSurfaceTarget;

type FollowUpModeTargetBinding = {
  get: () => FollowUpMode | undefined;
  set: (value: FollowUpMode) => void;
  label: string;
};

function getEditableConfigPath() {
  return process.env.CLISBOT_CONFIG_PATH;
}

function getOrCreateFollowUp(source: Record<string, unknown>) {
  const existing = source.followUp;
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    return existing as { mode?: FollowUpMode };
  }

  const created: { mode?: FollowUpMode } = {};
  source.followUp = created;
  return created;
}

function resolveConfiguredFollowUpModeTarget(
  config: ClisbotConfig,
  params: ConfiguredFollowUpModeTarget,
): FollowUpModeTargetBinding {
  const targetBinding = resolveConfiguredSurfaceTargetBinding(config, params);
  return {
    label: targetBinding.label,
    get: () =>
      [targetBinding.getExactSource(), ...targetBinding.getFallbackSources()]
        .map((source) => source?.followUp)
        .find((followUp): followUp is { mode?: FollowUpMode } =>
          typeof followUp === "object" && followUp !== null
        )?.mode,
    set: (value) => {
      getOrCreateFollowUp(targetBinding.ensureWritableSource()).mode = value;
    },
  } satisfies FollowUpModeTargetBinding;
}

export async function setScopedConversationFollowUpMode(params: {
  identity: ChannelIdentity;
  scope: ConfiguredFollowUpModeScope;
  mode: FollowUpMode;
}) {
  if (params.identity.platform === "terminal") {
    return undefined;
  }
  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  const target = resolveConfiguredFollowUpModeTarget(
    config,
    params.scope === "all"
      ? {
          channel: params.identity.platform as ConfiguredSurfaceTarget["channel"],
          botId: resolveChannelIdentityBotId(params.identity),
        }
      : buildConfiguredTargetFromIdentity(params.identity, {
          scope: "channel",
        }),
  );
  target.set(params.mode);
  await writeEditableConfig(configPath, config);
  return {
    configPath,
    label: target.label,
    followUpMode: params.mode,
  };
}
