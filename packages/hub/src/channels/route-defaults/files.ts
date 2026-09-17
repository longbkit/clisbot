// Reading and writing one Route's `agentControls:` and `interaction.followUp:`
// leaves in the authored account file, and finding the controls it had before
// their last change. Pure functions of revision files; `publish.ts` owns
// loading, authority and deployment.

import { dump, load } from "js-yaml";
import { CHANNELS_DIRECTORY, type HubBundleFile } from "../../config/bundle-contract.js";
import { routeFingerprint } from "../bindings/stored-route.js";
import type { AgentControls } from "../config/agent-controls.js";
import type { CompiledRoute } from "../config/compile.js";
import type { RouteFollowUpChange } from "../commands-follow-up-arguments.js";
import { AccountFileSchema, type AccountFile, type Route } from "../config/schema.js";

/** A Route's place in its account file: an index into `routes`, or the fallback. */
export type RoutePosition = number | "fallback";

/** Where one account's authored file lives in a revision. */
export function accountFilePath(channel: string, accountId: string): string {
  return `${CHANNELS_DIRECTORY}/${channel}/${accountId}.yml`;
}

/**
 * A compiled Route's identity apart from its default Agent controls. Two
 * revisions that differ only in that leaf hold the same Route, which is what
 * lets a default change without the conversation's Route "moving".
 */
export function routeIdentity(route: CompiledRoute): string {
  const { agentControls: _controls, ...defaults } = route.defaults;
  return routeFingerprint({ ...route, defaults });
}

/** The authored Route at a position, or undefined when the file or Route is absent. */
export function authoredRoute(
  files: readonly HubBundleFile[],
  channel: string,
  accountId: string,
  position: RoutePosition,
): Route | undefined {
  const account = authoredAccount(files, channel, accountId);
  if (account === undefined) return undefined;
  if (position === "fallback") {
    const fallback = account.fallback;
    return fallback === undefined || "deny" in fallback ? undefined : (fallback as Route);
  }
  return account.routes?.[position];
}

/** Replace the account file with one whose Route at `position` has `controls`. */
export function writeRouteAgentControls(
  files: readonly HubBundleFile[],
  channel: string,
  accountId: string,
  position: RoutePosition,
  controls: AgentControls | undefined,
): HubBundleFile[] {
  return writeRoute(files, channel, accountId, position, (route) => {
    if (controls === undefined) delete route.agentControls;
    else route.agentControls = controls;
  });
}

/**
 * Replace the account file with one whose Route at `position` has `change`
 * applied to its `interaction.followUp`. Authored leaves the change does not
 * name stay, so `mention-only` keeps a window for a later `auto`.
 */
export function writeRouteFollowUp(
  files: readonly HubBundleFile[],
  channel: string,
  accountId: string,
  position: RoutePosition,
  change: RouteFollowUpChange,
): HubBundleFile[] {
  return writeRoute(files, channel, accountId, position, (route) => {
    route.interaction = {
      ...route.interaction,
      followUp: { ...route.interaction?.followUp, ...change },
    };
  });
}

function writeRoute(
  files: readonly HubBundleFile[],
  channel: string,
  accountId: string,
  position: RoutePosition,
  edit: (route: Route) => void,
): HubBundleFile[] {
  const path = accountFilePath(channel, accountId);
  const account = authoredAccount(files, channel, accountId);
  if (account === undefined) throw new Error(`account file ${path} is not in the revision`);
  const next = structuredClone(account);
  const route =
    position === "fallback" ? (next.fallback as Route | undefined) : next.routes?.[position];
  if (route === undefined || "deny" in route)
    throw new Error(`route ${position} is not in ${path}`);
  edit(route);
  const content = dump(next, { lineWidth: -1 });
  return files.map((file) => (file.path === path ? { path, content } : file));
}

/**
 * The Route's `agentControls` before its most recent change, scanning
 * revisions newest first (the active one first). The scan stops where the
 * Route itself was different, so undo never reaches past a reorder or an edit
 * of the Route's match, target or other defaults. `found: false` means there is
 * no earlier value to restore.
 */
export function previousRouteAgentControls(
  revisions: readonly (readonly HubBundleFile[])[],
  channel: string,
  accountId: string,
  position: RoutePosition,
): { found: true; controls: AgentControls | undefined } | { found: false } {
  const [active, ...older] = revisions;
  const current = active && authoredRoute(active, channel, accountId, position);
  if (current === undefined) return { found: false };
  const identity = authoredIdentity(current);
  const currentControls = JSON.stringify(current.agentControls ?? null);
  for (const files of older) {
    const route = authoredRoute(files, channel, accountId, position);
    if (route === undefined || authoredIdentity(route) !== identity) return { found: false };
    if (JSON.stringify(route.agentControls ?? null) !== currentControls) {
      return { found: true, controls: route.agentControls };
    }
  }
  return { found: false };
}

function authoredIdentity(route: Route): string {
  const { agentControls: _controls, ...rest } = route;
  return JSON.stringify(rest);
}

function authoredAccount(
  files: readonly HubBundleFile[],
  channel: string,
  accountId: string,
): AccountFile | undefined {
  const file = files.find(({ path }) => path === accountFilePath(channel, accountId));
  if (file === undefined) return undefined;
  const parsed = AccountFileSchema.safeParse(load(file.content));
  return parsed.success ? parsed.data : undefined;
}
