/** Discovery does not confer authority: opening setup is always allowed for a known Host. */
export function canOpenChannelSetup(serverId: string): boolean {
  return serverId.trim().length > 0;
}
