export interface DiscordOperatorAuth {
  token: string;
  clientId?: string;
}

export function readDiscordOperatorAuth(
  environment: Record<string, string | undefined>,
): DiscordOperatorAuth | undefined {
  const token = environment["DISCORD_BOT_TOKEN"];
  const clientId = environment["DISCORD_CLIENT_ID"];

  if (token === undefined || token.length === 0) {
    return undefined;
  }

  return {
    token,
    ...(clientId === undefined || clientId.length === 0 ? {} : { clientId }),
  };
}
