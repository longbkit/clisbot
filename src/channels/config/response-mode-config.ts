import { readEditableConfig, writeEditableConfig } from "../../config/core/config-file.ts";
import type { ChannelInteractionIdentity } from "../message/interaction-processing.ts";
import {
  buildConfiguredTargetFromIdentity,
  resolveConfiguredSurfaceModeTarget,
  type ConfiguredSurfaceModeTarget,
  type ResponseMode,
} from "./surface-mode-config.ts";

export type { ResponseMode, SurfaceModeChannel as ResponseModeChannel } from "./surface-mode-config.ts";
export type ConfiguredResponseModeTarget = ConfiguredSurfaceModeTarget;

function getEditableConfigPath() {
  return process.env.CLISBOT_CONFIG_PATH;
}

export async function getConversationResponseMode(params: {
  identity: ChannelInteractionIdentity;
}) {
  const { config } = await readEditableConfig(getEditableConfigPath());
  const target = resolveConfiguredSurfaceModeTarget(
    config,
    "responseMode",
    buildConfiguredTargetFromIdentity(params.identity),
  );

  return {
    label: target.label,
    responseMode: target.get(),
  };
}

export async function setConversationResponseMode(params: {
  identity: ChannelInteractionIdentity;
  responseMode: ResponseMode;
}) {
  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  const target = resolveConfiguredSurfaceModeTarget(
    config,
    "responseMode",
    buildConfiguredTargetFromIdentity(params.identity),
  );
  target.set(params.responseMode);
  await writeEditableConfig(configPath, config);
  return {
    configPath,
    label: target.label,
    responseMode: params.responseMode,
  };
}

export async function getConfiguredResponseMode(params: ConfiguredResponseModeTarget) {
  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  const target = resolveConfiguredSurfaceModeTarget(config, "responseMode", params);
  return {
    configPath,
    label: target.label,
    responseMode: target.get(),
  };
}

export async function setConfiguredResponseMode(
  params: ConfiguredResponseModeTarget & {
    responseMode: ResponseMode;
  },
) {
  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  const target = resolveConfiguredSurfaceModeTarget(config, "responseMode", params);
  target.set(params.responseMode);
  await writeEditableConfig(configPath, config);
  return {
    configPath,
    label: target.label,
    responseMode: params.responseMode,
  };
}
