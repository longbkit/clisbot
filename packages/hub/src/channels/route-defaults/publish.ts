// Publishing a Route default from a conversation (`/promoteroutedefault`). The
// change is an ordinary Channel revision: the same compile guard and
// delegation check as a Hub UI save, attributed to the Member who sent the
// command, and written only if nobody published in between.

import type { Database } from "../../db/types.js";
import { AccessPolicyError } from "../../access/store.js";
import { ChannelConfigurationConflictError } from "../../db/errors.js";
import { catchAllRoute } from "../approvals/index.js";
import type { AgentControls } from "../config/agent-controls.js";
import type { CompiledRoute } from "../config/compile.js";
import { loadChannelControlPlane, type ChannelControlPlaneSnapshot } from "../control-plane.js";
import { deployRevision, type ChannelConfigurationCandidate } from "../http/configuration.js";
import {
  previousRouteAgentControls,
  routeIdentity,
  writeRouteAgentControls,
  type RoutePosition,
} from "./files.js";

/** How far back undo looks for the value before a Route default's last change. */
const UNDO_REVISION_LIMIT = 50;

export interface RouteDefaultPrincipal {
  membershipId: string;
  userId: string;
}

/** The Route a conversation is served by, as the running plane compiled it. */
export interface RouteDefaultTarget {
  organizationId: string;
  channel: string;
  accountId: string;
  position: RoutePosition;
  route: CompiledRoute;
  principal: RouteDefaultPrincipal;
}

export type RouteDefaultOutcome =
  | { status: "published"; agentControls: AgentControls | undefined }
  | { status: "route_changed" }
  | { status: "nothing_to_undo" }
  /** Delegation refused: the Route would start an agent the Member cannot. */
  | { status: "outside_access" };

export interface RouteDefaultPublisher {
  promote(target: RouteDefaultTarget, controls: AgentControls): Promise<RouteDefaultOutcome>;
  undo(target: RouteDefaultTarget): Promise<RouteDefaultOutcome>;
  /** Bring running accounts to the active revision. Call after the reply is posted. */
  apply(): void;
}

export interface RouteDefaultPublisherOptions {
  database: Database;
  publicBaseUrl?: string;
  /** Delegation for the changed Route only: the Member may start what it starts. */
  authorize(input: {
    principal: RouteDefaultPrincipal & { organizationId: string };
    candidate: ChannelConfigurationCandidate;
    route: { channel: string; accountId: string; position: RoutePosition };
  }): Promise<void>;
  apply(): void;
}

export function createRouteDefaultPublisher(
  options: RouteDefaultPublisherOptions,
): RouteDefaultPublisher {
  const publish = async (
    target: RouteDefaultTarget,
    controls: (
      snapshot: ChannelControlPlaneSnapshot,
    ) => { value: AgentControls | undefined } | undefined,
  ): Promise<RouteDefaultOutcome> => {
    const snapshot = await loadChannelControlPlane(
      options.database,
      target.organizationId,
      options.publicBaseUrl,
    );
    const current = compiledRoute(snapshot.controlPlane, target);
    if (current === undefined || routeIdentity(current) !== routeIdentity(target.route)) {
      return { status: "route_changed" };
    }
    const next = controls(snapshot);
    if (next === undefined) return { status: "nothing_to_undo" };
    const files = writeRouteAgentControls(
      snapshot.files,
      target.channel,
      target.accountId,
      target.position,
      next.value,
    );
    try {
      await deployRevision(options.database, snapshot, files, {
        createdByUserId: target.principal.userId,
        expectedRevisionId: snapshot.revision?.id ?? null,
        authorize: (candidate) =>
          options.authorize({
            principal: { ...target.principal, organizationId: target.organizationId },
            candidate,
            route: {
              channel: target.channel,
              accountId: target.accountId,
              position: target.position,
            },
          }),
      });
    } catch (error) {
      if (error instanceof ChannelConfigurationConflictError) return { status: "route_changed" };
      if (error instanceof AccessPolicyError) return { status: "outside_access" };
      throw error;
    }
    return { status: "published", agentControls: next.value };
  };

  return {
    promote: (target, controls) => publish(target, () => ({ value: controls })),
    undo: async (target) => {
      const revisions = await options.database.listChannelConfigurationRevisions(
        target.organizationId,
        UNDO_REVISION_LIMIT,
      );
      return publish(target, (snapshot) => {
        const activeVersion = snapshot.revision?.version ?? 0;
        const older = revisions.filter(({ version }) => version < activeVersion);
        const previous = previousRouteAgentControls(
          [snapshot.files, ...older.map(({ files }) => files)],
          target.channel,
          target.accountId,
          target.position,
        );
        return previous.found ? { value: previous.controls } : undefined;
      });
    },
    apply: options.apply,
  };
}

function compiledRoute(
  controlPlane: ChannelControlPlaneSnapshot["controlPlane"],
  target: RouteDefaultTarget,
): CompiledRoute | undefined {
  const account = controlPlane.accounts.find(
    (candidate) => candidate.channel === target.channel && candidate.accountId === target.accountId,
  );
  if (account === undefined) return undefined;
  if (target.position !== "fallback") return account.routes[target.position];
  return account.fallback.deny ? undefined : catchAllRoute(account.fallback);
}
