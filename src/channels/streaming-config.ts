import { readEditableConfig, writeEditableConfig } from "../config/config-file.ts";
import type { ChannelInteractionIdentity } from "./interaction-processing.ts";
import {
  buildConfiguredTargetFromIdentity,
  resolveConfiguredSurfaceModeTarget,
  type ConfiguredSurfaceModeTarget,
  type StreamingMode,
} from "./mode-config-shared.ts";

export type { StreamingMode } from "./mode-config-shared.ts";
export type ConfiguredStreamingTarget = ConfiguredSurfaceModeTarget;

function getEditableConfigPath() {
  return process.env.CLISBOT_CONFIG_PATH;
}

export async function getConversationStreaming(params: {
  identity: ChannelInteractionIdentity;
}) {
  const { config } = await readEditableConfig(getEditableConfigPath());
  const target = resolveConfiguredSurfaceModeTarget(
    config,
    "streaming",
    buildConfiguredTargetFromIdentity(params.identity),
  );

  return {
    label: target.label,
    streaming: target.get(),
  };
}

export async function setConversationStreaming(params: {
  identity: ChannelInteractionIdentity;
  streaming: StreamingMode;
}) {
  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  const target = resolveConfiguredSurfaceModeTarget(
    config,
    "streaming",
    buildConfiguredTargetFromIdentity(params.identity),
  );
  target.set(params.streaming);
  await writeEditableConfig(configPath, config);
  return {
    configPath,
    label: target.label,
    streaming: params.streaming,
  };
}
