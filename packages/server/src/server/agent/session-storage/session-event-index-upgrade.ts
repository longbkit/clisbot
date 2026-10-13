import {
  toolCallId,
  type SessionEventEnvelope,
  type SessionEventIndex,
} from "./session-event-index.js";
import { scanSessionEventLines } from "./session-event-scan.js";

/** Preserve the valid checkpoint, repairing only lists that the old 256-entry cap may truncate. */
export async function upgradeToolIndex(
  index: SessionEventIndex,
  eventPath: string,
): Promise<boolean> {
  if (index.version === 3) return false;
  const incomplete = new Map(
    Object.entries(index.tools)
      .filter(([, seqs]) => seqs.length >= 256)
      .map(([id]) => [id, new Set<number>()]),
  );
  if (incomplete.size) {
    for await (const { line, offset } of scanSessionEventLines(eventPath, 0, index.scannedBytes)) {
      let envelope: SessionEventEnvelope<unknown>;
      try {
        envelope = JSON.parse(line) as SessionEventEnvelope<unknown>;
      } catch {
        continue;
      }
      if (!envelope || index.pointers[`${envelope.kind}:${envelope.seq}`]?.offset !== offset)
        continue;
      const callId = toolCallId(envelope);
      if (callId) incomplete.get(callId)?.add(envelope.seq);
    }
  }
  for (const [id, seqs] of incomplete)
    index.tools[id] = [...seqs].sort((left, right) => left - right);
  index.version = 3;
  return true;
}
