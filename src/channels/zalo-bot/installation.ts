import zaloBotContract from "./config-bot-contract.ts";
import zaloBotCredentialContract from "./config-credential-contract.ts";
import zaloBotRouteContract from "./config-route-contract.ts";
import zaloBotChannelSchemaContract from "./config-schema.ts";
import zaloBotSurfaceConfigTargetContract from "./config-target.ts";
import zaloBotChannelTemplateContract from "./config-template-contract.ts";
import zaloBotSurfaceContract from "./contract.ts";
import zaloBotPairingAccessContract from "./pairing-access.ts";

export const zaloBotChannelInstallation = {
  surfaceContract: zaloBotSurfaceContract,
  configTarget: zaloBotSurfaceConfigTargetContract,
  pairingAccess: zaloBotPairingAccessContract,
  credentialContract: zaloBotCredentialContract,
  botContract: zaloBotContract,
  routeContract: zaloBotRouteContract,
  schemaContract: zaloBotChannelSchemaContract,
  templateContract: zaloBotChannelTemplateContract,
} as const;

export default zaloBotChannelInstallation;
