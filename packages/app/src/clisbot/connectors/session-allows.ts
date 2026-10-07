import type { SessionToolSet } from "./session-connectors";

/** The set with what this session may use beyond the Project added to what the Project gives. */
export function withAllows(
  set: SessionToolSet,
  tools: readonly string[],
  allows: ReadonlySet<string>,
) {
  const extra = tools.filter((tool) => allows.has(set.keyOf(tool)) && !set.given.includes(tool));
  return extra.length > 0 ? { ...set, given: [...set.given, ...extra] } : set;
}
