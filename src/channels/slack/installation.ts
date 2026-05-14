import slackBotContract from "./config-bot-contract.ts";
import slackCredentialContract from "./config-credential-contract.ts";
import slackRouteContract from "./config-route-contract.ts";
import slackChannelSchemaContract from "./config-schema.ts";
import slackSurfaceConfigTargetContract from "./config-target.ts";
import slackChannelTemplateContract from "./config-template-contract.ts";
import slackSurfaceContract from "./contract.ts";
import slackLegacyConfigMigrationContract from "./legacy-config-migration-contract.ts";
import slackPairingAccessContract from "./pairing-access.ts";

export const slackChannelInstallation = {
  surfaceContract: slackSurfaceContract,
  configTarget: slackSurfaceConfigTargetContract,
  pairingAccess: slackPairingAccessContract,
  credentialContract: slackCredentialContract,
  botContract: slackBotContract,
  routeContract: slackRouteContract,
  schemaContract: slackChannelSchemaContract,
  templateContract: slackChannelTemplateContract,
  legacyConfigMigrationContract: slackLegacyConfigMigrationContract,
} as const;

export default slackChannelInstallation;
