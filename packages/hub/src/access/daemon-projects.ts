import { z } from "zod";
import { authenticateDaemonRequest } from "../daemons/registration.js";
import type { Database } from "../db/types.js";
import { reportFailure } from "../failures/index.js";
import type { AccessStore } from "./store.js";
import { AgentConfigurationCatalogSchema, TerminalProfileCatalogSchema } from "./contract.js";
import { ProjectBotMarkerSchema } from "./project-bot-marker.js";

const publishedProjectSchema = z
  .object({
    projectId: z.string().min(1).max(256),
    name: z.string().trim().min(1).max(256),
    agentConfigurationCatalog: AgentConfigurationCatalogSchema.optional(),
    terminalProfileCatalog: TerminalProfileCatalogSchema.optional(),
    // COMPAT(clisbot-bot-project-marker): a Bot's home Project; absent from
    // older daemons and from every Project that is not a Bot's.
    bot: ProjectBotMarkerSchema.optional(),
  })
  .strict();
type PublishedProject = z.infer<typeof publishedProjectSchema>;

const replaceProjectsBodySchema = z.object({ projects: z.array(publishedProjectSchema) }).strict();

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
    body.data.projects.map(({ projectId, name, ...published }) =>
      Object.assign({ projectId, name }, projectMetadata(published)),
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

/** The published fields the Hub keeps in the Project row's `metadata`, only when one is present. */
function projectMetadata(
  published: Omit<PublishedProject, "projectId" | "name">,
): { metadata: Record<string, unknown> } | Record<never, never> {
  const metadata = Object.fromEntries(
    Object.entries(published).filter(([, value]) => value !== undefined),
  );
  return Object.keys(metadata).length === 0 ? {} : { metadata };
}
