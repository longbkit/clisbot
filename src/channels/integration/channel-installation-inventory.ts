import type { ChannelBotContract } from "../../config/channels/channel-bot-contract.ts";
import type { ChannelCredentialContract } from "../../config/channels/channel-credential-contract.ts";
import type { ChannelRouteContract } from "../../config/channels/channel-route-contract.ts";
import type { ChannelSchemaContract } from "../../config/channels/channel-schema-contract.ts";
import type { ChannelTemplateContract } from "../../config/channels/channel-template-contract.ts";
import type { ChannelSurfaceContract } from "./channel-surface-contract.ts";
import type { ChannelLegacyConfigMigrationContract } from "../config/legacy-config-migration-contract.ts";
import type { ChannelPairingAccessContract } from "../pairing/access-contract.ts";
import type { ChannelSurfaceConfigTargetContract } from "../config/surface-config-target-contract.ts";
import slackChannelInstallation from "../slack/installation.ts";
import telegramChannelInstallation from "../telegram/installation.ts";
import zaloBotChannelInstallation from "../zalo-bot/installation.ts";

export type ChannelInstallation = {
  surfaceContract: ChannelSurfaceContract;
  configTarget: ChannelSurfaceConfigTargetContract;
  pairingAccess: ChannelPairingAccessContract;
  credentialContract: ChannelCredentialContract;
  botContract: ChannelBotContract;
  routeContract: ChannelRouteContract;
  schemaContract: ChannelSchemaContract;
  templateContract: ChannelTemplateContract;
  legacyConfigMigrationContract?: ChannelLegacyConfigMigrationContract;
};

export const CHANNEL_INSTALLATIONS = [
  slackChannelInstallation,
  telegramChannelInstallation,
  zaloBotChannelInstallation,
] as const satisfies readonly ChannelInstallation[];

function projectInstallations<TValue>(
  read: (installation: ChannelInstallation) => TValue,
): readonly TValue[] {
  return CHANNEL_INSTALLATIONS.map(read);
}

export const CHANNEL_SURFACE_CONTRACTS: readonly ChannelSurfaceContract[] = projectInstallations(
  (installation) => installation.surfaceContract,
);
export const CHANNEL_CONFIG_TARGET_CONTRACTS: readonly ChannelSurfaceConfigTargetContract[] = projectInstallations(
  (installation) => installation.configTarget,
);
export const CHANNEL_PAIRING_ACCESS_CONTRACTS: readonly ChannelPairingAccessContract[] = projectInstallations(
  (installation) => installation.pairingAccess,
);
export const CHANNEL_CREDENTIAL_CONTRACTS: readonly ChannelCredentialContract[] = projectInstallations(
  (installation) => installation.credentialContract,
);
export const CHANNEL_BOT_CONTRACTS: readonly ChannelBotContract[] = projectInstallations(
  (installation) => installation.botContract,
);
export const CHANNEL_ROUTE_CONTRACTS: readonly ChannelRouteContract[] = projectInstallations(
  (installation) => installation.routeContract,
);
export const CHANNEL_SCHEMA_CONTRACTS: readonly ChannelSchemaContract[] = projectInstallations(
  (installation) => installation.schemaContract,
);
export const CHANNEL_TEMPLATE_CONTRACTS: readonly ChannelTemplateContract[] = projectInstallations(
  (installation) => installation.templateContract,
);
export const CHANNEL_LEGACY_CONFIG_MIGRATION_CONTRACTS: readonly ChannelLegacyConfigMigrationContract[] =
  CHANNEL_INSTALLATIONS
    .map((installation: ChannelInstallation) => installation.legacyConfigMigrationContract)
    .filter((contract): contract is ChannelLegacyConfigMigrationContract => Boolean(contract));
