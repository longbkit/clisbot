import { readEditableConfig, writeEditableConfig } from "../../config/core/config-file.ts";
import type { ChannelInteractionIdentity } from "../message/interaction-processing.ts";
import {
  buildConfiguredTargetFromIdentity,
  resolveConfiguredSurfaceModeTarget,
  type AdditionalMessageMode,
  type ConfiguredSurfaceModeTarget,
} from "./surface-mode-config.ts";

export type { AdditionalMessageMode } from "./surface-mode-config.ts";
export type ConfiguredAdditionalMessageModeTarget = ConfiguredSurfaceModeTarget;

function getEditableConfigPath() {
  return process.env.CLISBOT_CONFIG_PATH;
}

export async function getConversationAdditionalMessageMode(params: {
  identity: ChannelInteractionIdentity;
}) {
  const { config } = await readEditableConfig(getEditableConfigPath());
  const target = resolveConfiguredSurfaceModeTarget(
    config,
    "additionalMessageMode",
    buildConfiguredTargetFromIdentity(params.identity),
  );

  return {
    label: target.label,
    additionalMessageMode: target.get(),
  };
}

export async function setConversationAdditionalMessageMode(params: {
  identity: ChannelInteractionIdentity;
  additionalMessageMode: AdditionalMessageMode;
}) {
  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  const target = resolveConfiguredSurfaceModeTarget(
    config,
    "additionalMessageMode",
    buildConfiguredTargetFromIdentity(params.identity),
  );
  target.set(params.additionalMessageMode);
  await writeEditableConfig(configPath, config);
  return {
    configPath,
    label: target.label,
    additionalMessageMode: params.additionalMessageMode,
  };
}

export async function getConfiguredAdditionalMessageMode(
  params: ConfiguredAdditionalMessageModeTarget,
) {
  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  const target = resolveConfiguredSurfaceModeTarget(config, "additionalMessageMode", params);
  return {
    configPath,
    label: target.label,
    additionalMessageMode: target.get(),
  };
}

export async function setConfiguredAdditionalMessageMode(
  params: ConfiguredAdditionalMessageModeTarget & {
    additionalMessageMode: AdditionalMessageMode;
  },
) {
  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  const target = resolveConfiguredSurfaceModeTarget(config, "additionalMessageMode", params);
  target.set(params.additionalMessageMode);
  await writeEditableConfig(configPath, config);
  return {
    configPath,
    label: target.label,
    additionalMessageMode: params.additionalMessageMode,
  };
}
