import { z } from "zod";
import { authenticateDaemonRequest } from "../daemons/registration.js";
import type { Database } from "../db/types.js";
import { reportFailure } from "../failures/index.js";
import type { AccessStore } from "./store.js";
import { AgentConfigurationCatalogSchema } from "./contract.js";

const replaceProjectsBodySchema = z
  .object({
    projects: z.array(
      z
        .object({
          projectId: z.string().min(1).max(256),
          name: z.string().trim().min(1).max(256),
          agentConfigurationCatalog: AgentConfigurationCatalogSchema.optional(),
        })
        .strict(),
    ),
  })
  .strict();

/** Replaces the enrolled daemon's current Project catalog with one atomic snapshot. */
export async function replaceDaemonProjects(
  request: Request,
  daemonId: string,
  database: Database,
  access: AccessStore,
): Promise<Response> {
  const daemon = await authenticateDaemonRequest(request, daemonId, database);
  if (daemon instanceof Response) return daemon;
  if (daemon.status !== "active") {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  let value: unknown;
  try {
    value = await request.json();
  } catch (error) {
    reportFailure(
      error,
      { operation: "access.daemon-projects.replace.parse", component: "access" },
      { kind: "validation" },
    );
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const body = replaceProjectsBodySchema.safeParse(value);
  if (!body.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  const machine = await database.findMachineById(daemon.machineId);
  if (machine === undefined) return Response.json({ error: "daemon_unavailable" }, { status: 404 });
  const projects = await access.replaceDaemonProjects(
    machine.orgId,
    daemon.id,
    body.data.projects.map(({ projectId, name, agentConfigurationCatalog }) =>
      Object.assign(
        { projectId, name },
        agentConfigurationCatalog === undefined ? {} : { metadata: { agentConfigurationCatalog } },
      ),
    ),
  );
  return Response.json({
    projects: projects.map((project) => ({
      id: project.id,
      projectId: project.projectId,
      name: project.name,
      available: project.available,
      observedAt: project.observedAt.toISOString(),
    })),
  });
}
