import { inspectSummaryRecovery } from "./session-summary.js";
import { withSessionStorageIo } from "./paged-journal.js";
import type { AgentStorage } from "../agent-storage.js";
import type { AgentManager } from "../agent-manager.js";
import type { FileAgentTimelineStore } from "./file-agent-timeline-store.js";

/** Recover once at startup; directory listing continues to read summary metadata only. */
export async function recoverStoredSessionAuthorship(
  storage: AgentStorage,
  timeline: FileAgentTimelineStore,
  manager: AgentManager,
): Promise<void> {
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
  for (const record of await storage.list()) {
    if (record.internal) continue;
    const directory = await storage.getSessionDirectory(record.id);
    const inspection = await withSessionStorageIo(() => inspectSummaryRecovery(directory));
    if (inspection.state === "ready") {
      if (inspection.value.watermark !== record.authorshipWatermark)
        await storage.applyAuthorship(record.id, inspection.value);
    } else if (inspection.state === "replay") await timeline.recoverAuthorship(record.id);
    else if (inspection.state === "rebuild")
      await storage.setAuthorshipStatus(record.id, "pending");
    // Empty histories stay unopened. Damaged/missing indexes are rebuilt by an explicit history read.
  }
}
