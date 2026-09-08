// `/agent <name>` and `/model <name>`: the conversation's target, chosen from
// the menu its route offers.
//
// The menu is closed on purpose. A channel command that could name ANY agent or
// ANY model would let a member of one conversation reach every environment the
// Hub can run, so a route that authored no `agents:` / `models:` list refuses
// both commands rather than accepting a free-text name.
import type { CompiledRoute } from "../config/compile.js";

/** What a route offers, with the route's own target folded in. */
export interface ChannelSelectionMenu {
  /** Selectable agent names, the route's own target first. */
  agents: readonly string[];
  /** Selectable model ids; empty means `/model` is refused on this route. */
  models: readonly string[];
}

/**
 * The menu for one route. The route's own `agent:` is always selectable — that
 * is how a conversation switched away from it gets back — and never repeated.
 */
export function selectionMenu(route: CompiledRoute): ChannelSelectionMenu {
  const own = route.target.kind === "agent" ? route.target.agent : undefined;
  const listed = route.selectable?.agents ?? [];
  const agents = own === undefined ? [...listed] : [own, ...listed.filter((n) => n !== own)];
  return { agents, models: [...(route.selectable?.models ?? [])] };
}

export type ChannelSelectionResult =
  | { ok: true; kind: "agent" | "model"; value: string }
  | { ok: false; message: string };

/** Resolve one `/agent` or `/model` argument against the route's menu. */
export function resolveSelection(
  kind: "agent" | "model",
  value: string,
  route: CompiledRoute,
): ChannelSelectionResult {
  const menu = selectionMenu(route);
  const options = kind === "agent" ? menu.agents : menu.models;
  // A one-entry agent menu is the route's own target: nothing to switch to.
  const switchable = kind === "agent" ? options.length > 1 : options.length > 0;
  if (!switchable) {
    return { ok: false, message: `This route offers no ${kind} choices.` };
  }
  const match = options.find((option) => option.toLowerCase() === value.trim().toLowerCase());
  if (match === undefined) {
    return { ok: false, message: `Unknown ${kind}. Options: ${options.join(", ")}.` };
  }
  return { ok: true, kind, value: match };
}
