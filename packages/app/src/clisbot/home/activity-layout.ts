import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { activityBucket, groupActivity, type ActivityBucketOf } from "./activity";

/** Home remembers placement only. Every row's contents still come from the live directory. */
export interface ActivityLayoutSection {
  key: string;
  title: string;
  keys: string[];
}
// Rows keep their object until their content changes, so a key is built once per row, not once
// per layout pass.
const builtKeys = new WeakMap<object, string>();

export function activityKey(agent: Pick<AggregatedAgent, "serverId" | "id">): string {
  let key = builtKeys.get(agent);
  if (key === undefined) {
    key = `${agent.serverId}:${agent.id}`;
    builtKeys.set(agent, key);
  }
  return key;
}

/**
 * Newest first. Equal timestamps must not inherit the order in which independent Hosts
 * answered; any fixed order will do, so they go by key as plain text (a locale collator costs
 * an ICU call per comparison on Hermes).
 */
function compareRecency(left: AggregatedAgent, right: AggregatedAgent): number {
  const byTime = right.lastActivityAt.getTime() - left.lastActivityAt.getTime();
  if (byTime) return byTime;
  const a = activityKey(left);
  const b = activityKey(right);
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * `agents` newest first. The aggregated list is already newest first apart from open turns
 * leading it and the order of equal timestamps, so this is one pass that splits it into
 * newest-first runs and a merge of the runs, not a sort.
 */
function newestFirst(agents: readonly AggregatedAgent[]): AggregatedAgent[] {
  let runs: AggregatedAgent[][] = [];
  let run: AggregatedAgent[] = [];
  let lastTime = Number.POSITIVE_INFINITY;
  for (const agent of agents) {
    const time = agent.lastActivityAt.getTime();
    if (time > lastTime) {
      runs.push(settleTies(run));
      run = [];
    }
    run.push(agent);
    lastTime = time;
  }
  runs.push(settleTies(run));
  while (runs.length > 1) {
    const merged: AggregatedAgent[][] = [];
    for (let i = 0; i < runs.length; i += 2) {
      merged.push(runs[i + 1] ? mergeRuns(runs[i]!, runs[i + 1]!) : runs[i]!);
    }
    runs = merged;
  }
  return runs[0]!;
}

/** A run newest first by time, with each group of equal timestamps put in key order. */
function settleTies(run: AggregatedAgent[]): AggregatedAgent[] {
  let start = 0;
  while (start < run.length) {
    const time = run[start]!.lastActivityAt.getTime();
    let end = start + 1;
    while (end < run.length && run[end]!.lastActivityAt.getTime() === time) end += 1;
    if (end - start > 1) {
      const group = run.slice(start, end).sort(compareRecency);
      run.splice(start, group.length, ...group);
    }
    start = end;
  }
  return run;
}

function mergeRuns(left: AggregatedAgent[], right: AggregatedAgent[]): AggregatedAgent[] {
  const merged: AggregatedAgent[] = [];
  let l = 0;
  let r = 0;
  while (l < left.length && r < right.length) {
    merged.push(compareRecency(left[l]!, right[r]!) <= 0 ? left[l++]! : right[r++]!);
  }
  return merged.concat(left.slice(l), right.slice(r));
}

export function activityLayout(
  agents: AggregatedAgent[],
  now: Date,
  previous: ActivityLayoutSection[] = [],
  bucketOf: ActivityBucketOf = activityBucket,
): ActivityLayoutSection[] {
  return groupActivity(newestFirst(agents), now, undefined, bucketOf).map((section) => {
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
