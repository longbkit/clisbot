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
  return groupActivity(sorted, now, limit, bucketOf);
}

/** `activitySections` for sessions already newest first. */
export function groupActivity(
  sorted: readonly AggregatedAgent[],
  now: Date,
  limit: number | undefined,
  bucketOf: ActivityBucketOf,
): ActivitySection[] {
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
  // Titles are looked up once per day, not once per conversation: a translation or a date format
  // per row dominated Home's layout pass at a few thousand sessions.
  const titleOfDay = new Map<number, string>();
  const dateSections = new Map<string, ActivitySection>();
  let dateFormatter: Intl.DateTimeFormat | undefined;
  const titleFor = (date: Date): string => {
    if (date >= today) return i18n.t("home.activity.today");
    if (date >= yesterday) return i18n.t("home.activity.yesterday");
    if (Number.isNaN(date.getTime())) return date.toLocaleDateString();
    // Construct once per grouping pass, rather than once for every older conversation.
    dateFormatter ??= new Intl.DateTimeFormat(i18n.resolvedLanguage, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    return dateFormatter.format(date);
  };
  for (const agent of recent) {
    const date = agent.lastActivityAt;
    const day = date.getFullYear() * 10_000 + date.getMonth() * 100 + date.getDate();
    let title = titleOfDay.get(day);
    if (title === undefined) {
      title = titleFor(date);
      // An invalid date has no day; every one of them shares a title anyway.
      titleOfDay.set(day, title);
    }
    let section = dateSections.get(title);
    if (!section) {
      section = { key: `date:${title}`, title, agents: [] };
      dateSections.set(title, section);
      sections.push(section);
    }
    section.agents.push(agent);
  }
  const seen = take(buckets.seen);
  if (seen.length)
    sections.push({ key: "seen", title: i18n.t("home.activity.seenIssues"), agents: seen });
  return sections.filter((s) => s.agents.length || s.key === "recent");
}
