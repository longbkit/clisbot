import { i18n } from "@/i18n/i18next";
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
/** Where a conversation sits; Navigation V2 adds `seen`, its collapsed Seen issues group. */
export type ActivityBucketOf = (agent: AggregatedAgent) => "needs" | "active" | "recent" | "seen";

export function activitySections(
  agents: AggregatedAgent[],
  now = new Date(),
  limit?: number,
  bucketOf: ActivityBucketOf = activityBucket,
): ActivitySection[] {
  const sorted = [...agents].sort(
    (a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime(),
  );
  const take = (rows: AggregatedAgent[]) => (limit ? rows.slice(0, limit) : rows);
  // One classification per agent, whatever the number of buckets; each keeps the sorted order.
  const buckets = { needs: [], active: [], recent: [], seen: [] } as Record<
    ReturnType<ActivityBucketOf>,
    AggregatedAgent[]
  >;
  for (const agent of sorted) buckets[bucketOf(agent)].push(agent);
  const sections: ActivitySection[] = [
    { key: "needs", title: i18n.t("home.activity.needsYou"), agents: take(buckets.needs) },
    { key: "active", title: i18n.t("home.activity.active"), agents: take(buckets.active) },
  ];
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const recent = take(buckets.recent);
  if (recent.length)
    sections.push({ key: "recent", title: i18n.t("home.activity.recent"), agents: [] });
  let dateFormatter: Intl.DateTimeFormat | undefined;
  for (const agent of recent) {
    const date = agent.lastActivityAt;
    let title: string;
    if (date >= today) title = i18n.t("home.activity.today");
    else if (date >= yesterday) title = i18n.t("home.activity.yesterday");
    else if (Number.isNaN(date.getTime())) title = date.toLocaleDateString();
    else {
      // Construct once per grouping pass, rather than once for every older conversation.
      dateFormatter ??= new Intl.DateTimeFormat(i18n.resolvedLanguage, {
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
  const seen = take(buckets.seen);
  if (seen.length)
    sections.push({ key: "seen", title: i18n.t("home.activity.seenIssues"), agents: seen });
  return sections.filter((s) => s.agents.length || s.key === "recent");
}
