// upstream: extensions/whatsapp/src/account-types.ts@3928bad9bad
// Whatsapp plugin module implements account types behavior.
import type { OpenClawConfig } from "@clisbot/channels-core/plugin-sdk/config-contracts";

export type WhatsAppAccountConfig = NonNullable<
  NonNullable<NonNullable<OpenClawConfig["channels"]>["whatsapp"]>["accounts"]
>[string];
