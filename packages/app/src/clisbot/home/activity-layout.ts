import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { activitySections, type ActivityBucketOf } from "./activity";

// Hermes creates a platform collator for each localeCompare call. Reuse the same default
// collation while sorting a directory burst instead of creating thousands of ICU objects.
const identityCollator = new Intl.Collator();

/** Home remembers placement only. Every row's contents still come from the live directory. */
export interface ActivityLayoutSection {
  key: string;
  title: string;
  keys: string[];
}
export const activityKey = (agent: Pick<AggregatedAgent, "serverId" | "id">) =>
  `${agent.serverId}:${agent.id}`;

export function activityLayout(
  agents: AggregatedAgent[],
  now: Date,
  previous: ActivityLayoutSection[] = [],
  bucketOf?: ActivityBucketOf,
): ActivityLayoutSection[] {
  // Equal timestamps must not inherit the order in which independent Hosts answered.
  const ordered = [...agents].sort((a, b) =>
    identityCollator.compare(activityKey(a), activityKey(b)),
  );
  return activitySections(ordered, now, undefined, bucketOf).map((section) => {
    let keys = section.agents.map(activityKey);
    if (section.key === "active" || section.key === "needs" || section.key === "seen") {
      const oldKeys = previous.find((old) => old.key === section.key)?.keys ?? [];
      const current = new Set(keys);
      const old = new Set(oldKeys);
      keys = [...oldKeys.filter((key) => current.has(key)), ...keys.filter((key) => !old.has(key))];
    }
    return { key: section.key, title: section.title, keys };
  });
}

/** Count affected conversations, excluding rows merely pushed down by a new arrival. */
export function activityLayoutChanges(
  before: ActivityLayoutSection[],
  after: ActivityLayoutSection[],
): number {
  const oldGroups = new Map(before.flatMap((s) => s.keys.map((key) => [key, s.key] as const)));
  const newGroups = new Map(after.flatMap((s) => s.keys.map((key) => [key, s.key] as const)));
  const changed = new Set<string>();
  for (const key of new Set([...oldGroups.keys(), ...newGroups.keys()])) {
    if (oldGroups.get(key) !== newGroups.get(key)) changed.add(key);
  }
  for (const section of before) {
    const oldKeys = section.keys.filter((key) => !changed.has(key));
    const newKeys =
      after.find((s) => s.key === section.key)?.keys.filter((key) => !changed.has(key)) ?? [];
    for (const [index, key] of oldKeys.entries()) {
      if (newKeys[index] !== key) changed.add(key);
    }
  }
  return changed.size;
}

export function visibleActivityLayout(
  layout: ActivityLayoutSection[],
  limit: number,
): ActivityLayoutSection[] {
  let recentLeft = limit;
  return layout
    .map((section) => {
      if (!section.key.startsWith("date:") && section.key !== "seen")
        return { ...section, keys: section.keys.slice(0, limit) };
      if (section.key === "seen") return section;
      const keys = section.keys.slice(0, recentLeft);
      recentLeft -= keys.length;
      return { ...section, keys };
    })
    .filter((section) => section.keys.length || section.key === "recent");
}
