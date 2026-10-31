import { usePanelStore } from "@/stores/panel-store";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { useNavigationStore } from "@/clisbot/navigation/store";
import { useIssueStore } from "@/clisbot/navigation/issue-store";
import { useTranscriptStore } from "@/clisbot/bots/data/transcript-store";
import { useProviderSubagentStore } from "@/subagents/provider-store";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { formatPerfLine } from "./collector";
import { instrumentStore, instrumentTimers } from "./instrument";
import { perfProbe } from "./probe";

const REPORT_MS = 10_000;
const LAG_SAMPLE_MS = 50;

/** Installs the probe's hooks and starts its report. A no-op unless the build enabled it. */
export function startPerfProbe(): void {
  const collector = perfProbe;
  if (!collector) return;
  const now = () => performance.now();
  // The probe's own timers run on the originals, so they never show in its report.
  const schedule = globalThis.setInterval;
  instrumentTimers(globalThis, collector, now);

  instrumentStore(collector, "session", useSessionStore);
  instrumentStore(collector, "panel", usePanelStore);
  instrumentStore(collector, "workspaceLayout", useWorkspaceLayoutStore);
  instrumentStore(collector, "sidebarView", useSidebarViewStore);
  instrumentStore(collector, "navigation", useNavigationStore);
  instrumentStore(collector, "issue", useIssueStore);
  instrumentStore(collector, "transcript", useTranscriptStore);
  instrumentStore(collector, "providerSubagent", useProviderSubagentStore);
  getHostRuntimeStore().subscribeAll(() => collector.storeCommit("hostRuntime", null));

  // Event-loop lag: how late a 50 ms tick fires is how long the thread was busy.
  let previous = now();
  schedule(() => {
    const current = now();
    collector.lag(current - previous - LAG_SAMPLE_MS);
    previous = current;
  }, LAG_SAMPLE_MS);
  schedule(() => {
    // oxlint-disable-next-line no-console -- The probe's only output is this logcat line.
    console.log(formatPerfLine(collector.flush()));
  }, REPORT_MS);
}
