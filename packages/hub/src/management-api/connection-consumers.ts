import { and, asc, eq } from "drizzle-orm";
import { loadChannelControlPlane } from "../channels/control-plane.js";
import type { DatabaseRuntime } from "../db/runtime/index.js";
import * as schema from "../db/schema.js";
import type { Database } from "../db/types.js";

export type ConnectionConsumerResourceKind = "channel_account" | "automation" | "project";

/** A configured resource that still depends on one organization Connection. */
export interface ConnectionConsumer {
  resourceKind: ConnectionConsumerResourceKind;
  resourceId: string;
  name: string;
}

/**
 * Builds the Connection dependency graph from the stores that already own each resource.
 * There is deliberately no second consumer registry to reconcile.
 */
export async function connectionConsumersById(options: {
  database: Database;
  runtime: DatabaseRuntime;
  organizationId: string;
}): Promise<ReadonlyMap<string, readonly ConnectionConsumer[]>> {
  const [channelControlPlane, automations, projects] = await Promise.all([
    loadChannelControlPlane(options.database, options.organizationId),
    options.runtime
      .drizzle()
      .select({
        connectionId: schema.organizationTriggerRoutes.connectionId,
        id: schema.organizationTriggers.id,
        name: schema.organizationTriggers.name,
      })
      .from(schema.organizationTriggerRoutes)
      .innerJoin(
        schema.organizationTriggers,
        and(
          eq(schema.organizationTriggers.id, schema.organizationTriggerRoutes.triggerId),
          eq(
            schema.organizationTriggers.organizationId,
            schema.organizationTriggerRoutes.organizationId,
          ),
        ),
      )
      .where(eq(schema.organizationTriggerRoutes.organizationId, options.organizationId))
      .orderBy(asc(schema.organizationTriggers.name), asc(schema.organizationTriggers.id)),
    options.runtime
      .drizzle()
      .select({
        connectionId: schema.projectTriggerRoutes.connectionId,
        id: schema.projects.id,
        name: schema.projects.name,
      })
      .from(schema.projectTriggerRoutes)
      .innerJoin(
        schema.projects,
        and(
          eq(schema.projects.id, schema.projectTriggerRoutes.projectId),
          eq(schema.projects.organizationId, schema.projectTriggerRoutes.organizationId),
        ),
      )
      .where(eq(schema.projectTriggerRoutes.organizationId, options.organizationId))
      .orderBy(asc(schema.projects.name), asc(schema.projects.id)),
  ]);

  return groupedConsumers([
    ...channelControlPlane.controlPlane.accounts.map((account) => ({
      connectionId: account.connectionId,
      resourceKind: "channel_account" as const,
      resourceId: `${account.channel}/${account.accountId}`,
      name: `${account.channel} · ${account.accountId}`,
    })),
    ...automations.map((automation) => ({
      connectionId: automation.connectionId,
      resourceKind: "automation" as const,
      resourceId: automation.id,
      name: automation.name,
    })),
    ...projects.map((project) => ({
      connectionId: project.connectionId,
      resourceKind: "project" as const,
      resourceId: project.id,
      name: project.name,
    })),
  ]);
}

function groupedConsumers(
  consumers: readonly (ConnectionConsumer & { connectionId: string })[],
): ReadonlyMap<string, readonly ConnectionConsumer[]> {
  const grouped = new Map<string, Map<string, ConnectionConsumer>>();
  for (const { connectionId, ...consumer } of consumers) {
    const entries = grouped.get(connectionId) ?? new Map<string, ConnectionConsumer>();
    entries.set(`${consumer.resourceKind}:${consumer.resourceId}`, consumer);
    grouped.set(connectionId, entries);
  }
  return new Map(
    Array.from(grouped, ([connectionId, entries]) => [connectionId, Array.from(entries.values())]),
  );
}
