import { describeHubFailure } from "@/clisbot/hub/hub-failure";
import type { HubSourceSummary, SourceHealthSummary } from "@/hooks/use-source-health";
import { describeSourceProblem } from "@/hooks/use-source-health";
import { offlineT } from "@/i18n/offline";

/**
 * Home's one-line connection summary from per-source health (Offline O1). A Hub problem is
 * named once for all of its sandboxes; otherwise the first degraded Host is named. Healthy
 * means no line at all, so one flaky source never turns Home into a status page.
 */
export function connectionNoticeSummary(summary: SourceHealthSummary): string | null {
  const lines: string[] = [];
  const hubByOrigin = new Map(summary.hubs.map((hub) => [hub.origin, hub]));
  for (const hub of summary.hubs) {
    const line = hubLine(hub);
    if (line) lines.push(line);
  }
  for (const status of summary.degraded) {
    const hub = status.hubOrigin === null ? undefined : hubByOrigin.get(status.hubOrigin);
    // Sandboxes of a Hub already named above are covered by that Hub's line.
    if (hub && hubLine(hub)) continue;
    lines.push(describeSourceProblem(status, hub?.label));
  }
  if (lines.length === 0) return null;
  const [first, ...rest] = lines;
  return rest.length ? offlineT("notice.more", { summary: first, count: rest.length }) : first!;
}

function hubLine(hub: HubSourceSummary): string | null {
  if (hub.state === "needs-sign-in" || hub.state === "revoked")
    return describeHubFailure(hub.state, hub.label);
  if (hub.state === "unreachable") return describeHubFailure("unreachable", hub.label);
  if (hub.total > 0 && hub.reachable < hub.total)
    return offlineT("hub.partial", {
      hub: hub.label,
      reachable: hub.reachable,
      total: hub.total,
    });
  return null;
}
