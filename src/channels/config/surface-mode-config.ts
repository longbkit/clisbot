import type { ClisbotConfig } from "../../config/core/schema.ts";
import type { ChannelIdentity } from "../surface/channel-identity.ts";
import {
  buildConfiguredTargetFromIdentity,
  resolveConfiguredSurfaceTargetBinding,
  type ConfiguredSurfaceTarget,
} from "./surface-config-target.ts";

export type ResponseMode = "capture-pane" | "message-tool";
export type AdditionalMessageMode = "queue" | "steer";
export type StreamingMode = "off" | "latest" | "all";
export type SurfaceModeChannel = ConfiguredSurfaceTarget["channel"];
export type SurfaceModeField = "responseMode" | "additionalMessageMode" | "streaming";

export type ConfiguredSurfaceModeTarget = ConfiguredSurfaceTarget;

type SurfaceModeValueMap = {
  responseMode: ResponseMode;
  additionalMessageMode: AdditionalMessageMode;
  streaming: StreamingMode;
};

type SurfaceModeSource = Partial<{
  [K in SurfaceModeField]: SurfaceModeValueMap[K];
}>;

type SurfaceModeTargetBinding<TField extends SurfaceModeField> = {
  get: () => SurfaceModeValueMap[TField] | undefined;
  set: (value: SurfaceModeValueMap[TField]) => void;
  label: string;
};

function getModeValue<TField extends SurfaceModeField>(
  source: (SurfaceModeSource & Record<string, unknown>) | undefined,
  field: TField,
) {
  return source?.[field] as SurfaceModeValueMap[TField] | undefined;
}

function setModeValue<TField extends SurfaceModeField>(
  source: SurfaceModeSource & Record<string, unknown>,
  field: TField,
  value: SurfaceModeValueMap[TField],
) {
  source[field] = value;
}


export function resolveConfiguredSurfaceModeTarget<TField extends SurfaceModeField>(
  config: ClisbotConfig,
  field: TField,
  params: ConfiguredSurfaceModeTarget,
) {
  const targetBinding = resolveConfiguredSurfaceTargetBinding(config, params);
  return {
    label: targetBinding.label,
    get: () =>
      [targetBinding.getExactSource(), ...targetBinding.getFallbackSources()]
        .map((source) => getModeValue(source, field))
        .find((value) => value !== undefined),
    set: (value) => {
      setModeValue(targetBinding.ensureWritableSource(), field, value);
    },
  } satisfies SurfaceModeTargetBinding<TField>;
}

export { buildConfiguredTargetFromIdentity };
