import type { BotsRuntimeSnapshot } from "./client";
import { transcriptKey } from "./transcript-store";

/** A new transport admission must prove access before showing a previous principal's data. */
export function botsSessionScope(snapshot: BotsRuntimeSnapshot | null | undefined): string {
  return `${snapshot?.clientGeneration ?? 0}:${snapshot?.connectionEpoch ?? 0}`;
}
export function scopedTranscriptKey(
  serverId: string,
  chatId: string,
  snapshot: BotsRuntimeSnapshot | null | undefined,
): string {
  return transcriptKey(`${serverId}@${botsSessionScope(snapshot)}`, chatId);
}
