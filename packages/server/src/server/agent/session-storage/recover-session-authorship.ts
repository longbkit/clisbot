import { inspectSummaryRecovery } from "./session-summary.js";
import { withSessionStorageIo } from "./paged-journal.js";
import { DeferredAuthorshipProbes } from "./deferred-authorship-probes.js";
import type { Logger } from "pino";
import type { AgentStorage, StoredAgentRecord } from "../agent-storage.js";
import type { AgentManager } from "../agent-manager.js";
import type { FileAgentTimelineStore } from "./file-agent-timeline-store.js";

/**
 * Recover once at startup; directory listing continues to read summary metadata only.
 * Records `isCold` selects are probed later instead (docs/features/agent-session-storage/
 * cold-storage.md); the returned probes own them.
 */
export async function recoverStoredSessionAuthorship(
  storage: AgentStorage,
  timeline: FileAgentTimelineStore,
  manager: AgentManager,
  cold?: { isCold: (record: StoredAgentRecord) => boolean; logger: Logger },
): Promise<DeferredAuthorshipProbes | null> {
  timeline.setAuthorshipRecoveryObserver(async (agentId, status) => {
    await storage.setAuthorshipStatus(agentId, status);
    const record = await storage.get(agentId);
    if (record) manager.applySessionAuthorship(agentId, record);
  });
  timeline.setAuthorshipObserver(async (agentId, value) => {
    if (!(await storage.applyAuthorship(agentId, value))) return;
    const record = await storage.get(agentId);
    if (record) manager.applySessionAuthorship(agentId, record);
  });
  const deferred: string[] = [];
  for (const record of await storage.list()) {
    if (record.internal) continue;
    if (cold?.isCold(record)) deferred.push(record.id);
    else await probeSessionAuthorship(storage, timeline, record, "await");
  }
  if (!cold) return null;
  const probes = new DeferredAuthorshipProbes(
    deferred,
    async (agentId) => {
      const record = await storage.get(agentId);
      // Inside a history operation: a replay is queued, never awaited, so it cannot wait on itself.
      if (record) await probeSessionAuthorship(storage, timeline, record, "schedule");
    },
    cold.logger,
  );
  timeline.setOpenObserver((agentId) => probes.hydrate(agentId));
  return probes;
}

async function probeSessionAuthorship(
  storage: AgentStorage,
  timeline: FileAgentTimelineStore,
  record: StoredAgentRecord,
  replay: "await" | "schedule",
): Promise<void> {
  const directory = await storage.getSessionDirectory(record.id);
  const inspection = await withSessionStorageIo(() => inspectSummaryRecovery(directory));
  if (inspection.state === "ready") {
    if (inspection.value.watermark !== record.authorshipWatermark)
      await storage.applyAuthorship(record.id, inspection.value);
  } else if (inspection.state === "replay") {
    if (replay === "await") await timeline.recoverAuthorship(record.id);
    else timeline.scheduleAuthorshipRecovery(record.id, true);
  } else if (inspection.state === "rebuild")
    await storage.setAuthorshipStatus(record.id, "pending");
  // Empty histories stay unopened. Damaged/missing indexes are rebuilt by an explicit history read.
}
