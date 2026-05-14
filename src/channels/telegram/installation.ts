import telegramBotContract from "./config-bot-contract.ts";
import telegramCredentialContract from "./config-credential-contract.ts";
import telegramRouteContract from "./config-route-contract.ts";
import telegramChannelSchemaContract from "./config-schema.ts";
import telegramSurfaceConfigTargetContract from "./config-target.ts";
import telegramChannelTemplateContract from "./config-template-contract.ts";
import telegramSurfaceContract from "./contract.ts";
import telegramLegacyConfigMigrationContract from "./legacy-config-migration-contract.ts";
import telegramPairingAccessContract from "./pairing-access.ts";

export const telegramChannelInstallation = {
  surfaceContract: telegramSurfaceContract,
  configTarget: telegramSurfaceConfigTargetContract,
  pairingAccess: telegramPairingAccessContract,
  credentialContract: telegramCredentialContract,
  botContract: telegramBotContract,
  routeContract: telegramRouteContract,
  schemaContract: telegramChannelSchemaContract,
  templateContract: telegramChannelTemplateContract,
  legacyConfigMigrationContract: telegramLegacyConfigMigrationContract,
} as const;

export default telegramChannelInstallation;
