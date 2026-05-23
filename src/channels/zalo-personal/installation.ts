import zaloPersonalBotContract from "./config-bot-contract.ts";
import zaloPersonalRouteContract from "./config-route-contract.ts";
import zaloPersonalChannelSchemaContract from "./config-schema.ts";
import zaloPersonalSurfaceConfigTargetContract from "./config-target.ts";
import zaloPersonalChannelTemplateContract from "./config-template-contract.ts";
import zaloPersonalSurfaceContract from "./contract.ts";
import zaloPersonalPairingAccessContract from "./pairing-access.ts";

export const zaloPersonalChannelInstallation = {
  surfaceContract: zaloPersonalSurfaceContract,
  configTarget: zaloPersonalSurfaceConfigTargetContract,
  pairingAccess: zaloPersonalPairingAccessContract,
  botContract: zaloPersonalBotContract,
  routeContract: zaloPersonalRouteContract,
  schemaContract: zaloPersonalChannelSchemaContract,
  templateContract: zaloPersonalChannelTemplateContract,
} as const;

export default zaloPersonalChannelInstallation;
