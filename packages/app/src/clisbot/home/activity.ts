import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
export interface ActivitySection {
  key: string;
  title: string;
  agents: AggregatedAgent[];
}
/** A finished reply the user has not read yet: Recent, with an unread mark, not Needs you. */
export function isUnreadReply(agent: AggregatedAgent): boolean {
  return Boolean(agent.requiresAttention) && agent.attentionReason === "finished";
}

/** Needs you is only what blocks work: an approval to give or a failure to look at. */
export function activityBucket(agent: AggregatedAgent): "needs" | "active" | "recent" {
  const blocking =
    agent.status === "error" ||
    (agent.pendingPermissionCount ?? 0) > 0 ||
    (Boolean(agent.requiresAttention) && !isUnreadReply(agent));
  if (!agent.archivedAt && blocking) return "needs";
  if (!agent.archivedAt && (agent.status === "running" || agent.status === "initializing"))
    return "active";
  return "recent";
}
export function activitySections(
  agents: AggregatedAgent[],
  now = new Date(),
  limit?: number,
): ActivitySection[] {
  const sorted = [...agents].sort(
    (a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime(),
  );
  const take = (rows: AggregatedAgent[]) => (limit ? rows.slice(0, limit) : rows);
  const sections: ActivitySection[] = [
    {
      key: "needs",
      title: "Needs you",
      agents: take(sorted.filter((a) => activityBucket(a) === "needs")),
    },
    {
      key: "active",
      title: "Active",
      agents: take(sorted.filter((a) => activityBucket(a) === "active")),
    },
  ];
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const recent = take(sorted.filter((a) => activityBucket(a) === "recent"));
  if (recent.length) sections.push({ key: "recent", title: "Recent", agents: [] });
  let dateFormatter: Intl.DateTimeFormat | undefined;
  for (const agent of recent) {
    const date = agent.lastActivityAt;
    let title: string;
    if (date >= today) title = "Today";
    else if (date >= yesterday) title = "Yesterday";
    else if (Number.isNaN(date.getTime())) title = date.toLocaleDateString();
    else {
      // Construct once per grouping pass, rather than once for every older conversation.
      dateFormatter ??= new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
      title = dateFormatter.format(date);
    }
    let section = sections.find((s) => s.key === `date:${title}`);
    if (!section) {
      section = { key: `date:${title}`, title, agents: [] };
      sections.push(section);
    }
    section.agents.push(agent);
  }
  return sections.filter((s) => s.agents.length || s.key === "recent");
}
