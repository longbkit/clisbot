import apiBotContract from "./config-bot-contract.ts";
import apiRouteContract from "./config-route-contract.ts";
import apiChannelSchemaContract from "./config-schema.ts";
import apiSurfaceConfigTargetContract from "./config-target.ts";
import apiChannelTemplateContract from "./config-template-contract.ts";
import apiSurfaceContract from "./contract.ts";
import apiPairingAccessContract from "./pairing-access.ts";

export const apiChannelInstallation = {
  surfaceContract: apiSurfaceContract,
  configTarget: apiSurfaceConfigTargetContract,
  pairingAccess: apiPairingAccessContract,
  botContract: apiBotContract,
  routeContract: apiRouteContract,
  schemaContract: apiChannelSchemaContract,
  templateContract: apiChannelTemplateContract,
} as const;

export default apiChannelInstallation;
