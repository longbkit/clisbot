import type { ParsedTokenInput } from "./channel-credentials.ts";

export type ChannelBootstrapBotInput = {
  botId: string;
  appToken?: ParsedTokenInput;
  botToken?: ParsedTokenInput;
  qrPath?: string;
};
